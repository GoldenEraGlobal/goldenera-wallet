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
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.ListPagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import global.goldenera.wallet.entities.UserAccount;
import io.hypersistence.utils.spring.repository.BaseJpaRepository;

@Repository
public interface UserAccountRepository
                extends BaseJpaRepository<UserAccount, Long>,
                ListPagingAndSortingRepository<UserAccount, Long>,
                JpaSpecificationExecutor<UserAccount> {

        @Query(nativeQuery = true, value = """
                        SELECT ua.id AS "accountId",
                               ua.device_id AS "deviceId",
                               ua.tracked_address_id AS "trackedAddressId"
                        FROM user_account ua
                        JOIN device d ON d.id = ua.device_id
                        WHERE d.last_seen_at < :threshold
                        ORDER BY ua.id
                        LIMIT :batchSize
                        FOR UPDATE OF ua SKIP LOCKED
                        """)
        List<CleanupAccountRow> lockStaleAccountRowsForCleanup(Instant threshold, int batchSize);

        @Query(nativeQuery = true, value = """
                        SELECT ua.id AS "accountId",
                               ua.device_id AS "deviceId",
                               ua.tracked_address_id AS "trackedAddressId"
                        FROM user_account ua
                        JOIN device d ON d.id = ua.device_id
                        WHERE d.last_seen_at < :threshold
                          AND ua.id > :afterAccountId
                        ORDER BY ua.id
                        LIMIT :batchSize
                        FOR UPDATE OF ua SKIP LOCKED
                        """)
        List<CleanupAccountRow> lockStaleAccountRowsAfterForCleanup(
                        Instant threshold, long afterAccountId, int batchSize);

        @Modifying(clearAutomatically = true, flushAutomatically = true)
        @Query(nativeQuery = true, value = "DELETE FROM user_account WHERE id IN :accountIds")
        int deleteCleanupAccountRows(Collection<Long> accountIds);

        long countByTrackedAddressId(Long trackedAddressId);

        interface CleanupAccountRow {
                Long getAccountId();

                UUID getDeviceId();

                Long getTrackedAddressId();
        }
}
