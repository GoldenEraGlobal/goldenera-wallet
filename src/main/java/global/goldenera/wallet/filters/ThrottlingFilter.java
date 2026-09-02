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
package global.goldenera.wallet.filters;

import static lombok.AccessLevel.PRIVATE;

import java.io.IOException;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import global.goldenera.wallet.service.system.ApiErrorResponseWriter;
import global.goldenera.wallet.service.system.CoreRoutePolicyRegistry;
import global.goldenera.wallet.service.system.ThrottlingService;
import global.goldenera.wallet.service.system.ThrottlingService.RateLimitDecision;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.experimental.FieldDefaults;

@Component
@RequiredArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ThrottlingFilter extends OncePerRequestFilter {

    ThrottlingService throttlingService;
    CoreRoutePolicyRegistry routePolicies;
    ApiErrorResponseWriter apiErrors;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String path;
        try {
            path = throttlingService.getRequestPath(request);
        } catch (IllegalArgumentException exception) {
            apiErrors.write(response, HttpStatus.BAD_REQUEST, "INVALID_REQUEST_PATH", "The request path is invalid.");
            return;
        }

        RateLimitDecision globalDecision = throttlingService.checkGlobalIpLimitDecision(request);
        if (!globalDecision.allowed()) {
            rejectRateLimit(response, "GLOBAL_RATE_LIMITED", "Too many requests.",
                    globalDecision.retryAfterSeconds());
            return;
        }

        if (path.startsWith("/api")) {
            RateLimitDecision apiDecision = throttlingService.checkSpecificLimitDecision(request,
                    request.getRemoteAddr());
            if (!apiDecision.allowed()) {
                rejectRateLimit(response, "RATE_LIMITED", "The API rate limit was exceeded.",
                        apiDecision.retryAfterSeconds());
                return;
            }
        }

        if (routePolicies.isCorePath(path)) {
            if (!routePolicies.isKnownPath(path)) {
                apiErrors.write(response, HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "The requested API route does not exist.");
                return;
            }
            if (routePolicies.find(path, request.getMethod()).isEmpty()) {
                response.setHeader(HttpHeaders.ALLOW, String.join(", ", routePolicies.allowedMethods(path)));
                apiErrors.write(response, HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED",
                        "The request method is not supported for this route.");
                return;
            }
        }
        filterChain.doFilter(request, response);
    }

    private void rejectRateLimit(HttpServletResponse response, String code, String message, long retryAfterSeconds)
            throws IOException {
        response.setHeader(HttpHeaders.RETRY_AFTER, Long.toString(retryAfterSeconds));
        apiErrors.write(response, HttpStatus.TOO_MANY_REQUESTS, code, message);
    }
}
