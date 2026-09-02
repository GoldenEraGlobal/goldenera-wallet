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
package global.goldenera.wallet.service.business;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Service;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.Hash;
import global.goldenera.wallet.api.core.v1.governance.dtos.AuthorityStatusDtoV1;
import global.goldenera.wallet.api.core.v1.governance.dtos.BipDtoV1;
import global.goldenera.wallet.api.core.v1.governance.dtos.BipMetadataDtoV1;
import global.goldenera.wallet.api.core.v1.governance.dtos.BipPageDtoV1;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.service.node.GovernanceNodeService;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeAuthorityPage;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeBip;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeBipMetadata;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeBipPage;

@Service
public class GovernanceBusinessService {

    private static final Set<String> BIP_STATUSES = Set.of(
            "INVALID", "APPROVED", "DISAPPROVED", "PENDING", "EXPIRED");
    private static final Set<String> BIP_TYPES = Set.of(
            "UNKNOWN", "AUTHORITY_ADD", "AUTHORITY_REMOVE", "ADDRESS_ALIAS_ADD", "ADDRESS_ALIAS_REMOVE",
            "TOKEN_CREATE", "TOKEN_UPDATE", "TOKEN_MINT", "TOKEN_BURN", "NETWORK_PARAMS_SET",
            "VALIDATOR_ADD", "VALIDATOR_REMOVE", "VALIDATOR_MINING_POLICY_SET");

    private final GovernanceNodeService governanceNodeService;

    public GovernanceBusinessService(GovernanceNodeService governanceNodeService) {
        this.governanceNodeService = governanceNodeService;
    }

    public AuthorityStatusDtoV1 getAuthorityStatus(Address address) {
        NodeAuthorityPage page = governanceNodeService.getAuthority(address);
        if (page == null || page.list() == null || page.totalElements() == null || page.totalElements() < 0) {
            throw invalidNodeResponse("authority status");
        }
        boolean authority = page.list().stream().anyMatch(item -> {
            if (item == null || item.address() == null) {
                throw invalidNodeResponse("authority address");
            }
            return parseAddress(item.address(), "authority address").equals(address);
        });
        if (authority != (page.totalElements() > 0)) {
            throw invalidNodeResponse("authority page");
        }
        return new AuthorityStatusDtoV1(address, authority);
    }

    public BipPageDtoV1 getBips(int pageNumber, int pageSize, String status, String type) {
        validateFilter(status, BIP_STATUSES, "BIP status");
        validateFilter(type, BIP_TYPES, "BIP type");
        NodeBipPage page = governanceNodeService.getBips(pageNumber, pageSize, status, type);
        if (page == null || page.list() == null || page.totalElements() == null || page.totalElements() < 0
                || page.totalPages() == null || page.totalPages() < 0 || page.list().size() > pageSize) {
            throw invalidNodeResponse("BIP page");
        }
        List<BipDtoV1> content = page.list().stream().map(this::mapBip).toList();
        return new BipPageDtoV1(content, pageNumber, pageSize, Long.toString(page.totalElements()),
                page.totalPages(), pageNumber == 0, (long) pageNumber + 1 >= page.totalPages());
    }

    public BipDtoV1 getBip(Hash hash) {
        BipDtoV1 bip = mapBip(governanceNodeService.getBip(hash));
        if (!bip.bipHash().equals(hash.toHexString())) {
            throw invalidNodeResponse("BIP hash");
        }
        return bip;
    }

    private BipDtoV1 mapBip(NodeBip bip) {
        if (bip == null || bip.bipHash() == null || bip.status() == null || bip.type() == null
                || bip.actionExecuted() == null || bip.numberOfRequiredVotes() == null
                || bip.numberOfRequiredVotes() < 0 || bip.createdAtBlockHeight() == null
                || bip.createdAtBlockHeight() < 0 || bip.updatedAtBlockHeight() == null
                || bip.updatedAtBlockHeight() < 0 || bip.expirationTimestamp() == null
                || bip.createdAtTimestamp() == null || bip.updatedAtTimestamp() == null
                || bip.updatedByTxHash() == null || bip.approvers() == null || bip.disapprovers() == null
                || bip.metadata() == null) {
            throw invalidNodeResponse("BIP");
        }
        validateNodeValue(bip.status(), BIP_STATUSES, "BIP status");
        validateNodeValue(bip.type(), BIP_TYPES, "BIP type");
        String bipHash = parseHash(bip.bipHash(), "BIP hash");
        String updatedByTxHash = parseHash(bip.updatedByTxHash(), "BIP update hash");
        return new BipDtoV1(
                bipHash,
                bip.status(),
                bip.actionExecuted(),
                bip.type(),
                Long.toString(bip.numberOfRequiredVotes()),
                mapAddresses(bip.approvers()),
                mapAddresses(bip.disapprovers()),
                instant(bip.executedAtTimestamp()),
                bip.expirationTimestamp().toInstant(),
                Long.toString(bip.createdAtBlockHeight()),
                bip.createdAtTimestamp().toInstant(),
                Long.toString(bip.updatedAtBlockHeight()),
                bip.updatedAtTimestamp().toInstant(),
                updatedByTxHash,
                mapMetadata(bip.metadata()));
    }

    private BipMetadataDtoV1 mapMetadata(NodeBipMetadata metadata) {
        if (metadata.txVersion() == null || !metadata.txVersion().equals("V1") || metadata.txPayload() == null
                || metadata.txPayload().size() > 32) {
            throw invalidNodeResponse("BIP metadata");
        }
        String derivedTokenAddress = metadata.derivedTokenAddress() == null
                ? null
                : parseAddress(metadata.derivedTokenAddress(), "derived token address").toChecksumAddress();
        Map<String, Object> payload = Collections.unmodifiableMap(new LinkedHashMap<>(metadata.txPayload()));
        Object payloadType = payload.get("payloadType");
        if (!(payloadType instanceof String value) || !value.startsWith("BIP_")) {
            throw invalidNodeResponse("BIP payload");
        }
        return new BipMetadataDtoV1(metadata.txVersion(), derivedTokenAddress, payload);
    }

    private List<String> mapAddresses(List<String> addresses) {
        if (addresses.size() > 10_000) {
            throw invalidNodeResponse("BIP voters");
        }
        return addresses.stream()
                .map(value -> parseAddress(value, "BIP voter").toChecksumAddress())
                .toList();
    }

    private static Address parseAddress(String value, String field) {
        try {
            return Address.fromHexString(value);
        } catch (RuntimeException exception) {
            throw invalidNodeResponse(field);
        }
    }

    private static String parseHash(String value, String field) {
        try {
            return Hash.fromHexString(value).toHexString();
        } catch (RuntimeException exception) {
            throw invalidNodeResponse(field);
        }
    }

    private static java.time.Instant instant(OffsetDateTime value) {
        return value == null ? null : value.toInstant();
    }

    private static void validateFilter(String value, Set<String> allowed, String field) {
        if (value != null && !allowed.contains(value)) {
            throw new IllegalArgumentException("Unsupported " + field);
        }
    }

    private static void validateNodeValue(String value, Set<String> allowed, String field) {
        if (!allowed.contains(value)) {
            throw invalidNodeResponse(field);
        }
    }

    private static GEFailedException invalidNodeResponse(String field) {
        return new GEFailedException("Node returned an invalid " + field);
    }
}
