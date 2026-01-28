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
package global.goldenera.wallet.repositories;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.ListPagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import global.goldenera.wallet.entities.Device;
import io.hypersistence.utils.spring.repository.BaseJpaRepository;

@Repository
public interface DeviceRepository
                extends BaseJpaRepository<Device, UUID>,
                ListPagingAndSortingRepository<Device, UUID>,
                JpaSpecificationExecutor<Device> {

        @Query("SELECT d.id FROM Device d WHERE d.lastSeenAt < :threshold")
        List<UUID> findIdsByLastSeenAtBefore(Instant threshold);

        Optional<Device> findByClientIdentifier(UUID clientIdentifier);

        @Modifying
        @Query(nativeQuery = true, value = """
                        INSERT INTO device (id, client_identifier, platform, fcm_token, app_version, created_at, last_seen_at)
                        VALUES (gen_random_uuid(), :clientIdentifier, :platform, :fcmToken, :appVersion, NOW(), NOW())
                        ON CONFLICT (client_identifier) DO UPDATE SET
                                fcm_token = :fcmToken,
                                app_version = :appVersion,
                                platform = :platform,
                                last_seen_at = NOW()
                        """)
        void upsert(UUID clientIdentifier, String platform, String fcmToken, String appVersion);

}