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

import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.ListPagingAndSortingRepository;
import org.springframework.stereotype.Repository;

import global.goldenera.wallet.entities.TrackedAddress;
import io.hypersistence.utils.spring.repository.BaseJpaRepository;

@Repository
public interface TrackedAddressRepository
                extends BaseJpaRepository<TrackedAddress, Long>,
                ListPagingAndSortingRepository<TrackedAddress, Long>,
                JpaSpecificationExecutor<TrackedAddress> {

        /**
         * Finds TrackedAddress entities that:
         * 1. Have an ID in the given collection
         * 2. Have no remaining UserAccount subscribers (orphaned)
         */
        @Query("""
                        SELECT ta FROM TrackedAddress ta
                        WHERE ta.id IN :ids
                        AND NOT EXISTS (SELECT 1 FROM UserAccount ua WHERE ua.trackedAddress = ta)
                        """)
        List<TrackedAddress> findOrphanedByIds(Collection<Long> ids);

        /**
         * Deletes TrackedAddress entities that have no remaining UserAccount
         * subscribers.
         * Returns the number of deleted records.
         */
        @Modifying
        @Query("""
                        DELETE FROM TrackedAddress ta
                        WHERE ta.id IN :ids
                        AND NOT EXISTS (SELECT 1 FROM UserAccount ua WHERE ua.trackedAddress = ta)
                        """)
        int deleteOrphanedByIds(Collection<Long> ids);
}