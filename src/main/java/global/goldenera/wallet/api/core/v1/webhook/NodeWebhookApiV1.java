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
package global.goldenera.wallet.api.core.v1.webhook;

import static lombok.AccessLevel.PRIVATE;

import java.io.IOException;
import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import global.goldenera.wallet.api.core.v1.webhook.dtos.WebhookEventDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainBlockHeaderDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainTxDtoV1;
import global.goldenera.wallet.components.WebhookSignatureVerifier;
import global.goldenera.wallet.exceptions.GERuntimeException;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@RestController
@RequestMapping("/api/core/v1/node-webhook")
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
@Slf4j
public class NodeWebhookApiV1 {

    ObjectMapper objectMapper;
    WebhookSignatureVerifier webhookSignatureVerifier;

    @PostMapping("/handle")
    public ResponseEntity<String> receiveWebhook(
            @RequestHeader(value = "X-Webhook-Timestamp") String timestamp,
            @RequestHeader(value = "X-Webhook-Signature") String signature,
            @RequestBody byte[] rawBody) {
        try {
            webhookSignatureVerifier.verify(rawBody, timestamp, signature);

            List<WebhookEventDtoV1> events = objectMapper.readValue(rawBody, new TypeReference<>() {
            });
            events.forEach(this::handleEvent);
            return ResponseEntity.ok("Processed");
        } catch (GERuntimeException e) {
            log.warn("Security check failed: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body("Invalid signature");
        } catch (IOException e) {
            log.error("Deserialization failed", e);
            return ResponseEntity.badRequest().body("Invalid JSON structure");
        }
    }

    private void handleEvent(WebhookEventDtoV1 event) {
        switch (event) {
            case WebhookEventDtoV1.NewBlockEvent newBlock -> {
                BlockchainBlockHeaderDtoV1 header = newBlock.data();

                // log.info("New Block Received: {}", header.getMetadata());
            }

            case WebhookEventDtoV1.AddressActivityEvent activity -> {
                BlockchainTxDtoV1 tx = activity.data();

                // log.info("Transaction Activity: {}", tx.getMetadata());
            }
            default -> {
                // log.warn("Unknown event type: {}", event);
            }
        }
    }
}
