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

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRequest;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.stereotype.Component;

import global.goldenera.wallet.exceptions.GEFailedException;

/** Keeps body transport failures inside request execution, before JSON decoding. */
@Component
public class NodeResponseBufferingInterceptor implements ClientHttpRequestInterceptor {

    private static final int MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

    @Override
    public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution)
            throws IOException {
        try (ClientHttpResponse response = execution.execute(request, body)) {
            if (response.getStatusCode().is3xxRedirection()) {
                throw new GEFailedException("Node redirects are not allowed");
            }
            // The JDK factory's deadline closes this stream when the response body stalls.
            // Reading here preserves IOException -> ResourceAccessException rather than a JSON error.
            byte[] responseBody = response.getBody().readNBytes(MAX_RESPONSE_BYTES + 1);
            if (responseBody.length > MAX_RESPONSE_BYTES) {
                throw new GEFailedException("Node response exceeds the supported size");
            }
            return new BufferedResponse(response.getStatusCode(), response.getStatusText(),
                    HttpHeaders.readOnlyHttpHeaders(response.getHeaders()), new ByteArrayInputStream(responseBody));
        }
    }

    private record BufferedResponse(HttpStatusCode statusCode, String statusText, HttpHeaders headers,
            InputStream body) implements ClientHttpResponse {
        @Override public HttpStatusCode getStatusCode() { return statusCode; }
        @Override public String getStatusText() { return statusText; }
        @Override public HttpHeaders getHeaders() { return headers; }
        @Override public InputStream getBody() { return body; }
        @Override public void close() { /* ByteArrayInputStream does not own external resources. */ }
    }
}
