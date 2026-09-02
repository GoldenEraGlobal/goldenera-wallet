package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.jpa.repository.Query;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import global.goldenera.wallet.api.core.v1.device.DeviceApiV1;
import global.goldenera.wallet.api.core.v1.device.dtos.DeviceDtoV1;
import global.goldenera.wallet.api.core.v1.device.dtos.DeviceRegistrationRequestDtoV1;
import global.goldenera.wallet.api.core.v1.device.mappers.DeviceMapper;
import global.goldenera.wallet.entities.Device;
import global.goldenera.wallet.properties.DeviceCleanupProperties;
import global.goldenera.wallet.properties.DeviceRegistrationProperties;
import global.goldenera.wallet.repositories.DeviceRepository;
import global.goldenera.wallet.repositories.TrackedAddressRepository;
import global.goldenera.wallet.repositories.UserAccountRepository;
import global.goldenera.wallet.repositories.UserAccountRepository.CleanupAccountRow;
import global.goldenera.wallet.service.business.DeviceBusinessService;
import global.goldenera.wallet.service.scheduler.DeviceCleanupBatchService;
import global.goldenera.wallet.service.scheduler.DeviceCleanupBatchService.DeviceCleanupBatchOutcome;
import global.goldenera.wallet.service.scheduler.DeviceCleanupBatchService.DeviceCleanupBatchResult;
import global.goldenera.wallet.service.scheduler.SubscriptionCleanupService;

class DeviceRetirementTest {

    @Test
    void compatibilityEndpointReturnsALegacyDeviceShapeWithoutMutationAfterRetirement() {
        UUID clientIdentifier = UUID.randomUUID();
        DeviceRegistrationRequestDtoV1 request =
                new DeviceRegistrationRequestDtoV1(clientIdentifier, "PWA", "retired-token", "1.0");
        DeviceBusinessService business = mock(DeviceBusinessService.class);
        DeviceMapper mapper = mock(DeviceMapper.class);
        DeviceRegistrationProperties properties = new DeviceRegistrationProperties();
        properties.setMutationsEnabled(false);

        DeviceDtoV1 response = new DeviceApiV1(business, mapper, properties).register(request);

        assertThat(response).isEqualTo(new DeviceDtoV1(
                null, clientIdentifier, "PWA", "retired-token", "1.0", null, null));
        verifyNoInteractions(business, mapper);
    }

    @Test
    void compatibilityEndpointPreservesRegistrationTouchesByDefaultForTheFirstRollout() {
        DeviceRegistrationRequestDtoV1 request =
                new DeviceRegistrationRequestDtoV1(UUID.randomUUID(), "PWA", "legacy-token", "1.0");
        Device source = mock(Device.class);
        Device persisted = mock(Device.class);
        DeviceDtoV1 response = new DeviceDtoV1(
                UUID.randomUUID(), request.clientIdentifier(), "PWA", "legacy-token", "1.0", Instant.now(), Instant.now());
        DeviceBusinessService business = mock(DeviceBusinessService.class);
        DeviceMapper mapper = mock(DeviceMapper.class);
        DeviceRegistrationProperties properties = new DeviceRegistrationProperties();
        when(mapper.toEntity(request)).thenReturn(source);
        when(business.registerDevice(source)).thenReturn(persisted);
        when(mapper.toDto(persisted)).thenReturn(response);

        assertThat(new DeviceApiV1(business, mapper, properties).register(request)).isEqualTo(response);
        assertThat(properties.isMutationsEnabled()).isTrue();
        verify(mapper).toEntity(request);
        verify(business).registerDevice(source);
        verify(mapper).toDto(persisted);
    }

    @Test
    void compatibilityRouteReturnsHttpSuccessForTheLegacyGeneratedClientPayload() throws Exception {
        UUID clientIdentifier = UUID.randomUUID();
        DeviceRegistrationProperties properties = new DeviceRegistrationProperties();
        properties.setMutationsEnabled(false);
        var mvc = MockMvcBuilders.standaloneSetup(
                new DeviceApiV1(mock(DeviceBusinessService.class), mock(DeviceMapper.class), properties)).build();

        mvc.perform(post("/api/core/v1/device/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"clientIdentifier\":\"" + clientIdentifier
                                + "\",\"platform\":\"PWA\",\"appVersion\":\"1.0\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientIdentifier").value(clientIdentifier.toString()))
                .andExpect(jsonPath("$.platform").value("PWA"))
                .andExpect(jsonPath("$.appVersion").value("1.0"));
    }

    @Test
    void cleanupDefaultsToDisabledForMixedVersionRollouts() {
        DeviceCleanupBatchService batches = mock(DeviceCleanupBatchService.class);
        DeviceCleanupProperties properties = new DeviceCleanupProperties();

        new SubscriptionCleanupService(batches, properties).cleanupZombies();

        assertThat(properties.isEnabled()).isFalse();
        verifyNoInteractions(batches);
    }

    @Test
    void schedulerReusesOneThresholdAndContinuesAfterAShortAccountBatch() {
        DeviceCleanupBatchService batches = mock(DeviceCleanupBatchService.class);
        DeviceCleanupProperties properties = enabledProperties(2, 5);
        when(batches.cleanupBatchAfter(any(), eq(2), nullable(Long.class)))
                .thenReturn(outcome(new DeviceCleanupBatchResult(1, 1, 0, 0, 0, 1), 11L, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, true));

        new SubscriptionCleanupService(batches, properties).cleanupZombies();

        ArgumentCaptor<Instant> thresholds = ArgumentCaptor.forClass(Instant.class);
        verify(batches, times(2)).cleanupBatchAfter(thresholds.capture(), eq(2), nullable(Long.class));
        assertThat(thresholds.getAllValues()).hasSize(2).allMatch(thresholds.getValue()::equals);
    }

    @Test
    void schedulerAdvancesPastAContendedLowestAccountBeforeWrapping() {
        DeviceCleanupBatchService batches = mock(DeviceCleanupBatchService.class);
        DeviceCleanupProperties properties = enabledProperties(1, 5);
        when(batches.cleanupBatchAfter(any(), eq(1), nullable(Long.class)))
                .thenReturn(outcome(new DeviceCleanupBatchResult(1, 0, 0, 0, 0, 0), 11L, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(1, 1, 0, 1, 0, 1), 12L, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, true));

        new SubscriptionCleanupService(batches, properties).cleanupZombies();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Long> cursors = ArgumentCaptor.forClass(Long.class);
        verify(batches, times(3)).cleanupBatchAfter(any(), eq(1), cursors.capture());
        assertThat(cursors.getAllValues()).containsExactly(null, 11L, 12L);
    }

    @Test
    void schedulerRetriesAnEmptySkipLockedSelectionWhenStaleDevicesStillExist() {
        DeviceCleanupBatchService batches = mock(DeviceCleanupBatchService.class);
        DeviceCleanupProperties properties = enabledProperties(1, 5);
        when(batches.cleanupBatchAfter(any(), eq(1), nullable(Long.class)))
                .thenReturn(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(1, 1, 0, 1, 0, 1), 12L, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, true));

        new SubscriptionCleanupService(batches, properties).cleanupZombies();

        verify(batches, times(3)).cleanupBatchAfter(any(), eq(1), nullable(Long.class));
    }

    @Test
    void schedulerRetriesAZeroAccountDeviceLostToALateForeignKeyRace() {
        DeviceCleanupBatchService batches = mock(DeviceCleanupBatchService.class);
        DeviceCleanupProperties properties = enabledProperties(2, 5);
        when(batches.cleanupBatchAfter(any(), eq(2), nullable(Long.class)))
                .thenReturn(outcome(new DeviceCleanupBatchResult(0, 0, 1, 0, 0, 0), null, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(1, 1, 0, 1, 0, 1), 11L, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, true));

        new SubscriptionCleanupService(batches, properties).cleanupZombies();

        verify(batches, times(3)).cleanupBatchAfter(any(), eq(2), nullable(Long.class));
    }

    @Test
    void schedulerNeverExceedsItsConfiguredBatchLimit() {
        DeviceCleanupBatchService batches = mock(DeviceCleanupBatchService.class);
        DeviceCleanupProperties properties = enabledProperties(1, 2);
        when(batches.cleanupBatchAfter(any(), eq(1), nullable(Long.class)))
                .thenReturn(outcome(new DeviceCleanupBatchResult(1, 0, 0, 0, 0, 0), 11L, false))
                .thenReturn(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, false));

        new SubscriptionCleanupService(batches, properties).cleanupZombies();

        verify(batches, times(2)).cleanupBatchAfter(any(), eq(1), nullable(Long.class));
    }

    @Test
    void batchDeletesOnlyLockedAccountIdsWhileAddressLocksAreHeld() {
        DeviceRepository devices = mock(DeviceRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        TrackedAddressRepository addresses = mock(TrackedAddressRepository.class);
        DeviceCleanupBatchService cleanup = new DeviceCleanupBatchService(devices, accounts, addresses);
        UUID candidate = UUID.randomUUID();
        UUID zeroAccountCandidate = UUID.randomUUID();
        Instant threshold = Instant.parse("2026-03-01T00:00:00Z");
        CleanupAccountRow first = cleanupRow(11L, candidate, 41L);
        CleanupAccountRow second = cleanupRow(12L, candidate, 42L);
        when(accounts.lockStaleAccountRowsForCleanup(threshold, 2)).thenReturn(List.of(first, second));
        when(devices.lockStaleIdsForCleanup(List.of(candidate), threshold)).thenReturn(List.of(candidate));
        when(addresses.lockIdsForCleanup(List.of(41L, 42L))).thenReturn(List.of(41L, 42L));
        when(accounts.deleteCleanupAccountRows(List.of(11L, 12L))).thenReturn(2);
        when(addresses.deleteOrphanedByIds(List.of(41L, 42L))).thenReturn(2);
        when(devices.deleteCleanupCandidatesWithoutAccounts(List.of(candidate), threshold)).thenReturn(1);
        when(devices.lockStaleWithoutAccounts(threshold, 2)).thenReturn(List.of(zeroAccountCandidate));
        when(devices.deleteLockedStaleWithoutAccounts(List.of(zeroAccountCandidate), threshold)).thenReturn(1);

        DeviceCleanupBatchResult result = cleanup.cleanupBatch(threshold, 2);

        assertThat(result).isEqualTo(new DeviceCleanupBatchResult(2, 2, 1, 2, 1, 2));
        InOrder order = inOrder(devices, accounts, addresses);
        order.verify(accounts).lockStaleAccountRowsForCleanup(threshold, 2);
        order.verify(devices).lockStaleIdsForCleanup(List.of(candidate), threshold);
        order.verify(addresses).lockIdsForCleanup(List.of(41L, 42L));
        order.verify(accounts).deleteCleanupAccountRows(List.of(11L, 12L));
        order.verify(addresses).deleteOrphanedByIds(List.of(41L, 42L));
        order.verify(devices).deleteCleanupCandidatesWithoutAccounts(List.of(candidate), threshold);
        order.verify(devices).lockStaleWithoutAccounts(threshold, 2);
        order.verify(devices).deleteLockedStaleWithoutAccounts(List.of(zeroAccountCandidate), threshold);
    }

    @Test
    void batchLeavesSelectedAccountsUntouchedWhenAParentLockIsSkipped() {
        DeviceRepository devices = mock(DeviceRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        TrackedAddressRepository addresses = mock(TrackedAddressRepository.class);
        DeviceCleanupBatchService cleanup = new DeviceCleanupBatchService(devices, accounts, addresses);
        UUID candidate = UUID.randomUUID();
        Instant threshold = Instant.parse("2026-03-01T00:00:00Z");
        CleanupAccountRow row = cleanupRow(11L, candidate, 41L);
        when(accounts.lockStaleAccountRowsForCleanup(threshold, 1)).thenReturn(List.of(row));
        when(devices.lockStaleIdsForCleanup(List.of(candidate), threshold)).thenReturn(List.of(candidate));
        when(addresses.lockIdsForCleanup(List.of(41L))).thenReturn(List.of());

        DeviceCleanupBatchResult result = cleanup.cleanupBatch(threshold, 1);

        assertThat(result).isEqualTo(new DeviceCleanupBatchResult(1, 0, 0, 0, 0, 0));
        assertThat(result.didWork()).isFalse();
        verify(accounts, never()).deleteCleanupAccountRows(any());
        verify(addresses, never()).deleteOrphanedByIds(any());
        verify(devices, never()).deleteCleanupCandidatesWithoutAccounts(any(), any());
    }

    @Test
    void batchCursorSkipsAContendedLowestAccountAndDrainsTheNextAccount() {
        DeviceRepository devices = mock(DeviceRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        TrackedAddressRepository addresses = mock(TrackedAddressRepository.class);
        DeviceCleanupBatchService cleanup = new DeviceCleanupBatchService(devices, accounts, addresses);
        Instant threshold = Instant.parse("2026-03-01T00:00:00Z");
        UUID firstDevice = UUID.randomUUID();
        UUID secondDevice = UUID.randomUUID();
        CleanupAccountRow first = cleanupRow(11L, firstDevice, 41L);
        CleanupAccountRow second = cleanupRow(12L, secondDevice, 42L);
        when(accounts.lockStaleAccountRowsForCleanup(threshold, 1)).thenReturn(List.of(first));
        when(devices.lockStaleIdsForCleanup(List.of(firstDevice), threshold)).thenReturn(List.of());
        when(accounts.lockStaleAccountRowsAfterForCleanup(threshold, 11L, 1)).thenReturn(List.of(second));
        when(devices.lockStaleIdsForCleanup(List.of(secondDevice), threshold)).thenReturn(List.of(secondDevice));
        when(addresses.lockIdsForCleanup(List.of(42L))).thenReturn(List.of(42L));
        when(accounts.deleteCleanupAccountRows(List.of(12L))).thenReturn(1);
        when(addresses.deleteOrphanedByIds(List.of(42L))).thenReturn(1);
        when(devices.deleteCleanupCandidatesWithoutAccounts(List.of(secondDevice), threshold)).thenReturn(1);

        DeviceCleanupBatchOutcome contended = cleanup.cleanupBatchAfter(threshold, 1, null);
        DeviceCleanupBatchOutcome drained = cleanup.cleanupBatchAfter(threshold, 1, contended.lastSelectedAccountId());

        assertThat(contended)
                .isEqualTo(outcome(new DeviceCleanupBatchResult(1, 0, 0, 0, 0, 0), 11L, false));
        assertThat(drained)
                .isEqualTo(outcome(new DeviceCleanupBatchResult(1, 1, 0, 1, 0, 1), 12L, false));
        verify(accounts).lockStaleAccountRowsAfterForCleanup(threshold, 11L, 1);
    }

    @Test
    void everyRepositoryBindSetIsBoundedByTheAccountBatchSize() {
        DeviceRepository devices = mock(DeviceRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        TrackedAddressRepository addresses = mock(TrackedAddressRepository.class);
        DeviceCleanupBatchService cleanup = new DeviceCleanupBatchService(devices, accounts, addresses);
        Instant threshold = Instant.parse("2026-03-01T00:00:00Z");
        UUID firstDevice = UUID.randomUUID();
        UUID secondDevice = UUID.randomUUID();
        CleanupAccountRow first = cleanupRow(11L, firstDevice, 41L);
        CleanupAccountRow second = cleanupRow(12L, secondDevice, 42L);
        when(accounts.lockStaleAccountRowsForCleanup(threshold, 2)).thenReturn(List.of(first, second));
        when(devices.lockStaleIdsForCleanup(List.of(firstDevice, secondDevice), threshold))
                .thenReturn(List.of(firstDevice, secondDevice));
        when(addresses.lockIdsForCleanup(List.of(41L, 42L))).thenReturn(List.of(41L, 42L));

        cleanup.cleanupBatch(threshold, 2);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<Long>> accountIds = ArgumentCaptor.forClass(Collection.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<Long>> addressIds = ArgumentCaptor.forClass(Collection.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<Long>> addressLockIds = ArgumentCaptor.forClass(Collection.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> deviceIds = ArgumentCaptor.forClass(Collection.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> deviceLockIds = ArgumentCaptor.forClass(Collection.class);
        verify(devices).lockStaleIdsForCleanup(deviceLockIds.capture(), eq(threshold));
        verify(addresses).lockIdsForCleanup(addressLockIds.capture());
        verify(accounts).deleteCleanupAccountRows(accountIds.capture());
        verify(addresses).deleteOrphanedByIds(addressIds.capture());
        verify(devices).deleteCleanupCandidatesWithoutAccounts(deviceIds.capture(), eq(threshold));
        assertThat(deviceLockIds.getValue()).hasSizeLessThanOrEqualTo(2);
        assertThat(addressLockIds.getValue()).hasSizeLessThanOrEqualTo(2);
        assertThat(accountIds.getValue()).hasSizeLessThanOrEqualTo(2);
        assertThat(addressIds.getValue()).hasSizeLessThanOrEqualTo(2);
        assertThat(deviceIds.getValue()).hasSizeLessThanOrEqualTo(2);
    }

    @Test
    void batchSeparatelyDeletesBoundedStaleDevicesThatAlreadyHaveNoAccounts() {
        DeviceRepository devices = mock(DeviceRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        TrackedAddressRepository addresses = mock(TrackedAddressRepository.class);
        DeviceCleanupBatchService cleanup = new DeviceCleanupBatchService(devices, accounts, addresses);
        Instant threshold = Instant.parse("2026-03-01T00:00:00Z");
        List<UUID> candidateIds = List.of(UUID.randomUUID(), UUID.randomUUID());
        when(accounts.lockStaleAccountRowsForCleanup(threshold, 3)).thenReturn(List.of());
        when(devices.lockStaleWithoutAccounts(threshold, 3)).thenReturn(candidateIds);
        when(devices.deleteLockedStaleWithoutAccounts(candidateIds, threshold)).thenReturn(2);

        assertThat(cleanup.cleanupBatch(threshold, 3))
                .isEqualTo(new DeviceCleanupBatchResult(0, 0, 2, 2, 2, 0));

        InOrder order = inOrder(devices);
        order.verify(devices).lockStaleWithoutAccounts(threshold, 3);
        order.verify(devices).deleteLockedStaleWithoutAccounts(candidateIds, threshold);
        assertThat(candidateIds).hasSizeLessThanOrEqualTo(3);
        verifyNoInteractions(addresses);
    }

    @Test
    void emptyLockedSelectionUsesANonLockingStaleDeviceConfirmation() {
        DeviceRepository devices = mock(DeviceRepository.class);
        UserAccountRepository accounts = mock(UserAccountRepository.class);
        TrackedAddressRepository addresses = mock(TrackedAddressRepository.class);
        DeviceCleanupBatchService cleanup = new DeviceCleanupBatchService(devices, accounts, addresses);
        Instant threshold = Instant.parse("2026-03-01T00:00:00Z");
        when(accounts.lockStaleAccountRowsForCleanup(threshold, 1)).thenReturn(List.of());
        when(devices.lockStaleWithoutAccounts(threshold, 1)).thenReturn(List.of());
        when(devices.existsStaleForCleanup(threshold)).thenReturn(true, false);

        assertThat(cleanup.cleanupBatchAfter(threshold, 1, null))
                .isEqualTo(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, false));
        assertThat(cleanup.cleanupBatchAfter(threshold, 1, null))
                .isEqualTo(outcome(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0), null, true));
        verify(devices, times(2)).existsStaleForCleanup(threshold);
        verifyNoInteractions(addresses);
    }

    @Test
    void eachCleanupBatchRequiresAnIndependentTransaction() throws Exception {
        Method cleanupBatch = DeviceCleanupBatchService.class.getMethod("cleanupBatch", Instant.class, int.class);
        Method cleanupBatchAfter = DeviceCleanupBatchService.class.getMethod(
                "cleanupBatchAfter", Instant.class, int.class, Long.class);

        for (Method method : List.of(cleanupBatch, cleanupBatchAfter)) {
            Transactional transactional = method.getAnnotation(Transactional.class);
            assertThat(transactional).isNotNull();
            assertThat(transactional.propagation()).isEqualTo(Propagation.REQUIRES_NEW);
            assertThat(transactional.rollbackFor()).containsExactly(Exception.class);
        }
    }

    @Test
    void deviceLastSeenCleanupIndexIsConcurrentAndWiredAsANewChangeset() throws Exception {
        String master = new ClassPathResource("db/changelog/db.changelog-master.yaml")
                .getContentAsString(StandardCharsets.UTF_8);
        String indexChange = new ClassPathResource("db/changelog/changesets/004-device-last-seen-index.yaml")
                .getContentAsString(StandardCharsets.UTF_8);

        assertThat(master).contains("db/changelog/changesets/004-device-last-seen-index.yaml");
        assertThat(indexChange)
                .contains("runInTransaction: false")
                .contains("CREATE INDEX CONCURRENTLY")
                .contains("idx_device_last_seen_at_id")
                .contains("ON device (last_seen_at, id)");
    }

    @Test
    void repositoriesExcludeUnknownLastSeenRowsFromBoundedCleanupQueries() throws Exception {
        Query accountSelection = UserAccountRepository.class
                .getMethod("lockStaleAccountRowsForCleanup", Instant.class, int.class)
                .getAnnotation(Query.class);
        Query cursorAccountSelection = UserAccountRepository.class
                .getMethod("lockStaleAccountRowsAfterForCleanup", Instant.class, long.class, int.class)
                .getAnnotation(Query.class);
        Query deviceLocks = DeviceRepository.class
                .getMethod("lockStaleIdsForCleanup", Collection.class, Instant.class)
                .getAnnotation(Query.class);
        Query addressLocks = TrackedAddressRepository.class
                .getMethod("lockIdsForCleanup", Collection.class)
                .getAnnotation(Query.class);
        Query candidateDeviceDeletion = DeviceRepository.class
                .getMethod("deleteCleanupCandidatesWithoutAccounts", Collection.class, Instant.class)
                .getAnnotation(Query.class);
        Query zeroAccountSelection = DeviceRepository.class
                .getMethod("lockStaleWithoutAccounts", Instant.class, int.class)
                .getAnnotation(Query.class);
        Query zeroAccountDeletion = DeviceRepository.class
                .getMethod("deleteLockedStaleWithoutAccounts", Collection.class, Instant.class)
                .getAnnotation(Query.class);
        Query staleExistenceConfirmation = DeviceRepository.class
                .getMethod("existsStaleForCleanup", Instant.class)
                .getAnnotation(Query.class);
        Query orphanDeletion = TrackedAddressRepository.class
                .getMethod("deleteOrphanedByIds", Collection.class)
                .getAnnotation(Query.class);

        assertThat(accountSelection.nativeQuery()).isTrue();
        assertThat(accountSelection.value())
                .contains("d.last_seen_at < :threshold")
                .doesNotContain("last_seen_at IS NULL")
                .contains("ORDER BY ua.id")
                .contains("LIMIT :batchSize")
                .contains("FOR UPDATE OF ua SKIP LOCKED");
        assertThat(cursorAccountSelection.nativeQuery()).isTrue();
        assertThat(cursorAccountSelection.value())
                .contains("d.last_seen_at < :threshold")
                .doesNotContain("last_seen_at IS NULL")
                .contains("ua.id > :afterAccountId")
                .contains("ORDER BY ua.id")
                .contains("LIMIT :batchSize")
                .contains("FOR UPDATE OF ua SKIP LOCKED");
        assertThat(deviceLocks.nativeQuery()).isTrue();
        assertThat(deviceLocks.value())
                .contains("d.id IN :deviceIds")
                .contains("d.last_seen_at < :threshold")
                .doesNotContain("last_seen_at IS NULL")
                .contains("ORDER BY d.id")
                .contains("FOR UPDATE OF d SKIP LOCKED");
        assertThat(addressLocks.nativeQuery()).isTrue();
        assertThat(addressLocks.value())
                .contains("ta.id IN :ids")
                .contains("ORDER BY ta.id")
                .contains("FOR UPDATE OF ta SKIP LOCKED");
        assertThat(candidateDeviceDeletion.value())
                .contains("d.id IN :deviceIds")
                .contains("d.last_seen_at < :threshold")
                .doesNotContain("last_seen_at IS NULL")
                .contains("NOT EXISTS");
        assertThat(zeroAccountSelection.nativeQuery()).isTrue();
        assertThat(zeroAccountSelection.value())
                .contains("d.last_seen_at < :threshold")
                .doesNotContain("last_seen_at IS NULL")
                .contains("LIMIT :batchSize")
                .contains("ORDER BY d.id")
                .contains("FOR UPDATE OF d SKIP LOCKED")
                .contains("NOT EXISTS")
                .doesNotContain("DELETE FROM");
        assertThat(zeroAccountDeletion.nativeQuery()).isTrue();
        assertThat(zeroAccountDeletion.value())
                .contains("d.id IN :deviceIds")
                .contains("d.last_seen_at < :threshold")
                .doesNotContain("last_seen_at IS NULL")
                .contains("NOT EXISTS")
                .doesNotContain("FOR UPDATE");
        assertThat(staleExistenceConfirmation.nativeQuery()).isTrue();
        assertThat(staleExistenceConfirmation.value())
                .contains("SELECT EXISTS")
                .contains("d.last_seen_at < :threshold")
                .doesNotContain("last_seen_at IS NULL")
                .doesNotContain("FOR UPDATE")
                .doesNotContain("DELETE FROM");
        assertThat(orphanDeletion.value()).contains("ta.id IN :ids").contains("NOT EXISTS");
    }

    private CleanupAccountRow cleanupRow(long accountId, UUID deviceId, long trackedAddressId) {
        CleanupAccountRow row = mock(CleanupAccountRow.class);
        when(row.getAccountId()).thenReturn(accountId);
        when(row.getDeviceId()).thenReturn(deviceId);
        when(row.getTrackedAddressId()).thenReturn(trackedAddressId);
        return row;
    }

    private DeviceCleanupBatchOutcome outcome(
            DeviceCleanupBatchResult result, Long lastSelectedAccountId, boolean exhaustionConfirmed) {
        return new DeviceCleanupBatchOutcome(result, lastSelectedAccountId, exhaustionConfirmed);
    }

    private DeviceCleanupProperties enabledProperties(int batchSize, int maxBatchesPerRun) {
        DeviceCleanupProperties properties = new DeviceCleanupProperties();
        properties.setEnabled(true);
        properties.setBatchSize(batchSize);
        properties.setMaxBatchesPerRun(maxBatchesPerRun);
        return properties;
    }
}
