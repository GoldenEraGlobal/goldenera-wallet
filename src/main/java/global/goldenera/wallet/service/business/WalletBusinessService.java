/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2025-2030 The GoldenEraGlobal Developers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
package global.goldenera.wallet.service.business;

import static lombok.AccessLevel.PRIVATE;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Supplier;

import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.units.ethereum.Wei;
import org.springframework.stereotype.Service;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.serialization.tx.TxDecoder;
import global.goldenera.wallet.api.core.v1.wallet.dtos.MempoolRecommendedFeesDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TokenDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TransactionStatusDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TransactionStatusDtoV1.Status;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferPageDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.WalletBalanceDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapper;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.AccountSummaryDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainTxDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainTxMetadataDtoV1;
import global.goldenera.wallet.client.node.model.v1.BulkMemTransferPageRequestV1.TransferTypeEnum;
import global.goldenera.wallet.client.node.model.v1.BulkTransferPageRequestV1;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.MempoolResult;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.TxDtoV1;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.exceptions.GEValidationException;
import global.goldenera.wallet.exceptions.UpstreamObservationUnstableException;
import global.goldenera.wallet.service.node.BlockchainNodeService;
import global.goldenera.wallet.service.node.ExplorerNodeService;
import global.goldenera.wallet.utils.PaginationUtil;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

/**
 * Business service for wallet operations.
 * Handles balance fetching and unified transfer pagination.
 */
@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class WalletBusinessService {

    ExplorerNodeService explorerNodeService;
    BlockchainNodeService blockchainNodeService;
    WalletMapper walletMapper;

    public static final int MAX_ADDRESSES = 100;
    private static final int PAGE_SIZE = 100;
    private static final int MAX_RESULT_ROWS = 2_000;
    private static final int MAX_RAW_HISTORY_ROWS = MAX_RESULT_ROWS * 2;
    private static final int MAX_BALANCE_PAGE_CALLS_PER_OBSERVATION = 40;
    private static final int MAX_HISTORY_PAGE_CALLS_PER_OBSERVATION = 40;
    private static final int MAX_STABILITY_OBSERVATIONS = 3;
    private static final Duration STABILITY_QUERY_BUDGET = Duration.ofSeconds(30);
    private static final Duration HISTORY_SNAPSHOT_TTL = Duration.ofSeconds(20);
    private static final int MAX_HISTORY_SNAPSHOT_BYTES = 16 * 1024 * 1024;
    private static final int MAX_CACHED_HISTORY_BYTES = 64 * 1024 * 1024;
    private static final int TRANSACTION_STATUS_CALLS_PER_OBSERVATION = 4;
    private static final int MAX_TRANSACTION_STATUS_OBSERVATIONS = 3;
    private static final long FINAL_TRANSACTION_CONFIRMATIONS = 6L;
    private static final String REQUIRED_TRANSACTION_CONFIRMATIONS = Long.toString(FINAL_TRANSACTION_CONFIRMATIONS);
    private static final Duration TRANSACTION_STATUS_QUERY_BUDGET = Duration.ofSeconds(30);
    public static final int MAX_SIGNED_TX_BYTES = 100_000;
    private static final int MAX_HISTORY_MESSAGE_CHARACTERS = MAX_SIGNED_TX_BYTES;
    private static final int MAX_DECIMAL_DIGITS = 78;
    private static final BigInteger MAX_UINT256 = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE);

    Cache<HistoryQueryKey, HistoryObservation> historySnapshots = Caffeine.newBuilder()
            .expireAfterWrite(HISTORY_SNAPSHOT_TTL)
            .maximumWeight(MAX_CACHED_HISTORY_BYTES)
            .weigher((HistoryQueryKey key, HistoryObservation value) -> historyCacheWeight(key, value))
            .build();

    /** Returns a stable bounded observation of all requested balances. */
    public List<WalletBalanceDtoV1> getBalances(Set<Address> addresses, Set<Address> tokenAddresses) {
        validateAddresses(addresses, tokenAddresses);
        BalanceObservation observation = stableBalanceObservation(addresses, tokenAddresses);
        return observation.balances().stream().map(balance -> {
            BigInteger pending = observation.outgoing()
                    .getOrDefault(new BalanceKey(balance.address(), balance.tokenAddress()), BigInteger.ZERO);
            BigInteger available = balance.spendableBalance().toBigInteger().subtract(pending).max(BigInteger.ZERO);
            return new WalletBalanceDtoV1(balance.address(), balance.tokenAddress(), Wei.valueOf(available),
                    balance.updatedAtBlockHeight(), balance.updatedAtTimestamp(), balance.totalBalance(),
                    balance.lockedMiningReward(), balance.spendableBalance());
        }).toList();
    }

    private BalanceObservation stableBalanceObservation(Set<Address> addresses, Set<Address> tokenAddresses) {
        QueryBudget budget = QueryBudget.forBalances();
        BalanceObservation previous = null;
        for (int observation = 0; observation < MAX_STABILITY_OBSERVATIONS; observation++) {
            BalanceObservation current = readBalanceObservation(
                    addresses, tokenAddresses, budget, new RawRowBudget(MAX_RESULT_ROWS));
            if (previous != null && previous.fingerprint().equals(current.fingerprint())) {
                return current;
            }
            previous = current;
        }
        throw new UpstreamObservationUnstableException(
                "Wallet balances did not stabilize within the bounded observation budget");
    }

    private BalanceObservation readBalanceObservation(Set<Address> addresses, Set<Address> tokenAddresses,
            QueryBudget budget, RawRowBudget rowBudget) {
        PageDataset<WalletBalanceDtoV1> balanceData = readBalanceRows(
                addresses, tokenAddresses, budget, rowBudget);
        PageDataset<PendingReservation> pendingData = readPendingRows(
                addresses, tokenAddresses, budget, rowBudget);
        List<PendingReservation> normalizedPending = normalizePendingReservations(pendingData.rows());
        Map<BalanceKey, BigInteger> outgoing = aggregatePending(addresses, normalizedPending);

        List<String> canonicalBalances = balanceData.rows().stream()
                .map(WalletBusinessService::canonicalBalance)
                .sorted()
                .toList();
        List<String> canonicalPending = normalizedPending.stream()
                .map(PendingReservation::canonical)
                .toList();
        String fingerprint = fingerprint(List.of(
                "balances:" + canonicalBalances.size(),
                String.join("\n", canonicalBalances),
                "pending:" + canonicalPending.size(),
                String.join("\n", canonicalPending)));

        List<WalletBalanceDtoV1> ordered = balanceData.rows().stream()
                .sorted(Comparator.comparing(WalletBusinessService::canonicalBalance))
                .toList();
        return new BalanceObservation(ordered, outgoing, fingerprint);
    }

    private PageDataset<WalletBalanceDtoV1> readBalanceRows(Set<Address> addresses, Set<Address> tokenAddresses,
            QueryBudget budget, RawRowBudget rowBudget) {
        List<WalletBalanceDtoV1> balances = new ArrayList<>();
        Set<BalanceKey> keys = new HashSet<>();
        int pageNumber = 0;
        Long expectedTotal = null;
        do {
            int requestedPage = pageNumber++;
            AccountBalanceDtoV1Page page = budget.call(() -> explorerNodeService.getAccountBalancesBulkForObservation(
                    requestedPage, PAGE_SIZE, addresses, tokenAddresses));
            if (page == null || page.getList() == null) {
                throw new GEFailedException("Node returned an invalid balance page");
            }
            long total = checkedTotal(page.getTotalElements());
            if (expectedTotal == null) {
                rowBudget.declareDataset("balance", total);
            }
            expectedTotal = consistentTotal("balance", expectedTotal, total);
            checkPageCompleteness("balance", requestedPage, total, page.getList().size());
            for (var source : page.getList()) {
                if (source == null) {
                    throw new GEFailedException("Node returned an invalid account balance row");
                }
                WalletBalanceDtoV1 balance;
                try {
                    balance = walletMapper.toWalletBalance(source);
                } catch (RuntimeException exception) {
                    throw new GEFailedException("Node returned an invalid account balance");
                }
                if (balance == null || balance.address() == null || balance.tokenAddress() == null
                        || !addresses.contains(balance.address())
                        || (!tokenAddresses.isEmpty() && !tokenAddresses.contains(balance.tokenAddress()))) {
                    throw new GEFailedException("Node returned an unexpected account balance");
                }
                BalanceKey key = new BalanceKey(balance.address(), balance.tokenAddress());
                if (!keys.add(key)) {
                    throw new GEFailedException("Node returned a duplicate account balance");
                }
                balances.add(balance);
            }
        } while ((long) pageNumber * PAGE_SIZE < expectedTotal);
        return new PageDataset<>(expectedTotal, List.copyOf(balances));
    }

    private PageDataset<PendingReservation> readPendingRows(Set<Address> addresses, Set<Address> tokenAddresses,
            QueryBudget budget, RawRowBudget rowBudget) {
        boolean broad = tokenAddresses.isEmpty() || tokenAddresses.contains(Address.ZERO);
        Set<Address> pendingTokens = broad ? Set.of() : tokenAddresses;
        List<PendingReservation> rows = new ArrayList<>();
        int pageNumber = 0;
        Long expectedTotal = null;
        do {
            int requestedPage = pageNumber++;
            MemTransferDtoV1Page page = budget.call(() -> explorerNodeService.getOutgoingMemTransfersBulkForObservation(
                    requestedPage, PAGE_SIZE, addresses, pendingTokens));
            if (page == null || page.getList() == null) {
                throw new GEFailedException("Node returned an invalid pending page");
            }
            long total = checkedTotal(page.getTotalElements());
            if (expectedTotal == null) {
                rowBudget.declareDataset("pending", total);
            }
            expectedTotal = consistentTotal("pending", expectedTotal, total);
            checkPageCompleteness("pending", requestedPage, total, page.getList().size());
            for (MemTransferDtoV1 transfer : page.getList()) {
                if (transfer == null) {
                    throw new GEFailedException("Node returned an invalid pending row");
                }
                Address from = requiredAddress(transfer.getFrom(), "pending sender");
                if (transfer.getTransferType() == null) {
                    throw new GEFailedException("Node returned a pending transfer without a transfer type");
                }
                if (transfer.getAddedAt() == null) {
                    throw new GEFailedException("Node returned a pending transfer without an added timestamp");
                }
                Address token = requiredTokenAddress(transfer.getTokenAddress(), "pending token");
                if (!addresses.contains(from) || (!broad && !pendingTokens.contains(token))) {
                    throw new GEFailedException("Node returned an unexpected pending transfer");
                }
                BigInteger amount;
                if (isFeeOnlyGovernance(transfer)) {
                    if (transfer.getAmount() != null) {
                        throw new GEFailedException("Node returned an invalid governance pending amount");
                    }
                    amount = BigInteger.ZERO;
                } else {
                    amount = requiredDecimal(transfer.getAmount(), "pending amount");
                }
                rows.add(new PendingReservation(
                        normalizeRequiredHash(transfer.getHash(), "pending transaction hash"),
                        from,
                        token,
                        amount,
                        requiredDecimal(transfer.getFee(), "pending fee")));
            }
        } while ((long) pageNumber * PAGE_SIZE < expectedTotal);
        return new PageDataset<>(expectedTotal, List.copyOf(rows));
    }

    private List<PendingReservation> normalizePendingReservations(List<PendingReservation> rows) {
        Map<String, PendingReservation> seenHashes = new HashMap<>();
        for (PendingReservation transfer : rows) {
            PendingReservation previous = seenHashes.putIfAbsent(transfer.hash(), transfer);
            if (previous != null && !previous.equals(transfer)) {
                throw new GEFailedException("Node returned conflicting pending transfers for one hash");
            }
        }
        return seenHashes.values().stream()
                .sorted(Comparator.comparing(PendingReservation::canonical))
                .toList();
    }

    private Map<BalanceKey, BigInteger> aggregatePending(Set<Address> addresses, List<PendingReservation> rows) {
        Map<BalanceKey, BigInteger> outgoing = new HashMap<>();
        for (PendingReservation transfer : rows) {
            if (!addresses.contains(transfer.from())) {
                throw new GEFailedException("Node returned an unexpected pending sender");
            }
            if (transfer.amount().signum() != 0) {
                outgoing.merge(new BalanceKey(transfer.from(), transfer.token()), transfer.amount(),
                        WalletBusinessService::addUint256);
            }
            outgoing.merge(new BalanceKey(transfer.from(), Address.ZERO), transfer.fee(),
                    WalletBusinessService::addUint256);
        }
        return Map.copyOf(outgoing);
    }

    private static boolean isFeeOnlyGovernance(MemTransferDtoV1 transfer) {
        return transfer.getTransferType() == MemTransferDtoV1.TransferTypeEnum.TRANSFER
                && (transfer.getTxType() == MemTransferDtoV1.TxTypeEnum.BIP_CREATE
                        || transfer.getTxType() == MemTransferDtoV1.TxTypeEnum.BIP_VOTE);
    }

    private static BigInteger requiredDecimal(String value, String field) {
        if (value == null || value.length() > MAX_DECIMAL_DIGITS
                || !value.matches("^(0|[1-9][0-9]*)$")) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        BigInteger parsed = new BigInteger(value);
        if (parsed.compareTo(MAX_UINT256) > 0) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        return parsed;
    }

    private static BigInteger addUint256(BigInteger left, BigInteger right) {
        BigInteger result = left.add(right);
        if (result.compareTo(MAX_UINT256) > 0) {
            throw new GEFailedException("Node returned pending reservations that exceed the uint256 range");
        }
        return result;
    }

    private static void requireBoundedHistoryMessage(String value, String field) {
        if (value != null && value.length() > MAX_HISTORY_MESSAGE_CHARACTERS) {
            throw new GEFailedException("Node returned an oversized " + field);
        }
    }

    private static void requireNonNegativeLong(Long value, String field) {
        if (value == null || value < 0) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
    }

    private record BalanceKey(Address address, Address token) { }

    private record PendingReservation(String hash, Address from, Address token, BigInteger amount, BigInteger fee) {
        String canonical() {
            return field(hash) + "|" + address(from) + "|" + address(token) + "|" + amount + "|" + fee;
        }
    }

    private record PageDataset<T>(long total, List<T> rows) { }

    private record BalanceObservation(
            List<WalletBalanceDtoV1> balances,
            Map<BalanceKey, BigInteger> outgoing,
            String fingerprint) { }

    private static final class QueryBudget {
        private final long started = System.nanoTime();
        private final int maxCalls;
        private int calls;

        private QueryBudget(int maxCalls) {
            this.maxCalls = maxCalls;
        }

        static QueryBudget forBalances() {
            return new QueryBudget(MAX_BALANCE_PAGE_CALLS_PER_OBSERVATION * MAX_STABILITY_OBSERVATIONS);
        }

        static QueryBudget forHistory() {
            return new QueryBudget(MAX_HISTORY_PAGE_CALLS_PER_OBSERVATION * MAX_STABILITY_OBSERVATIONS + 1);
        }

        <T> T call(Supplier<T> supplier) {
            if (++calls > maxCalls) {
                throw new GEValidationException("Wallet query is too large; request fewer addresses or tokens");
            }
            long remaining = STABILITY_QUERY_BUDGET.toNanos() - (System.nanoTime() - started);
            if (remaining <= 0) {
                throw timeout();
            }

            FutureTask<T> task = new FutureTask<>(supplier::get);
            Thread worker = Thread.ofVirtual().name("wallet-node-observation").start(task);
            try {
                return task.get(remaining, TimeUnit.NANOSECONDS);
            } catch (TimeoutException exception) {
                task.cancel(true);
                worker.interrupt();
                throw timeout();
            } catch (InterruptedException exception) {
                task.cancel(true);
                worker.interrupt();
                Thread.currentThread().interrupt();
                throw timeout();
            } catch (ExecutionException exception) {
                Throwable cause = exception.getCause();
                if (cause instanceof RuntimeException runtimeException) {
                    throw runtimeException;
                }
                throw new GEFailedException("Node observation failed");
            }
        }

        private UpstreamObservationUnstableException timeout() {
            return new UpstreamObservationUnstableException(
                    "Wallet state could not be read within the bounded observation budget");
        }
    }

    private static final class RawRowBudget {
        private final long maxRows;
        private final long maxBytes;
        private long declaredRows;
        private long consumedBytes;

        private RawRowBudget(long maxRows) {
            this(maxRows, Long.MAX_VALUE);
        }

        private RawRowBudget(long maxRows, long maxBytes) {
            this.maxRows = maxRows;
            this.maxBytes = maxBytes;
        }

        void declareDataset(String kind, long rows) {
            try {
                declaredRows = Math.addExact(declaredRows, rows);
            } catch (ArithmeticException exception) {
                throw new GEValidationException("Wallet " + kind + " result exceeds the supported range");
            }
            if (declaredRows > maxRows) {
                throw new GEValidationException(
                        "Wallet result exceeds the bounded row budget; request fewer addresses or tokens");
            }
        }

        void consumeBytes(String kind, long bytes) {
            try {
                consumedBytes = Math.addExact(consumedBytes, bytes);
            } catch (ArithmeticException exception) {
                throw new GEValidationException("Wallet " + kind + " result exceeds the supported range");
            }
            if (consumedBytes > maxBytes) {
                throw new GEValidationException(
                        "Wallet history exceeds the 16 MiB observation limit; request fewer addresses or narrow the filters");
            }
        }
    }

    private static void checkPageCompleteness(String kind, int pageNumber, long total, int actualRows) {
        long remaining = Math.max(0L, total - (long) pageNumber * PAGE_SIZE);
        long expectedRows = Math.min(PAGE_SIZE, remaining);
        if (actualRows != expectedRows) {
            throw new GEFailedException("Node returned an incomplete or inconsistent " + kind + " page");
        }
    }

    private static long checkedTotal(Long total) {
        if (total == null || total < 0) {
            throw new GEFailedException("Node returned an invalid page count");
        }
        return total;
    }

    private static long consistentTotal(String kind, Long expected, long actual) {
        if (expected != null && expected != actual) {
            throw new GEFailedException("Node returned inconsistent " + kind + " page totals");
        }
        return actual;
    }

    private static long addTotals(long left, long right) {
        try {
            return Math.addExact(left, right);
        } catch (ArithmeticException exception) {
            throw new GEFailedException("Node returned transfer counts that exceed the supported range");
        }
    }

    private static void validateAddresses(Set<Address> addresses, Set<Address> tokenAddresses) {
        if (addresses == null || addresses.isEmpty() || addresses.size() > MAX_ADDRESSES
                || addresses.stream().anyMatch(address -> address == null)) {
            throw new GEValidationException("Provide between 1 and 100 valid wallet addresses");
        }
        if (tokenAddresses == null || tokenAddresses.size() > MAX_ADDRESSES
                || tokenAddresses.stream().anyMatch(address -> address == null)) {
            throw new GEValidationException("Provide at most 100 valid token addresses");
        }
    }

    /** Pending rows precede confirmed rows in a short-lived stable public snapshot. */
    public UnifiedTransferPageDtoV1 getTransfers(Set<Address> addresses, Set<Address> tokenAddresses, int pageNumber,
            int pageSize, TransferTypeEnum transferType) {
        validateAddresses(addresses, tokenAddresses);
        PaginationUtil.validatePageRequest(pageNumber, pageSize);
        QueryBudget budget = QueryBudget.forHistory();
        HistoryQueryKey key = HistoryQueryKey.from(addresses, tokenAddresses, transferType);
        HistoryObservation observation = historySnapshots.get(key,
                ignored -> stableHistoryObservation(addresses, tokenAddresses, transferType, budget));
        return buildTransferPage(observation, pageNumber, pageSize, budget);
    }

    private HistoryObservation stableHistoryObservation(Set<Address> addresses, Set<Address> tokenAddresses,
            TransferTypeEnum transferType, QueryBudget budget) {
        HistoryObservation previous = null;
        for (int observation = 0; observation < MAX_STABILITY_OBSERVATIONS; observation++) {
            HistoryObservation current = readHistoryObservation(addresses, tokenAddresses, transferType, budget);
            if (previous != null && previous.fingerprint().equals(current.fingerprint())) {
                return current;
            }
            previous = current;
        }
        throw new UpstreamObservationUnstableException(
                "Wallet history did not stabilize within the bounded observation budget");
    }

    private HistoryObservation readHistoryObservation(Set<Address> addresses, Set<Address> tokenAddresses,
            TransferTypeEnum transferType, QueryBudget budget) {
        RawRowBudget rowBudget = new RawRowBudget(MAX_RAW_HISTORY_ROWS, MAX_HISTORY_SNAPSHOT_BYTES);
        PageDataset<MemTransferDtoV1> pending = readPendingHistoryRows(
                addresses, tokenAddresses, transferType, budget, rowBudget);
        BulkTransferPageRequestV1.TypeEnum confirmedType = transferType == null ? null
                : BulkTransferPageRequestV1.TypeEnum.fromValue(transferType.name());
        PageDataset<TransferDtoV1> confirmed = readConfirmedHistoryRows(
                addresses, tokenAddresses, confirmedType, transferType, budget, rowBudget);
        return normalizeHistory(pending.rows(), confirmed.rows());
    }

    private PageDataset<MemTransferDtoV1> readPendingHistoryRows(Set<Address> addresses,
            Set<Address> tokenAddresses, TransferTypeEnum transferType, QueryBudget budget, RawRowBudget rowBudget) {
        List<MemTransferDtoV1> rows = new ArrayList<>();
        int pageNumber = 0;
        Long expectedTotal = null;
        do {
            int requestedPage = pageNumber++;
            MemTransferDtoV1Page page = budget.call(() -> explorerNodeService.getMemTransfersBulkForObservation(
                    requestedPage, PAGE_SIZE, addresses, tokenAddresses, transferType));
            if (page == null || page.getList() == null) {
                throw new GEFailedException("Node returned an invalid pending history page");
            }
            long total = checkedTotal(page.getTotalElements());
            if (expectedTotal == null) {
                rowBudget.declareDataset("history", total);
            }
            expectedTotal = consistentTotal("pending history", expectedTotal, total);
            checkPageCompleteness("pending history", requestedPage, total, page.getList().size());
            for (MemTransferDtoV1 transfer : page.getList()) {
                if (transfer == null) {
                    throw new GEFailedException("Node returned an invalid pending history row");
                }
                validatePendingHistoryRow(transfer, addresses, tokenAddresses, transferType);
                MemTransferDtoV1 compact = compactPendingTransfer(
                        transfer, normalizeRequiredHash(transfer.getHash(), "pending transaction hash"));
                rowBudget.consumeBytes("history", estimatedPendingProjectionBytes(compact));
                rows.add(compact);
            }
        } while ((long) pageNumber * PAGE_SIZE < expectedTotal);
        return new PageDataset<>(expectedTotal, List.copyOf(rows));
    }

    private PageDataset<TransferDtoV1> readConfirmedHistoryRows(Set<Address> addresses,
            Set<Address> tokenAddresses, BulkTransferPageRequestV1.TypeEnum nodeTransferType,
            TransferTypeEnum requestedType, QueryBudget budget, RawRowBudget rowBudget) {
        List<TransferDtoV1> rows = new ArrayList<>();
        int pageNumber = 0;
        Long expectedTotal = null;
        do {
            int requestedPage = pageNumber++;
            TransferDtoV1Page page = budget.call(() -> explorerNodeService.getTransfersBulkForObservation(
                    requestedPage, PAGE_SIZE, addresses, tokenAddresses, nodeTransferType));
            if (page == null || page.getList() == null) {
                throw new GEFailedException("Node returned an invalid confirmed history page");
            }
            long total = checkedTotal(page.getTotalElements());
            if (expectedTotal == null) {
                rowBudget.declareDataset("history", total);
            }
            expectedTotal = consistentTotal("confirmed history", expectedTotal, total);
            checkPageCompleteness("confirmed history", requestedPage, total, page.getList().size());
            for (TransferDtoV1 transfer : page.getList()) {
                if (transfer == null) {
                    throw new GEFailedException("Node returned an invalid confirmed history row");
                }
                validateConfirmedHistoryRow(transfer, addresses, tokenAddresses, requestedType);
                TransferDtoV1 compact = compactConfirmedTransfer(
                        transfer, normalizeOptionalHash(transfer.getTxHash(), "confirmed transaction hash"));
                rowBudget.consumeBytes("history", estimatedConfirmedProjectionBytes(compact));
                rows.add(compact);
            }
        } while ((long) pageNumber * PAGE_SIZE < expectedTotal);
        return new PageDataset<>(expectedTotal, List.copyOf(rows));
    }

    private HistoryObservation normalizeHistory(List<MemTransferDtoV1> pendingRows,
            List<TransferDtoV1> confirmedRows) {
        Map<String, MemTransferDtoV1> pendingByHash = new LinkedHashMap<>();
        for (MemTransferDtoV1 transfer : pendingRows) {
            String hash = normalizeRequiredHash(transfer.getHash(), "pending transaction hash");
            MemTransferDtoV1 compact = compactPendingTransfer(transfer, hash);
            MemTransferDtoV1 previous = pendingByHash.putIfAbsent(hash, compact);
            if (previous != null && !canonicalPendingTransfer(previous).equals(canonicalPendingTransfer(compact))) {
                throw new GEFailedException("Node returned conflicting pending history rows for one hash");
            }
        }

        Map<String, TransferDtoV1> confirmedByHash = new LinkedHashMap<>();
        Map<String, TransferDtoV1> hashlessConfirmedByContent = new LinkedHashMap<>();
        for (TransferDtoV1 transfer : confirmedRows) {
            String hash = normalizeOptionalHash(transfer.getTxHash(), "confirmed transaction hash");
            TransferDtoV1 compact = compactConfirmedTransfer(transfer, hash);
            if (hash == null) {
                hashlessConfirmedByContent.putIfAbsent(canonicalConfirmedTransfer(compact), compact);
                continue;
            }
            TransferDtoV1 previous = confirmedByHash.putIfAbsent(hash, compact);
            if (previous != null
                    && !canonicalConfirmedTransfer(previous).equals(canonicalConfirmedTransfer(compact))) {
                throw new GEFailedException("Node returned conflicting confirmed history rows for one hash");
            }
        }

        for (Map.Entry<String, TransferDtoV1> confirmed : confirmedByHash.entrySet()) {
            MemTransferDtoV1 pending = pendingByHash.remove(confirmed.getKey());
            if (pending != null && !canonicalTransferCore(pending).equals(canonicalTransferCore(confirmed.getValue()))) {
                throw new GEFailedException("Node returned conflicting pending and confirmed history for one hash");
            }
        }

        List<MemTransferDtoV1> normalizedPending = new ArrayList<>(pendingByHash.values());
        normalizedPending.sort(Comparator
                .comparing(MemTransferDtoV1::getAddedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(WalletBusinessService::canonicalPendingTransfer));
        List<TransferDtoV1> normalizedConfirmed = new ArrayList<>(confirmedByHash.values());
        normalizedConfirmed.addAll(hashlessConfirmedByContent.values());
        normalizedConfirmed.sort(Comparator
                .comparing(TransferDtoV1::getTimestamp, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(WalletBusinessService::canonicalConfirmedTransfer));

        long unifiedRows = addTotals(normalizedPending.size(), normalizedConfirmed.size());
        if (unifiedRows > MAX_RESULT_ROWS) {
            throw new GEValidationException(
                    "Wallet history exceeds 2000 rows; request fewer addresses or narrow the token filter");
        }

        List<String> canonical = new ArrayList<>();
        canonical.add("pending:" + normalizedPending.size());
        long estimatedBytes = 0;
        for (MemTransferDtoV1 row : normalizedPending) {
            String value = "p|" + canonicalPendingTransfer(row);
            canonical.add(value);
            estimatedBytes = addEstimatedHistoryBytes(estimatedBytes, value);
        }
        canonical.add("confirmed:" + normalizedConfirmed.size());
        for (TransferDtoV1 row : normalizedConfirmed) {
            String value = "c|" + canonicalConfirmedTransfer(row);
            canonical.add(value);
            estimatedBytes = addEstimatedHistoryBytes(estimatedBytes, value);
        }
        return new HistoryObservation(
                List.copyOf(normalizedPending),
                List.copyOf(normalizedConfirmed),
                fingerprint(canonical),
                Math.toIntExact(estimatedBytes));
    }

    private void validatePendingHistoryRow(MemTransferDtoV1 transfer, Set<Address> addresses,
            Set<Address> tokenAddresses, TransferTypeEnum requestedType) {
        requiredAddress(transfer.getFrom(), "pending sender");
        if (transfer.getTransferType() == null) {
            throw new GEFailedException("Node returned a pending history row without a transfer type");
        }
        if (transfer.getAddedAt() == null) {
            throw new GEFailedException("Node returned a pending history row without an added timestamp");
        }
        boolean feeOnlyGovernance = isFeeOnlyGovernance(transfer);
        if (!feeOnlyGovernance) {
            requiredAddress(transfer.getTo(), "pending recipient");
        }
        requiredScopedAddresses(transfer.getFrom(), transfer.getTo(), addresses, "pending history");
        Address token = requiredTokenAddress(transfer.getTokenAddress(), "pending history token");
        if (!tokenAddresses.isEmpty() && !tokenAddresses.contains(token)) {
            throw new GEFailedException("Node returned a pending history row outside the requested token scope");
        }
        if (requestedType != null && !transfer.getTransferType().name().equals(requestedType.name())) {
            throw new GEFailedException("Node returned a pending history row outside the requested type scope");
        }
        normalizeRequiredHash(transfer.getHash(), "pending transaction hash");
        requireNonNegativeLong(transfer.getNonce(), "pending transaction nonce");
        requireBoundedHistoryMessage(transfer.getMessage(), "pending message");
        requiredDecimal(transfer.getFee(), "pending fee");
        if (feeOnlyGovernance) {
            if (transfer.getAmount() != null) {
                throw new GEFailedException("Node returned an invalid governance pending amount");
            }
        } else {
            requiredDecimal(transfer.getAmount(), "pending amount");
        }
    }

    private void validateConfirmedHistoryRow(TransferDtoV1 transfer, Set<Address> addresses,
            Set<Address> tokenAddresses, TransferTypeEnum requestedType) {
        if (transfer.getType() == null) {
            throw new GEFailedException("Node returned a confirmed history row without a transfer type");
        }
        if (transfer.getTimestamp() == null) {
            throw new GEFailedException("Node returned a confirmed history row without a timestamp");
        }
        normalizeRequiredHash(transfer.getBlockHash(), "confirmed block hash");
        if (requestedType != null && !transfer.getType().name().equals(requestedType.name())) {
            throw new GEFailedException("Node returned a confirmed history row outside the requested type scope");
        }
        if (transfer.getType() == TransferDtoV1.TypeEnum.TRANSFER) {
            requiredAddress(transfer.getFrom(), "confirmed sender");
            requiredAddress(transfer.getTo(), "confirmed recipient");
        }
        requiredScopedAddresses(transfer.getFrom(), transfer.getTo(), addresses, "confirmed history");
        Address token = requiredTokenAddress(transfer.getTokenAddress(), "confirmed history token");
        if (!tokenAddresses.isEmpty() && !tokenAddresses.contains(token)) {
            throw new GEFailedException("Node returned a confirmed history row outside the requested token scope");
        }
        requireBoundedHistoryMessage(transfer.getMessage(), "confirmed message");
        requiredDecimal(transfer.getAmount(), "confirmed amount");
        if (transfer.getFee() != null) {
            requiredDecimal(transfer.getFee(), "confirmed fee");
        } else if (transfer.getType() == TransferDtoV1.TypeEnum.TRANSFER) {
            throw new GEFailedException("Node returned an invalid confirmed fee");
        }
        requireNonNegativeLong(transfer.getBlockHeight(), "confirmed block height");
        requireOptionalNonNegative(transfer.getId(), "confirmed transfer id");
        requireOptionalNonNegative(transfer.getTxIndex(), "confirmed transaction index");
        boolean transactionTransfer = transfer.getType() == TransferDtoV1.TypeEnum.TRANSFER;
        if (transfer.getNonce() == null) {
            if (transactionTransfer) {
                throw new GEFailedException("Node returned an invalid confirmed transaction nonce");
            }
        } else {
            requireNonNegativeLong(transfer.getNonce(), "confirmed transaction nonce");
        }
        String hash = normalizeOptionalHash(transfer.getTxHash(), "confirmed transaction hash");
        if (hash == null && transactionTransfer) {
            throw new GEFailedException("Node returned an invalid confirmed transaction hash");
        }
    }

    private UnifiedTransferPageDtoV1 buildTransferPage(HistoryObservation observation, int pageNumber, int pageSize,
            QueryBudget budget) {
        long offset = Math.multiplyExact((long) pageNumber, pageSize);
        int pendingStart = (int) Math.min(offset, observation.pendingRows().size());
        int pendingEnd = Math.min(observation.pendingRows().size(), pendingStart + pageSize);
        List<MemTransferDtoV1> pendingRows = observation.pendingRows().subList(pendingStart, pendingEnd);

        int confirmedNeeded = pageSize - pendingRows.size();
        long confirmedOffset = Math.max(0L, offset - observation.pendingRows().size());
        int confirmedStart = (int) Math.min(confirmedOffset, observation.confirmedRows().size());
        int confirmedEnd = Math.min(observation.confirmedRows().size(), confirmedStart + confirmedNeeded);
        List<TransferDtoV1> confirmedRows = observation.confirmedRows().subList(confirmedStart, confirmedEnd);

        Long currentBlockHeight = null;
        if (!confirmedRows.isEmpty()) {
            long maxBlockHeight = confirmedRows.stream()
                    .mapToLong(transfer -> transfer.getBlockHeight())
                    .max()
                    .orElseThrow();
            currentBlockHeight = budget.call(blockchainNodeService::getLatestBlockHeightForObservation);
            if (currentBlockHeight == null || currentBlockHeight < maxBlockHeight) {
                throw new GEFailedException("Node returned a block height older than confirmed wallet history");
            }
        }

        List<UnifiedTransferDtoV1> content = new ArrayList<>(pageSize);
        pendingRows.stream().map(walletMapper::toUnifiedTransfer).forEach(content::add);
        Long height = currentBlockHeight;
        confirmedRows.stream()
                .map(transfer -> walletMapper.toUnifiedTransferWithConfirmations(transfer, height))
                .forEach(content::add);

        long pendingCount = observation.pendingRows().size();
        long confirmedCount = observation.confirmedRows().size();
        long totalElements = addTotals(pendingCount, confirmedCount);
        int totalPages = (int) Math.max(1,
                totalElements / pageSize + (totalElements % pageSize == 0 ? 0 : 1));
        return new UnifiedTransferPageDtoV1(
                content,
                pageNumber,
                pageSize,
                Long.toString(totalElements),
                totalPages,
                Long.toString(pendingCount),
                Long.toString(confirmedCount),
                pageNumber == 0,
                pageNumber >= totalPages - 1);
    }

    private record HistoryQueryKey(List<String> addresses, List<String> tokenAddresses, String transferType) {
        static HistoryQueryKey from(Set<Address> addresses, Set<Address> tokenAddresses,
                TransferTypeEnum transferType) {
            return new HistoryQueryKey(
                    addresses.stream().map(WalletBusinessService::address).sorted().toList(),
                    tokenAddresses.stream().map(WalletBusinessService::address).sorted().toList(),
                    transferType == null ? null : transferType.name());
        }
    }

    private record HistoryObservation(
            List<MemTransferDtoV1> pendingRows,
            List<TransferDtoV1> confirmedRows,
            String fingerprint,
            int estimatedBytes) { }

    private static int historyCacheWeight(HistoryQueryKey key, HistoryObservation value) {
        long bytes = value.estimatedBytes() + estimatedHistoryKeyBytes(key);
        return (int) Math.min(Integer.MAX_VALUE, Math.max(1L, bytes));
    }

    private static long estimatedHistoryKeyBytes(HistoryQueryKey key) {
        long characters = key.addresses().stream().mapToLong(String::length).sum()
                + key.tokenAddresses().stream().mapToLong(String::length).sum()
                + (key.transferType() == null ? 0 : key.transferType().length());
        return 256L + characters * Character.BYTES;
    }

    private static long addEstimatedHistoryBytes(long current, String canonical) {
        long rowBytes = 256L + (long) canonical.length() * Character.BYTES;
        long total = Math.addExact(current, rowBytes);
        if (total > MAX_HISTORY_SNAPSHOT_BYTES) {
            throw new GEValidationException(
                    "Wallet history exceeds the 16 MiB snapshot limit; request fewer addresses or narrow the filters");
        }
        return total;
    }

    private static long estimatedPendingProjectionBytes(MemTransferDtoV1 transfer) {
        return estimatedPublicProjectionBytes(
                transfer.getHash(), transfer.getFrom(), transfer.getTo(), transfer.getTokenAddress(),
                transfer.getAmount(), transfer.getFee(), transfer.getMessage());
    }

    private static long estimatedConfirmedProjectionBytes(TransferDtoV1 transfer) {
        return estimatedPublicProjectionBytes(
                transfer.getTxHash(), transfer.getBlockHash(), transfer.getFrom(), transfer.getTo(),
                transfer.getTokenAddress(), transfer.getAmount(), transfer.getFee(), transfer.getMessage());
    }

    private static long estimatedPublicProjectionBytes(String... values) {
        long bytes = 512L;
        for (String value : values) {
            bytes = Math.addExact(bytes, 48L);
            if (value != null) {
                bytes = Math.addExact(bytes, (long) value.length() * Character.BYTES);
            }
        }
        return bytes;
    }

    private static MemTransferDtoV1 compactPendingTransfer(MemTransferDtoV1 source, String hash) {
        return new MemTransferDtoV1()
                .hash(hash)
                .addedAt(source.getAddedAt())
                .transferType(source.getTransferType())
                .from(source.getFrom())
                .to(source.getTo())
                .tokenAddress(source.getTokenAddress())
                .amount(source.getAmount())
                .fee(source.getFee())
                .nonce(source.getNonce())
                .message(source.getMessage());
    }

    private static TransferDtoV1 compactConfirmedTransfer(TransferDtoV1 source, String hash) {
        return new TransferDtoV1()
                .blockHeight(source.getBlockHeight())
                .blockHash(source.getBlockHash())
                .timestamp(source.getTimestamp())
                .txHash(hash)
                .type(source.getType())
                .from(source.getFrom())
                .to(source.getTo())
                .tokenAddress(source.getTokenAddress())
                .amount(source.getAmount())
                .fee(source.getFee())
                .nonce(source.getNonce())
                .message(source.getMessage());
    }

    private static String canonicalBalance(WalletBalanceDtoV1 balance) {
        return address(balance.address()) + "|" + address(balance.tokenAddress()) + "|"
                + balance.totalBalance().toBigInteger() + "|" + balance.lockedMiningReward().toBigInteger() + "|"
                + balance.spendableBalance().toBigInteger() + "|" + field(balance.updatedAtBlockHeight()) + "|"
                + field(balance.updatedAtTimestamp());
    }

    private static String canonicalPendingTransfer(MemTransferDtoV1 transfer) {
        return field(normalizeHash(transfer.getHash())) + "|" + lowerField(transfer.getFrom()) + "|"
                + lowerField(transfer.getTo()) + "|" + canonicalTokenField(transfer.getTokenAddress()) + "|"
                + field(transfer.getAmount()) + "|" + field(transfer.getFee()) + "|" + field(transfer.getNonce()) + "|"
                + field(transfer.getMessage()) + "|" + field(transfer.getAddedAt()) + "|"
                + field(transfer.getTransferType());
    }

    private static String canonicalConfirmedTransfer(TransferDtoV1 transfer) {
        return field(normalizeHash(transfer.getTxHash())) + "|" + lowerField(transfer.getFrom()) + "|"
                + lowerField(transfer.getTo()) + "|" + canonicalTokenField(transfer.getTokenAddress()) + "|"
                + field(transfer.getAmount()) + "|" + field(transfer.getFee()) + "|" + field(transfer.getNonce()) + "|"
                + field(transfer.getMessage()) + "|" + field(transfer.getTimestamp()) + "|"
                + field(transfer.getBlockHeight()) + "|" + lowerField(transfer.getBlockHash()) + "|"
                + field(transfer.getType());
    }

    private static String canonicalTransferCore(MemTransferDtoV1 transfer) {
        return lowerField(transfer.getFrom()) + "|" + lowerField(transfer.getTo()) + "|"
                + canonicalTokenField(transfer.getTokenAddress()) + "|" + field(transfer.getAmount()) + "|"
                + field(transfer.getFee()) + "|" + field(transfer.getNonce()) + "|" + field(transfer.getMessage()) + "|"
                + field(transfer.getTransferType());
    }

    private static String canonicalTransferCore(TransferDtoV1 transfer) {
        return lowerField(transfer.getFrom()) + "|" + lowerField(transfer.getTo()) + "|"
                + canonicalTokenField(transfer.getTokenAddress()) + "|" + field(transfer.getAmount()) + "|"
                + field(transfer.getFee()) + "|" + field(transfer.getNonce()) + "|" + field(transfer.getMessage()) + "|"
                + field(transfer.getType());
    }

    private static void requiredScopedAddresses(String fromValue, String toValue, Set<Address> requested,
            String kind) {
        Address from = optionalAddress(fromValue, kind + " sender");
        Address to = optionalAddress(toValue, kind + " recipient");
        if (from == null && to == null) {
            throw new GEFailedException("Node returned a " + kind + " row without an address");
        }
        boolean matchesFrom = from != null && requested.contains(from);
        boolean matchesTo = to != null && requested.contains(to);
        if (!matchesFrom && !matchesTo) {
            throw new GEFailedException("Node returned a " + kind + " row outside the requested address scope");
        }
    }

    private static Address requiredAddress(String value, String field) {
        Address address = optionalAddress(value, field);
        if (address == null) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        return address;
    }

    private static Address optionalAddress(String value, String field) {
        if (value == null) {
            return null;
        }
        try {
            if (!value.matches("(?i)^0x[0-9a-f]{40}$")) {
                throw new IllegalArgumentException("invalid address");
            }
            return Address.fromHexString(value);
        } catch (RuntimeException exception) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
    }

    private static Address requiredTokenAddress(String value, String field) {
        if (value == null || value.isEmpty()) {
            return Address.ZERO;
        }
        return requiredAddress(value, field);
    }

    private static String canonicalTokenField(String value) {
        if (value == null || value.isEmpty()) {
            return address(Address.ZERO);
        }
        try {
            Address token = Address.fromHexString(value);
            return address(token);
        } catch (RuntimeException exception) {
            return lowerField(value);
        }
    }

    private static String fingerprint(List<String> parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (String part : parts) {
                digest.update(part.getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static String normalizeHash(String value) {
        return value == null || value.isBlank() ? null : value.toLowerCase(Locale.ROOT);
    }

    private static String normalizeRequiredHash(String value, String field) {
        if (value == null || !value.matches("(?i)^0x[0-9a-f]{64}$")) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        return value.toLowerCase(Locale.ROOT);
    }

    private static String normalizeOptionalHash(String value, String field) {
        return value == null ? null : normalizeRequiredHash(value, field);
    }

    private static String lowerField(String value) {
        return field(value == null ? null : value.toLowerCase(Locale.ROOT));
    }

    private static String address(Address value) {
        return value == null ? "N" : value.toHexString().toLowerCase(Locale.ROOT);
    }

    private static String field(Object value) {
        if (value == null) {
            return "N";
        }
        String text = value.toString();
        return "V" + text.length() + ":" + text;
    }

    /**
     * Get token by address.
     */
    public TokenDtoV1 getTokenByAddress(Address address) {
        var token = explorerNodeService.getTokenByAddress(address);
        return walletMapper.toToken(token);
    }

    /**
     * Get paginated list of tokens.
     */
    public List<TokenDtoV1> getTokens() {
        var tokens = blockchainNodeService.getAllTokens();
        return tokens;
    }

    public MempoolResult submitTransaction(String hexData) {
        validateSignedTransaction(hexData);
        return blockchainNodeService.submitTransaction(hexData);
    }

    private static void validateSignedTransaction(String hexData) {
        if (hexData == null || hexData.length() < 4 || hexData.length() > 2 + 2 * MAX_SIGNED_TX_BYTES
                || !hexData.matches("^0x(?:[0-9a-fA-F]{2})+$")) {
            throw new GEValidationException("Invalid signed transaction encoding");
        }
        try {
            Bytes raw = Bytes.fromHexString(hexData);
            if (raw.isEmpty() || raw.size() > MAX_SIGNED_TX_BYTES) {
                throw new GEValidationException("Signed transaction exceeds the supported size");
            }
            var transaction = TxDecoder.INSTANCE.decode(raw);
            if (transaction.getSignature() == null) {
                throw new GEValidationException("Transaction must be signed");
            }
            transaction.getSender();
        } catch (GEValidationException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new GEValidationException("Invalid signed transaction");
        }
    }

    /** Observes a signed transaction without ever submitting or replaying it. */
    public TransactionStatusDtoV1 getTransactionStatus(String hash, Address sender, String nonce) {
        if (hash == null || !hash.matches("^0x[0-9a-f]{64}$")) {
            throw new GEValidationException("Transaction hash must be canonical lowercase hexadecimal");
        }
        if (sender == null) {
            throw new GEValidationException("Transaction sender is required");
        }
        if (nonce == null || nonce.length() > MAX_DECIMAL_DIGITS
                || !nonce.matches("^(0|[1-9][0-9]*)$")) {
            throw new GEValidationException("Transaction nonce must be a canonical uint256 decimal string");
        }

        BigInteger submittedNonce = new BigInteger(nonce);
        if (submittedNonce.compareTo(MAX_UINT256) > 0) {
            throw new GEValidationException("Transaction nonce must be a canonical uint256 decimal string");
        }
        String canonicalSender = address(sender);
        TransactionStatusBudget budget = new TransactionStatusBudget();
        Candidate previous = null;
        String lastNextNonce = null;
        String lastConfirmations = null;
        for (int index = 0; index < MAX_TRANSACTION_STATUS_OBSERVATIONS; index++) {
            try {
                TransactionObservation observation = readTransactionObservation(
                        hash, canonicalSender, submittedNonce, budget);
                lastNextNonce = observation.nextNonce().toString();
                lastConfirmations = observation.confirmations() == null
                        ? null
                        : Long.toString(observation.confirmations());
                Candidate current = classifyTransactionObservation(observation, submittedNonce);
                if (current.status() == Status.BLOCKED_UNKNOWN) {
                    return transactionStatus(Status.BLOCKED_UNKNOWN, hash, canonicalSender, nonce,
                            lastNextNonce, lastConfirmations);
                }
                if (previous != null && previous.equals(current)) {
                    return transactionStatus(current.status(), hash, canonicalSender, nonce,
                            lastNextNonce, lastConfirmations);
                }
                previous = current;
            } catch (RuntimeException exception) {
                return transactionStatus(Status.BLOCKED_UNKNOWN, hash, canonicalSender, nonce,
                        lastNextNonce, lastConfirmations);
            }
        }
        return transactionStatus(Status.BLOCKED_UNKNOWN, hash, canonicalSender, nonce,
                lastNextNonce, lastConfirmations);
    }

    private TransactionObservation readTransactionObservation(String hash, String sender, BigInteger nonce,
            TransactionStatusBudget budget) {
        Optional<BlockchainTxDtoV1> confirmed = budget.call(
                () -> blockchainNodeService.findBlockchainTransactionByHash(hash));
        Optional<BlockchainTxDtoV1> pending = budget.call(
                () -> blockchainNodeService.findMempoolTransactionByHash(hash));
        AccountSummaryDtoV1 summary = budget.call(() -> blockchainNodeService.getAccountSummaryForObservation(
                Address.fromHexString(sender)));

        if (confirmed == null || pending == null || summary == null || summary.getNextNonce() == null
                || summary.getNextNonce() < 0) {
            throw new GEFailedException("Node returned an invalid transaction observation");
        }
        if (!requiredNodeAddress(summary.getAddress(), "account summary address").equals(sender)) {
            throw new GEFailedException("Node returned an account summary for another sender");
        }
        BigInteger nextNonce = BigInteger.valueOf(summary.getNextNonce());
        Optional<ValidatedTransaction> validConfirmed = confirmed.map(value ->
                validateObservedTransaction(value, hash, sender, nonce, true));
        Optional<ValidatedTransaction> validPending = pending.map(value ->
                validateObservedTransaction(value, hash, sender, nonce, false));
        if (validConfirmed.isPresent() && validPending.isPresent()) {
            if (!validConfirmed.orElseThrow().core().equals(validPending.orElseThrow().core())) {
                throw new GEFailedException("Node returned conflicting pending and confirmed transactions");
            }
            validateCompatibleObservationMetadata(confirmed.orElseThrow(), pending.orElseThrow());
        }
        Long confirmations = validConfirmed.isPresent()
                ? budget.call(() -> blockchainNodeService.getTransactionConfirmationsForObservation(hash))
                : null;
        return new TransactionObservation(validConfirmed, validPending, nextNonce, confirmations);
    }

    private static Candidate classifyTransactionObservation(TransactionObservation observation,
            BigInteger submittedNonce) {
        if (observation.confirmed().isPresent()) {
            if (observation.confirmations() == null || observation.confirmations() < 1L) {
                return new Candidate(Status.BLOCKED_UNKNOWN, "invalid-confirmations");
            }
            Status status = observation.confirmations() >= FINAL_TRANSACTION_CONFIRMATIONS
                    ? Status.CONFIRMED
                    : Status.CONFIRMING;
            return new Candidate(status, observation.confirmed().orElseThrow().observation());
        }
        if (observation.confirmations() != null) {
            return new Candidate(Status.BLOCKED_UNKNOWN, "unexpected-confirmations");
        }
        if (observation.pending().isPresent()) {
            return new Candidate(Status.PENDING, observation.pending().orElseThrow().observation());
        }
        int nonceComparison = observation.nextNonce().compareTo(submittedNonce);
        if (nonceComparison == 0) {
            return new Candidate(Status.ABSENT_REUSABLE, "absent|" + observation.nextNonce());
        }
        if (nonceComparison > 0) {
            return new Candidate(Status.CONSUMED_SUPERSEDED, "consumed|" + observation.nextNonce());
        }
        return new Candidate(Status.BLOCKED_UNKNOWN, "blocked|" + observation.nextNonce());
    }

    private static ValidatedTransaction validateObservedTransaction(BlockchainTxDtoV1 source,
            String expectedHash, String expectedSender, BigInteger expectedNonce, boolean confirmedSource) {
        if (source == null || source.getTx() == null || source.getMetadata() == null) {
            throw new GEFailedException("Node returned a malformed transaction");
        }
        TxDtoV1 tx = source.getTx();
        BlockchainTxMetadataDtoV1 metadata = source.getMetadata();
        String hash = requiredCanonicalHash(metadata.getHash(), "transaction metadata hash");
        String sender = requiredNodeAddress(metadata.getSender(), "transaction metadata sender");
        if (!hash.equals(expectedHash) || !sender.equals(expectedSender)
                || tx.getNonce() == null || tx.getNonce() < 0
                || !BigInteger.valueOf(tx.getNonce()).equals(expectedNonce)) {
            throw new GEFailedException("Node returned a transaction with mismatched identity");
        }

        if (tx.getHash() != null
                && !requiredCanonicalHash(tx.getHash(), "transaction hash").equals(hash)) {
            throw new GEFailedException("Node returned inconsistent transaction metadata");
        }
        if (tx.getSender() != null
                && !requiredNodeAddress(tx.getSender(), "transaction sender").equals(sender)) {
            throw new GEFailedException("Node returned inconsistent transaction metadata");
        }
        if (metadata.getSize() == null) {
            throw new GEFailedException("Node returned transaction metadata without a size");
        }
        requireEqualWhenPresent(tx.getSize(), metadata.getSize(), "transaction size");
        requireEqualWhenPresent(tx.getBlockHeight(), metadata.getBlockHeight(), "transaction block height");
        requireEqualWhenPresent(tx.getIndex(), metadata.getIndex(), "transaction index");
        requireEqualHashWhenPresent(tx.getBlockHash(), metadata.getBlockHash(), "transaction block hash");
        requireOptionalNonNegative(tx.getSize(), "transaction size");
        requireOptionalNonNegative(tx.getBlockHeight(), "transaction block height");
        requireOptionalNonNegative(tx.getIndex(), "transaction index");
        requireOptionalNonNegative(metadata.getSize(), "transaction metadata size");
        requireOptionalNonNegative(metadata.getBlockHeight(), "transaction metadata block height");
        requireOptionalNonNegative(metadata.getIndex(), "transaction metadata index");

        if (confirmedSource && (metadata.getBlockHeight() == null || metadata.getIndex() == null
                || metadata.getBlockHash() == null || metadata.getBlockTimestamp() == null)) {
            throw new GEFailedException("Node returned incomplete confirmed transaction metadata");
        }
        String blockHash = metadata.getBlockHash();
        if (blockHash != null) {
            blockHash = requiredCanonicalHash(blockHash, "transaction block hash");
        }
        String core = String.join("|",
                hash, sender, expectedNonce.toString(), transactionField(tx.getVersion()),
                transactionField(tx.getTimestamp()), transactionField(tx.getType()),
                transactionField(tx.getNetwork()), lowerTransactionField(tx.getRecipient()),
                transactionField(tx.getAmount()), transactionField(tx.getFee()),
                lowerTransactionField(tx.getTokenAddress()), transactionField(tx.getMessage()),
                lowerTransactionField(tx.getReferenceHash()), transactionField(tx.getSignature()),
                transactionField(tx.getPayloadType()), transactionField(tx.getPayload()));
        String observation = String.join("|", core, transactionField(metadata.getSize()), transactionField(blockHash),
                transactionField(metadata.getBlockHeight()), transactionField(metadata.getIndex()),
                transactionField(metadata.getBlockTimestamp()));
        return new ValidatedTransaction(core, observation);
    }

    private static void validateCompatibleObservationMetadata(BlockchainTxDtoV1 left, BlockchainTxDtoV1 right) {
        TxDtoV1 leftTx = left.getTx();
        TxDtoV1 rightTx = right.getTx();
        BlockchainTxMetadataDtoV1 leftMetadata = left.getMetadata();
        BlockchainTxMetadataDtoV1 rightMetadata = right.getMetadata();
        requireEqualWhenPresent(
                firstNonNull(leftTx.getSize(), leftMetadata == null ? null : leftMetadata.getSize()),
                firstNonNull(rightTx.getSize(), rightMetadata == null ? null : rightMetadata.getSize()),
                "transaction size across sources");
        requireEqualWhenPresent(
                firstNonNull(leftTx.getBlockHeight(), leftMetadata == null ? null : leftMetadata.getBlockHeight()),
                firstNonNull(rightTx.getBlockHeight(), rightMetadata == null ? null : rightMetadata.getBlockHeight()),
                "transaction block height across sources");
        requireEqualWhenPresent(
                firstNonNull(leftTx.getIndex(), leftMetadata == null ? null : leftMetadata.getIndex()),
                firstNonNull(rightTx.getIndex(), rightMetadata == null ? null : rightMetadata.getIndex()),
                "transaction index across sources");
        requireEqualHashWhenPresent(
                firstNonNull(leftTx.getBlockHash(), leftMetadata == null ? null : leftMetadata.getBlockHash()),
                firstNonNull(rightTx.getBlockHash(), rightMetadata == null ? null : rightMetadata.getBlockHash()),
                "transaction block hash across sources");
        requireEqualWhenPresent(
                leftMetadata == null ? null : leftMetadata.getBlockTimestamp(),
                rightMetadata == null ? null : rightMetadata.getBlockTimestamp(),
                "transaction block timestamp across sources");
    }

    private static String lowerTransactionField(String value) {
        return transactionField(value == null ? null : value.toLowerCase(Locale.ROOT));
    }

    private static String transactionField(Object value) {
        if (value == null) {
            return "N";
        }
        return "V" + value.toString().replace("\\", "\\\\").replace("|", "\\|");
    }

    private static String requiredCanonicalHash(String value, String field) {
        if (value == null || !value.matches("^0x[0-9a-f]{64}$")) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        return value;
    }

    private static String requiredNodeAddress(String value, String field) {
        try {
            if (value == null || !value.matches("(?i)^0x[0-9a-f]{40}$")) {
                throw new IllegalArgumentException("invalid address");
            }
            return Address.fromHexString(value).toHexString().toLowerCase(Locale.ROOT);
        } catch (RuntimeException exception) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
    }

    private static void requireEqualWhenPresent(Object left, Object right, String field) {
        if (left != null && right != null && !left.equals(right)) {
            throw new GEFailedException("Node returned inconsistent " + field);
        }
    }

    private static void requireEqualHashWhenPresent(String left, String right, String field) {
        if (left != null && right != null
                && !requiredCanonicalHash(left, field).equals(requiredCanonicalHash(right, field))) {
            throw new GEFailedException("Node returned inconsistent " + field);
        }
    }

    private static void requireOptionalNonNegative(Number value, String field) {
        if (value != null && value.longValue() < 0) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
    }

    private static <T> T firstNonNull(T first, T second) {
        return first != null ? first : second;
    }

    private static TransactionStatusDtoV1 transactionStatus(Status status, String hash, String sender,
            String nonce, String nextNonce, String confirmations) {
        return new TransactionStatusDtoV1(
                status, hash, sender, nonce, nextNonce, confirmations, REQUIRED_TRANSACTION_CONFIRMATIONS);
    }

    private record ValidatedTransaction(String core, String observation) { }

    private record TransactionObservation(
            Optional<ValidatedTransaction> confirmed,
            Optional<ValidatedTransaction> pending,
            BigInteger nextNonce,
            Long confirmations) { }

    private record Candidate(Status status, String stabilityKey) { }

    private static final class TransactionStatusBudget {
        private final long started = System.nanoTime();
        private int calls;

        <T> T call(Supplier<T> supplier) {
            if (++calls > TRANSACTION_STATUS_CALLS_PER_OBSERVATION * MAX_TRANSACTION_STATUS_OBSERVATIONS) {
                throw new UpstreamObservationUnstableException(
                        "Transaction status exceeded the bounded node-call budget");
            }
            long remaining = TRANSACTION_STATUS_QUERY_BUDGET.toNanos() - (System.nanoTime() - started);
            if (remaining <= 0) {
                throw timeout();
            }
            FutureTask<T> task = new FutureTask<>(supplier::get);
            Thread worker = Thread.ofVirtual().name("wallet-transaction-observation").start(task);
            try {
                return task.get(remaining, TimeUnit.NANOSECONDS);
            } catch (TimeoutException exception) {
                task.cancel(true);
                worker.interrupt();
                throw timeout();
            } catch (InterruptedException exception) {
                task.cancel(true);
                worker.interrupt();
                Thread.currentThread().interrupt();
                throw timeout();
            } catch (ExecutionException exception) {
                Throwable cause = exception.getCause();
                if (cause instanceof RuntimeException runtimeException) {
                    throw runtimeException;
                }
                throw new GEFailedException("Transaction status observation failed");
            }
        }

        private UpstreamObservationUnstableException timeout() {
            return new UpstreamObservationUnstableException(
                    "Transaction status exceeded the bounded time budget");
        }
    }

    public String getNextNonce(Address address) {
        var summary = blockchainNodeService.getAccountSummary(address, null);
        if (summary == null || summary.getNextNonce() == null) {
            throw new GEFailedException("Node returned a missing next nonce");
        }
        return walletMapper.nonNegativeLongToString(summary.getNextNonce(), "next nonce");
    }

    public MempoolRecommendedFeesDtoV1 getMempoolRecommendedFees() {
        return walletMapper.toMempoolRecommendedFeesDtoV1(blockchainNodeService.getMempoolRecommendedFees());
    }
}
