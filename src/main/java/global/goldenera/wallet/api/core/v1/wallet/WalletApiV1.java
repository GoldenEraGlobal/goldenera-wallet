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
import global.goldenera.wallet.api.core.v1.wallet.dtos.TransactionStatusDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TxSubmitDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferPageDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.WalletBalanceDtoV1;
import global.goldenera.wallet.client.node.model.v1.BulkMemTransferPageRequestV1.TransferTypeEnum;
import global.goldenera.wallet.client.node.model.v1.MempoolResult;
import global.goldenera.wallet.service.business.WalletBusinessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

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
    @Operation(summary = "Get wallet balances", description = "Get total, locked, spendable and available balances for 1–100 addresses; large results must be narrowed")
    public List<WalletBalanceDtoV1> getBalances(
            @Parameter(description = "1–100 wallet addresses; an empty list is rejected") @RequestParam Set<Address> addresses,
            @Parameter(description = "At most 100 token addresses (optional; omitted means all tokens)") @RequestParam(required = false) Set<Address> tokenAddresses) {

        log.debug("Getting balances for {} addresses", addresses.size());

        return walletBusinessService.getBalances(addresses, tokenAddresses != null ? tokenAddresses : Set.of());
    }

    @GetMapping("/transfers")
    @Operation(summary = "Get transfer history", description = "Get unified transfer history (pending first, then confirmed)")
    public UnifiedTransferPageDtoV1 getTransfers(
            @Parameter(description = "1–100 wallet addresses; an empty list is rejected") @RequestParam Set<Address> addresses,
            @Parameter(description = "At most 100 token addresses (optional; omitted means all tokens)") @RequestParam(required = false) Set<Address> tokenAddresses,
            @Parameter(description = "Transfer type (optional, null for all types)") @RequestParam(required = false) TransferTypeEnum transferType,
            @Parameter(description = "Page number (0-indexed; pageNumber × pageSize must not exceed 100000)") @RequestParam(defaultValue = "0") int pageNumber,
            @Parameter(description = "Page size, 1–100") @RequestParam(defaultValue = "20") int pageSize) {

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
    @ApiResponse(responseCode = "200", description = "Canonical non-negative decimal next nonce",
            content = @Content(schema = @Schema(type = "string", pattern = "^(0|[1-9][0-9]*)$")))
    public String getNextNonce(
            @Parameter(description = "Address") @RequestParam Address address) {

        log.debug("Getting next nonce for address: {}", address);

        return walletBusinessService.getNextNonce(address);
    }

    @GetMapping("/transaction-status")
    @Operation(summary = "Observe transaction status",
            description = "Observe a previously signed transaction without submitting or replaying it")
    public TransactionStatusDtoV1 getTransactionStatus(
            @Parameter(description = "Canonical lowercase transaction hash", required = true,
                    schema = @Schema(type = "string", pattern = "^0x[0-9a-f]{64}$"))
            @RequestParam String hash,
            @Parameter(description = "Transaction sender", required = true,
                    schema = @Schema(type = "string", pattern = "^0x[0-9a-fA-F]{40}$"))
            @RequestParam Address sender,
            @Parameter(description = "Canonical uint256 decimal nonce", required = true,
                    schema = @Schema(type = "string", pattern = "^(0|[1-9][0-9]*)$", maxLength = 78))
            @RequestParam @Size(max = 78) String nonce) {
        return walletBusinessService.getTransactionStatus(hash, sender, nonce);
    }

    @PostMapping("/submit-tx")
    @Operation(summary = "Submit transaction", description = "Submit a transaction")
    public MempoolResult submitTransaction(
            @Parameter(description = "Transaction details") @RequestBody @Valid TxSubmitDtoV1 input) {
        log.debug("Submitting transaction");
        return walletBusinessService.submitTransaction(input.hexData());
    }

    @GetMapping("/mempool-recommended-fees")
    @Operation(summary = "Get mempool recommended fees", description = "Get mempool recommended fees")
    public MempoolRecommendedFeesDtoV1 getMempoolRecommendedFees() {
        log.debug("Getting mempool recommended fees");
        return walletBusinessService.getMempoolRecommendedFees();
    }
}
