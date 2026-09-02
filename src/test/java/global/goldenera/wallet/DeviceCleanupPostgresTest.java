package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import global.goldenera.wallet.service.scheduler.DeviceCleanupBatchService;
import global.goldenera.wallet.service.scheduler.DeviceCleanupBatchService.DeviceCleanupBatchResult;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "server.address=127.0.0.1",
        "spring.jpa.hibernate.ddl-auto=validate",
        "spring.jpa.open-in-view=false",
        "spring.liquibase.analytics-enabled=false",
        "spring.task.scheduling.enabled=false",
        "ge.node.base-url=http://127.0.0.1:1",
        "ge.node.api-key=cleanup-test-api-key",
        "ge.node.webhook-uid=00000000-0000-0000-0000-000000000001",
        "ge.node.webhook-secret-key=cleanup-test-webhook-secret",
        "spring.security.user.name=test-admin",
        "spring.security.user.password={noop}cleanup-test-password",
        "ge.throttling.global-capacity=10000",
        "ge.throttling.global-refill-tokens=10000",
        "ge.throttling.public-core-capacity=10000",
        "ge.throttling.public-core-refill-tokens=10000"
})
class DeviceCleanupPostgresTest {

    private static final Instant THRESHOLD = Instant.parse("2026-03-01T00:00:00Z");
    private static final Instant STALE = Instant.parse("2025-01-01T00:00:00Z");
    private static final Instant FRESH = Instant.parse("2026-08-01T00:00:00Z");

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18.6-alpine")
            .withTmpFs(Map.of("/var/lib/postgresql", "rw"));

    @DynamicPropertySource
    static void connectionProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;
    @Autowired DeviceCleanupBatchService cleanup;

    @BeforeEach
    void resetTables() {
        jdbc.execute("DROP TRIGGER IF EXISTS cleanup_delete_delay ON user_account");
        jdbc.execute("DROP FUNCTION IF EXISTS cleanup_delete_delay()");
        jdbc.execute("TRUNCATE TABLE user_account, tracked_address, device RESTART IDENTITY CASCADE");
    }

    @Test
    void onePathologicalDeviceDrainsAcrossBoundedCommittedBatchesWithoutCascade() {
        UUID deviceId = insertDevice(STALE);
        for (long id = 1; id <= 5; id++) {
            insertAddress(id);
            insertAccount(id, deviceId, id);
        }

        DeviceCleanupBatchResult first = cleanup.cleanupBatch(THRESHOLD, 2);
        assertThat(first).isEqualTo(new DeviceCleanupBatchResult(2, 2, 0, 0, 0, 2));
        assertThat(count("user_account")).isEqualTo(3);
        assertThat(count("device")).isEqualTo(1);

        DeviceCleanupBatchResult second = cleanup.cleanupBatch(THRESHOLD, 2);
        assertThat(second).isEqualTo(new DeviceCleanupBatchResult(2, 2, 0, 0, 0, 2));
        assertThat(count("user_account")).isEqualTo(1);
        assertThat(count("device")).isEqualTo(1);

        DeviceCleanupBatchResult third = cleanup.cleanupBatch(THRESHOLD, 2);
        assertThat(third).isEqualTo(new DeviceCleanupBatchResult(1, 1, 0, 1, 0, 1));
        assertThat(count("user_account")).isZero();
        assertThat(count("tracked_address")).isZero();
        assertThat(count("device")).isZero();

        assertThat(cleanup.cleanupBatch(THRESHOLD, 2).didWork()).isFalse();
    }

    @Test
    void concurrentStaleDevicesSharingAnAddressCannotStrandTheOrphan() throws Exception {
        UUID firstDevice = insertDevice(STALE);
        UUID secondDevice = insertDevice(STALE);
        insertAddress(10L);
        insertAccount(10L, firstDevice, 10L);
        insertAccount(11L, secondDevice, 10L);
        installDeleteDelay();

        DeviceCleanupBatchResult first;
        DeviceCleanupBatchResult second;
        try {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);
            try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
                Future<DeviceCleanupBatchResult> firstRun = executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    return cleanup.cleanupBatch(THRESHOLD, 1);
                });
                Future<DeviceCleanupBatchResult> secondRun = executor.submit(() -> {
                    ready.countDown();
                    start.await();
                    return cleanup.cleanupBatch(THRESHOLD, 1);
                });
                boolean bothReady = ready.await(5, TimeUnit.SECONDS);
                start.countDown();
                assertThat(bothReady).isTrue();
                first = firstRun.get(10, TimeUnit.SECONDS);
                second = secondRun.get(10, TimeUnit.SECONDS);
            }
        } finally {
            removeDeleteDelay();
        }

        assertThat(first.selectedAccounts() + second.selectedAccounts()).isEqualTo(2);
        assertThat(first.deletedAccounts() + second.deletedAccounts()).isEqualTo(1);
        assertThat(count("user_account")).isEqualTo(1);
        assertThat(count("tracked_address")).isEqualTo(1);

        assertThat(cleanup.cleanupBatch(THRESHOLD, 1).didWork()).isTrue();
        assertThat(cleanup.cleanupBatch(THRESHOLD, 1).didWork()).isFalse();
        assertThat(count("user_account")).isZero();
        assertThat(count("device")).isZero();
        assertThat(count("tracked_address")).isZero();
    }

    @Test
    void activeAccountSharingAnAddressSurvivesStaleDeviceCleanup() {
        UUID staleDevice = insertDevice(STALE);
        UUID activeDevice = insertDevice(FRESH);
        insertAddress(20L);
        insertAccount(20L, staleDevice, 20L);
        insertAccount(21L, activeDevice, 20L);

        DeviceCleanupBatchResult result = cleanup.cleanupBatch(THRESHOLD, 10);

        assertThat(result).isEqualTo(new DeviceCleanupBatchResult(1, 1, 0, 1, 0, 0));
        assertThat(accountExists(21L)).isTrue();
        assertThat(deviceExists(activeDevice)).isTrue();
        assertThat(addressExists(20L)).isTrue();
    }

    @Test
    void nullLastSeenDeviceIsPreservedUntilAnExplicitMigrationDefinesItsActivity() {
        UUID deviceId = insertDevice(null);
        insertAddress(30L);
        insertAccount(30L, deviceId, 30L);

        assertThat(cleanup.cleanupBatch(THRESHOLD, 10))
                .isEqualTo(new DeviceCleanupBatchResult(0, 0, 0, 0, 0, 0));
        assertThat(deviceExists(deviceId)).isTrue();
        assertThat(accountExists(30L)).isTrue();
        assertThat(addressExists(30L)).isTrue();
    }

    @Test
    void concurrentlyRefreshedDeviceIsSkippedAndSurvives() throws Exception {
        UUID deviceId = insertDevice(STALE);
        insertAddress(40L);
        insertAccount(40L, deviceId, 40L);
        DeviceCleanupBatchResult result;

        try (Connection connection = dataSource.getConnection();
                PreparedStatement refresh = connection.prepareStatement(
                        "UPDATE device SET last_seen_at = ? WHERE id = ?");
                ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            connection.setAutoCommit(false);
            refresh.setTimestamp(1, Timestamp.from(FRESH));
            refresh.setObject(2, deviceId);
            assertThat(refresh.executeUpdate()).isEqualTo(1);

            CountDownLatch cleanupStarted = new CountDownLatch(1);
            Future<DeviceCleanupBatchResult> cleanupRun = executor.submit(() -> {
                cleanupStarted.countDown();
                return cleanup.cleanupBatch(THRESHOLD, 10);
            });
            assertThat(cleanupStarted.await(5, TimeUnit.SECONDS)).isTrue();
            assertCleanupIsWaiting(cleanupRun);
            connection.commit();
            result = cleanupRun.get(10, TimeUnit.SECONDS);
        }

        assertThat(result.didWork()).isFalse();
        assertThat(result.deletedAccounts()).isZero();
        assertThat(result.deletedDevices()).isZero();
        assertThat(cleanup.cleanupBatch(THRESHOLD, 10).didWork()).isFalse();
        assertThat(deviceExists(deviceId)).isTrue();
        assertThat(accountExists(40L)).isTrue();
        assertThat(addressExists(40L)).isTrue();
    }

    @Test
    void uncommittedLateForeignKeyInsertPreventsDeviceDeletion() throws Exception {
        UUID deviceId = insertDevice(STALE);
        insertAddress(50L);
        DeviceCleanupBatchResult result;

        try (Connection connection = dataSource.getConnection();
                PreparedStatement insert = connection.prepareStatement("""
                        INSERT INTO user_account (id, device_id, tracked_address_id, label, created_at)
                        VALUES (?, ?, ?, 'late', NOW())
                        """);
                ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            connection.setAutoCommit(false);
            insert.setLong(1, 50L);
            insert.setObject(2, deviceId);
            insert.setLong(3, 50L);
            assertThat(insert.executeUpdate()).isEqualTo(1);

            CountDownLatch cleanupStarted = new CountDownLatch(1);
            Future<DeviceCleanupBatchResult> cleanupRun = executor.submit(() -> {
                cleanupStarted.countDown();
                return cleanup.cleanupBatch(THRESHOLD, 10);
            });
            assertThat(cleanupStarted.await(5, TimeUnit.SECONDS)).isTrue();
            assertCleanupIsWaiting(cleanupRun);
            connection.commit();
            result = cleanupRun.get(10, TimeUnit.SECONDS);
        }

        assertThat(result.selectedZeroAccountDevices()).isEqualTo(1);
        assertThat(result.deletedZeroAccountDevices()).isZero();
        assertThat(result.didWork()).isFalse();
        assertThat(deviceExists(deviceId)).isTrue();
        assertThat(accountExists(50L)).isTrue();
        assertThat(addressExists(50L)).isTrue();

        assertThat(cleanup.cleanupBatch(THRESHOLD, 10).didWork()).isTrue();
        assertThat(count("device")).isZero();
        assertThat(count("user_account")).isZero();
        assertThat(count("tracked_address")).isZero();
    }

    @Test
    void staleDeviceThatAlreadyHasNoAccountsIsDeletedInItsOwnBoundedPath() {
        UUID deviceId = insertDevice(STALE);

        DeviceCleanupBatchResult result = cleanup.cleanupBatch(THRESHOLD, 1);

        assertThat(result).isEqualTo(new DeviceCleanupBatchResult(0, 0, 1, 1, 1, 0));
        assertThat(deviceExists(deviceId)).isFalse();
        assertThat(cleanup.cleanupBatch(THRESHOLD, 1).didWork()).isFalse();
    }

    @Test
    void cleanupDoesNotSweepUnrelatedOrphanAddresses() {
        UUID deviceId = insertDevice(STALE);
        insertAddress(60L);
        insertAddress(61L);
        insertAccount(60L, deviceId, 60L);

        assertThat(cleanup.cleanupBatch(THRESHOLD, 10).didWork()).isTrue();

        assertThat(addressExists(60L)).isFalse();
        assertThat(addressExists(61L)).isTrue();
    }

    private void assertCleanupIsWaiting(Future<DeviceCleanupBatchResult> cleanupRun) {
        assertThatThrownBy(() -> cleanupRun.get(250, TimeUnit.MILLISECONDS))
                .isInstanceOf(TimeoutException.class);
    }

    private UUID insertDevice(Instant lastSeenAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO device (id, client_identifier, platform, created_at, last_seen_at)
                VALUES (?, ?, 'PWA', NOW(), ?)
                """, id, UUID.randomUUID(), lastSeenAt == null ? null : Timestamp.from(lastSeenAt));
        return id;
    }

    private void insertAddress(long id) {
        byte[] address = new byte[20];
        address[12] = (byte) (id >>> 56);
        address[13] = (byte) (id >>> 48);
        address[14] = (byte) (id >>> 40);
        address[15] = (byte) (id >>> 32);
        address[16] = (byte) (id >>> 24);
        address[17] = (byte) (id >>> 16);
        address[18] = (byte) (id >>> 8);
        address[19] = (byte) id;
        jdbc.update("INSERT INTO tracked_address (id, address) VALUES (?, ?)", id, address);
    }

    private void insertAccount(long id, UUID deviceId, long addressId) {
        jdbc.update("""
                INSERT INTO user_account (id, device_id, tracked_address_id, label, created_at)
                VALUES (?, ?, ?, 'cleanup-test', NOW())
                """, id, deviceId, addressId);
    }

    private void installDeleteDelay() {
        jdbc.execute("""
                CREATE FUNCTION cleanup_delete_delay() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    PERFORM pg_sleep(0.5);
                    RETURN OLD;
                END;
                $$
                """);
        jdbc.execute("""
                CREATE TRIGGER cleanup_delete_delay
                BEFORE DELETE ON user_account
                FOR EACH ROW EXECUTE FUNCTION cleanup_delete_delay()
                """);
    }

    private void removeDeleteDelay() {
        jdbc.execute("DROP TRIGGER IF EXISTS cleanup_delete_delay ON user_account");
        jdbc.execute("DROP FUNCTION IF EXISTS cleanup_delete_delay()");
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }

    private boolean deviceExists(UUID id) {
        return jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM device WHERE id = ?)", Boolean.class, id);
    }

    private boolean accountExists(long id) {
        return jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM user_account WHERE id = ?)", Boolean.class, id);
    }

    private boolean addressExists(long id) {
        return jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM tracked_address WHERE id = ?)", Boolean.class, id);
    }
}
