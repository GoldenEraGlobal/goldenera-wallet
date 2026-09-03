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
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import global.goldenera.wallet.repositories.DeviceRepository;
import global.goldenera.wallet.repositories.TrackedAddressRepository;
import global.goldenera.wallet.repositories.UserAccountRepository;
import global.goldenera.wallet.repositories.UserAccountRepository.CleanupAccountRow;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class DeviceCleanupBatchService {

    DeviceRepository deviceRepository;
    UserAccountRepository userAccountRepository;
    TrackedAddressRepository trackedAddressRepository;

    /**
     * Locks and removes bounded account work in an independently committed
     * transaction. Single-table lock stages keep skipped rows from accumulating
     * partial join locks. Address locks serialize cleanup replicas that encounter
     * a shared address, while device locks make refreshes and late foreign-key
     * inserts fail closed.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public DeviceCleanupBatchResult cleanupBatch(Instant threshold, int batchSize) {
        return executeCleanupBatch(threshold, batchSize, null).result();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public DeviceCleanupBatchOutcome cleanupBatchAfter(Instant threshold, int batchSize, Long afterAccountId) {
        return executeCleanupBatch(threshold, batchSize, afterAccountId);
    }

    private DeviceCleanupBatchOutcome executeCleanupBatch(Instant threshold, int batchSize, Long afterAccountId) {
        List<CleanupAccountRow> accountRows = afterAccountId == null
                ? userAccountRepository.lockStaleAccountRowsForCleanup(threshold, batchSize)
                : userAccountRepository.lockStaleAccountRowsAfterForCleanup(threshold, afterAccountId, batchSize);
        Long lastSelectedAccountId = accountRows.isEmpty()
                ? null
                : accountRows.get(accountRows.size() - 1).getAccountId();

        int deletedAccounts = 0;
        int deletedCandidateDevices = 0;
        int deletedOrphans = 0;
        if (!accountRows.isEmpty()) {
            List<UUID> selectedDeviceIds = accountRows.stream()
                    .map(CleanupAccountRow::getDeviceId)
                    .distinct()
                    .toList();
            Set<UUID> lockedDeviceIds = new HashSet<>(
                    deviceRepository.lockStaleIdsForCleanup(selectedDeviceIds, threshold));
            List<CleanupAccountRow> deviceLockedRows = accountRows.stream()
                    .filter(row -> lockedDeviceIds.contains(row.getDeviceId()))
                    .toList();

            if (!deviceLockedRows.isEmpty()) {
                List<Long> selectedAddressIds = deviceLockedRows.stream()
                        .map(CleanupAccountRow::getTrackedAddressId)
                        .distinct()
                        .toList();
                Set<Long> lockedAddressIds =
                        new HashSet<>(trackedAddressRepository.lockIdsForCleanup(selectedAddressIds));
                List<CleanupAccountRow> cleanupRows = deviceLockedRows.stream()
                        .filter(row -> lockedAddressIds.contains(row.getTrackedAddressId()))
                        .toList();

                if (!cleanupRows.isEmpty()) {
                    List<Long> accountIds = cleanupRows.stream()
                            .map(CleanupAccountRow::getAccountId)
                            .toList();
                    List<Long> impactedAddressIds = cleanupRows.stream()
                            .map(CleanupAccountRow::getTrackedAddressId)
                            .distinct()
                            .toList();
                    List<UUID> candidateDeviceIds = cleanupRows.stream()
                            .map(CleanupAccountRow::getDeviceId)
                            .distinct()
                            .toList();

                    deletedAccounts = userAccountRepository.deleteCleanupAccountRows(accountIds);
                    deletedOrphans = trackedAddressRepository.deleteOrphanedByIds(impactedAddressIds);
                    deletedCandidateDevices =
                            deviceRepository.deleteCleanupCandidatesWithoutAccounts(candidateDeviceIds, threshold);
                }
            }
        }

        List<UUID> zeroAccountDeviceIds = deviceRepository.lockStaleWithoutAccounts(threshold, batchSize);
        // Keep deletion in a second READ COMMITTED statement so a just-committed
        // foreign-key insert is visible to the repeated NOT EXISTS check.
        int deletedZeroAccountDevices = zeroAccountDeviceIds.isEmpty()
                ? 0
                : deviceRepository.deleteLockedStaleWithoutAccounts(zeroAccountDeviceIds, threshold);
        int deletedDevices = deletedCandidateDevices + deletedZeroAccountDevices;
        DeviceCleanupBatchResult result = new DeviceCleanupBatchResult(
                accountRows.size(),
                deletedAccounts,
                zeroAccountDeviceIds.size(),
                deletedDevices,
                deletedZeroAccountDevices,
                deletedOrphans);
        boolean exhaustionConfirmed = result.selectionIsEmpty()
                && !deviceRepository.existsStaleForCleanup(threshold);
        return new DeviceCleanupBatchOutcome(result, lastSelectedAccountId, exhaustionConfirmed);
    }

    public record DeviceCleanupBatchOutcome(
            DeviceCleanupBatchResult result,
            Long lastSelectedAccountId,
            boolean exhaustionConfirmed) {
    }

    public record DeviceCleanupBatchResult(
            int selectedAccounts,
            int deletedAccounts,
            int selectedZeroAccountDevices,
            int deletedDevices,
            int deletedZeroAccountDevices,
            int deletedOrphans) {

        public boolean didWork() {
            return deletedAccounts > 0 || deletedZeroAccountDevices > 0;
        }

        public boolean selectionIsEmpty() {
            return selectedAccounts == 0 && selectedZeroAccountDevices == 0;
        }
    }
}
