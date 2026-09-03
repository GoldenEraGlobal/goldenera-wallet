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

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** Safe observational lifecycle state for a previously signed transaction. */
public record TransactionStatusDtoV1(
        @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Status status,
        @NotNull @Pattern(regexp = "^0x[0-9a-f]{64}$")
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^0x[0-9a-f]{64}$") String hash,
        @NotNull @Pattern(regexp = "^0x[0-9a-f]{40}$")
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, pattern = "^0x[0-9a-f]{40}$") String sender,
        @NotNull @Pattern(regexp = "^(0|[1-9][0-9]*)$") @Size(max = 78)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string",
                pattern = "^(0|[1-9][0-9]*)$", maxLength = 78) String nonce,
        @Pattern(regexp = "^(0|[1-9][0-9]*)$") @Size(max = 78)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string",
                pattern = "^(0|[1-9][0-9]*)$", maxLength = 78, nullable = true) String nextNonce,
        @Pattern(regexp = "^(0|[1-9][0-9]*)$") @Size(max = 78)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string",
                pattern = "^(0|[1-9][0-9]*)$", maxLength = 78, nullable = true) String confirmations,
        @NotNull @Pattern(regexp = "^[1-9][0-9]*$") @Size(max = 78)
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string",
                pattern = "^[1-9][0-9]*$", maxLength = 78) String requiredConfirmations) {

    public enum Status {
        PENDING,
        CONFIRMING,
        CONFIRMED,
        ABSENT_REUSABLE,
        CONSUMED_SUPERSEDED,
        BLOCKED_UNKNOWN
    }
}
