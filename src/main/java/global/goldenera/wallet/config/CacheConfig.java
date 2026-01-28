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
package global.goldenera.wallet.config;

import static lombok.AccessLevel.PRIVATE;

import java.util.concurrent.TimeUnit;

import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.github.benmanes.caffeine.cache.Caffeine;

import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

@Configuration
@EnableCaching
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class CacheConfig {

    public static final String SHORT_LIVED = "SHORT_LIVED";
    public static final String MEDIUM_LIVED = "MEDIUM_LIVED";
    public static final String LONG_LIVED = "LONG_LIVED";

    /**
     * Definition of cache types with specific TTL and Size configurations.
     */
    public static enum CacheType {
        /**
         * For highly volatile data that changes almost instantly or requires near
         * real-time accuracy.
         * Example: Node sync status, mempool checks
         * TTL: 2 seconds
         */
        SHORT_LIVED(2, TimeUnit.SECONDS, 1000, CacheConfig.SHORT_LIVED),

        /**
         * For data that typically changes per block
         * Example: Account balances, nonce
         * TTL: 15 seconds (slightly more than avg block time to hit cache safely)
         */
        MEDIUM_LIVED(15, TimeUnit.SECONDS, 5000, CacheConfig.MEDIUM_LIVED),

        /**
         * For data that never changes or changes extremely rarely.
         * Example: Block by hash, tx by hash
         * TTL: 1 Hour
         */
        LONG_LIVED(1, TimeUnit.HOURS, 100_00, CacheConfig.LONG_LIVED);

        private final long ttl;
        private final TimeUnit timeUnit;
        private final long maxSize;
        private final String cacheName;

        CacheType(long ttl, TimeUnit timeUnit, long maxSize, String cacheName) {
            this.ttl = ttl;
            this.timeUnit = timeUnit;
            this.maxSize = maxSize;
            this.cacheName = cacheName;

            if (!this.cacheName.equals(this.name())) {
                throw new IllegalArgumentException("Cache name must be equal to enum name");
            }
        }

        public String getCacheName() {
            return this.cacheName;
        }
    }

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager cacheManager = new CaffeineCacheManager();
        for (CacheType cacheType : CacheType.values()) {
            cacheManager.registerCustomCache(
                    cacheType.getCacheName(),
                    Caffeine.newBuilder()
                            .expireAfterWrite(cacheType.ttl, cacheType.timeUnit)
                            .maximumSize(cacheType.maxSize)
                            .recordStats()
                            .build());
        }
        return cacheManager;
    }

}
