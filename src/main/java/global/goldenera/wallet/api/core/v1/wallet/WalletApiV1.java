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
package global.goldenera.wallet.api.core.v1.wallet;

import static lombok.AccessLevel.PRIVATE;

import java.util.List;
import java.util.Set;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.api.core.v1.wallet.dtos.MempoolRecommendedFeesDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TokenDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TxSubmitDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferPageDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.WalletBalanceDtoV1;
import global.goldenera.wallet.client.node.model.v1.BulkMemTransferPageRequestV1.TransferTypeEnum;
import global.goldenera.wallet.client.node.model.v1.MempoolResult;
import global.goldenera.wallet.service.business.WalletBusinessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

/**
 * Wallet API for balance and transfer history.
 */
@RestController
@RequestMapping("/api/core/v1/wallet")
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
@Slf4j
@Tag(name = "Wallet API V1", description = "API for wallet balances and transfer history")
public class WalletApiV1 {

    WalletBusinessService walletBusinessService;

    @GetMapping("/balances")
    @Operation(summary = "Get wallet balances", description = "Get balances for multiple addresses")
    public List<WalletBalanceDtoV1> getBalances(
            @Parameter(description = "Wallet addresses") @RequestParam Set<Address> addresses,
            @Parameter(description = "Token addresses (optional, null for native token)") @RequestParam(required = false) Set<Address> tokenAddresses) {

        log.debug("Getting balances for {} addresses", addresses.size());

        return walletBusinessService.getBalances(addresses, tokenAddresses != null ? tokenAddresses : Set.of());
    }

    @GetMapping("/transfers")
    @Operation(summary = "Get transfer history", description = "Get unified transfer history (pending first, then confirmed)")
    public UnifiedTransferPageDtoV1 getTransfers(
            @Parameter(description = "Wallet addresses") @RequestParam Set<Address> addresses,
            @Parameter(description = "Token addresses (optional, null for all tokens)") @RequestParam(required = false) Set<Address> tokenAddresses,
            @Parameter(description = "Transfer type (optional, null for all types)") @RequestParam(required = false) TransferTypeEnum transferType,
            @Parameter(description = "Page number (0-indexed)") @RequestParam(defaultValue = "0") int pageNumber,
            @Parameter(description = "Page size") @RequestParam(defaultValue = "20") int pageSize) {

        log.debug("Getting transfers for {} addresses, page {}/{}", addresses.size(), pageNumber, pageSize);

        return walletBusinessService.getTransfers(addresses, tokenAddresses != null ? tokenAddresses : Set.of(),
                pageNumber, pageSize, transferType);
    }

    @GetMapping("/tokens")
    @Operation(summary = "Get tokens", description = "Get paginated list of available tokens")
    public List<TokenDtoV1> getTokens() {
        log.debug("Getting tokens");
        return walletBusinessService.getTokens();
    }

    @GetMapping("/token")
    @Operation(summary = "Get token by address", description = "Get token details by contract address")
    public TokenDtoV1 getTokenByAddress(
            @Parameter(description = "Token contract address") @RequestParam Address address) {

        log.debug("Getting token by address: {}", address);

        return walletBusinessService.getTokenByAddress(address);
    }

    @GetMapping("/next-nonce")
    @Operation(summary = "Get next nonce", description = "Get next nonce for a given address")
    public String getNextNonce(
            @Parameter(description = "Address") @RequestParam Address address) {

        log.debug("Getting next nonce for address: {}", address);

        return walletBusinessService.getNextNonce(address).toString();
    }

    @PostMapping("/submit-tx")
    @Operation(summary = "Submit transaction", description = "Submit a transaction")
    public MempoolResult submitTransaction(
            @Parameter(description = "Transaction details") @RequestBody TxSubmitDtoV1 input) {
        log.debug("Submitting transaction: {}", input);
        return walletBusinessService.submitTransaction(input.hexData());
    }

    @GetMapping("/mempool-recommended-fees")
    @Operation(summary = "Get mempool recommended fees", description = "Get mempool recommended fees")
    public MempoolRecommendedFeesDtoV1 getMempoolRecommendedFees() {
        log.debug("Getting mempool recommended fees");
        return walletBusinessService.getMempoolRecommendedFees();
    }
}
