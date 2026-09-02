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

import global.goldenera.cryptoj.datatypes.Address;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * Wallet balance DTO for displaying account balances.
 */
public record WalletBalanceDtoV1(
                /** Account address */
                Address address,
                /** Token contract address (Address.ZERO for native token) */
                Address tokenAddress,
                /** Available amount after pending outgoing amounts and native fees. Used by Send/MAX. */
                @Schema(description = "Available amount after pending outgoing amounts and native fees; used by Send/MAX") Wei balance,
                /** Canonical decimal block height when balance was last updated */
                @Schema(description = "Canonical non-negative decimal block height", type = "string",
                                pattern = "^(0|[1-9][0-9]*)$") String updatedAtBlockHeight,
                /** Timestamp when balance was last updated */
                Instant updatedAtTimestamp,
                /** Full confirmed amount, including locked mining rewards. */
                @Schema(description = "Full confirmed amount including locked mining rewards",
                                requiredMode = Schema.RequiredMode.REQUIRED) Wei totalBalance,
                /** Confirmed mining rewards which cannot yet be spent. */
                @Schema(description = "Confirmed mining rewards that cannot yet be spent") Wei lockedMiningReward,
                /** Confirmed unlocked amount before pending outgoing reservations. */
                @Schema(description = "Confirmed unlocked amount before pending outgoing reservations") Wei spendableBalance) {

        public WalletBalanceDtoV1(Address address, Address tokenAddress, Wei balance,
                        String updatedAtBlockHeight, Instant updatedAtTimestamp) {
                this(address, tokenAddress, balance, updatedAtBlockHeight, updatedAtTimestamp,
                                balance, Wei.ZERO, balance);
        }
}
