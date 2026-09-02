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
package global.goldenera.wallet.service.node;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.Hash;

@Service
public class GovernanceNodeService {

    private final RestClient nodeRestClient;

    public GovernanceNodeService(RestClient nodeRestClient) {
        this.nodeRestClient = nodeRestClient;
    }

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 250))
    public NodeAuthorityPage getAuthority(Address address) {
        return nodeRestClient.post()
                .uri("/api/explorer/v1/authority/page/bulk")
                .body(new NodeAuthorityRequest(0, 1, List.of(address.toChecksumAddress())))
                .retrieve()
                .body(NodeAuthorityPage.class);
    }

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 250))
    public NodeBipPage getBips(int pageNumber, int pageSize, String status, String type) {
        return nodeRestClient.get()
                .uri(uriBuilder -> {
                    var builder = uriBuilder.path("/api/explorer/v1/bip-state/page")
                            .queryParam("pageNumber", pageNumber)
                            .queryParam("pageSize", pageSize)
                            .queryParam("direction", "DESC");
                    if (status != null) {
                        builder.queryParam("status", status);
                    }
                    if (type != null) {
                        builder.queryParam("type", type);
                    }
                    return builder.build();
                })
                .retrieve()
                .body(NodeBipPage.class);
    }

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 250))
    public NodeBip getBip(Hash hash) {
        return nodeRestClient.get()
                .uri("/api/explorer/v1/bip-state/by-hash/{hash}", hash.toHexString())
                .retrieve()
                .body(NodeBip.class);
    }

    private record NodeAuthorityRequest(int pageNumber, int pageSize, List<String> addresses) {
    }

    public record NodeAuthority(String address) {
    }

    public record NodeAuthorityPage(List<NodeAuthority> list, Integer totalPages, Long totalElements) {
    }

    public record NodeBipMetadata(String version, String txVersion, String derivedTokenAddress,
            Map<String, Object> txPayload) {
    }

    public record NodeBip(
            String bipHash,
            String status,
            Boolean actionExecuted,
            String type,
            Long numberOfRequiredVotes,
            List<String> approvers,
            List<String> disapprovers,
            OffsetDateTime executedAtTimestamp,
            OffsetDateTime expirationTimestamp,
            Long createdAtBlockHeight,
            OffsetDateTime createdAtTimestamp,
            Long updatedAtBlockHeight,
            OffsetDateTime updatedAtTimestamp,
            String updatedByTxHash,
            NodeBipMetadata metadata) {
    }

    public record NodeBipPage(List<NodeBip> list, Integer totalPages, Long totalElements) {
    }
}
