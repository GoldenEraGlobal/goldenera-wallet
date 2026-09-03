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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import org.springframework.http.server.PathContainer;
import org.springframework.http.server.RequestPath;
import org.springframework.stereotype.Service;

import com.github.benmanes.caffeine.cache.Caffeine;

import global.goldenera.wallet.properties.ThrottlingProperties;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.experimental.FieldDefaults;

@Service
@RequiredArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class ThrottlingService {

    private static final Duration REFILL_DURATION = Duration.ofSeconds(1);

    ThrottlingProperties throttlingProperties;
    CoreRoutePolicyRegistry routePolicies;

    Map<String, Bucket> globalIpCache = Caffeine.newBuilder()
            .expireAfterAccess(1, TimeUnit.HOURS)
            .maximumSize(10_000)
            .<String, Bucket>build().asMap();

    Map<String, Bucket> specificLogicCache = Caffeine.newBuilder()
            .expireAfterAccess(1, TimeUnit.HOURS)
            .maximumSize(50_000)
            .<String, Bucket>build().asMap();

    ConcurrentMap<String, InFlightState> inFlightIpCache = new ConcurrentHashMap<>();

    InFlightState globalInFlight = new InFlightState();

    /** Layer 1: global per-IP request-rate safety net. */
    public RateLimitDecision checkGlobalIpLimitDecision(HttpServletRequest request) {
        String ip = getClientIp(request);
        Bucket bucket = globalIpCache.computeIfAbsent(ip, ignored -> createBucket(
                throttlingProperties.getGlobalCapacity(), throttlingProperties.getGlobalRefillTokens()));
        return consume(bucket, 1);
    }

    public boolean checkGlobalIpLimit(HttpServletRequest request) {
        return checkGlobalIpLimitDecision(request).allowed();
    }

    /** Layer 2: endpoint-aware public API cost. */
    public RateLimitDecision checkSpecificLimitDecision(HttpServletRequest request, String keyIdentifier) {
        String path = getRequestPath(request);
        Bucket bucket = specificLogicCache.computeIfAbsent(keyIdentifier + ":" + getBucketType(path),
                ignored -> createBucket(throttlingProperties.getPublicCoreCapacity(),
                        throttlingProperties.getPublicCoreRefillTokens()));

        int cost = (int) Math.min(resolveCost(path, request.getMethod()),
                throttlingProperties.getPublicCoreCapacity());
        return consume(bucket, cost);
    }

    public boolean checkSpecificLimit(HttpServletRequest request, String keyIdentifier) {
        return checkSpecificLimitDecision(request, keyIdentifier).allowed();
    }

    /**
     * Reserves both one active request and the route's worst-case body bytes.
     * The returned handle is idempotent and must be closed in a finally block.
     */
    public InFlightAdmission tryAcquireInFlight(HttpServletRequest request, long reservedBytes) {
        long bytes = Math.max(0, reservedBytes);
        if (!globalInFlight.tryAcquire(throttlingProperties.getGlobalInFlightRequests(),
                throttlingProperties.getGlobalInFlightBytes(), bytes)) {
            return null;
        }

        String clientIp = getClientIp(request);
        AtomicReference<InFlightState> acquired = new AtomicReference<>();
        inFlightIpCache.compute(clientIp, (ignored, existing) -> {
            InFlightState current = existing == null ? new InFlightState() : existing;
            if (current.tryAcquire(throttlingProperties.getPerIpInFlightRequests(),
                    throttlingProperties.getPerIpInFlightBytes(), bytes)) {
                acquired.set(current);
                return current;
            }
            return existing;
        });
        InFlightState perIp = acquired.get();
        if (perIp == null) {
            globalInFlight.release(bytes);
            return null;
        }
        return new InFlightAdmission(globalInFlight, inFlightIpCache, clientIp, perIp, bytes);
    }

    /** Use Spring's decoded routing segments for API detection and policy lookup. */
    public String getRequestPath(HttpServletRequest request) {
        StringBuilder path = new StringBuilder();
        for (PathContainer.Element element : RequestPath.parse(request.getRequestURI(), request.getContextPath())
                .pathWithinApplication().elements()) {
            path.append(element instanceof PathContainer.PathSegment segment ? segment.valueToMatch() : element.value());
        }
        return path.toString();
    }

    private Bucket createBucket(long capacity, long refillTokens) {
        return Bucket.builder()
                .addLimit(limit -> limit.capacity(capacity).refillGreedy(refillTokens, REFILL_DURATION))
                .build();
    }

    private static RateLimitDecision consume(Bucket bucket, long tokens) {
        ConsumptionProbe probe = bucket.tryConsumeAndReturnRemaining(tokens);
        if (probe.isConsumed()) {
            return new RateLimitDecision(true, 0);
        }
        long nanos = probe.getNanosToWaitForRefill();
        long seconds = nanos / 1_000_000_000L;
        if (nanos % 1_000_000_000L != 0) {
            seconds++;
        }
        return new RateLimitDecision(false, Math.max(1, seconds));
    }

    private int resolveCost(String path, String method) {
        return routePolicies.find(path, method)
                .map(CoreRoutePolicyRegistry.RoutePolicy::throttleCost)
                .orElse(1);
    }

    private String getBucketType(String uri) {
        return uri.startsWith("/api/core/") ? "PUBLIC_CORE" : "PUBLIC_API";
    }

    private String getClientIp(HttpServletRequest request) {
        return request.getRemoteAddr();
    }

    public record RateLimitDecision(boolean allowed, long retryAfterSeconds) { }

    public static final class InFlightAdmission implements AutoCloseable {
        private final InFlightState global;
        private final ConcurrentMap<String, InFlightState> perIpStates;
        private final String clientIp;
        private final InFlightState perIp;
        private final long reservedBytes;
        private final AtomicBoolean closed = new AtomicBoolean();

        private InFlightAdmission(InFlightState global, ConcurrentMap<String, InFlightState> perIpStates,
                String clientIp, InFlightState perIp, long reservedBytes) {
            this.global = global;
            this.perIpStates = perIpStates;
            this.clientIp = clientIp;
            this.perIp = perIp;
            this.reservedBytes = reservedBytes;
        }

        @Override
        public void close() {
            if (closed.compareAndSet(false, true)) {
                try {
                    perIpStates.compute(clientIp, (ignored, current) -> {
                        if (current != perIp) {
                            throw new IllegalStateException("In-flight per-IP admission state changed while active");
                        }
                        current.release(reservedBytes);
                        return current.isIdle() ? null : current;
                    });
                } finally {
                    global.release(reservedBytes);
                }
            }
        }
    }

    static final class InFlightState {
        private long requests;
        private long bytes;

        synchronized boolean tryAcquire(long requestLimit, long byteLimit, long reservedBytes) {
            if (requests >= requestLimit || reservedBytes > byteLimit - bytes) {
                return false;
            }
            requests++;
            bytes += reservedBytes;
            return true;
        }

        synchronized void release(long reservedBytes) {
            if (requests <= 0 || bytes < reservedBytes) {
                throw new IllegalStateException("In-flight admission was released without a matching reservation");
            }
            requests--;
            bytes -= reservedBytes;
        }

        synchronized boolean isIdle() {
            return requests == 0;
        }
    }
}
