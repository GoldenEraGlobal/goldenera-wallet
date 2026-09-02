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
package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import global.goldenera.wallet.properties.ThrottlingProperties;
import global.goldenera.wallet.service.system.CoreRoutePolicyRegistry;
import global.goldenera.wallet.service.system.ThrottlingService;
import jakarta.validation.Validation;

class CoreRoutePolicyRegistryTest {

    @Test
    void everyCoreControllerMappingHasExactlyOneAdmissionPolicy() throws Exception {
        Set<Route> controllerRoutes = scanControllerRoutes();
        Set<Route> policyRoutes = new LinkedHashSet<>();
        new CoreRoutePolicyRegistry().declaredPolicies().forEach(policy ->
                policyRoutes.add(new Route(policy.method().name(), policy.path())));

        assertThat(policyRoutes).containsExactlyInAnyOrderElementsOf(controllerRoutes);
    }

    @Test
    void derivedHeadAndOptionsPoliciesDoNotPermitOtherMethods() {
        CoreRoutePolicyRegistry registry = new CoreRoutePolicyRegistry();
        String balances = "/api/core/v1/wallet/balances";
        assertThat(registry.find(balances, HttpMethod.HEAD.name())).isPresent();
        assertThat(registry.find(balances, HttpMethod.OPTIONS.name())).isPresent();
        assertThat(registry.find(balances, HttpMethod.POST.name())).isEmpty();
        assertThat(registry.allowedMethods(balances)).containsExactly("GET", "HEAD", "OPTIONS");
        assertThat(registry.isKnownPath("/api/core/v1/wallet/unknown")).isFalse();
    }

    @Test
    void retiredDeviceRegistrationKeepsLegacyBodyCompatibilityAtMinimumAdmissionCost() {
        CoreRoutePolicyRegistry registry = new CoreRoutePolicyRegistry();
        var registration = registry.find("/api/core/v1/device/register", HttpMethod.POST.name()).orElseThrow();

        assertThat(registration.bodyLimitBytes())
                .isEqualTo(CoreRoutePolicyRegistry.DEVICE_REGISTRATION_REQUEST_BYTES);
        assertThat(registration.throttleCost()).isEqualTo(1);
        assertThat(registration.cacheBody()).isTrue();
        assertThat(registration.reservedBytes())
                .isEqualTo(4L * CoreRoutePolicyRegistry.DEVICE_REGISTRATION_REQUEST_BYTES);
    }

    @Test
    void cachedBodyReservationsCoverCopiesAndConfigurationRejectsUndersizedLimits() {
        CoreRoutePolicyRegistry registry = new CoreRoutePolicyRegistry();
        var webhook = registry.find("/api/core/v1/node-webhook/handle", HttpMethod.POST.name()).orElseThrow();
        assertThat(webhook.reservedBytes()).isEqualTo(CoreRoutePolicyRegistry.MAX_ROUTE_RESERVATION_BYTES)
                .isEqualTo(4L * CoreRoutePolicyRegistry.WEBHOOK_REQUEST_BYTES);

        ThrottlingProperties properties = new ThrottlingProperties();
        properties.setGlobalCapacity(1);
        properties.setGlobalRefillTokens(1);
        properties.setPublicCoreCapacity(1);
        properties.setPublicCoreRefillTokens(1);
        properties.setGlobalInFlightRequests(1);
        properties.setPerIpInFlightRequests(1);
        properties.setGlobalInFlightBytes(CoreRoutePolicyRegistry.MAX_ROUTE_RESERVATION_BYTES);
        properties.setPerIpInFlightBytes(CoreRoutePolicyRegistry.MAX_ROUTE_RESERVATION_BYTES - 1);
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            assertThat(factory.getValidator().validate(properties))
                    .anyMatch(violation -> violation.getPropertyPath().toString()
                            .equals("largestCoreRouteAdmissible"));

            properties.setPerIpInFlightBytes(CoreRoutePolicyRegistry.MAX_ROUTE_RESERVATION_BYTES);
            properties.setGlobalInFlightBytes(CoreRoutePolicyRegistry.MAX_ROUTE_RESERVATION_BYTES - 1);
            assertThat(factory.getValidator().validate(properties))
                    .anyMatch(violation -> violation.getPropertyPath().toString()
                            .equals("globalByteAdmissionAtLeastPerIp"));
        }
    }

    @Test
    void inFlightAdmissionEnforcesRequestAndByteLimitsAndReleasesExactlyOnce() {
        ThrottlingProperties properties = new ThrottlingProperties();
        properties.setGlobalCapacity(100);
        properties.setGlobalRefillTokens(100);
        properties.setPublicCoreCapacity(100);
        properties.setPublicCoreRefillTokens(100);
        properties.setGlobalInFlightRequests(2);
        properties.setGlobalInFlightBytes(100);
        properties.setPerIpInFlightRequests(1);
        properties.setPerIpInFlightBytes(50);
        ThrottlingService service = new ThrottlingService(properties, new CoreRoutePolicyRegistry());

        MockHttpServletRequest firstRequest = request("192.0.2.1");
        var first = service.tryAcquireInFlight(firstRequest, 40);
        assertThat(first).isNotNull();
        assertThat(service.tryAcquireInFlight(firstRequest, 1)).isNull();

        MockHttpServletRequest otherIp = request("192.0.2.2");
        assertThat(service.tryAcquireInFlight(otherIp, 70)).isNull();
        first.close();
        first.close();
        assertThat(service.tryAcquireInFlight(otherIp, 51)).isNull();
        var afterRelease = service.tryAcquireInFlight(otherIp, 50);
        assertThat(afterRelease).isNotNull();
        afterRelease.close();
        assertThat((Map<?, ?>) ReflectionTestUtils.getField(service, "inFlightIpCache")).isEmpty();
    }

    private static MockHttpServletRequest request(String address) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/core/v1/wallet/submit-tx");
        request.setRemoteAddr(address);
        return request;
    }

    private static Set<Route> scanControllerRoutes() throws Exception {
        var scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(RestController.class));
        Set<Route> routes = new LinkedHashSet<>();
        for (var component : scanner.findCandidateComponents("global.goldenera.wallet.api.core")) {
            Class<?> controller = Class.forName(component.getBeanClassName());
            RequestMapping root = AnnotatedElementUtils.findMergedAnnotation(controller, RequestMapping.class);
            String[] roots = paths(root);
            for (Method method : controller.getDeclaredMethods()) {
                RequestMapping mapping = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping.class);
                if (mapping == null) {
                    continue;
                }
                assertThat(mapping.method()).as("HTTP method for %s#%s", controller.getName(), method.getName())
                        .isNotEmpty();
                for (String rootPath : roots) {
                    for (String methodPath : paths(mapping)) {
                        for (RequestMethod requestMethod : mapping.method()) {
                            String path = join(rootPath, methodPath);
                            if (path.startsWith("/api/core/")) {
                                routes.add(new Route(requestMethod.name(), path));
                            }
                        }
                    }
                }
            }
        }
        return routes;
    }

    private static String[] paths(RequestMapping mapping) {
        return mapping == null || mapping.path().length == 0 ? new String[] { "" } : mapping.path();
    }

    private static String join(String root, String child) {
        if (root.endsWith("/") && child.startsWith("/")) {
            return root + child.substring(1);
        }
        if (!root.endsWith("/") && !child.isEmpty() && !child.startsWith("/")) {
            return root + "/" + child;
        }
        return root + child;
    }

    private record Route(String method, String path) { }
}
