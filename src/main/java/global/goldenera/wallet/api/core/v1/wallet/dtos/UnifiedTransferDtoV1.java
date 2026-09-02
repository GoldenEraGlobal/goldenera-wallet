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
package global.goldenera.wallet.api.core.v1.wallet.dtos;

import java.time.Instant;

import org.apache.tuweni.units.ethereum.Wei;

import com.fasterxml.jackson.annotation.JsonInclude;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.Hash;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * Unified transfer DTO that combines both pending (mempool) and confirmed
 * transfers.
 * Used for wallet transfer history display.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record UnifiedTransferDtoV1(
        /** Transfer status: PENDING or CONFIRMED */
        TransferStatus status,
        /** Transaction hash */
        Hash txHash,
        /** Transfer type */
        TransferType transferType,
        /** Sender address */
        Address from,
        /** Recipient address */
        Address to,
        /** Token contract address */
        Address tokenAddress,
        /** Transfer amount */
        Wei amount,
        /** Transaction fee */
        Wei fee,
        /** Canonical non-negative decimal transaction nonce */
        @Schema(description = "Canonical non-negative decimal transaction nonce", type = "string",
                pattern = "^(0|[1-9][0-9]*)$") String nonce,
        /** Message attached to transfer */
        String message,
        /** Timestamp - addedAt for pending, block timestamp for confirmed */
        Instant timestamp,
        /** Canonical non-negative decimal block height (only for confirmed) */
        @Schema(description = "Canonical non-negative decimal block height", type = "string",
                pattern = "^(0|[1-9][0-9]*)$") String blockHeight,
        /** Block hash (only for confirmed) */
        Hash blockHash,
        /** Canonical non-negative decimal confirmation count (only for confirmed) */
        @Schema(description = "Canonical non-negative decimal confirmation count", type = "string",
                pattern = "^(0|[1-9][0-9]*)$") String confirmations) {

    public enum TransferStatus {
        PENDING, CONFIRMED
    }

    public enum TransferType {
        TRANSFER, BLOCK_FEES, BLOCK_REWARD, MINT, BURN
    }
}
