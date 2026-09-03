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

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import global.goldenera.wallet.properties.DeviceCleanupProperties;
import global.goldenera.wallet.service.scheduler.DeviceCleanupBatchService.DeviceCleanupBatchOutcome;
import global.goldenera.wallet.service.scheduler.DeviceCleanupBatchService.DeviceCleanupBatchResult;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
@Slf4j
public class SubscriptionCleanupService {

    static final long INITIAL_CONTENTION_BACKOFF_MILLIS = 10;
    static final long MAX_CONTENTION_BACKOFF_MILLIS = 100;

    DeviceCleanupBatchService batchService;
    DeviceCleanupProperties properties;

    @Scheduled(cron = "0 0 3 * * *")
    public void cleanupZombies() {
        if (!properties.isEnabled()) {
            log.info("Device cleanup is disabled until the registration-retirement rollout is complete.");
            return;
        }

        log.info("Starting zombie device cleanup task...");
        Instant threshold = Instant.now().minus(180, ChronoUnit.DAYS);
        int batchSize = properties.getBatchSize();
        int batchesExecuted = 0;
        long selectedAccounts = 0;
        long deletedAccounts = 0;
        long selectedZeroAccountDevices = 0;
        long deletedDevices = 0;
        long deletedZeroAccountDevices = 0;
        long deletedOrphans = 0;
        boolean exhausted = false;
        boolean retryInterrupted = false;
        int consecutiveContendedBatches = 0;
        int maxBatchesPerRun = properties.getMaxBatchesPerRun();
        Long accountCursor = null;

        for (int batch = 0; batch < maxBatchesPerRun; batch++) {
            DeviceCleanupBatchOutcome outcome =
                    batchService.cleanupBatchAfter(threshold, batchSize, accountCursor);
            DeviceCleanupBatchResult result = outcome.result();
            batchesExecuted++;
            selectedAccounts += result.selectedAccounts();
            deletedAccounts += result.deletedAccounts();
            selectedZeroAccountDevices += result.selectedZeroAccountDevices();
            deletedDevices += result.deletedDevices();
            deletedZeroAccountDevices += result.deletedZeroAccountDevices();
            deletedOrphans += result.deletedOrphans();

            if (result.selectedAccounts() == 0) {
                accountCursor = null;
            } else if (accountCursor != null || result.deletedAccounts() < result.selectedAccounts()) {
                accountCursor = outcome.lastSelectedAccountId();
            }

            if (outcome.exhaustionConfirmed()) {
                exhausted = true;
                break;
            }

            // Later device/address locks, initial SKIP LOCKED selection, and deletion
            // rechecks may all lose races. A per-run account cursor prevents a
            // persistently contended low ID from starving unrelated later rows.
            if (result.didWork()) {
                consecutiveContendedBatches = 0;
            } else if (batch + 1 < maxBatchesPerRun) {
                consecutiveContendedBatches++;
                if (!backOffBeforeRetry(consecutiveContendedBatches)) {
                    retryInterrupted = true;
                    break;
                }
            }
        }

        if (retryInterrupted) {
            log.warn("Device cleanup retry was interrupted; remaining stale rows will be retried.");
        } else if (!exhausted) {
            log.warn("Device cleanup reached its per-run batch limit; remaining stale rows will be retried.");
        }
        log.info(
                "Device cleanup finished: batches={}, account-rows-selected={}, account-rows-deleted={}, "
                        + "zero-account-devices-selected={}, devices-deleted={} (zero-account={}), "
                        + "orphaned-addresses-deleted={}.",
                batchesExecuted,
                selectedAccounts,
                deletedAccounts,
                selectedZeroAccountDevices,
                deletedDevices,
                deletedZeroAccountDevices,
                deletedOrphans);
    }

    private boolean backOffBeforeRetry(int consecutiveContendedBatches) {
        int exponent = Math.min(consecutiveContendedBatches - 1, 4);
        long delayMillis = Math.min(
                INITIAL_CONTENTION_BACKOFF_MILLIS << exponent, MAX_CONTENTION_BACKOFF_MILLIS);
        try {
            Thread.sleep(delayMillis);
            return true;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return false;
        }
    }
}
