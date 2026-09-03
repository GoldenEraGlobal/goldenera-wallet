package global.goldenera.wallet;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.boot.SpringApplication;
import org.testcontainers.postgresql.PostgreSQLContainer;

import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Local-only PWA test backend. Every node response and balance is synthetic. */
public final class E2eBackend {

    private static final String ZERO = "0x0000000000000000000000000000000000000000";
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Map<String, Object> TOKEN = Map.of(
            "name", "GoldenEra Test Fixture", "smallestUnitName", "GE", "numberOfDecimals", 8,
            "maxSupply", "1000000000000000000", "totalSupply", "1000000000000000", "userBurnable", false);

    private E2eBackend() { }

    public static void main(String[] args) throws Exception {
        int port = args.length == 0 ? 18084 : Integer.parseInt(args[0]);
        PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:18.6-alpine");
        HttpServer node = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        node.createContext("/", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            Object result = response(exchange.getRequestURI().getPath(), body);
            byte[] bytes = JSON.writeValueAsBytes(result);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        try {
            postgres.start();
            node.start();
            var context = SpringApplication.run(Application.class,
                    "--spring.profiles.active=dev", "--server.address=127.0.0.1", "--server.port=" + port,
                    "--spring.datasource.url=" + postgres.getJdbcUrl(),
                    "--spring.datasource.username=" + postgres.getUsername(),
                    "--spring.datasource.password=" + postgres.getPassword(),
                    "--spring.liquibase.analytics-enabled=false",
                    "--spring.jpa.open-in-view=false",
                    "--ge.node.base-url=http://127.0.0.1:" + node.getAddress().getPort(),
                    "--ge.node.api-key=public-e2e-api-key",
                    "--ge.node.webhook-uid=00000000-0000-0000-0000-000000000001",
                    "--ge.node.webhook-secret-key=public-e2e-webhook-secret",
                    "--spring.security.user.name=test-admin",
                    "--spring.security.user.password={noop}public-e2e-password",
                    "--ge.throttling.global-capacity=10000", "--ge.throttling.global-refill-tokens=10000",
                    "--ge.throttling.public-core-capacity=10000", "--ge.throttling.public-core-refill-tokens=10000");
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                context.close();
                node.stop(0);
                postgres.stop();
            }));
            System.out.println("E2E_BACKEND_READY http://127.0.0.1:" + port + " (synthetic node, disposable PostgreSQL)");
        } catch (Exception exception) {
            node.stop(0);
            postgres.stop();
            throw exception;
        }
    }

    private static Object response(String path, String body) {
        if (path.endsWith("/worldstate/tokens")) {
            return Map.of(ZERO, TOKEN);
        }
        if (path.contains("/token/by-address/")) {
            var token = new HashMap<>(TOKEN);
            token.put("address", ZERO);
            return token;
        }
        if (path.endsWith("/account/balance/page/bulk")) {
            JsonNode request = JSON.readTree(body);
            List<Map<String, Object>> balances = new ArrayList<>();
            for (JsonNode address : request.get("addresses")) {
                balances.add(Map.of("version", "V1", "address", address.asString(), "tokenAddress", ZERO,
                        "balance", "100000000000", "updatedAtBlockHeight", 100,
                        "updatedAtTimestamp", "2026-08-31T12:00:00Z"));
            }
            return Map.of("list", balances, "totalPages", 1, "totalElements", balances.size());
        }
        if (path.endsWith("/page/bulk")) {
            return Map.of("list", List.of(), "totalPages", 1, "totalElements", 0);
        }
        if (path.endsWith("/summary")) {
            return Map.of("nextNonce", 1, "nonce", 0, "pendingTxCount", 0, "nativeBalance", "100000000000");
        }
        if (path.endsWith("/recommended-fees")) {
            var level = Map.of(
                    "baseFee", "100",
                    "feePerByte", "1",
                    "minimumTotalFee", "250",
                    "miningFeePerByte", "0",
                    "totalForAverageTx", "250");
            return Map.of("slow", level, "standard", level, "fast", level, "mempoolSize", 0);
        }
        if (path.endsWith("/mempool/submit")) {
            return Map.of("status", "SUCCESS", "message", "Accepted by local E2E fixture; never broadcast");
        }
        return 100;
    }
}
