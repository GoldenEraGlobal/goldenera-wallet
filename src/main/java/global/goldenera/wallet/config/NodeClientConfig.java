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
package global.goldenera.wallet.config;

import static lombok.AccessLevel.PRIVATE;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.Executors;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.ConversionService;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.support.RestClientAdapter;
import org.springframework.web.service.invoker.HttpServiceProxyFactory;

import global.goldenera.wallet.client.node.api.v1.AccountBalanceApiV1Api;
import global.goldenera.wallet.client.node.api.v1.BlockchainApiV1Api;
import global.goldenera.wallet.client.node.api.v1.MemTransferApiV1Api;
import global.goldenera.wallet.client.node.api.v1.MempoolApiV1Api;
import global.goldenera.wallet.client.node.api.v1.NodeInfoApiV1Api;
import global.goldenera.wallet.client.node.api.v1.TokenApiV1Api;
import global.goldenera.wallet.client.node.api.v1.TransferApiV1Api;
import global.goldenera.wallet.client.node.api.v1.TxApiV1Api;
import global.goldenera.wallet.client.node.api.v1.WebhookApiV1Api;
import global.goldenera.wallet.client.node.api.v1.WebhookEventApiV1Api;
import global.goldenera.wallet.properties.NodeProperties;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

@Configuration
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class NodeClientConfig {

    NodeProperties nodeProperties;
    ConversionService conversionService;

    @Bean
    public HttpClient generalHttpClient() {
        return HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_2)
                .connectTimeout(Duration.ofSeconds(30))
                .executor(Executors.newVirtualThreadPerTaskExecutor())
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    @Bean
    public RestClient nodeRestClient(RestClient.Builder builder, HttpClient generalHttpClient) {
        return builder
                .baseUrl(nodeProperties.getBaseUrl())
                .requestFactory(new JdkClientHttpRequestFactory(generalHttpClient))
                .defaultHeader("User-Agent", "GEWallet-Client")
                .defaultHeader("X-API-Key", nodeProperties.getApiKey())
                .build();
    }

    @Bean
    public HttpServiceProxyFactory nodeHttpServiceProxyFactory(RestClient nodeRestClient) {
        RestClientAdapter adapter = RestClientAdapter.create(nodeRestClient);
        return HttpServiceProxyFactory.builderFor(adapter)
                .conversionService(conversionService)
                .build();
    }

    @Bean
    public BlockchainApiV1Api blockchainApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(BlockchainApiV1Api.class);
    }

    @Bean
    public MempoolApiV1Api mempoolApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(MempoolApiV1Api.class);
    }

    @Bean
    public NodeInfoApiV1Api nodeInfoApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(NodeInfoApiV1Api.class);
    }

    @Bean
    public WebhookApiV1Api webhookApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(WebhookApiV1Api.class);
    }

    @Bean
    public WebhookEventApiV1Api webhookEventApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(WebhookEventApiV1Api.class);
    }

    @Bean
    public AccountBalanceApiV1Api accountBalanceApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(AccountBalanceApiV1Api.class);
    }

    @Bean
    public MemTransferApiV1Api memTransferApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(MemTransferApiV1Api.class);
    }

    @Bean
    public TransferApiV1Api transferApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(TransferApiV1Api.class);
    }

    @Bean
    public TxApiV1Api txApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(TxApiV1Api.class);
    }

    @Bean
    public TokenApiV1Api tokenApiV1(HttpServiceProxyFactory nodeHttpServiceProxyFactory) {
        return nodeHttpServiceProxyFactory.createClient(TokenApiV1Api.class);
    }
}
