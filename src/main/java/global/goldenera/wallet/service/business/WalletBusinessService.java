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
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.List;
import java.util.Set;

import org.apache.tuweni.units.ethereum.Wei;
import org.apache.tuweni.bytes.Bytes;
import org.springframework.stereotype.Service;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.serialization.tx.TxDecoder;
import global.goldenera.wallet.api.core.v1.wallet.dtos.MempoolRecommendedFeesDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TokenDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferPageDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.WalletBalanceDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapper;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.BulkMemTransferPageRequestV1.TransferTypeEnum;
import global.goldenera.wallet.client.node.model.v1.BulkTransferPageRequestV1;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.MempoolResult;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1Page;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.exceptions.GEValidationException;
import global.goldenera.wallet.utils.PaginationUtil;
import global.goldenera.wallet.service.node.BlockchainNodeService;
import global.goldenera.wallet.service.node.ExplorerNodeService;
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
    private static final int MAX_BALANCE_PAGE_CALLS = 20;
    private static final Duration BALANCE_QUERY_BUDGET = Duration.ofSeconds(10);
    public static final int MAX_SIGNED_TX_BYTES = 100_000;

    /** Returns all requested balances within a bounded node-query budget. */
    public List<WalletBalanceDtoV1> getBalances(Set<Address> addresses, Set<Address> tokenAddresses) {
        validateAddresses(addresses, tokenAddresses);
        QueryBudget budget = new QueryBudget();
        List<WalletBalanceDtoV1> balances = new ArrayList<>();
        int pageNumber = 0;
        long total;
        do {
            budget.beforePage();
            AccountBalanceDtoV1Page page = explorerNodeService.getAccountBalancesBulk(
                    pageNumber++, PAGE_SIZE, addresses, tokenAddresses);
            if (page == null || page.getList() == null) {
                throw new GEFailedException("Node returned an invalid balance page");
            }
            total = checkedTotal(page.getTotalElements());
            checkResultLimit(total, balances.size() + page.getList().size());
            checkPageCompleteness("balance", pageNumber - 1, total, page.getList().size());
            balances.addAll(page.getList().stream().map(walletMapper::toWalletBalance).toList());
        } while ((long) pageNumber * PAGE_SIZE < total);

        Map<BalanceKey, BigInteger> outgoing = pendingOutgoing(addresses, budget);
        return balances.stream().map(balance -> {
            BigInteger pending = outgoing.getOrDefault(new BalanceKey(balance.address(), balance.tokenAddress()), BigInteger.ZERO);
            BigInteger available = balance.spendableBalance().toBigInteger().subtract(pending).max(BigInteger.ZERO);
            return new WalletBalanceDtoV1(balance.address(), balance.tokenAddress(), Wei.valueOf(available),
                    balance.updatedAtBlockHeight(), balance.updatedAtTimestamp(), balance.totalBalance(),
                    balance.lockedMiningReward(), balance.spendableBalance());
        }).toList();
    }

    /** All outgoing tokens are needed even when the result asks only for native balance. */
    private Map<BalanceKey, BigInteger> pendingOutgoing(Set<Address> addresses, QueryBudget budget) {
        Map<BalanceKey, BigInteger> outgoing = new HashMap<>();
        Set<String> seenHashes = new HashSet<>();
        int pageNumber = 0;
        int fetched = 0;
        long total;
        do {
            budget.beforePage();
            MemTransferDtoV1Page page = explorerNodeService.getOutgoingMemTransfersBulk(pageNumber++, PAGE_SIZE, addresses);
            if (page == null || page.getList() == null) {
                throw new GEFailedException("Node returned an invalid pending page");
            }
            total = checkedTotal(page.getTotalElements());
            fetched += page.getList().size();
            checkResultLimit(total, fetched);
            checkPageCompleteness("pending", pageNumber - 1, total, page.getList().size());
            for (MemTransferDtoV1 transfer : page.getList()) {
                if (transfer.getHash() != null && !seenHashes.add(transfer.getHash())) {
                    continue;
                }
                Address from = walletMapper.stringToAddress(transfer.getFrom());
                if (!addresses.contains(from)) {
                    continue;
                }
                Address token = walletMapper.stringToTokenAddress(transfer.getTokenAddress());
                outgoing.merge(new BalanceKey(from, token), decimalOrZero(transfer.getAmount()), BigInteger::add);
                outgoing.merge(new BalanceKey(from, Address.ZERO), decimalOrZero(transfer.getFee()), BigInteger::add);
            }
        } while ((long) pageNumber * PAGE_SIZE < total);
        return outgoing;
    }

    private BigInteger decimalOrZero(String value) {
        BigInteger result = value == null || value.isBlank() ? BigInteger.ZERO : new BigInteger(value);
        if (result.signum() < 0) {
            throw new GEFailedException("Node returned a negative pending amount");
        }
        return result;
    }

    private record BalanceKey(Address address, Address token) { }

    private static final class QueryBudget {
        private final long started = System.nanoTime();
        private int calls;

        void beforePage() {
            if (++calls > MAX_BALANCE_PAGE_CALLS || System.nanoTime() - started > BALANCE_QUERY_BUDGET.toNanos()) {
                throw new GEValidationException("Wallet query is too large; request fewer addresses or tokens");
            }
        }
    }

    private static void checkResultLimit(long total, int fetched) {
        if (total > MAX_RESULT_ROWS || fetched > MAX_RESULT_ROWS) {
            throw new GEValidationException("Wallet result exceeds 2000 rows; request fewer addresses or tokens");
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

    /** Pending rows precede confirmed rows; confirmed offsets need not align with node pages. */
    public UnifiedTransferPageDtoV1 getTransfers(Set<Address> addresses, Set<Address> tokenAddresses, int pageNumber,
            int pageSize, TransferTypeEnum transferType) {
        validateAddresses(addresses, tokenAddresses);
        PaginationUtil.validatePageRequest(pageNumber, pageSize);
        Long currentBlockHeight = blockchainNodeService.getLatestBlockHeight();
        MemTransferDtoV1Page pendingPage = explorerNodeService.getMemTransfersBulk(
                pageNumber, pageSize, addresses, tokenAddresses, transferType);
        if (pendingPage == null || pendingPage.getList() == null) {
            throw new GEFailedException("Node returned an invalid pending page");
        }
        long pendingCount = checkedTotal(pendingPage.getTotalElements());
        long offset = (long) pageNumber * pageSize;
        List<UnifiedTransferDtoV1> content = new ArrayList<>();
        if (offset < pendingCount) {
            pendingPage.getList().stream().limit(pageSize).map(walletMapper::toUnifiedTransfer).forEach(content::add);
        }
        BulkTransferPageRequestV1.TypeEnum confirmedType = transferType == null ? null
                : BulkTransferPageRequestV1.TypeEnum.fromValue(transferType.name());
        long confirmedOffset = Math.max(0, offset - pendingCount);
        int confirmedPageNumber = (int) (confirmedOffset / pageSize);
        int withinPage = (int) (confirmedOffset % pageSize);
        boolean countOnly = content.size() == pageSize;
        TransferDtoV1Page confirmedPage = explorerNodeService.getTransfersBulk(
                countOnly ? 0 : confirmedPageNumber, countOnly ? 1 : pageSize, addresses, tokenAddresses, confirmedType);
        if (confirmedPage == null || confirmedPage.getList() == null) {
            throw new GEFailedException("Node returned an invalid confirmed page");
        }
        long confirmedCount = checkedTotal(confirmedPage.getTotalElements());
        if (!countOnly) {
            addConfirmed(content, confirmedPage, withinPage, pageSize, currentBlockHeight);
            if (content.size() < pageSize && (long) (confirmedPageNumber + 1) * pageSize < confirmedCount) {
                TransferDtoV1Page next = explorerNodeService.getTransfersBulk(
                        confirmedPageNumber + 1, pageSize, addresses, tokenAddresses, confirmedType);
                if (next == null || next.getList() == null) {
                    throw new GEFailedException("Node returned an invalid confirmed page");
                }
                addConfirmed(content, next, 0, pageSize, currentBlockHeight);
            }
        }
        long totalElements = Math.addExact(pendingCount, confirmedCount);
        int totalPages = (int) Math.min(Integer.MAX_VALUE, Math.max(1, totalElements / pageSize + (totalElements % pageSize == 0 ? 0 : 1)));
        return new UnifiedTransferPageDtoV1(content, pageNumber, pageSize, totalElements, totalPages,
                pendingCount, confirmedCount, pageNumber == 0, pageNumber >= totalPages - 1);
    }

    private void addConfirmed(List<UnifiedTransferDtoV1> content, TransferDtoV1Page page, int skip, int pageSize,
            Long currentBlockHeight) {
        page.getList().stream().skip(skip).limit(pageSize - content.size())
                .map(transfer -> walletMapper.toUnifiedTransferWithConfirmations(transfer, currentBlockHeight))
                .forEach(content::add);
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

    public Long getNextNonce(Address address) {
        return blockchainNodeService.getAccountSummary(address, null).getNextNonce();
    }

    public MempoolRecommendedFeesDtoV1 getMempoolRecommendedFees() {
        return walletMapper.toMempoolRecommendedFeesDtoV1(blockchainNodeService.getMempoolRecommendedFees());
    }
}
