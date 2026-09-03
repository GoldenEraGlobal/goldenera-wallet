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

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import global.goldenera.wallet.exceptions.RequestBodyTooLargeException;
import global.goldenera.wallet.service.system.ApiErrorResponseWriter;
import global.goldenera.wallet.service.system.CoreRoutePolicyRegistry;
import global.goldenera.wallet.service.system.CoreRoutePolicyRegistry.RoutePolicy;
import global.goldenera.wallet.service.system.ThrottlingService;
import global.goldenera.wallet.service.system.ThrottlingService.InFlightAdmission;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

/** Applies endpoint-specific admission and bounded reads before deserialization. */
@Component
@RequiredArgsConstructor
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
public class RequestBodyLimitFilter extends OncePerRequestFilter {

    public static final int SIGNED_TX_REQUEST_BYTES = CoreRoutePolicyRegistry.SIGNED_TX_REQUEST_BYTES;
    public static final int DEVICE_REGISTRATION_REQUEST_BYTES = CoreRoutePolicyRegistry.DEVICE_REGISTRATION_REQUEST_BYTES;
    public static final int WEBHOOK_REQUEST_BYTES = CoreRoutePolicyRegistry.WEBHOOK_REQUEST_BYTES;

    private final ThrottlingService throttlingService;
    private final CoreRoutePolicyRegistry routePolicies;
    private final ApiErrorResponseWriter apiErrors;

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
        if (!routePolicies.isCorePath(path)) {
            filterChain.doFilter(request, response);
            return;
        }
        if (!routePolicies.isKnownPath(path)) {
            apiErrors.write(response, HttpStatus.NOT_FOUND, "ROUTE_NOT_FOUND", "The requested API route does not exist.");
            return;
        }
        RoutePolicy policy = routePolicies.find(path, request.getMethod()).orElse(null);
        if (policy == null) {
            response.setHeader(HttpHeaders.ALLOW, String.join(", ", routePolicies.allowedMethods(path)));
            apiErrors.write(response, HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED",
                    "The request method is not supported for this route.");
            return;
        }

        if (request.getContentLengthLong() > policy.bodyLimitBytes()) {
            rejectTooLarge(response);
            return;
        }

        InFlightAdmission admission = throttlingService.tryAcquireInFlight(request, policy.reservedBytes());
        if (admission == null) {
            response.setHeader(HttpHeaders.RETRY_AFTER, "1");
            apiErrors.write(response, HttpStatus.SERVICE_UNAVAILABLE, "REQUEST_CAPACITY_EXCEEDED",
                    "The server is handling too many concurrent requests. Retry shortly.");
            return;
        }

        try (admission) {
            byte[] body = readBounded(request.getInputStream(), policy.bodyLimitBytes());
            filterChain.doFilter(new CachedBodyRequest(request, body), response);
        } catch (RequestBodyTooLargeException exception) {
            rejectTooLarge(response);
        }
    }

    private void rejectTooLarge(HttpServletResponse response) throws IOException {
        apiErrors.write(response, HttpStatus.PAYLOAD_TOO_LARGE, "PAYLOAD_TOO_LARGE",
                "Request body exceeds the supported size.");
    }

    private static byte[] readBounded(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 8192));
        byte[] buffer = new byte[8192];
        int total = 0;
        while (true) {
            int remainingWithProbe = limit - total + 1;
            int read = input.read(buffer, 0, Math.min(buffer.length, remainingWithProbe));
            if (read < 0) {
                return output.toByteArray();
            }
            total += read;
            if (total > limit) {
                throw new RequestBodyTooLargeException();
            }
            output.write(buffer, 0, read);
        }
    }

    private static Charset charset(HttpServletRequest request) {
        return request.getCharacterEncoding() == null
                ? StandardCharsets.UTF_8
                : Charset.forName(request.getCharacterEncoding());
    }

    private static final class CachedBodyRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        CachedBodyRequest(HttpServletRequest request, byte[] body) {
            super(request);
            this.body = body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream input = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public int read() { return input.read(); }
                @Override public int read(byte[] bytes, int offset, int length) { return input.read(bytes, offset, length); }
                @Override public boolean isFinished() { return input.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener readListener) {
                    throw new UnsupportedOperationException("Asynchronous request reads are not supported");
                }
            };
        }

        @Override
        public BufferedReader getReader() {
            return new BufferedReader(new InputStreamReader(getInputStream(), charset(this)));
        }

        @Override public int getContentLength() { return body.length; }
        @Override public long getContentLengthLong() { return body.length; }
    }
}
