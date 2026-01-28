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
package global.goldenera.wallet.service.node;

import static lombok.AccessLevel.PRIVATE;

import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.Hash;
import global.goldenera.wallet.client.node.api.v1.AccountBalanceApiV1Api;
import global.goldenera.wallet.client.node.api.v1.MemTransferApiV1Api;
import global.goldenera.wallet.client.node.api.v1.TokenApiV1Api;
import global.goldenera.wallet.client.node.api.v1.TransferApiV1Api;
import global.goldenera.wallet.client.node.api.v1.TxApiV1Api;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.BulkAccountBalancePageRequestV1;
import global.goldenera.wallet.client.node.model.v1.BulkMemTransferPageRequestV1;
import global.goldenera.wallet.client.node.model.v1.BulkMemTransferPageRequestV1.TransferTypeEnum;
import global.goldenera.wallet.client.node.model.v1.BulkTransferPageRequestV1;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.TokenDtoV1;
import global.goldenera.wallet.client.node.model.v1.TokenDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.TxDtoV1;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

/**
 * Service layer for Explorer API with retry support.
 * Wraps the generated Explorer API client interfaces.
 */
@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class ExplorerNodeService {

    AccountBalanceApiV1Api accountBalanceApi;
    MemTransferApiV1Api memTransferApi;
    TransferApiV1Api transferApi;
    TxApiV1Api txApi;
    TokenApiV1Api tokenApi;

    // ==================== Account Balance API ====================

    /**
     * Get account balance by address and optional token address.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public AccountBalanceDtoV1 getAccountBalanceByAddress(Address address, Address tokenAddress) {
        return accountBalanceApi
                .apiV1AccountBalanceGetByAddressAndTokenContractAddress(address.toChecksumAddress(),
                        tokenAddress.toChecksumAddress())
                .getBody();
    }

    /**
     * Get total count of account balances.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Long getAccountBalanceCount() {
        return accountBalanceApi.apiV1AccountBalanceGetCount().getBody();
    }

    /**
     * Get account balances in bulk for multiple addresses.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public AccountBalanceDtoV1Page getAccountBalancesBulk(Integer pageNumber, Integer pageSize, Set<Address> addresses,
            Set<Address> tokenAddresses) {
        var request = new BulkAccountBalancePageRequestV1()
                .pageNumber(pageNumber)
                .pageSize(pageSize)
                .addresses(addresses.stream().map(Address::toChecksumAddress).collect(Collectors.toSet()))
                .tokenAddresses(tokenAddresses.stream().map(Address::toChecksumAddress).collect(Collectors.toSet()));
        return accountBalanceApi.apiV1AccountBalanceGetPageBulk(request).getBody();
    }

    // ==================== Mem Transfer API ====================

    /**
     * Get mempool transfer by hash.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public MemTransferDtoV1 getMemTransferByHash(Hash hash) {
        return memTransferApi.apiV1MemTransferGetByHash(hash.toHexString()).getBody();
    }

    /**
     * Get total count of mempool transfers.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Long getMemTransferCount() {
        return memTransferApi.apiV1MemTransferGetCount().getBody();
    }

    /**
     * Get mempool transfers in bulk for multiple addresses.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public MemTransferDtoV1Page getMemTransfersBulk(Integer pageNumber, Integer pageSize, Set<Address> addresses,
            Set<Address> tokenAddresses, TransferTypeEnum transferType) {
        var request = new BulkMemTransferPageRequestV1()
                .pageNumber(pageNumber)
                .pageSize(pageSize)
                .direction(BulkMemTransferPageRequestV1.DirectionEnum.DESC)
                .addresses(addresses.stream().map(Address::toChecksumAddress).collect(Collectors.toSet()))
                .tokenAddresses(tokenAddresses.stream().map(Address::toChecksumAddress).collect(Collectors.toSet()))
                .transferType(transferType);
        return memTransferApi.apiV1MemTransferGetPageBulk(request).getBody();
    }

    // ==================== Transfer API ====================

    /**
     * Get confirmed transfer by id.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public TransferDtoV1 getTransferById(Long id) {
        return transferApi.apiV1TransferGetById(id).getBody();
    }

    /**
     * Get total count of confirmed transfers.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Long getTransferCount() {
        return transferApi.apiV1TransferGetCount().getBody();
    }

    /**
     * Get confirmed transfers in bulk for multiple addresses.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public TransferDtoV1Page getTransfersBulk(Integer pageNumber, Integer pageSize, Set<Address> addresses,
            Set<Address> tokenAddresses, BulkTransferPageRequestV1.TypeEnum transferType) {
        var request = new BulkTransferPageRequestV1()
                .pageNumber(pageNumber)
                .pageSize(pageSize)
                .direction(BulkTransferPageRequestV1.DirectionEnum.DESC)
                .addresses(addresses.stream().map(Address::toChecksumAddress).collect(Collectors.toSet()))
                .tokenAddresses(tokenAddresses.stream().map(Address::toChecksumAddress).collect(Collectors.toSet()))
                .type(transferType);
        return transferApi.apiV1TransferGetPageBulk(request).getBody();
    }

    // ==================== Tx API ====================

    /**
     * Get transaction by hash.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public TxDtoV1 getTxByHash(Hash hash) {
        return txApi.apiV1TxGetByHash(hash.toHexString()).getBody();
    }

    /**
     * Get transaction confirmations by hash.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Long getTxConfirmationsByHash(Hash hash) {
        return txApi.apiV1TxGetConfirmationsByHash(hash.toHexString()).getBody();
    }

    /**
     * Get total count of transactions.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Long getTxCount() {
        return txApi.apiV1TxGetCount().getBody();
    }

    // ==================== Token API ====================

    /**
     * Get token by address.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public TokenDtoV1 getTokenByAddress(Address address) {
        return tokenApi.apiV1TokenGetByAddress(address.toChecksumAddress()).getBody();
    }

    /**
     * Get total count of tokens.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Long getTokenCount() {
        return tokenApi.apiV1TokenGetCount().getBody();
    }

    /**
     * Get paginated list of tokens.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public TokenDtoV1Page getTokenPage(Integer pageNumber, Integer pageSize) {
        return tokenApi.apiV1TokenGetPage(pageNumber, pageSize, null, null, null, null, null, null, null, null, null,
                null, null).getBody();
    }
}
