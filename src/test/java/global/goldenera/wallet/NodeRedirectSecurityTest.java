package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.convert.support.DefaultConversionService;
import org.springframework.web.client.RestClient;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import global.goldenera.wallet.components.NodeResponseBufferingInterceptor;
import global.goldenera.wallet.config.NodeClientConfig;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.properties.NodeProperties;

class NodeRedirectSecurityTest {

    private static final String SYNTHETIC_API_KEY = "synthetic-node-api-key";

    HttpServer redirectingNode;
    HttpServer foreignOrigin;
    AtomicInteger foreignRequests;
    AtomicReference<String> nodeHeader;
    AtomicReference<String> foreignHeader;

    @BeforeEach
    void startLoopbackOrigins() throws Exception {
        foreignRequests = new AtomicInteger();
        nodeHeader = new AtomicReference<>();
        foreignHeader = new AtomicReference<>();

        foreignOrigin = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        foreignOrigin.createContext("/capture", exchange -> {
            foreignRequests.incrementAndGet();
            foreignHeader.set(exchange.getRequestHeaders().getFirst("X-API-Key"));
            respond(exchange, 200, "foreign");
        });
        foreignOrigin.start();

        redirectingNode = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        redirectingNode.createContext("/redirect", exchange -> {
            nodeHeader.set(exchange.getRequestHeaders().getFirst("X-API-Key"));
            exchange.getResponseHeaders().set("Location",
                    "http://127.0.0.1:" + foreignOrigin.getAddress().getPort() + "/capture");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        redirectingNode.start();
    }

    @AfterEach
    void stopLoopbackOrigins() {
        if (redirectingNode != null) {
            redirectingNode.stop(0);
        }
        if (foreignOrigin != null) {
            foreignOrigin.stop(0);
        }
    }

    @Test
    void nodeRedirectIsRejectedWithoutForwardingApiKeyToAnotherOrigin() {
        NodeProperties properties = new NodeProperties();
        properties.setBaseUrl("http://127.0.0.1:" + redirectingNode.getAddress().getPort());
        properties.setApiKey(SYNTHETIC_API_KEY);
        NodeClientConfig config = new NodeClientConfig(properties, new NodeResponseBufferingInterceptor(),
                new DefaultConversionService());
        HttpClient httpClient = config.generalHttpClient();
        RestClient restClient = config.nodeRestClient(RestClient.builder(), httpClient);

        assertThatThrownBy(() -> restClient.get().uri("/redirect").retrieve().body(String.class))
                .isInstanceOf(GEFailedException.class)
                .hasMessage("Node redirects are not allowed");
        assertThat(nodeHeader).hasValue(SYNTHETIC_API_KEY);
        assertThat(foreignRequests).hasValue(0);
        assertThat(foreignHeader).hasValue(null);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }
}
