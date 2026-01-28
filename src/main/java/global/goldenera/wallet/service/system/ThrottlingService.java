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
package global.goldenera.wallet.service.system;

import static lombok.AccessLevel.PRIVATE;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.github.benmanes.caffeine.cache.Caffeine;

import global.goldenera.wallet.properties.ThrottlingProperties;
import io.github.bucket4j.Bucket;
import jakarta.servlet.http.HttpServletRequest;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class ThrottlingService {

    ThrottlingProperties throttlingProperties;

    private static final Duration REFILL_DURATION = Duration.ofSeconds(1);

    Map<String, Bucket> globalIpCache = Caffeine.newBuilder()
            .expireAfterAccess(1, TimeUnit.HOURS)
            .maximumSize(10_000)
            .<String, Bucket>build().asMap();

    Map<String, Bucket> specificLogicCache = Caffeine.newBuilder()
            .expireAfterAccess(1, TimeUnit.HOURS)
            .maximumSize(50_000)
            .<String, Bucket>build().asMap();

    private static final Map<Pattern, Integer> ENDPOINT_COSTS = new LinkedHashMap<>();
    static {

    }

    /**
     * Layer 1: Global IP Check.
     * Returns false if the IP is spamming the server entirely.
     */
    public boolean checkGlobalIpLimit(HttpServletRequest request) {
        String ip = getClientIp(request);
        Bucket bucket = globalIpCache.computeIfAbsent(ip, k -> createBucket(throttlingProperties.getGlobalCapacity(),
                throttlingProperties.getGlobalRefillTokens()));
        return bucket.tryConsume(1);
    }

    /**
     * Layer 2: Context Aware Check.
     * Handles Public Core vs API Key logic and calculating costs.
     */
    public boolean checkSpecificLimit(HttpServletRequest request, String keyIdentifier) {
        String uri = request.getRequestURI();
        Bucket bucket = specificLogicCache.computeIfAbsent(keyIdentifier + ":" + getBucketType(uri),
                k -> createBucketForContext(uri));

        int cost = resolveCost(uri);
        return bucket.tryConsume(cost);
    }

    private Bucket createBucketForContext(String uri) {
        return createBucket(throttlingProperties.getPublicCoreCapacity(),
                throttlingProperties.getPublicCoreRefillTokens());
    }

    private Bucket createBucket(long capacity, long refillTokens) {
        return Bucket.builder()
                .addLimit(limit -> limit.capacity(capacity)
                        .refillGreedy(refillTokens, REFILL_DURATION))
                .build();
    }

    private int resolveCost(String uri) {
        for (Map.Entry<Pattern, Integer> entry : ENDPOINT_COSTS.entrySet()) {
            if (entry.getKey().matcher(uri).matches()) {
                return entry.getValue();
            }
        }
        return 1;
    }

    private String getBucketType(String uri) {
        return "PUBLIC_CORE";
    }

    private String getClientIp(HttpServletRequest request) {
        return request.getRemoteAddr();
    }
}