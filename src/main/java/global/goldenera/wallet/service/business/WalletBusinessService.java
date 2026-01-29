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

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import org.apache.tuweni.units.ethereum.Wei;
import org.springframework.stereotype.Service;

import global.goldenera.cryptoj.datatypes.Address;
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
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1Page;
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

    /**
     * Get balances for multiple addresses.
     * Subtracts pending outgoing transactions from the balance.
     *
     * @param addresses
     *            Set of wallet addresses
     * @param tokenAddresses
     *            Set of token addresses (null for native token only)
     * @return List of wallet balances (adjusted for pending outgoing transactions)
     */
    public List<WalletBalanceDtoV1> getBalances(Set<Address> addresses, Set<Address> tokenAddresses) {
        int pageNumber = 0;
        int pageSize = 100;
        Long totalElements = 0L;
        List<WalletBalanceDtoV1> balances = new ArrayList<>();

        AccountBalanceDtoV1Page page = null;

        do {
            page = explorerNodeService.getAccountBalancesBulk(pageNumber, pageSize, addresses,
                    tokenAddresses);

            if (page == null || page.getList() == null) {
                break;
            }

            totalElements = page.getTotalElements();
            balances.addAll(page.getList().stream()
                    .map(walletMapper::toWalletBalance)
                    .collect(Collectors.toList()));

            pageNumber++;
        } while (pageNumber * pageSize < totalElements);

        // Fetch all pending mempool transactions for the given addresses
        List<MemTransferDtoV1> pendingTransfers = getAllPendingTransfers(addresses, tokenAddresses);

        // Adjust balances by subtracting pending outgoing transactions
        return balances.stream()
                .map(balance -> adjustBalanceForPendingOutgoing(balance, pendingTransfers))
                .collect(Collectors.toList());
    }

    /**
     * Fetches all pending mempool transfers for the given addresses.
     */
    private List<MemTransferDtoV1> getAllPendingTransfers(Set<Address> addresses, Set<Address> tokenAddresses) {
        List<MemTransferDtoV1> allPendingTransfers = new ArrayList<>();
        int pendingPageNumber = 0;
        int pendingPageSize = 100;
        long pendingTotalElements = 0L;

        do {
            MemTransferDtoV1Page pendingPage = explorerNodeService.getMemTransfersBulk(
                    pendingPageNumber,
                    pendingPageSize,
                    addresses,
                    tokenAddresses,
                    null); // null for all transfer types

            if (pendingPage == null || pendingPage.getList() == null) {
                break;
            }

            pendingTotalElements = pendingPage.getTotalElements() != null ? pendingPage.getTotalElements() : 0;
            allPendingTransfers.addAll(pendingPage.getList());
            pendingPageNumber++;
        } while (pendingPageNumber * pendingPageSize < pendingTotalElements);

        return allPendingTransfers;
    }

    /**
     * Adjusts a balance by subtracting pending outgoing transactions.
     * Only subtracts from outgoing transactions (where 'from' matches the balance
     * address).
     * For native token (Address.ZERO), the fee is also subtracted.
     */
    private WalletBalanceDtoV1 adjustBalanceForPendingOutgoing(WalletBalanceDtoV1 balance,
            List<MemTransferDtoV1> pendingTransfers) {
        Address balanceAddress = balance.address();
        Address balanceTokenAddress = balance.tokenAddress();

        Wei pendingOutgoingSum = Wei.ZERO;

        for (MemTransferDtoV1 transfer : pendingTransfers) {
            // Skip if this is not an outgoing transaction from this address
            if (transfer.getFrom() == null
                    || !Address.fromHexString(transfer.getFrom()).equals(balanceAddress)) {
                continue;
            }

            // Check if token address matches (Address.ZERO for native token)
            Address transferTokenAddress = transfer.getTokenAddress() != null
                    ? Address.fromHexString(transfer.getTokenAddress())
                    : Address.ZERO;
            boolean isNativeToken = Address.ZERO.equals(balanceTokenAddress);
            boolean tokenMatches = transferTokenAddress.equals(balanceTokenAddress);

            if (tokenMatches) {
                // Subtract the transfer amount
                if (transfer.getAmount() != null && !transfer.getAmount().isEmpty()) {
                    pendingOutgoingSum = pendingOutgoingSum
                            .add(Wei.valueOf(new java.math.BigInteger(transfer.getAmount())));
                }
            }

            // For native token balance, also subtract the fee from all outgoing
            // transactions
            if (isNativeToken && transfer.getFee() != null && !transfer.getFee().isEmpty()) {
                pendingOutgoingSum = pendingOutgoingSum.add(Wei.valueOf(new java.math.BigInteger(transfer.getFee())));
            }
        }

        // If no pending outgoing, return original balance
        if (pendingOutgoingSum.equals(Wei.ZERO)) {
            return balance;
        }

        // Calculate adjusted balance (ensure it doesn't go negative)
        Wei adjustedBalance;
        if (pendingOutgoingSum.compareTo(balance.balance()) > 0) {
            adjustedBalance = Wei.ZERO;
        } else {
            adjustedBalance = balance.balance().subtract(pendingOutgoingSum);
        }

        return new WalletBalanceDtoV1(
                balance.address(),
                balance.tokenAddress(),
                adjustedBalance,
                balance.updatedAtBlockHeight(),
                balance.updatedAtTimestamp());
    }

    /**
     * Get unified transfer history for multiple addresses.
     * Combines pending (mempool) transfers first, then confirmed transfers.
     * 
     * Algorithm:
     * 1. Get total count of pending and confirmed transfers
     * 2. Calculate which items belong to the requested page
     * 3. If page starts within pending items - fetch pending first, then fill with
     * confirmed
     * 4. If page starts after pending items - fetch only confirmed with adjusted
     * offset
     *
     * @param addresses
     *            Set of wallet addresses
     * @param tokenAddresses
     *            Set of token addresses (null for all tokens)
     * @param pageNumber
     *            Page number (0-indexed)
     * @param pageSize
     *            Page size
     * @return Paginated unified transfers
     */
    public UnifiedTransferPageDtoV1 getTransfers(Set<Address> addresses, Set<Address> tokenAddresses, int pageNumber,
            int pageSize, TransferTypeEnum transferType) {
        Long currentBlockHeight = blockchainNodeService.getLatestBlockHeight();

        // Fetch pending transfers for the requested page (filtered by addresses)
        MemTransferDtoV1Page pendingPage = explorerNodeService.getMemTransfersBulk(
                pageNumber,
                pageSize,
                addresses,
                tokenAddresses,
                transferType);

        // Get filtered count from page response (this is the count for these specific
        // addresses)
        long pendingCount = pendingPage != null && pendingPage.getTotalElements() != null
                ? pendingPage.getTotalElements()
                : 0;
        int pendingCountInt = (int) pendingCount;

        // Calculate offset based on page
        int offset = pageNumber * pageSize;

        List<UnifiedTransferDtoV1> content = new ArrayList<>();
        long confirmedCount = 0;

        if (offset < pendingCountInt) {
            // Page starts within pending transfers
            if (pendingPage != null && pendingPage.getList() != null) {
                for (MemTransferDtoV1 pending : pendingPage.getList()) {
                    content.add(walletMapper.toUnifiedTransfer(pending));
                }
            }

            // If we need more items, fetch confirmed transfers
            int remainingSlots = pageSize - content.size();
            if (remainingSlots > 0) {
                TransferDtoV1Page confirmedPage = explorerNodeService.getTransfersBulk(
                        0, // start from beginning of confirmed
                        remainingSlots,
                        addresses,
                        tokenAddresses,
                        transferType != null ? BulkTransferPageRequestV1.TypeEnum.fromValue(transferType.name())
                                : null);

                if (confirmedPage != null) {
                    confirmedCount = confirmedPage.getTotalElements() != null
                            ? confirmedPage.getTotalElements()
                            : 0;
                    if (confirmedPage.getList() != null) {
                        for (TransferDtoV1 confirmed : confirmedPage.getList()) {
                            content.add(walletMapper.toUnifiedTransferWithConfirmations(confirmed, currentBlockHeight));
                        }
                    }
                }
            } else {
                // Still need to get confirmed count for totalElements calculation
                TransferDtoV1Page confirmedPage = explorerNodeService.getTransfersBulk(
                        0, 1, addresses, tokenAddresses,
                        transferType != null ? BulkTransferPageRequestV1.TypeEnum.fromValue(transferType.name())
                                : null);
                if (confirmedPage != null && confirmedPage.getTotalElements() != null) {
                    confirmedCount = confirmedPage.getTotalElements();
                }
            }
        } else {
            // Page starts after all pending transfers - only fetch confirmed
            int confirmedOffset = offset - pendingCountInt;
            int confirmedPageNumber = confirmedOffset / pageSize;

            TransferDtoV1Page confirmedPage = explorerNodeService.getTransfersBulk(
                    confirmedPageNumber,
                    pageSize,
                    addresses,
                    tokenAddresses,
                    transferType != null ? BulkTransferPageRequestV1.TypeEnum.fromValue(transferType.name()) : null);

            if (confirmedPage != null) {
                confirmedCount = confirmedPage.getTotalElements() != null
                        ? confirmedPage.getTotalElements()
                        : 0;
                if (confirmedPage.getList() != null) {
                    for (TransferDtoV1 confirmed : confirmedPage.getList()) {
                        content.add(walletMapper.toUnifiedTransferWithConfirmations(confirmed, currentBlockHeight));
                    }
                }
            }
        }

        long totalElements = pendingCount + confirmedCount;
        int totalPages = (int) Math.ceil((double) totalElements / pageSize);
        if (totalPages == 0)
            totalPages = 1;

        return new UnifiedTransferPageDtoV1(
                content,
                pageNumber,
                pageSize,
                totalElements,
                totalPages,
                pendingCount,
                confirmedCount,
                pageNumber == 0,
                pageNumber >= totalPages - 1);
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
        return blockchainNodeService.submitTransaction(hexData);
    }

    public Long getNextNonce(Address address) {
        return blockchainNodeService.getAccountSummary(address, null).getNextNonce();
    }

    public MempoolRecommendedFeesDtoV1 getMempoolRecommendedFees() {
        return walletMapper.toMempoolRecommendedFeesDtoV1(blockchainNodeService.getMempoolRecommendedFees());
    }
}
