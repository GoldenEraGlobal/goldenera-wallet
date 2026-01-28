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
package global.goldenera.wallet.service.scheduler;

import static lombok.AccessLevel.PRIVATE;

import java.util.List;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import global.goldenera.wallet.client.node.model.v1.WebhookEventDtoV1;
import global.goldenera.wallet.service.node.WebhookNodeService;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
@Slf4j
public class SubscriptionSyncService {

    WebhookNodeService webhookNodeService;

    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(fixedDelay = 3600000)
    public void syncSubscriptions() {
        log.info("Starting subscription sync with Blockchain Node...");
        // Subscribe to new blocks (idempotent, ensures we always track new blocks)
        try {
            webhookNodeService.subscribeToEvents(List.of(
                    new WebhookEventDtoV1().type(WebhookEventDtoV1.TypeEnum.NEW_BLOCK)));
            log.debug("Subscribed to NEW_BLOCK events.");
        } catch (Exception e) {
            log.error("Failed to subscribe to NEW_BLOCK events.", e);
        }
    }
}
