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
package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.springdoc.core.configuration.SpringDocConfiguration;
import org.springdoc.core.properties.SpringDocConfigProperties;
import org.springdoc.webmvc.core.configuration.MultipleOpenApiSupportConfiguration;
import org.springdoc.webmvc.core.configuration.SpringDocWebMvcConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import global.goldenera.wallet.api.core.v1.device.DeviceApiV1;
import global.goldenera.wallet.api.core.v1.device.mappers.DeviceMapper;
import global.goldenera.wallet.api.core.v1.wallet.WalletApiV1;
import global.goldenera.wallet.api.core.v1.webhook.NodeWebhookApiV1;
import global.goldenera.wallet.components.WebhookSignatureVerifier;
import global.goldenera.wallet.config.SpringDocConfig;
import global.goldenera.wallet.properties.DeviceRegistrationProperties;
import global.goldenera.wallet.service.business.DeviceBusinessService;
import global.goldenera.wallet.service.business.WalletBusinessService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Exports the Core API from production MVC controllers without application infrastructure. */
@WebMvcTest(controllers = { WalletApiV1.class, DeviceApiV1.class, NodeWebhookApiV1.class },
        useDefaultFilters = false,
        properties = {
                "spring.security.user.name=test",
                "spring.security.user.password={noop}test"
        })
@ContextConfiguration(classes = CoreApiOpenApiExportTest.HarnessConfiguration.class)
@AutoConfigureMockMvc(addFilters = false)
@ImportAutoConfiguration(classes = {
        SpringDocConfigProperties.class,
        SpringDocConfiguration.class,
        SpringDocWebMvcConfiguration.class,
        MultipleOpenApiSupportConfiguration.class
})
@org.springframework.context.annotation.Import({
        SpringDocConfig.class,
        WalletApiV1.class,
        DeviceApiV1.class,
        NodeWebhookApiV1.class
})
class CoreApiOpenApiExportTest {

    private static final Path OUTPUT = Path.of("target/wallet-openapi-boot4.json");

    @Autowired MockMvc mvc;

    @MockitoBean WalletBusinessService walletBusinessService;
    @MockitoBean DeviceBusinessService deviceBusinessService;
    @MockitoBean DeviceMapper deviceMapper;
    @MockitoBean DeviceRegistrationProperties deviceRegistrationProperties;
    @MockitoBean WebhookSignatureVerifier webhookSignatureVerifier;

    @Test
    void exportsTheCurrentCoreApiDocument() throws Exception {
        String body = mvc.perform(get("/v3/api-docs/Core API"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        JsonNode document = JsonMapper.builder().build().readTree(body);

        JsonNode operation = document.path("paths")
                .path("/api/core/v1/wallet/transaction-status")
                .path("get");
        assertThat(operation.path("operationId").asString()).isEqualTo("getTransactionStatus");
        assertThat(requiredParameterNames(operation)).containsExactlyInAnyOrder("hash", "sender", "nonce");

        JsonNode schema = document.path("components").path("schemas").path("TransactionStatusDtoV1");
        assertThat(schema.isMissingNode()).isFalse();
        assertThat(requiredPropertyNames(schema)).containsExactlyInAnyOrder(
                "status", "hash", "sender", "nonce", "nextNonce", "confirmations", "requiredConfirmations");

        Files.writeString(OUTPUT, body);
    }

    private static Set<String> requiredParameterNames(JsonNode operation) {
        Set<String> names = new HashSet<>();
        for (JsonNode parameter : operation.path("parameters")) {
            assertThat(parameter.path("required").asBoolean()).isTrue();
            names.add(parameter.path("name").asString());
        }
        return names;
    }

    private static Set<String> requiredPropertyNames(JsonNode schema) {
        Set<String> names = new HashSet<>();
        for (JsonNode property : schema.path("required")) {
            names.add(property.asString());
        }
        return names;
    }

    @Configuration(proxyBeanMethods = false)
    static class HarnessConfiguration { }
}
