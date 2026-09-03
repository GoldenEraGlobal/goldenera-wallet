package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.Hash;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.service.business.GovernanceBusinessService;
import global.goldenera.wallet.service.node.GovernanceNodeService;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeAuthority;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeAuthorityPage;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeAddressAlias;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeAddressAliasPage;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeBip;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeBipMetadata;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeBipPage;
import global.goldenera.wallet.service.node.GovernanceNodeService.NodeValidator;

class GovernanceBusinessServiceTest {

    private static final Address AUTHORITY = Address.fromHexString("0x1111111111111111111111111111111111111111");
    private static final Hash BIP_HASH = Hash.fromHexString(
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    private final GovernanceNodeService node = mock(GovernanceNodeService.class);
    private final GovernanceBusinessService service = new GovernanceBusinessService(node);

    @Test
    void authorityMembershipIsMatchedAgainstTheRequestedAddress() {
        when(node.getAuthority(AUTHORITY)).thenReturn(new NodeAuthorityPage(
                List.of(new NodeAuthority(AUTHORITY.toChecksumAddress())), 1, 1L));

        assertThat(service.getAuthorityStatus(AUTHORITY).authority()).isTrue();

        when(node.getAuthority(AUTHORITY)).thenReturn(new NodeAuthorityPage(List.of(), 0, 0L));
        assertThat(service.getAuthorityStatus(AUTHORITY).authority()).isFalse();
    }

    @Test
    void bipPagePreservesPayloadAndUsesJsonSafeChainIntegers() {
        NodeBip bip = bip();
        when(node.getBips(0, 20, "PENDING", null)).thenReturn(new NodeBipPage(List.of(bip), 1, 1L));

        var page = service.getBips(0, 20, "PENDING", null);

        assertThat(page.totalElements()).isEqualTo("1");
        assertThat(page.content()).singleElement().satisfies(item -> {
            assertThat(item.bipHash()).isEqualTo(BIP_HASH.toHexString());
            assertThat(item.numberOfRequiredVotes()).isEqualTo("2");
            assertThat(item.createdAtBlockHeight()).isEqualTo("9007199254740993");
            assertThat(item.metadata().txPayload()).containsEntry("payloadType", "BIP_AUTHORITY_ADD");
        });
    }

    @Test
    void malformedNodeGovernanceDataIsRejected() {
        when(node.getAuthority(AUTHORITY)).thenReturn(new NodeAuthorityPage(List.of(), 1, 1L));
        assertThatThrownBy(() -> service.getAuthorityStatus(AUTHORITY)).isInstanceOf(GEFailedException.class);

        NodeBip invalid = new NodeBip("not-a-hash", "PENDING", false, "AUTHORITY_ADD", 1L,
                List.of(), List.of(), null, OffsetDateTime.now().plusDays(1), 1L, OffsetDateTime.now(),
                1L, OffsetDateTime.now(), BIP_HASH.toHexString(),
                new NodeBipMetadata("V1", "V1", null, Map.of("payloadType", "BIP_AUTHORITY_ADD")));
        when(node.getBip(BIP_HASH)).thenReturn(invalid);
        assertThatThrownBy(() -> service.getBip(BIP_HASH)).isInstanceOf(GEFailedException.class);
    }

    @Test
    void optionsExposeCurrentAuthoritiesAliasesAndValidatorPolicies() {
        Address other = Address.fromHexString("0x2222222222222222222222222222222222222222");
        when(node.getAuthorities()).thenReturn(List.of(new NodeAuthority(AUTHORITY.toChecksumAddress())));
        when(node.getAddressAliases()).thenReturn(new NodeAddressAliasPage(
                List.of(new NodeAddressAlias("treasury", other.toChecksumAddress())), 1, 1L));
        when(node.getValidators()).thenReturn(List.of(
                new NodeValidator(other.toChecksumAddress(), "LIMITED", 2_500L)));

        var options = service.getOptions();

        assertThat(options.authorities()).containsExactly(AUTHORITY);
        assertThat(options.addressAliases()).singleElement().satisfies(alias -> {
            assertThat(alias.alias()).isEqualTo("treasury");
            assertThat(alias.address()).isEqualTo(other);
        });
        assertThat(options.validators()).singleElement().satisfies(validator -> {
            assertThat(validator.address()).isEqualTo(other);
            assertThat(validator.miningLimitMode()).isEqualTo("LIMITED");
            assertThat(validator.maxMiningShareBps()).isEqualTo("2500");
        });
        assertThat(options.addressAliasesTruncated()).isFalse();
    }

    private static NodeBip bip() {
        OffsetDateTime now = OffsetDateTime.parse("2026-09-02T20:00:00Z");
        return new NodeBip(BIP_HASH.toHexString(), "PENDING", false, "AUTHORITY_ADD", 2L,
                List.of(AUTHORITY.toChecksumAddress()), List.of(), null, now.plusDays(1),
                9_007_199_254_740_993L, now, 9_007_199_254_740_994L, now, BIP_HASH.toHexString(),
                new NodeBipMetadata("V1", "V1", null, Map.of(
                        "payloadType", "BIP_AUTHORITY_ADD",
                        "payloadVersion", "V1",
                        "address", "0x2222222222222222222222222222222222222222")));
    }
}
