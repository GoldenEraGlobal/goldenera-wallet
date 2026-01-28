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
package global.goldenera.wallet.api.core.v1.webhook.dtos;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

import global.goldenera.cryptoj.datatypes.Hash;
import global.goldenera.wallet.client.node.model.v1.BlockchainBlockHeaderDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainTxDtoV1;
import global.goldenera.wallet.client.node.model.v1.WebhookDtoV1;
import global.goldenera.wallet.enums.WebhookEventType;
import global.goldenera.wallet.enums.WebhookTxStatus;

@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.EXISTING_PROPERTY, property = "type", visible = true)
@JsonSubTypes({
                @JsonSubTypes.Type(value = WebhookEventDtoV1.NewBlockEvent.class, name = "NEW_BLOCK"),
                @JsonSubTypes.Type(value = WebhookEventDtoV1.AddressActivityEvent.class, name = "ADDRESS_ACTIVITY"),
                @JsonSubTypes.Type(value = WebhookEventDtoV1.ReorgEvent.class, name = "REORG")
})
public sealed interface WebhookEventDtoV1 {

        WebhookEventType type();

        WebhookDtoV1.TypeEnum source();

        // --- 1. NEW BLOCK ---

        record NewBlockEvent(
                        WebhookEventType type,
                        WebhookDtoV1.TypeEnum source,
                        BlockchainBlockHeaderDtoV1 data) implements WebhookEventDtoV1 {
        }

        // --- 2. ADDRESS ACTIVITY ---

        record AddressActivityEvent(
                        WebhookEventType type,
                        WebhookDtoV1.TypeEnum source,
                        BlockchainTxDtoV1 data,
                        WebhookTxStatus status) implements WebhookEventDtoV1 {
        }

        // --- 3. REORG ---

        record ReorgEvent(
                        WebhookEventType type,
                        WebhookDtoV1.TypeEnum source,
                        Long oldHeight,
                        Hash oldHash,
                        Long newHeight,
                        Hash newHash) implements WebhookEventDtoV1 {
        }
}