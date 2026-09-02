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
package global.goldenera.wallet.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.validation.annotation.Validated;

import global.goldenera.wallet.service.system.CoreRoutePolicyRegistry;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Min;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Validated
@Configuration
@ConfigurationProperties(prefix = "ge.throttling", ignoreUnknownFields = false)
public class ThrottlingProperties {

    @Min(1)
    long globalCapacity;
    @Min(1)
    long globalRefillTokens;

    @Min(1)
    long publicCoreCapacity;
    @Min(1)
    long publicCoreRefillTokens;

    @Min(1)
    long globalInFlightRequests = 256;
    @Min(1)
    long globalInFlightBytes = 256L * 1024 * 1024;
    @Min(1)
    long perIpInFlightRequests = 32;
    @Min(1)
    long perIpInFlightBytes = 64L * 1024 * 1024;

    @AssertTrue(message = "global in-flight request limit must be at least the per-IP limit")
    public boolean isGlobalRequestAdmissionAtLeastPerIp() {
        return globalInFlightRequests >= perIpInFlightRequests;
    }

    @AssertTrue(message = "global in-flight byte limit must be at least the per-IP limit")
    public boolean isGlobalByteAdmissionAtLeastPerIp() {
        return globalInFlightBytes >= perIpInFlightBytes;
    }

    @AssertTrue(message = "per-IP in-flight byte limit must admit the largest Core route")
    public boolean isLargestCoreRouteAdmissible() {
        return perIpInFlightBytes >= CoreRoutePolicyRegistry.MAX_ROUTE_RESERVATION_BYTES;
    }

}
