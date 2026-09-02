package global.goldenera.wallet;

import static org.hamcrest.Matchers.containsString;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Instant;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.HashSet;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.concurrent.CopyOnWriteArrayList;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.units.ethereum.Wei;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.BindException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import com.github.benmanes.caffeine.cache.Cache;
import com.sun.net.httpserver.HttpServer;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.PrivateKey;
import global.goldenera.cryptoj.builder.TxBuilder;
import global.goldenera.cryptoj.enums.Network;
import global.goldenera.cryptoj.enums.TxType;
import global.goldenera.cryptoj.serialization.tx.TxEncoder;
import global.goldenera.cryptoj.serialization.tx.TxDecoder;
import global.goldenera.cryptoj.utils.Amounts;
import global.goldenera.wallet.api.core.v1.wallet.dtos.WalletBalanceDtoV1;
import global.goldenera.wallet.service.business.WalletBusinessService;
import global.goldenera.wallet.entities.Device;
import global.goldenera.wallet.entities.TrackedAddress;
import global.goldenera.wallet.entities.UserAccount;
import global.goldenera.wallet.properties.NodeProperties;
import global.goldenera.wallet.service.scheduler.SubscriptionCleanupService;
import global.goldenera.wallet.service.system.ThrottlingService;
import global.goldenera.wallet.filters.RequestBodyLimitFilter;
import io.github.bucket4j.Bucket;
import global.goldenera.wallet.repositories.DeviceRepository;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import javax.sql.DataSource;
import global.goldenera.wallet.repositories.TrackedAddressRepository;
import global.goldenera.wallet.repositories.UserAccountRepository;
import jakarta.persistence.EntityManager;
import liquibase.integration.spring.SpringLiquibase;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.profiles.active=dev",
        "spring.jpa.hibernate.ddl-auto=validate",
        "spring.jpa.open-in-view=false",
        "spring.liquibase.analytics-enabled=false",
        "ge.node.api-key=public-test-api-key",
        "ge.node.webhook-uid=00000000-0000-0000-0000-000000000001",
        "ge.node.webhook-secret-key=public-test-webhook-secret",
        "spring.security.user.name=test-admin",
        "spring.security.user.password={noop}public-test-password",
        "ge.throttling.global-capacity=10000",
        "ge.throttling.global-refill-tokens=10000",
        "ge.throttling.public-core-capacity=10000",
        "ge.throttling.public-core-refill-tokens=10000",
        "ge.device-registration.mutations-enabled=false",
        "ge.device-cleanup.enabled=true",
        "ge.device-cleanup.batch-size=1",
        "ge.device-cleanup.max-batches-per-run=100",
        "server.address=127.0.0.1",
        "ge.node.connect-timeout=100ms",
        "ge.node.read-timeout=250ms"
})
@AutoConfigureMockMvc
@Import(BackendCompatibilityTest.ProbeConfiguration.class)
class BackendCompatibilityTest {

    private static final String ADDRESS = "0x1111111111111111111111111111111111111111";
    private static final String ZERO = "0x0000000000000000000000000000000000000000";
    private static final String BALANCE_PATH = "/api/explorer/v1/account/balance/page/bulk";
    private static final String PENDING_PATH = "/api/explorer/v1/mem-transfer/page/bulk";
    private static final String SUBMIT_PATH = "/api/core/v1/mempool/submit";
    private static final String WEBHOOK_PATH = "/api/core/v1/node-webhook/handle";
    private static final MockNode NODE = new MockNode();

    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:18.6-alpine")
            .withTmpFs(Map.of("/var/lib/postgresql", "rw"));

    @DynamicPropertySource
    static void connectionProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("ge.node.base-url", NODE::baseUrl);
    }

    @Autowired MockMvc mvc;
    @Autowired JsonMapper mapper;
    @Autowired JdbcTemplate jdbc;
    @Autowired SpringLiquibase liquibase;
    @Autowired DeviceRepository devices;
    @Autowired TrackedAddressRepository trackedAddresses;
    @Autowired UserAccountRepository userAccounts;
    @Autowired EntityManager entityManager;
    @Autowired DataSource dataSource;
    @Autowired SubscriptionCleanupService cleanup;
    @Autowired ThrottlingService throttlingService;
    @Autowired WalletBusinessService walletBusinessService;
    @LocalServerPort int port;

    @BeforeEach
    void resetNode() {
        NODE.reset();
        invalidateHistorySnapshots();
    }

    @SuppressWarnings("unchecked")
    private void invalidateHistorySnapshots() {
        Cache<?, ?> snapshots = (Cache<?, ?>) ReflectionTestUtils.getField(
                walletBusinessService, "historySnapshots");
        snapshots.invalidateAll();
    }

    @AfterAll
    static void stopNode() {
        NODE.close();
    }

    @Test
    void migrationsRunOnPostgresqlAndCanRunAgain() throws Exception {
        assertThat(jdbc.queryForObject("select version()", String.class)).startsWith("PostgreSQL 18.6");
        int applied = jdbc.queryForObject("select count(*) from databasechangelog", Integer.class);
        assertThat(applied).isEqualTo(33);
        assertThat(jdbc.queryForObject("show data_directory", String.class)).startsWith("/var/lib/postgresql/18/");
        liquibase.afterPropertiesSet();
        assertThat(jdbc.queryForObject("select count(*) from databasechangelog", Integer.class)).isEqualTo(applied);
    }

    @Test
    @Transactional
    void hypersistenceRepositoriesAndAddressConverterRoundTrip() {
        Device device = devices.persist(Device.builder().clientIdentifier(UUID.randomUUID()).platform("PWA").build());
        TrackedAddress tracked = trackedAddresses.persist(TrackedAddress.builder()
                .address(Address.fromHexString(ADDRESS)).build());
        userAccounts.persist(UserAccount.builder().device(device).trackedAddress(tracked).label("Public fixture").build());
        entityManager.flush();
        entityManager.clear();
        assertThat(trackedAddresses.findById(tracked.getId()).orElseThrow().getAddress())
                .isEqualTo(Address.fromHexString(ADDRESS));
        assertThat(userAccounts.countByTrackedAddressId(tracked.getId())).isEqualTo(1);
    }

    @Test
    void trackedAddressOrphanLookupIndexIsInstalledConcurrentlyAndValid() {
        String indexDefinition = jdbc.queryForObject("""
                select indexdef
                from pg_indexes
                where schemaname = current_schema()
                  and indexname = 'idx_user_account_tracked_address_id'
                """, String.class);

        assertThat(indexDefinition).contains("USING btree (tracked_address_id)");
        assertThat(trackedAddressIndexIsValid("public")).isTrue();
    }

    @Test
    void trackedAddressIndexMigrationRebuildsAnInvalidSameNamedIndexOnRetry() throws Exception {
        String schema = "tracked_address_index_retry";
        jdbc.execute("create schema " + schema);
        jdbc.execute("create table " + schema + ".user_account (id bigint not null, tracked_address_id bigint)");
        jdbc.execute("insert into " + schema + ".user_account values (1, 7), (2, 7)");

        assertThatThrownBy(() -> jdbc.execute("create unique index concurrently "
                + "idx_user_account_tracked_address_id on " + schema + ".user_account (tracked_address_id)"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(trackedAddressIndexIsValid(schema)).isFalse();

        migration(schema, "classpath:db/changelog/changesets/003-user-account-tracked-address-index.yaml")
                .afterPropertiesSet();

        assertThat(trackedAddressIndexIsValid(schema)).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from " + schema + ".databasechangelog", Integer.class))
                .isEqualTo(1);
    }

    @Test
    void deviceRegistrationCompatibilityEndpointReturnsLegacySuccessWithoutMutatingRows() throws Exception {
        UUID clientId = UUID.randomUUID();
        long rowCount = devices.count();
        String response = mvc.perform(post("/api/core/v1/device/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"clientIdentifier\":\"" + clientId + "\",\"platform\":\"PWA\",\"appVersion\":\"1\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(response).get("clientIdentifier").asString()).isEqualTo(clientId.toString());
        assertThat(mapper.readTree(response).get("platform").asString()).isEqualTo("PWA");
        assertThat(mapper.readTree(response).get("appVersion").asString()).isEqualTo("1");
        assertThat(devices.count()).isEqualTo(rowCount);
        assertThat(devices.findByClientIdentifier(clientId)).isEmpty();
    }

    @Test
    void jsonPreservesDecimalStringsChecksumAddressesAndIsoInstants() {
        WalletBalanceDtoV1 balance = new WalletBalanceDtoV1(Address.fromHexString(ADDRESS), Address.ZERO,
                Wei.valueOf(new BigInteger("123456789012345678901234567890")), "9007199254740993",
                Instant.parse("2026-08-31T12:34:56Z"));
        String json = mapper.writeValueAsString(balance);
        assertThat(json).isEqualTo("{\"address\":\"" + ADDRESS + "\",\"tokenAddress\":\"" + ZERO
                + "\",\"balance\":\"123456789012345678901234567890\",\"updatedAtBlockHeight\":\"9007199254740993\","
                + "\"updatedAtTimestamp\":\"2026-08-31T12:34:56Z\",\"totalBalance\":\"123456789012345678901234567890\","
                + "\"lockedMiningReward\":\"0\",\"spendableBalance\":\"123456789012345678901234567890\"}");
        assertThat(mapper.readValue(json, WalletBalanceDtoV1.class)).isEqualTo(balance);
    }

    @Test
    void actualMvcAndRestClientUseTheSameWireTypes() throws Exception {
        NODE.respond(BALANCE_PATH, 200, "{\"list\":[{\"version\":\"V1\",\"address\":\"" + ADDRESS
                + "\",\"tokenAddress\":\"" + ZERO + "\",\"balance\":\"12345678901234567890\","
                + "\"updatedAtBlockHeight\":42,\"updatedAtTimestamp\":\"2026-08-31T12:34:56Z\"}],"
                + "\"totalElements\":1,\"totalPages\":1}");
        NODE.respond(PENDING_PATH, 200, "{\"list\":[],\"totalElements\":0,\"totalPages\":0}");
        String body = mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", ADDRESS))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(body).get(0).get("balance").asString()).isEqualTo("12345678901234567890");
        assertThat(mapper.readTree(body).get(0).get("updatedAtTimestamp").asString()).isEqualTo("2026-08-31T12:34:56Z");
        RecordedRequest request = NODE.lastRequest(BALANCE_PATH);
        assertThat(request.apiKey()).isEqualTo("public-test-api-key");
        assertThat(mapper.readTree(request.body()).get("addresses").get(0).asString()).isEqualTo(ADDRESS);
    }

    @Test
    void publicJavascriptVectorsDecodeWithUpdatedJavaCryptoLibraries() throws Exception {
        JsonNode vectors = resourceJson("/contracts/signed-transfers.json");
        for (JsonNode vector : vectors.get("transfers")) {
            var tx = TxDecoder.INSTANCE.decode(Bytes.fromHexString(vector.get("hex").asString()));
            assertThat(tx.getHash().toHexString()).isEqualTo(vector.get("hash").asString());
            assertThat(tx.getSender().toHexString()).isEqualTo(vectors.get("addresses").get(vector.get("seed").asInt()).asString());
            assertThat(tx.getAmount().toDecimalString()).isEqualTo(vector.get("amount").asString());
            assertThat(tx.getNonce()).isEqualTo(Long.parseLong(vector.get("nonce").asString()));
        }
    }

    @Test
    void signedTransactionBytesAreForwardedUnchangedToLocalMockOnly() throws Exception {
        String signed = resourceJson("/contracts/signed-transfers.json").get("transfers").get(0).get("hex").asString();
        NODE.respond(SUBMIT_PATH, 200, "{\"status\":\"SUCCESS\",\"message\":\"accepted by isolated test stub\"}");
        mvc.perform(post("/api/core/v1/wallet/submit-tx").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("hexData", signed))))
                .andExpect(status().isOk());
        assertThat(mapper.readTree(NODE.lastRequest(SUBMIT_PATH).body()).get("rawTxDataInHex").asString()).isEqualTo(signed);
    }

    @Test
    void signedTransactionBoundaryRejectsInvalidSyntaxAndOversizeWithoutCallingNode() throws Exception {
        for (String invalid : List.of("", "0x", "0x0", "0xzz", "0x01")) {
            mvc.perform(post("/api/core/v1/wallet/submit-tx").contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(Map.of("hexData", invalid))))
                    .andExpect(status().isBadRequest());
        }
        String oversized = "0x" + "00".repeat(WalletBusinessService.MAX_SIGNED_TX_BYTES + 1);
        mvc.perform(post("/api/core/v1/wallet/submit-tx").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("hexData", oversized))))
                .andExpect(status().isBadRequest());
        assertThat(NODE.requests.stream().filter(request -> request.path().equals(SUBMIT_PATH))).isEmpty();
    }

    @Test
    void largestCurrentConsensusTransactionPassesWalletBoundaryAndIsForwardedOnce() throws Exception {
        String signed = largestSignedTransferAtOrBelow(WalletBusinessService.MAX_SIGNED_TX_BYTES);
        assertThat(Bytes.fromHexString(signed).size()).isEqualTo(WalletBusinessService.MAX_SIGNED_TX_BYTES);
        NODE.respond(SUBMIT_PATH, 200, "{\"status\":\"SUCCESS\"}");
        mvc.perform(post("/api/core/v1/wallet/submit-tx").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("hexData", signed))))
                .andExpect(status().isOk());
        assertThat(NODE.requests.stream().filter(request -> request.path().equals(SUBMIT_PATH))).hasSize(1);
        assertThat(mapper.readTree(NODE.lastRequest(SUBMIT_PATH).body()).get("rawTxDataInHex").asString())
                .isEqualTo(signed);
    }

    @Test
    void requestBodyFilterRejectsDeclaredAndChunkedOverrunsBeforeControllerOrNode() throws Exception {
        byte[] declared = new byte[RequestBodyLimitFilter.SIGNED_TX_REQUEST_BYTES + 1];
        String declaredError = mvc.perform(post("/api/core/v1/wallet/submit-tx")
                .contentType(MediaType.APPLICATION_JSON).content(declared))
                .andExpect(status().isPayloadTooLarge()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(declaredError).get("code").asString()).isEqualTo("PAYLOAD_TOO_LARGE");

        byte[] chunked = ("{\"hexData\":\"0x00\"}" + " ".repeat(RequestBodyLimitFilter.SIGNED_TX_REQUEST_BYTES))
                .getBytes(StandardCharsets.UTF_8);
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/core/v1/wallet/submit-tx"))
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(chunked)))
                .build();
        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(response.body()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE.value());
        assertThat(mapper.readTree(response.body()).get("code").asString()).isEqualTo("PAYLOAD_TOO_LARGE");

        HttpRequest unexpectedGetBody = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port
                + "/api/core/v1/wallet/balances?addresses=" + ADDRESS))
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .method("GET", HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(new byte[] { 1 })))
                .build();
        HttpResponse<String> unexpectedGetBodyResponse = HttpClient.newHttpClient()
                .send(unexpectedGetBody, HttpResponse.BodyHandlers.ofString());
        assertThat(unexpectedGetBodyResponse.statusCode()).as(unexpectedGetBodyResponse.body())
                .isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE.value());

        byte[] oversizedWebhook = new byte[RequestBodyLimitFilter.WEBHOOK_REQUEST_BYTES + 1];
        HttpRequest webhookRequest = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + WEBHOOK_PATH))
                .header("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .header("X-Webhook-Timestamp", "0")
                .header("X-Webhook-Signature", "synthetic")
                .POST(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(oversizedWebhook)))
                .build();
        HttpResponse<String> webhookResponse = HttpClient.newHttpClient()
                .send(webhookRequest, HttpResponse.BodyHandlers.ofString());
        assertThat(webhookResponse.statusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE.value());
        assertThat(NODE.requests.stream().filter(nodeRequest -> nodeRequest.path().equals(SUBMIT_PATH))).isEmpty();
    }

    @Test
    void unknownCoreRoutesAndWrongMethodsAreRejectedBeforeBodyHandling() throws Exception {
        String missing = mvc.perform(post("/api/core/v1/wallet/not-a-route")
                .contentType(MediaType.APPLICATION_JSON).content(new byte[1024]))
                .andExpect(status().isNotFound()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(missing).get("code").asString()).isEqualTo("ROUTE_NOT_FOUND");

        String wrongMethod = mvc.perform(post("/api/core/v1/wallet/balances")
                .contentType(MediaType.APPLICATION_JSON).content(new byte[1024]))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(header().string("Allow", containsString("GET")))
                .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(wrongMethod).get("code").asString()).isEqualTo("METHOD_NOT_ALLOWED");
    }

    @Test
    @SuppressWarnings("unchecked")
    void signedSubmissionAndWebhookConsumeWeightedPublicCapacity() {
        Map<String, Bucket> buckets = (Map<String, Bucket>) ReflectionTestUtils.getField(
                throttlingService, "specificLogicCache");
        try {
            for (String path : List.of("/api/core/v1/wallet/submit-tx", WEBHOOK_PATH)) {
                String key = "weighted-" + path;
                Bucket bucket = Bucket.builder().addLimit(limit -> limit.capacity(10)
                        .refillGreedy(1, Duration.ofDays(1))).build();
                buckets.put(key + ":PUBLIC_CORE", bucket);
                MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
                assertThat(throttlingService.checkSpecificLimit(request, key)).isTrue();
                assertThat(bucket.getAvailableTokens()).isZero();
                var rejected = throttlingService.checkSpecificLimitDecision(request, key);
                assertThat(rejected.allowed()).isFalse();
                assertThat(rejected.retryAfterSeconds()).isGreaterThan(1);
            }
        } finally {
            buckets.clear();
        }
    }

    @Test
    void nodeHttpErrorRemainsSanitizedAndIsNotRetriedAsConnectionFailure() throws Exception {
        String signed = resourceJson("/contracts/signed-transfers.json").get("transfers").get(0).get("hex").asString();
        NODE.respond(SUBMIT_PATH, 503, "{\"message\":\"internal mock detail\"}");
        String error = mvc.perform(post("/api/core/v1/wallet/submit-tx").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("hexData", signed))))
                .andExpect(status().isInternalServerError()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(error).get("code").asString()).isEqualTo("INTERNAL_ERROR");
        assertThat(error).doesNotContain("internal mock detail");
        assertThat(NODE.requests.stream().filter(r -> r.path().equals(SUBMIT_PATH))).hasSize(1);
    }

    @Test
    void webhookStillVerifiesRawBytesAndRejectsTamperingAndExpiredTimestamp() throws Exception {
        String body = "[ {\"type\":\"NEW_BLOCK\", \"source\":\"BLOCKCHAIN\", \"data\":{} } ]";
        String timestamp = Long.toString(Instant.now().getEpochSecond());
        String signature = sign(body, timestamp);
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON).content(body)
                .header("X-Webhook-Timestamp", timestamp).header("X-Webhook-Signature", signature))
                .andExpect(status().isOk()).andExpect(content().string("Processed"));
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON).content(body + " ")
                .header("X-Webhook-Timestamp", timestamp).header("X-Webhook-Signature", signature))
                .andExpect(status().isUnauthorized());
        String expired = Long.toString(Instant.now().minusSeconds(600).getEpochSecond());
        mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON).content(body)
                .header("X-Webhook-Timestamp", expired).header("X-Webhook-Signature", sign(body, expired)))
                .andExpect(status().isUnauthorized());
        for (String extreme : List.of(Long.toString(Long.MIN_VALUE), Long.toString(Long.MAX_VALUE))) {
            mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON).content(body)
                    .header("X-Webhook-Timestamp", extreme).header("X-Webhook-Signature", sign(body, extreme)))
                    .andExpect(status().isUnauthorized());
        }
    }

    @Test
    void signedInvalidJsonHasTheExistingBadRequestContract() throws Exception {
        String timestamp = Long.toString(Instant.now().getEpochSecond());
        for (String invalid : List.of("invalid", "null", "[null]",
                "[{\"type\":\"NEW_BLOCK\",\"source\":\"BLOCKCHAIN\"}]")) {
            String error = mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON).content(invalid)
                    .header("X-Webhook-Timestamp", timestamp)
                    .header("X-Webhook-Signature", sign(invalid, timestamp)))
                    .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
            assertThat(mapper.readTree(error).get("code").asString()).isEqualTo("MALFORMED_REQUEST");
        }

        String missingHeader = mvc.perform(post(WEBHOOK_PATH).contentType(MediaType.APPLICATION_JSON).content("[]"))
                .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(missingHeader).get("code").asString()).isEqualTo("MISSING_HEADER");
    }

    @Test
    @SuppressWarnings("unchecked")
    void publicCorsAndProtectedAdminBoundarySurviveSecurityMigration() throws Exception {
        String origin = "https://wallet.example";
        String adminError = mvc.perform(get("/api/admin/review-probe").header("Origin", origin))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("Access-Control-Allow-Origin", origin))
                .andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(adminError).get("code").asString()).isEqualTo("AUTHENTICATION_REQUIRED");
        String rejected = mvc.perform(get("/api/review/client-ip;matrix"))
                .andExpect(status().isBadRequest()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(rejected).get("code").asString()).isEqualTo("REQUEST_REJECTED");

        mvc.perform(options("/api/core/v1/wallet/submit-tx").header("Origin", origin)
                .header("Access-Control-Request-Method", "POST"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", origin));
        mvc.perform(get("/api/core/v1/not-a-route").header("Origin", origin))
                .andExpect(status().isNotFound())
                .andExpect(header().string("Access-Control-Allow-Origin", origin))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(post("/api/core/v1/wallet/balances").header("Origin", origin))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(header().string("Access-Control-Allow-Origin", origin));
        mvc.perform(post("/api/core/v1/wallet/submit-tx").header("Origin", origin)
                .contentType(MediaType.APPLICATION_JSON)
                .content(new byte[RequestBodyLimitFilter.SIGNED_TX_REQUEST_BYTES + 1]))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(header().string("Access-Control-Allow-Origin", origin));

        Map<String, Bucket> buckets = (Map<String, Bucket>) ReflectionTestUtils.getField(
                throttlingService, "specificLogicCache");
        String bucketKey = "127.0.0.1:PUBLIC_CORE";
        Bucket exhausted = Bucket.builder().addLimit(limit -> limit.capacity(1)
                .refillGreedy(1, Duration.ofDays(1))).build();
        assertThat(exhausted.tryConsume(1)).isTrue();
        buckets.put(bucketKey, exhausted);
        try {
            mvc.perform(get("/api/core/v1/not-a-route").header("Origin", origin))
                    .andExpect(status().isTooManyRequests())
                    .andExpect(header().string("Access-Control-Allow-Origin", origin))
                    .andExpect(header().exists("Retry-After"));
        } finally {
            buckets.remove(bucketKey, exhausted);
        }

        MockHttpServletRequest admissionRequest = new MockHttpServletRequest(
                "GET", "/api/core/v1/wallet/balances");
        admissionRequest.setRemoteAddr("127.0.0.1");
        List<ThrottlingService.InFlightAdmission> admissions = new ArrayList<>();
        try {
            ThrottlingService.InFlightAdmission admission;
            while ((admission = throttlingService.tryAcquireInFlight(admissionRequest, 0)) != null) {
                admissions.add(admission);
            }
            assertThat(admissions).isNotEmpty();
            mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", ADDRESS).header("Origin", origin))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(header().string("Access-Control-Allow-Origin", origin));
        } finally {
            admissions.forEach(ThrottlingService.InFlightAdmission::close);
        }
    }

    @Test
    void pwaStaticResourcesHaveIsolationHeadersWithoutOverridingCachePolicy() throws Exception {
        mvc.perform(get("/"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().string("Content-Security-Policy", containsString("frame-ancestors 'none'")))
                .andExpect(header().string("Content-Security-Policy", containsString("script-src 'self' 'wasm-unsafe-eval'")))
                .andExpect(header().string("Permissions-Policy", containsString("publickey-credentials-get=(self)")));

        HttpResponse<String> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(HttpStatus.OK.value());
        assertThat(response.headers().firstValue("content-security-policy")).hasValueSatisfying(
                value -> assertThat(value).contains("default-src 'self'", "connect-src 'self'"));
        assertThat(response.headers().firstValue("x-frame-options")).contains("DENY");
        assertThat(response.headers().firstValue("cache-control").orElse("")).doesNotContain("no-store");
    }

    @Test
    void openApiKeepsExistingPathsAndOperationIds() throws Exception {
        JsonNode baseline = resourceJson("/contracts/wallet-openapi-boot3.json");
        String response = mvc.perform(get("/v3/api-docs/Core API")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode current = mapper.readTree(response);
        var baselinePaths = baseline.get("paths").propertyNames();
        var currentPaths = current.get("paths").propertyNames();
        String transactionStatusPath = "/api/core/v1/wallet/transaction-status";
        Set<String> addedPaths = Set.of(
                transactionStatusPath,
                "/api/core/v1/governance/authority-status",
                "/api/core/v1/governance/bips",
                "/api/core/v1/governance/bip");
        assertThat(currentPaths).containsAll(baselinePaths).contains(transactionStatusPath)
                .containsAll(addedPaths)
                .hasSize(baselinePaths.size() + addedPaths.size());
        for (String path : baselinePaths) {
            for (String method : baseline.get("paths").get(path).propertyNames()) {
                assertThat(current.get("paths").get(path).get(method).get("operationId"))
                        .isEqualTo(baseline.get("paths").get(path).get(method).get("operationId"));
            }
        }
        JsonNode transactionStatusOperation = current.get("paths").get(transactionStatusPath).get("get");
        assertThat(transactionStatusOperation.get("operationId").asString()).isEqualTo("getTransactionStatus");
        Map<String, JsonNode> parameterSchemas = new HashMap<>();
        for (JsonNode parameter : transactionStatusOperation.get("parameters")) {
            assertThat(parameter.get("required").asBoolean()).isTrue();
            parameterSchemas.put(parameter.get("name").asString(), parameter.get("schema"));
        }
        assertThat(parameterSchemas).containsOnlyKeys("hash", "sender", "nonce");
        assertThat(parameterSchemas.get("hash").get("pattern").asString()).isEqualTo("^0x[0-9a-f]{64}$");
        assertThat(parameterSchemas.get("sender").get("pattern").asString()).isEqualTo("^0x[0-9a-fA-F]{40}$");
        assertThat(parameterSchemas.get("nonce").get("pattern").asString()).isEqualTo("^(0|[1-9][0-9]*)$");

        JsonNode transactionStatusSchema = current.get("components").get("schemas").get("TransactionStatusDtoV1");
        List<String> requiredProperties = new ArrayList<>();
        for (JsonNode property : transactionStatusSchema.get("required")) {
            requiredProperties.add(property.asString());
        }
        assertThat(requiredProperties).containsExactlyInAnyOrder(
                "status", "hash", "sender", "nonce", "nextNonce", "confirmations", "requiredConfirmations");
        assertThat(transactionStatusSchema.get("properties").get("hash").get("pattern").asString())
                .isEqualTo("^0x[0-9a-f]{64}$");
        assertThat(transactionStatusSchema.get("properties").get("sender").get("pattern").asString())
                .isEqualTo("^0x[0-9a-f]{40}$");
        assertThat(transactionStatusSchema.get("properties").get("nonce").get("pattern").asString())
                .isEqualTo("^(0|[1-9][0-9]*)$");
        Files.writeString(Path.of("target/wallet-openapi-boot4.json"), response);
    }

    @Test
    void v2BalancesKeepLockedRewardsOutOfAvailableFundsAndV1StillWorks() throws Exception {
        var v2 = Map.<String, Object>of("version", "V2", "address", ADDRESS, "tokenAddress", ZERO,
                "balance", "100", "lockedMiningReward", "60", "spendableBalance", "40");
        NODE.page(BALANCE_PATH, List.of(v2));
        NODE.page(PENDING_PATH, List.of(pending("0x" + "01".repeat(32), ZERO, "5", "2")));
        JsonNode balance = balanceRequest(ZERO).get(0);
        assertThat(balance.get("balance").asString()).isEqualTo("33");
        assertThat(balance.get("totalBalance").asString()).isEqualTo("100");
        assertThat(balance.get("lockedMiningReward").asString()).isEqualTo("60");
        assertThat(balance.get("spendableBalance").asString()).isEqualTo("40");

        NODE.page(BALANCE_PATH, List.of(Map.of("version", "V1", "address", ADDRESS, "tokenAddress", ZERO, "balance", "100")));
        NODE.page(PENDING_PATH, List.of());
        JsonNode legacy = balanceRequest(ZERO).get(0);
        assertThat(legacy.get("balance").asString()).isEqualTo("100");
        assertThat(legacy.get("lockedMiningReward").asString()).isEqualTo("0");
        assertThat(legacy.get("spendableBalance").asString()).isEqualTo("100");
    }

    @Test
    void nativeBalanceReservesFeesFromOtherTokensEvenWithNativeOnlyFilter() throws Exception {
        NODE.page(BALANCE_PATH, List.of(Map.of("version", "V1", "address", ADDRESS, "tokenAddress", ZERO, "balance", "100")));
        NODE.page(PENDING_PATH, List.of(pending("0x" + "02".repeat(32), "0x" + "33".repeat(20), "5", "7")));
        assertThat(balanceRequest(ZERO).get(0).get("balance").asString()).isEqualTo("93");
        JsonNode nodeRequest = mapper.readTree(NODE.lastRequest(PENDING_PATH).body());
        assertThat(nodeRequest.get("fromAddresses").get(0).asString()).isEqualTo(ADDRESS);
        assertThat(nodeRequest.path("tokenAddresses").isNull() || nodeRequest.path("tokenAddresses").isMissingNode()
                || nodeRequest.path("tokenAddresses").isEmpty()).isTrue();
        assertThat(balanceRequest(null).get(0).get("balance").asString()).isEqualTo("93");
    }

    @Test
    void invalidWalletFiltersAndPaginationNeverReachTheNode() throws Exception {
        for (String addresses : List.of("", " ", ADDRESS + ", ")) {
            mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", addresses)).andExpect(status().isBadRequest());
        }
        List<String> tooMany = new ArrayList<>();
        for (int i = 1; i <= 101; i++) tooMany.add("0x" + String.format("%040x", i));
        mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", String.join(",", tooMany)))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", ADDRESS).param("tokenAddresses", String.join(",", tooMany)))
                .andExpect(status().isBadRequest());
        for (String size : List.of("0", "101", "-1")) {
            mvc.perform(get("/api/core/v1/wallet/transfers").param("addresses", ADDRESS).param("pageSize", size))
                    .andExpect(status().isBadRequest());
        }
        for (String number : List.of("-1", "2147483647")) {
            mvc.perform(get("/api/core/v1/wallet/transfers").param("addresses", ADDRESS).param("pageNumber", number))
                    .andExpect(status().isBadRequest());
        }
        assertThat(NODE.requests.stream().filter(r -> !r.path().endsWith("/subscribe"))).isEmpty();
    }

    @Test
    void excessiveNodeResultsAndPageWorkAreBoundedInsteadOfScanningTheChain() throws Exception {
        NODE.respond(BALANCE_PATH, 200, "{\"list\":[],\"totalElements\":2001,\"totalPages\":21}");
        mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", ADDRESS)).andExpect(status().isBadRequest());
        assertThat(NODE.requests.stream().filter(r -> r.path().startsWith("/api/explorer"))).hasSize(1);

        NODE.reset();
        List<Map<String, Object>> rows = new ArrayList<>();
        for (int i = 0; i < 2000; i++) {
            rows.add(Map.of(
                    "version", "V1",
                    "address", ADDRESS,
                    "tokenAddress", "0x" + String.format("%040x", i + 1),
                    "balance", "1"));
        }
        NODE.page(BALANCE_PATH, rows);
        NODE.page(PENDING_PATH, List.of());
        mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", ADDRESS)).andExpect(status().isOk());
        assertThat(NODE.requests.stream().filter(r -> r.path().equals(BALANCE_PATH))).hasSize(40);
        assertThat(NODE.requests.stream().filter(r -> r.path().equals(PENDING_PATH))).hasSize(2);
    }

    @Test
    void nonEmptyTruncatedBalancePagesFailClosed() throws Exception {
        List<Map<String, Object>> balances = new ArrayList<>();
        for (int i = 0; i < 50; i++) {
            balances.add(Map.of(
                    "version", "V1",
                    "address", ADDRESS,
                    "tokenAddress", "0x" + String.format("%040x", i + 1),
                    "balance", "1000"));
        }
        NODE.respond(BALANCE_PATH, 200, mapper.writeValueAsString(
                Map.of("list", balances, "totalElements", 100, "totalPages", 1)));
        NODE.page(PENDING_PATH, List.of());
        mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", ADDRESS))
                .andExpect(status().isInternalServerError());
        assertThat(NODE.requests.stream().filter(r -> r.path().equals(PENDING_PATH))).isEmpty();

        // A genuine short final page is valid when its count is consistent.
        NODE.reset();
        NODE.page(BALANCE_PATH, balances);
        NODE.page(PENDING_PATH, List.of());
        assertThat(balanceRequest(null).size()).isEqualTo(50);
    }

    @Test
    void nonEmptyTruncatedPendingPagesFailClosed() throws Exception {
        NODE.page(BALANCE_PATH, List.of(Map.of("version", "V1", "address", ADDRESS, "tokenAddress", ZERO, "balance", "1000")));
        List<Map<String, Object>> pendingRows = new ArrayList<>();
        for (int i = 0; i < 50; i++) {
            pendingRows.add(pending("0x" + String.format("%064x", i), ZERO, "1", "1"));
        }
        NODE.respond(PENDING_PATH, 200, mapper.writeValueAsString(
                Map.of("list", pendingRows, "totalElements", 100, "totalPages", 1)));
        mvc.perform(get("/api/core/v1/wallet/balances").param("addresses", ADDRESS))
                .andExpect(status().isInternalServerError());

        // With an honest count, all outgoing amounts and fees are reserved.
        NODE.page(PENDING_PATH, pendingRows);
        assertThat(balanceRequest(ZERO).get(0).get("balance").asString()).isEqualTo("900");
    }

    @Test
    @SuppressWarnings("unchecked")
    void encodedBalanceAliasesCannotBypassThePublicBucketOrEndpointCost() throws Exception {
        MockHttpServletRequest pathProbe = new MockHttpServletRequest("GET", "/wallet/%61pi/a+b%2Bc");
        pathProbe.setContextPath("/wallet");
        assertThat(throttlingService.getRequestPath(pathProbe)).isEqualTo("/api/a+b+c");
        NODE.page(BALANCE_PATH, List.of());
        NODE.page(PENDING_PATH, List.of());
        Map<String, Bucket> buckets = (Map<String, Bucket>) ReflectionTestUtils.getField(throttlingService, "specificLogicCache");
        HttpClient client = HttpClient.newHttpClient();
        List<String> violations = new ArrayList<>();
        try {
            for (String path : List.of("/api/core/v1/wallet/balances", "/%61pi/core/v1/wallet/balances",
                    "/api/core/v1/wallet/%62alances")) {
                Bucket bucket = Bucket.builder().addLimit(limit -> limit.capacity(10)
                        .refillGreedy(1, Duration.ofDays(1))).build();
                buckets.clear();
                buckets.put("127.0.0.1:PUBLIC_CORE", bucket);
                HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path + "?addresses=" + ADDRESS)).GET().build();
                HttpResponse<String> first = client.send(request, HttpResponse.BodyHandlers.ofString());
                // Rejecting a noncanonical route is safe; otherwise charge the same ten-token cost.
                if (first.statusCode() == 400) continue;
                assertThat(first.statusCode()).as("route %s", path).isEqualTo(200);
                long remaining = bucket.getAvailableTokens();
                int secondStatus = client.send(request, HttpResponse.BodyHandlers.ofString()).statusCode();
                if (remaining != 0 || secondStatus != 429) {
                    violations.add(path + ": tokens=" + remaining + ", second HTTP=" + secondStatus);
                }
            }
        } finally {
            buckets.clear();
        }
        assertThat(violations).isEmpty();
    }

    @Test
    void allHistoryRowsAppearExactlyOnceAcrossPendingConfirmedBoundaries() throws Exception {
        String confirmedPath = "/api/explorer/v1/transfer/page/bulk";
        NODE.respond("/api/core/v1/blockchain/latest-height", 200, "100");
        for (int pendingCount : List.of(0, 1, 3, 19, 20, 23, 40)) {
            invalidateHistorySnapshots();
            List<Map<String, Object>> pending = new ArrayList<>();
            List<Map<String, Object>> confirmed = new ArrayList<>();
            List<Long> expected = new ArrayList<>();
            for (int i = 0; i < pendingCount; i++) {
                Map<String, Object> row = new HashMap<>(pending(
                        "0x" + String.format("%064x", 1_000 + i), ZERO, "1", "1"));
                row.put("nonce", 1_000 + i);
                pending.add(row);
                expected.add(1_000L + i);
            }
            for (int i = 0; i < 47; i++) {
                confirmed.add(confirmed(
                        "0x" + String.format("%064x", i),
                        i,
                        i + 1));
                expected.add((long) i);
            }
            NODE.page(PENDING_PATH, pending);
            NODE.page(confirmedPath, confirmed);
            List<Long> actual = new ArrayList<>();
            int pages = (pendingCount + 47 + 19) / 20;
            for (int number = 0; number < pages; number++) {
                String json = mvc.perform(get("/api/core/v1/wallet/transfers").param("addresses", ADDRESS)
                        .param("pageNumber", Integer.toString(number)).param("pageSize", "20"))
                        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
                JsonNode page = mapper.readTree(json);
                assertThat(page.get("totalElements").isTextual()).isTrue();
                assertThat(page.get("totalElements").textValue()).isEqualTo(Long.toString(pendingCount + 47));
                assertThat(page.get("last").asBoolean()).isEqualTo(number == pages - 1);
                for (JsonNode row : page.get("content")) actual.add(row.get("nonce").asLong());
            }
            assertThat(actual).as("pending count %s", pendingCount).containsExactlyElementsOf(expected);
            assertThat(new HashSet<>(actual)).hasSameSizeAs(actual);
        }
    }

    @Test
    void nativeTomcatIgnoresForgedForwardedAddressesWithoutAnExplicitTrustedProxy() throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            for (String forged : List.of("203.0.113.10", "198.51.100.20")) {
                HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/review/client-ip"))
                        .header("X-Forwarded-For", forged).header("X-Forwarded-Proto", "https").GET().build();
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                assertThat(response.statusCode()).isEqualTo(200);
                assertThat(response.body()).isEqualTo("127.0.0.1");
            }
        }
    }

    @Test
    void stalledNodeHeadersHitTheDeadlineWithoutMultiplyingObservationAttempts() throws Exception {
        String path = "/api/core/v1/blockchain/latest-height";
        NODE.page(PENDING_PATH, List.of());
        NODE.page("/api/explorer/v1/transfer/page/bulk", List.of(
                confirmed("0x" + "11".repeat(32), 1, 1)));
        NODE.delay(path, 1500, 0, "100");
        long started = System.nanoTime();
        mvc.perform(get("/api/core/v1/wallet/transfers").param("addresses", ADDRESS))
                .andExpect(status().isGatewayTimeout());
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(5));
        assertThat(NODE.requests.stream().filter(r -> r.path().equals(path))).hasSize(1);
    }

    @Test
    void stalledResponseBodyTimesOutAndSignedSubmissionIsNeverAutomaticallyRetried() throws Exception {
        String signed = resourceJson("/contracts/signed-transfers.json").get("transfers").get(0).get("hex").asString();
        NODE.delay(SUBMIT_PATH, 0, 1500, "{\"status\":\"SUCCESS\"}");
        long started = System.nanoTime();
        String timeout = mvc.perform(post("/api/core/v1/wallet/submit-tx").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("hexData", signed))))
                .andExpect(status().isGatewayTimeout()).andReturn().getResponse().getContentAsString();
        assertThat(mapper.readTree(timeout).get("code").asString()).isEqualTo("NODE_TIMEOUT");
        assertThat(mapper.readTree(timeout).get("message").asString())
                .isEqualTo("The upstream node did not respond. Retry the request.");
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(1));
        assertThat(NODE.requests.stream().filter(r -> r.path().equals(SUBMIT_PATH))).hasSize(1);
    }

    @Test
    void invalidOrUnresolvedWebhookUuidIsRejectedDuringConfigurationBinding() {
        for (String value : List.of("not-a-uuid", "${MISSING_TEST_WEBHOOK_UID}")) {
            StandardEnvironment environment = new StandardEnvironment();
            environment.getPropertySources().addFirst(new MapPropertySource("test", Map.of("ge.node.webhook-uid", value)));
            assertThatThrownBy(() -> Binder.get(environment).bind("ge.node", Bindable.of(NodeProperties.class)))
                    .isInstanceOf(BindException.class);
        }
    }

    @Test
    void forwardMigrationUpgradesTheExistingRestrictiveForeignKeyWithoutLosingAccounts() throws Exception {
        jdbc.execute("create schema legacy_upgrade");
        SpringLiquibase initial = migration("legacy_upgrade", "classpath:db/changelog/changesets/001-initial-schema.yaml");
        initial.afterPropertiesSet();
        UUID id = UUID.randomUUID();
        jdbc.update("insert into legacy_upgrade.device(id,client_identifier,created_at) values (?,?,now())", id, id);
        jdbc.execute("insert into legacy_upgrade.tracked_address(id,address) values (1,decode('" + "11".repeat(20) + "','hex'))");
        jdbc.update("insert into legacy_upgrade.user_account(id,created_at,device_id,tracked_address_id) values (1,now(),?,1)", id);
        assertThatThrownBy(() -> jdbc.update("delete from legacy_upgrade.device where id=?", id))
                .isInstanceOf(DataIntegrityViolationException.class);
        migration("legacy_upgrade", "classpath:db/changelog/db.changelog-master.yaml").afterPropertiesSet();
        assertThat(jdbc.queryForObject("select count(*) from legacy_upgrade.user_account", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from legacy_upgrade.databasechangelog", Integer.class)).isEqualTo(33);
        jdbc.update("delete from legacy_upgrade.device where id=?", id);
        assertThat(jdbc.queryForObject("select count(*) from legacy_upgrade.user_account", Integer.class)).isZero();
    }

    @Test
    void cleanupDeletesKnownOldDevicesButPreservesUnknownLastSeenRows() {
        UUID oldZombie = UUID.randomUUID();
        UUID nullSeenZombie = UUID.randomUUID();
        UUID active = UUID.randomUUID();
        jdbc.update("insert into device(id,client_identifier,created_at,last_seen_at) values (?,?,now(),now()-interval '181 days')", oldZombie, oldZombie);
        jdbc.update("insert into device(id,client_identifier,created_at,last_seen_at) values (?,?,now(),null)", nullSeenZombie, nullSeenZombie);
        jdbc.update("insert into device(id,client_identifier,created_at,last_seen_at) values (?,?,now(),now())", active, active);
        Long shared = jdbc.queryForObject("insert into tracked_address(id,address) values(nextval('tracked_addr_id_seq'),decode('" + "44".repeat(20) + "','hex')) returning id", Long.class);
        Long oldOrphan = jdbc.queryForObject("insert into tracked_address(id,address) values(nextval('tracked_addr_id_seq'),decode('" + "55".repeat(20) + "','hex')) returning id", Long.class);
        Long nullSeenOrphan = jdbc.queryForObject("insert into tracked_address(id,address) values(nextval('tracked_addr_id_seq'),decode('" + "66".repeat(20) + "','hex')) returning id", Long.class);
        insertAccount(oldZombie, shared);
        insertAccount(active, shared);
        insertAccount(oldZombie, oldOrphan);
        insertAccount(nullSeenZombie, nullSeenOrphan);

        cleanup.cleanupZombies();

        assertThat(devices.findById(oldZombie)).isEmpty();
        assertThat(devices.findById(nullSeenZombie)).isPresent();
        assertThat(devices.findById(active)).isPresent();
        assertThat(trackedAddresses.findById(shared)).isPresent();
        assertThat(trackedAddresses.findById(oldOrphan)).isEmpty();
        assertThat(trackedAddresses.findById(nullSeenOrphan)).isPresent();
        assertThat(userAccounts.countByTrackedAddressId(shared)).isEqualTo(1);
        assertThat(userAccounts.countByTrackedAddressId(nullSeenOrphan)).isEqualTo(1);
    }

    @Test
    void lockedCleanupCandidateRejectsALateAccountInsertInsteadOfCreatingAnOrphanRace() throws Exception {
        UUID staleDevice = UUID.randomUUID();
        jdbc.update("insert into device(id,client_identifier,created_at,last_seen_at) values (?,?,now(),now()-interval '181 days')", staleDevice, staleDevice);
        Long address = jdbc.queryForObject("insert into tracked_address(id,address) values(nextval('tracked_addr_id_seq'),decode('" + "77".repeat(20) + "','hex')) returning id", Long.class);

        try (var cleanupConnection = dataSource.getConnection();
                ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            cleanupConnection.setAutoCommit(false);
            try (var lock = cleanupConnection.prepareStatement("""
                    select id from device
                    where id = ? and last_seen_at < now() - interval '180 days'
                    for update
                    """)) {
                lock.setObject(1, staleDevice);
                assertThat(lock.executeQuery().next()).isTrue();
            }

            CountDownLatch insertStarted = new CountDownLatch(1);
            Future<Exception> lateInsert = executor.submit(() -> {
                try (var connection = dataSource.getConnection();
                        var statement = connection.prepareStatement("""
                                insert into user_account(id,created_at,device_id,tracked_address_id)
                                values(nextval('user_acc_id_seq'),now(),?,?)
                                """)) {
                    insertStarted.countDown();
                    statement.setObject(1, staleDevice);
                    statement.setLong(2, address);
                    statement.executeUpdate();
                    return null;
                } catch (Exception exception) {
                    return exception;
                }
            });

            assertThat(insertStarted.await(2, TimeUnit.SECONDS)).isTrue();
            Thread.sleep(100);
            assertThat(lateInsert.isDone()).isFalse();

            try (var deletion = cleanupConnection.prepareStatement("delete from device where id = ?")) {
                deletion.setObject(1, staleDevice);
                assertThat(deletion.executeUpdate()).isEqualTo(1);
            }
            cleanupConnection.commit();

            Exception failure = lateInsert.get(5, TimeUnit.SECONDS);
            assertThat(failure).isInstanceOf(SQLException.class);
            assertThat(((SQLException) failure).getSQLState()).isEqualTo("23503");
        }

        assertThat(devices.findById(staleDevice)).isEmpty();
        assertThat(userAccounts.countByTrackedAddressId(address)).isZero();
        assertThat(trackedAddresses.findById(address)).isPresent();
    }

    private void insertAccount(UUID device, Long address) {
        jdbc.update("insert into user_account(id,created_at,device_id,tracked_address_id) values(nextval('user_acc_id_seq'),now(),?,?)", device, address);
    }

    private SpringLiquibase migration(String schema, String changelog) {
        SpringLiquibase migration = new SpringLiquibase();
        migration.setDataSource(dataSource);
        migration.setDefaultSchema(schema);
        migration.setLiquibaseSchema(schema);
        migration.setChangeLog(changelog);
        migration.setAnalyticsEnabled(false);
        return migration;
    }

    private boolean trackedAddressIndexIsValid(String schema) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                select index_metadata.indisvalid
                from pg_index index_metadata
                join pg_class index_relation on index_relation.oid = index_metadata.indexrelid
                join pg_namespace index_schema on index_schema.oid = index_relation.relnamespace
                where index_schema.nspname = ?
                  and index_relation.relname = 'idx_user_account_tracked_address_id'
                """, Boolean.class, schema));
    }

    private JsonNode balanceRequest(String token) throws Exception {
        var request = get("/api/core/v1/wallet/balances").param("addresses", ADDRESS);
        if (token != null) request.param("tokenAddresses", token);
        return mapper.readTree(mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private Map<String, Object> pending(String hash, String token, String amount, String fee) {
        return Map.of(
                "hash", hash,
                "addedAt", "2026-09-01T12:00:00Z",
                "transferType", "TRANSFER",
                "from", ADDRESS,
                "to", "0x" + "44".repeat(20),
                "tokenAddress", token,
                "amount", amount,
                "fee", fee,
                "nonce", 1L);
    }

    private Map<String, Object> confirmed(String hash, long nonce, long blockHeight) {
        return Map.ofEntries(
                Map.entry("txHash", hash),
                Map.entry("nonce", nonce),
                Map.entry("blockHeight", blockHeight),
                Map.entry("blockHash", "0x" + "55".repeat(32)),
                Map.entry("timestamp", "2026-09-01T12:00:00Z"),
                Map.entry("type", "TRANSFER"),
                Map.entry("from", ADDRESS),
                Map.entry("to", "0x" + "44".repeat(20)),
                Map.entry("tokenAddress", ZERO),
                Map.entry("amount", "1"),
                Map.entry("fee", "1"));
    }

    private String largestSignedTransferAtOrBelow(int maxBytes) throws Exception {
        PrivateKey key = PrivateKey.load(
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about", "", 0);
        String best = null;
        int low = 0;
        int high = maxBytes;
        while (low <= high) {
            int messageLength = low + (high - low) / 2;
            var transaction = TxBuilder.create()
                    .type(TxType.TRANSFER)
                    .network(Network.MAINNET)
                    .recipient(Address.fromHexString("0x2222222222222222222222222222222222222222"))
                    .amount(Amounts.tokens(1))
                    .fee(Amounts.tokensDecimal("0.001"))
                    .nonce(1L)
                    .message("a".repeat(messageLength))
                    .sign(key);
            String candidate = TxEncoder.INSTANCE.encode(transaction, true).toHexString();
            if (Bytes.fromHexString(candidate).size() <= maxBytes) {
                best = candidate;
                low = messageLength + 1;
            } else {
                high = messageLength - 1;
            }
        }
        return best;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ProbeConfiguration {
        @Bean ProbeController probeController() { return new ProbeController(); }
    }

    @Hidden
    @RestController
    static class ProbeController {
        @GetMapping("/api/review/client-ip")
        String clientIp(HttpServletRequest request) { return request.getRemoteAddr(); }
    }

    private JsonNode resourceJson(String path) throws IOException {
        try (var input = getClass().getResourceAsStream(path)) {
            return mapper.readTree(input);
        }
    }

    private static String sign(String body, String timestamp) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("public-test-webhook-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal((timestamp + "." + body).getBytes(StandardCharsets.UTF_8)));
    }

    private record RecordedRequest(String path, String body, String apiKey) { }
    private record MockResponse(int status, String body, long headerDelay, long bodyDelay) {
        MockResponse(int status, String body) { this(status, body, 0, 0); }
    }

    private static final class MockNode implements AutoCloseable {
        private final HttpServer server;
        private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
        private final Map<String, Function<RecordedRequest, MockResponse>> handlers = new ConcurrentHashMap<>();
        private final Map<String, MockResponse> responses = new ConcurrentHashMap<>();
        private final CopyOnWriteArrayList<RecordedRequest> requests = new CopyOnWriteArrayList<>();

        MockNode() {
            try {
                server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                server.setExecutor(executor);
                server.createContext("/", exchange -> {
                    String path = exchange.getRequestURI().getPath();
                    String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                    RecordedRequest request = new RecordedRequest(path, body, exchange.getRequestHeaders().getFirst("X-API-Key"));
                    requests.add(request);
                    MockResponse response = handlers.containsKey(path) ? handlers.get(path).apply(request)
                            : responses.getOrDefault(path, new MockResponse(200, "0"));
                    pause(response.headerDelay());
                    byte[] bytes = response.body().getBytes(StandardCharsets.UTF_8);
                    exchange.getResponseHeaders().add("Content-Type", "application/json");
                    exchange.sendResponseHeaders(response.status(), bytes.length);
                    pause(response.bodyDelay());
                    exchange.getResponseBody().write(bytes);
                    exchange.close();
                });
                server.start();
            } catch (IOException exception) {
                throw new IllegalStateException("Cannot start local mock node", exception);
            }
        }

        String baseUrl() { return "http://127.0.0.1:" + server.getAddress().getPort(); }
        void respond(String path, int status, String body) { responses.put(path, new MockResponse(status, body)); }
        void delay(String path, long headers, long body, String json) {
            responses.put(path, new MockResponse(200, json, headers, body));
        }
        void page(String path, List<Map<String, Object>> rows) {
            JsonMapper json = JsonMapper.builder().build();
            handlers.put(path, request -> {
                JsonNode input = json.readTree(request.body());
                int number = input.get("pageNumber").asInt();
                int size = input.get("pageSize").asInt();
                var list = rows.stream().skip((long) number * size).limit(size).toList();
                return new MockResponse(200, json.writeValueAsString(Map.of("list", list, "totalElements", rows.size(), "totalPages", (rows.size() + size - 1) / size)));
            });
        }
        void reset() { responses.clear(); handlers.clear(); requests.clear(); }
        private static void pause(long millis) {
            try { Thread.sleep(millis); }
            catch (InterruptedException ex) { Thread.currentThread().interrupt(); }
        }
        RecordedRequest lastRequest(String path) { return requests.stream().filter(r -> r.path().equals(path)).toList().getLast(); }
        @Override public void close() { server.stop(0); executor.shutdownNow(); }
    }
}
