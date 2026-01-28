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

import java.util.List;

import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.client.node.api.v1.WebhookApiV1Api;
import global.goldenera.wallet.client.node.api.v1.WebhookEventApiV1Api;
import global.goldenera.wallet.client.node.model.v1.WebhookDtoV1;
import global.goldenera.wallet.client.node.model.v1.WebhookEventDtoV1;
import global.goldenera.wallet.client.node.model.v1.WebhookEventDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.WebhookSetEnabledInDtoV1;
import global.goldenera.wallet.properties.NodeProperties;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

/**
 * Service layer for Webhook API with retry support.
 * No caching is applied as webhook data is user-specific and mutable.
 * Wraps the generated WebhookApiV1Api and WebhookEventApiV1Api client
 * interfaces.
 */
@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class WebhookNodeService {

    WebhookApiV1Api webhookApi;
    WebhookEventApiV1Api webhookEventApi;
    NodeProperties nodeProperties;

    // ========================
    // Webhook CRUD operations
    // ========================

    /**
     * Enable or disable a webhook.
     * 
     * @param enabled
     *            Enable/disable flag
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public WebhookDtoV1 setWebhookEnabled(boolean enabled) {
        return webhookApi
                .apiV1WebhookSetEnabled(nodeProperties.getWebhookUid(), new WebhookSetEnabledInDtoV1().enabled(enabled))
                .getBody();
    }

    // ========================
    // Webhook Event operations
    // ========================

    /**
     * Get a paginated list of webhook events.
     * 
     * @param webhookId
     *            UUID of the webhook
     * @param pageNumber
     *            Page number (0-based)
     * @param pageSize
     *            Number of items per page
     * @param direction
     *            Optional sort direction
     * @param type
     *            Optional filter by event type
     * @param addressFilter
     *            Optional filter by address
     * @param tokenAddressFilter
     *            Optional filter by token address
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public WebhookEventDtoV1Page getEventPage(
            Integer pageNumber,
            Integer pageSize,
            String direction,
            String type,
            Address addressFilter,
            Address tokenAddressFilter) {
        return webhookEventApi
                .apiV1WebhookEventGetPage(nodeProperties.getWebhookUid(), pageNumber, pageSize, direction, type,
                        addressFilter != null ? addressFilter.toChecksumAddress() : null,
                        tokenAddressFilter != null ? tokenAddressFilter.toChecksumAddress() : null)
                .getBody();
    }

    /**
     * Subscribe to webhook events.
     * 
     * @param events
     *            List of event configurations to subscribe to
     * @return Number of events subscribed
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Integer subscribeToEvents(List<WebhookEventDtoV1> events) {
        return webhookEventApi.apiV1WebhookEventSubscribe(nodeProperties.getWebhookUid(), events).getBody();
    }

    /**
     * Unsubscribe from webhook events.
     * 
     * @param events
     *            List of event configurations to unsubscribe from
     * @return Number of events unsubscribed
     */
    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Integer unsubscribeFromEvents(List<WebhookEventDtoV1> events) {
        return webhookEventApi.apiV1WebhookEventUnsubscribe(nodeProperties.getWebhookUid(), events).getBody();
    }
}
