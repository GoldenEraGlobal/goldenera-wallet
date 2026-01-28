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
package global.goldenera.wallet.service.scheduler;

import static lombok.AccessLevel.PRIVATE;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import global.goldenera.wallet.repositories.DeviceRepository;
import global.goldenera.wallet.repositories.TrackedAddressRepository;
import global.goldenera.wallet.repositories.UserAccountRepository;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
@Slf4j
public class SubscriptionCleanupService {

    DeviceRepository deviceRepository;
    UserAccountRepository userAccountRepository;
    TrackedAddressRepository trackedAddressRepository;

    @Scheduled(cron = "0 0 3 * * *")
    @Transactional(rollbackFor = Exception.class)
    public void cleanupZombies() {
        log.info("Starting zombie device cleanup task...");

        Instant threshold = Instant.now().minus(180, ChronoUnit.DAYS);
        List<UUID> zombieDeviceIds = deviceRepository.findIdsByLastSeenAtBefore(threshold);

        if (zombieDeviceIds.isEmpty()) {
            log.info("No zombie devices found. Cleanup finished.");
            return;
        }

        log.info("Found {} zombie devices. Analyzing impacted addresses...", zombieDeviceIds.size());
        Set<Long> impactedAddressIds = userAccountRepository.findTrackedAddressIdsByDeviceIds(zombieDeviceIds);

        deviceRepository.deleteAllByIdInBatch(zombieDeviceIds);
        deviceRepository.flush();
        log.info("Deleted {} zombie devices and their user accounts.", zombieDeviceIds.size());

        if (impactedAddressIds.isEmpty()) {
            log.info("No impacted addresses. Cleanup finished.");
            return;
        }

        int deletedOrphans = trackedAddressRepository.deleteOrphanedByIds(impactedAddressIds);
        log.info("Deleted {} orphaned tracked addresses.", deletedOrphans);
    }
}