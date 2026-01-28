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
package global.goldenera.wallet.components;

import static lombok.AccessLevel.PRIVATE;

import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Base64;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.stereotype.Component;

import global.goldenera.wallet.exceptions.GERuntimeException;
import global.goldenera.wallet.exceptions.GEValidationException;
import global.goldenera.wallet.properties.NodeProperties;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class WebhookSignatureVerifier {

    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final long TOLERANCE_IN_SECONDS = 300;

    byte[] secretKeyBytes;

    public WebhookSignatureVerifier(NodeProperties nodeProperties) {
        if (nodeProperties.getWebhookSecretKey() == null || nodeProperties.getWebhookSecretKey().isBlank()) {
            throw new GEValidationException("Webhook secret key is not configured!");
        }
        this.secretKeyBytes = nodeProperties.getWebhookSecretKey().getBytes(StandardCharsets.UTF_8);
    }

    /**
     * Verifies the integrity and authenticity of the webhook request.
     *
     * @param payloadBody
     *            Raw byte array of the request body (do not deserialize before
     *            this!).
     * @param timestamp
     *            Value of X-Webhook-Timestamp header.
     * @param signature
     *            Value of X-Webhook-Signature header.
     * @throws GEValidationException
     *             if verification fails.
     */
    public void verify(byte[] payloadBody, String timestamp, String signature) {
        if (timestamp == null || signature == null) {
            throw new GEValidationException("Missing required webhook headers (Timestamp or Signature)");
        }

        verifyTimestamp(timestamp);

        String calculatedSignature = calculateSignature(payloadBody, timestamp);

        if (!MessageDigest.isEqual(
                signature.getBytes(StandardCharsets.UTF_8),
                calculatedSignature.getBytes(StandardCharsets.UTF_8))) {
            log.warn("Invalid webhook signature. Received: {}, Calculated: {}", signature, calculatedSignature);
            throw new GEValidationException("Invalid webhook signature");
        }
    }

    private void verifyTimestamp(String timestampStr) {
        try {
            long eventTime = Long.parseLong(timestampStr);
            long now = Instant.now().getEpochSecond();
            if (Math.abs(now - eventTime) > TOLERANCE_IN_SECONDS) {
                log.error("Webhook timestamp rejected. Event Time: {}, Current Time: {}, Tolerance: {}",
                        eventTime, now, TOLERANCE_IN_SECONDS);
                throw new GEValidationException("Webhook timestamp is outside of the tolerance window");
            }
        } catch (NumberFormatException e) {
            throw new GEValidationException("Invalid timestamp format");
        }
    }

    private String calculateSignature(byte[] payloadBody, String timestamp) {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            SecretKeySpec secretKeySpec = new SecretKeySpec(secretKeyBytes, HMAC_ALGORITHM);
            mac.init(secretKeySpec);
            mac.update(timestamp.getBytes(StandardCharsets.UTF_8));
            mac.update((byte) '.');
            byte[] signatureBytes = mac.doFinal(payloadBody);
            return Base64.getEncoder().encodeToString(signatureBytes);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            log.error("Crypto algorithm not found or key invalid", e);
            throw new GERuntimeException("Error calculating HMAC signature", e);
        }
    }
}