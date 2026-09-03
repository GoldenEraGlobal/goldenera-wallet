package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.Properties;

import org.junit.jupiter.api.Test;
import org.springframework.util.PropertyPlaceholderHelper;

class ApplicationPropertiesTest {

    private static final PropertyPlaceholderHelper PLACEHOLDER_HELPER =
            new PropertyPlaceholderHelper("${", "}", ":", null, true);

    @Test
    void listenPortDefaultsToDocumentedComposePortAndHonorsExplicitOverride() throws IOException {
        Properties properties = new Properties();
        try (InputStream input = ApplicationPropertiesTest.class.getResourceAsStream("/application.properties")) {
            assertThat(input).as("application.properties resource").isNotNull();
            properties.load(input);
        }

        String expression = properties.getProperty("server.port");
        assertThat(expression).isEqualTo("${LISTEN_PORT:8080}");
        assertThat(resolve(expression, Map.of())).isEqualTo("8080");
        assertThat(resolve(expression, Map.of("LISTEN_PORT", "18080"))).isEqualTo("18080");
    }

    private static String resolve(String expression, Map<String, String> environment) {
        return PLACEHOLDER_HELPER.replacePlaceholders(expression, environment::get);
    }
}
