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

import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;

import global.goldenera.wallet.client.node.api.v1.MempoolApiV1Api;
import global.goldenera.wallet.client.node.model.v1.MempoolResult;
import global.goldenera.wallet.client.node.model.v1.MempoolSubmitTxDtoV1;
import global.goldenera.wallet.client.node.model.v1.RecommendedFeesDtoV1;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

/**
 * Service layer for Mempool API with caching and retry support.
 * Wraps the generated MempoolApiV1Api client interface.
 */
@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class MempoolNodeService {

    MempoolApiV1Api mempoolApi;

    /**
     * Submit a raw transaction to the mempool.
     * No caching for mutating operations.
     * 
     * @param input
     *            Raw transaction data
     * @return Result of the submission
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public MempoolResult submitTransaction(MempoolSubmitTxDtoV1 input) {
        return mempoolApi.submitTx(input).getBody();
    }

    /**
     * Get recommended transaction fees based on current mempool state.
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public RecommendedFeesDtoV1 getRecommendedFees() {
        return mempoolApi.getRecommendedFees().getBody();
    }
}
