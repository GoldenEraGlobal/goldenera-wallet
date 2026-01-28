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
package global.goldenera.wallet.enums;

/**
 * Result status enum for mempool transaction submission.
 */
public enum MempoolAddResult {
    SUCCESS, // Added as executable
    QUEUED, // Added as future
    STALE, // Rejected: Nonce too low
    REJECTED_FEE, // Rejected: Fee too low (for spam)
    REJECTED_RBF, // Rejected: Fee too low for replacement
    REJECTED_STATE, // Rejected: Insufficient funds, not authority, etc.
    REJECTED_DUPLICATE, // Rejected: Duplicate hash or governance
    REJECTED_NONCE_TOO_FAR_FUTURE, // Rejected: Nonce too far in the future
    REJECTED_MEMPOOL_FULL, // Rejected: Mempool full and fee too low
    REJECTED_OTHER; // Rejected: Bad signature, invalid format, etc.

    public boolean isSuccess() {
        return this == SUCCESS || this == QUEUED;
    }
}
