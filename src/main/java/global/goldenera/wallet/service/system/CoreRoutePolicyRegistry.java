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

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;

/**
 * The admission policy is intentionally explicit. A new Core controller mapping
 * must add a policy and pass the controller/policy parity test before it can read
 * a request body or consume backend resources.
 */
@Component
public class CoreRoutePolicyRegistry {

    public static final int SIGNED_TX_REQUEST_BYTES = 256 * 1024;
    public static final int DEVICE_REGISTRATION_REQUEST_BYTES = 16 * 1024;
    public static final int WEBHOOK_REQUEST_BYTES = 16 * 1024 * 1024;
    private static final long CACHED_BODY_RESERVATION_MULTIPLIER = 4;
    public static final long MAX_ROUTE_RESERVATION_BYTES =
            WEBHOOK_REQUEST_BYTES * CACHED_BODY_RESERVATION_MULTIPLIER;

    private static final int DEFAULT_COST = 1;

    private final List<RoutePolicy> declaredPolicies;
    private final Map<String, Map<String, RoutePolicy>> policiesByPath;

    public CoreRoutePolicyRegistry() {
        this(List.of(
                get("/api/core/v1/wallet/balances", 10),
                get("/api/core/v1/wallet/transfers", 3),
                get("/api/core/v1/wallet/tokens", DEFAULT_COST),
                get("/api/core/v1/wallet/token", DEFAULT_COST),
                get("/api/core/v1/wallet/next-nonce", DEFAULT_COST),
                get("/api/core/v1/wallet/transaction-status", 10),
                post("/api/core/v1/wallet/submit-tx", SIGNED_TX_REQUEST_BYTES, 10, true),
                get("/api/core/v1/wallet/mempool-recommended-fees", DEFAULT_COST),
                get("/api/core/v1/governance/authority-status", DEFAULT_COST),
                get("/api/core/v1/governance/bips", 3),
                get("/api/core/v1/governance/bip", DEFAULT_COST),
                post("/api/core/v1/device/register", DEVICE_REGISTRATION_REQUEST_BYTES, DEFAULT_COST, true),
                post("/api/core/v1/node-webhook/handle", WEBHOOK_REQUEST_BYTES, 10, true)));
    }

    CoreRoutePolicyRegistry(Collection<RoutePolicy> policies) {
        List<RoutePolicy> declared = List.copyOf(policies);
        Map<String, Map<String, RoutePolicy>> byPath = new LinkedHashMap<>();
        for (RoutePolicy policy : declared) {
            RoutePolicy previous = byPath.computeIfAbsent(policy.path(), ignored -> new LinkedHashMap<>())
                    .put(policy.method().name(), policy);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate Core route policy for "
                        + policy.method() + " " + policy.path());
            }
        }
        Map<String, Map<String, RoutePolicy>> immutable = new LinkedHashMap<>();
        byPath.forEach((path, methods) -> immutable.put(path,
                Collections.unmodifiableMap(new LinkedHashMap<>(methods))));
        declaredPolicies = declared;
        policiesByPath = Collections.unmodifiableMap(immutable);
    }

    public boolean isCorePath(String path) {
        return path.equals("/api/core") || path.startsWith("/api/core/");
    }

    public boolean isKnownPath(String path) {
        return policiesByPath.containsKey(path);
    }

    public Optional<RoutePolicy> find(String path, String method) {
        Map<String, RoutePolicy> methods = policiesByPath.get(path);
        if (methods == null) {
            return Optional.empty();
        }
        String normalizedMethod = method.toUpperCase(Locale.ROOT);
        RoutePolicy exact = methods.get(normalizedMethod);
        if (exact != null) {
            return Optional.of(exact);
        }
        if (HttpMethod.HEAD.name().equals(normalizedMethod)) {
            RoutePolicy get = methods.get(HttpMethod.GET.name());
            return get == null ? Optional.empty() : Optional.of(get.withMethod(HttpMethod.HEAD));
        }
        if (HttpMethod.OPTIONS.name().equals(normalizedMethod)) {
            return Optional.of(new RoutePolicy(HttpMethod.OPTIONS, path, 0, DEFAULT_COST, 0, false));
        }
        return Optional.empty();
    }

    public Set<String> allowedMethods(String path) {
        Map<String, RoutePolicy> methods = policiesByPath.get(path);
        if (methods == null) {
            return Set.of();
        }
        LinkedHashSet<String> allowed = new LinkedHashSet<>(methods.keySet());
        if (methods.containsKey(HttpMethod.GET.name())) {
            allowed.add(HttpMethod.HEAD.name());
        }
        allowed.add(HttpMethod.OPTIONS.name());
        return Collections.unmodifiableSet(allowed);
    }

    public List<RoutePolicy> declaredPolicies() {
        return declaredPolicies;
    }

    public record RoutePolicy(HttpMethod method, String path, int bodyLimitBytes, int throttleCost,
            long reservedBytes, boolean cacheBody) {

        public RoutePolicy {
            if (method == null || path == null || !path.startsWith("/api/core/")
                    || bodyLimitBytes < 0 || throttleCost < 1 || reservedBytes < 0
                    || (bodyLimitBytes > 0 && !cacheBody)) {
                throw new IllegalArgumentException("Invalid Core route policy");
            }
        }

        RoutePolicy withMethod(HttpMethod replacement) {
            return new RoutePolicy(replacement, path, bodyLimitBytes, throttleCost, reservedBytes, cacheBody);
        }
    }

    private static RoutePolicy get(String path, int cost) {
        return new RoutePolicy(HttpMethod.GET, path, 0, cost, 0, false);
    }

    private static RoutePolicy post(String path, int bodyLimit, int cost, boolean cacheBody) {
        long reservedBytes = cacheBody
                ? Math.multiplyExact((long) bodyLimit, CACHED_BODY_RESERVATION_MULTIPLIER)
                : bodyLimit;
        return new RoutePolicy(HttpMethod.POST, path, bodyLimit, cost, reservedBytes, cacheBody);
    }
}
