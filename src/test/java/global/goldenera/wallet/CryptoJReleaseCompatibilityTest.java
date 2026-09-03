package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;

import org.apache.tuweni.bytes.Bytes;
import org.apache.tuweni.units.ethereum.Wei;
import org.junit.jupiter.api.Test;

import global.goldenera.cryptoj.enums.state.AccountBalanceStateVersion;
import global.goldenera.cryptoj.serialization.state.accountbalance.AccountBalanceStateDecoder;
import global.goldenera.cryptoj.serialization.state.accountbalance.AccountBalanceStateEncoder;

class CryptoJReleaseCompatibilityTest {

    @Test
    void publishedLibraryPreservesV1StateWireFormat() {
        Bytes wire = Bytes.fromHexString("0xc7010a05c38203e8");
        var state = AccountBalanceStateDecoder.INSTANCE.decode(wire);
        assertThat(state.getVersion()).isEqualTo(AccountBalanceStateVersion.V1);
        assertThat(state.getBalance()).isEqualTo(Wei.valueOf(10));
        assertThat(state.getLockedMiningReward()).isEqualTo(Wei.ZERO);
        assertThat(state.getSpendableBalance()).isEqualTo(Wei.valueOf(10));
        assertThat(AccountBalanceStateEncoder.INSTANCE.encode(state)).isEqualTo(wire);
    }

    @Test
    void publishedLibraryPreservesV2LockedAndCancellationState() {
        Bytes wire = Bytes.fromHexString("0xc9020a05c38203e80403");
        var state = AccountBalanceStateDecoder.INSTANCE.decode(wire);
        assertThat(state.getVersion()).isEqualTo(AccountBalanceStateVersion.V2);
        assertThat(state.getBalance()).isEqualTo(Wei.valueOf(10));
        assertThat(state.getLockedMiningReward()).isEqualTo(Wei.valueOf(4));
        assertThat(state.getPendingMiningRewardCancellation()).isEqualTo(Wei.valueOf(3));
        assertThat(state.getSpendableBalance()).isEqualTo(Wei.valueOf(6));
        assertThat(AccountBalanceStateEncoder.INSTANCE.encode(state)).isEqualTo(wire);
    }
}
