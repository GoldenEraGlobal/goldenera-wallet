package global.goldenera.wallet;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.beans.factory.support.BeanDefinitionRegistry;
import org.springframework.beans.factory.support.BeanDefinitionRegistryPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.client.RestClient;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.testcontainers.postgresql.PostgreSQLContainer;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1Page;
import global.goldenera.wallet.service.business.WalletBusinessService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Explicit opt-in tooling: isolated local DB, real node reads only, never packaged in the app. */
public final class MainnetReadOnlySmoke {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Path REPORT = Path.of("docs/reviews/2026-08-31/implementation-mainnet-readonly.json");
    private static final Map<String, Object> RESULTS = new ConcurrentHashMap<>();
    private static final Map<String, AtomicInteger> COUNTS = new ConcurrentHashMap<>();
    private static final AtomicInteger BLOCKED = new AtomicInteger();
    private static final AtomicInteger SENT = new AtomicInteger();
    private static final AtomicInteger GUARDED_BUILDERS = new AtomicInteger();
    private static URI origin;

    private MainnetReadOnlySmoke() { }

    public static void main(String[] args) {
        PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18.6-alpine");
        ConfigurableApplicationContext context = null;
        try {
            Map<String, String> connection = readConnection(Path.of(args.length == 0 ? ".env" : args[0]));
            origin = URI.create(connection.get("NODE_BASE_URL"));
            if (origin.getHost() == null || origin.getUserInfo() != null || origin.getQuery() != null
                    || origin.getFragment() != null || !Set.of("http", "https").contains(origin.getScheme())) {
                throw new IllegalArgumentException("Invalid node origin configuration");
            }
            postgres.start();
            Map<String, Object> properties = new HashMap<>();
            properties.put("ge.node.base-url", connection.get("NODE_BASE_URL"));
            properties.put("ge.node.api-key", connection.get("NODE_API_KEY"));
            properties.put("ge.node.webhook-uid", "00000000-0000-0000-0000-000000000001");
            properties.put("ge.node.webhook-secret-key", "unused-read-only-placeholder");
            properties.put("spring.datasource.url", postgres.getJdbcUrl());
            properties.put("spring.datasource.username", postgres.getUsername());
            properties.put("spring.datasource.password", postgres.getPassword());
            properties.put("spring.liquibase.analytics-enabled", false);
            properties.put("spring.jpa.open-in-view", false);
            properties.put("spring.profiles.active", "dev");
            properties.put("spring.main.banner-mode", "off");
            properties.put("spring.main.log-startup-info", false);
            properties.put("logging.level.root", "OFF");
            properties.put("logging.level.global.goldenera", "OFF");
            properties.put("server.address", "127.0.0.1");
            properties.put("server.port", 18086);
            properties.put("spring.security.user.name", "read-only-local-test");
            properties.put("spring.security.user.password", "{noop}unused-local-test-password");
            properties.put("ge.throttling.global-capacity", 10000);
            properties.put("ge.throttling.global-refill-tokens", 10000);
            properties.put("ge.throttling.public-core-capacity", 10000);
            properties.put("ge.throttling.public-core-refill-tokens", 10000);
            SpringApplication app = new SpringApplication(Application.class, ReadOnlyConfiguration.class);
            app.addInitializers(ctx -> ctx.getEnvironment().getPropertySources().addFirst(new MapPropertySource("read-only-mainnet", properties)));
            context = app.run();
            if (context.containsBean("subscriptionSyncService") || context.containsBean("subscriptionCleanupService")) {
                throw new IllegalStateException("Schedulers were not removed");
            }
            if (GUARDED_BUILDERS.get() == 0 || context.getBean(HttpClient.class).followRedirects() != HttpClient.Redirect.NEVER) {
                throw new IllegalStateException("Read-only HTTP protection was not installed");
            }
            RESULTS.put("schedulersRemoved", true);
            RESULTS.put("isolatedPostgresql", true);
            RESULTS.put("localOrigin", "http://127.0.0.1:18086");
            smoke(context);
            ConfigurableApplicationContext running = context;
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                running.close();
                postgres.stop();
                RESULTS.put("cleanupComplete", true);
                save();
            }));
            save();
            System.out.println("MAINNET_READ_ONLY_READY http://127.0.0.1:18086 report=" + REPORT);
        } catch (Exception failure) {
            RESULTS.put("startupOrProbeFailureType", failure.getClass().getSimpleName());
            if (context != null) context.close();
            postgres.stop();
            save();
            System.out.println("READ_ONLY_SMOKE_FAILED " + failure.getClass().getSimpleName());
            System.exit(1);
        }
    }

    private static Map<String, String> readConnection(Path path) throws IOException {
        Map<String, String> values = new HashMap<>();
        try (var lines = Files.lines(path, StandardCharsets.UTF_8)) {
            lines.forEach(line -> {
                String value = line.trim();
                if (value.startsWith("export ")) value = value.substring(7);
                int split = value.indexOf('=');
                if (split < 0) return;
                String key = value.substring(0, split).trim();
                if (!Set.of("NODE_BASE_URL", "NODE_API_KEY").contains(key)) return;
                value = value.substring(split + 1).trim();
                if (value.length() >= 2 && ((value.startsWith("\"") && value.endsWith("\""))
                        || (value.startsWith("'") && value.endsWith("'")))) value = value.substring(1, value.length() - 1);
                values.put(key, value);
            });
        }
        if (values.size() != 2 || values.values().stream().anyMatch(String::isBlank)) {
            throw new IllegalArgumentException("Required node read configuration is missing");
        }
        return values;
    }

    private static void smoke(ConfigurableApplicationContext context) {
        RestClient node = context.getBean("nodeRestClient", RestClient.class);
        WalletBusinessService wallet = context.getBean(WalletBusinessService.class);
        JsonNode info = node.get().uri("/api/core/v1/info").retrieve().body(JsonNode.class);
        RESULTS.put("nodeInfoRead", info != null && info.isObject());
        if (info != null && info.has("network")) RESULTS.put("network", info.get("network").asString());
        RESULTS.put("tokenCount", wallet.getTokens().size());
        AccountBalanceDtoV1Page page = node.get().uri("/api/explorer/v1/account/balance/page?pageNumber=0&pageSize=3&direction=DESC")
                .retrieve().body(AccountBalanceDtoV1Page.class);
        if (page == null || page.getList() == null || page.getList().isEmpty()) throw new IllegalStateException("No public explorer addresses");
        Address watch = Address.fromHexString(page.getList().getFirst().getAddress());
        RESULTS.put("publicWatchAddress", watch.toChecksumAddress());
        RESULTS.put("sampledBalanceVersions", page.getList().stream().map(row -> String.valueOf(row.getVersion())).distinct().toList());
        var balances = wallet.getBalances(Set.of(watch), Set.of(Address.ZERO));
        if (balances.isEmpty()) throw new IllegalStateException("No public address balance");
        for (var balance : balances) {
            if (balance.balance().compareTo(balance.spendableBalance()) > 0
                    || balance.spendableBalance().add(balance.lockedMiningReward()).compareTo(balance.totalBalance()) > 0) {
                throw new IllegalStateException("Balance invariant failed");
            }
        }
        RESULTS.put("balanceInvariant", true);
        var first = wallet.getTransfers(Set.of(watch), Set.of(), 0, 5, null);
        var second = wallet.getTransfers(Set.of(watch), Set.of(), 1, 5, null);
        RESULTS.put("historyPageSizes", List.of(first.content().size(), second.content().size()));
        RESULTS.put("historyTotalsAtRead", List.of(first.totalElements(), second.totalElements()));
        String nextNonce = wallet.getNextNonce(watch);
        RESULTS.put("nonceRead", nextNonce.matches("^(0|[1-9][0-9]*)$"));
        var fees = wallet.getMempoolRecommendedFees();
        RESULTS.put("feesRead", fees != null && fees.standard() != null);
        Address empty = Address.fromHexString("0x1111111111111111111111111111111111111111");
        RESULTS.put("syntheticAddressBalanceRows", wallet.getBalances(Set.of(empty), Set.of(Address.ZERO)).size());
        RESULTS.put("backendReadSmoke", "PASS");
    }

    private static synchronized void save() {
        Map<String, Object> report = new TreeMap<>(RESULTS);
        Map<String, Integer> counts = new TreeMap<>();
        COUNTS.forEach((key, value) -> counts.put(key, value.get()));
        report.put("nodeRequestMethodsAndPaths", counts);
        report.put("blockedOutboundAttempts", BLOCKED.get());
        report.put("nodeMutationsSent", 0);
        report.put("transactionSubmissionsSent", 0);
        report.put("redirects", "NEVER");
        try { Files.writeString(REPORT, JSON.writerWithDefaultPrettyPrinter().writeValueAsString(report) + "\n"); }
        catch (IOException exception) { throw new IllegalStateException("Cannot write redacted smoke report"); }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class ReadOnlyConfiguration implements WebMvcConfigurer {
        @Bean
        static BeanDefinitionRegistryPostProcessor removeSchedulers() {
            return new BeanDefinitionRegistryPostProcessor() {
                @Override public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
                    for (String name : List.of("subscriptionSyncService", "subscriptionCleanupService")) {
                        if (!registry.containsBeanDefinition(name)) throw new IllegalStateException("Expected scheduler bean missing");
                        registry.removeBeanDefinition(name);
                    }
                }
            };
        }

        @Bean @Primary
        HttpClient readOnlyHttpClient() {
            return HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).followRedirects(HttpClient.Redirect.NEVER).build();
        }

        @Bean
        static BeanPostProcessor guardedClients() {
            return new BeanPostProcessor() {
                @Override public Object postProcessAfterInitialization(Object bean, String name) throws BeansException {
                    if (bean instanceof RestClient.Builder builder) {
                        builder.requestInterceptor(new ReadOnlyGuard());
                        GUARDED_BUILDERS.incrementAndGet();
                    }
                    return bean;
                }
            };
        }

        @Override public void addInterceptors(InterceptorRegistry registry) {
            registry.addInterceptor(new HandlerInterceptor() {
                @Override public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                    if (Set.of("GET", "HEAD", "OPTIONS").contains(request.getMethod())) return true;
                    response.setStatus(405);
                    return false;
                }
            });
        }
    }

    private static final class ReadOnlyGuard implements ClientHttpRequestInterceptor {
        private static final Set<String> READ_POSTS = Set.of("/api/explorer/v1/account/balance/page/bulk",
                "/api/explorer/v1/mem-transfer/page/bulk", "/api/explorer/v1/transfer/page/bulk");

        @Override public ClientHttpResponse intercept(HttpRequest request, byte[] body, ClientHttpRequestExecution execution) throws IOException {
            URI uri = request.getURI();
            String path = uri.getPath();
            boolean sameOrigin = origin.getScheme().equalsIgnoreCase(uri.getScheme())
                    && origin.getHost().equalsIgnoreCase(uri.getHost()) && port(origin) == port(uri)
                    && uri.getUserInfo() == null && uri.getFragment() == null;
            boolean readGet = (request.getMethod() == HttpMethod.GET || request.getMethod() == HttpMethod.HEAD)
                    && (path.equals("/api/core/v1/info") || path.equals("/api/core/v1/blockchain/worldstate/tokens")
                    || path.equals("/api/core/v1/blockchain/latest-height") || path.equals("/api/core/v1/mempool/recommended-fees")
                    || path.equals("/api/explorer/v1/account/balance/page")
                    || path.matches("/api/core/v1/blockchain/account/0x[0-9a-fA-F]{40}/summary")
                    || path.matches("/api/explorer/v1/token/by-address/0x[0-9a-fA-F]{40}"));
            boolean readPost = request.getMethod() == HttpMethod.POST && READ_POSTS.contains(path);
            if (readPost) {
                JsonNode payload = JSON.readTree(body);
                readPost = payload.path("pageNumber").asInt(-1) >= 0 && payload.path("pageNumber").asInt() <= 20
                        && payload.path("pageSize").asInt(-1) >= 1 && payload.path("pageSize").asInt() <= 100;
                JsonNode addresses = payload.path("addresses");
                if (!addresses.isArray() || addresses.isEmpty()) addresses = payload.path("fromAddresses");
                readPost &= addresses.isArray() && !addresses.isEmpty() && addresses.size() <= 3;
            }
            if (!sameOrigin || (!readGet && !readPost) || SENT.incrementAndGet() > 200) {
                BLOCKED.incrementAndGet(); save(); throw new IOException("Read-only node policy rejected request");
            }
            String label = (readPost ? "READ_ONLY_POST " : request.getMethod() + " ") + path.replaceAll("0x[0-9a-fA-F]{40}", "{address}");
            COUNTS.computeIfAbsent(label, key -> new AtomicInteger()).incrementAndGet();
            save();
            ClientHttpResponse response = execution.execute(request, body);
            if (response.getStatusCode().is3xxRedirection()) { response.close(); throw new IOException("Node redirects are forbidden"); }
            return response;
        }

        private static int port(URI uri) { return uri.getPort() >= 0 ? uri.getPort() : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80; }
    }
}
