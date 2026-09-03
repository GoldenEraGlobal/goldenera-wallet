package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferPageDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapper;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.AccountSummaryDtoV1;
import global.goldenera.wallet.client.node.model.v1.BulkMemTransferPageRequestV1.TransferTypeEnum;
import global.goldenera.wallet.client.node.model.v1.FeeLevel;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1Page;
import global.goldenera.wallet.client.node.model.v1.RecommendedFeesDtoV1;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1Page;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.exceptions.GEValidationException;
import global.goldenera.wallet.exceptions.UpstreamObservationUnstableException;
import global.goldenera.wallet.service.business.WalletBusinessService;
import global.goldenera.wallet.service.node.BlockchainNodeService;
import global.goldenera.wallet.service.node.ExplorerNodeService;

class WalletBusinessServiceConsistencyTest {

    private static final Address WALLET = Address.fromHexString("0x1111111111111111111111111111111111111111");
    private static final Address TOKEN = Address.fromHexString("0x2222222222222222222222222222222222222222");
    private static final String RECIPIENT = "0x3333333333333333333333333333333333333333";
    private static final String HASH = "0x" + "44".repeat(32);
    private static final String OTHER_HASH = "0x" + "55".repeat(32);

    private ExplorerNodeService explorer;
    private BlockchainNodeService blockchain;
    private WalletMapper mapper;
    private WalletBusinessService service;

    @BeforeEach
    void setUp() {
        explorer = mock(ExplorerNodeService.class);
        blockchain = mock(BlockchainNodeService.class);
        mapper = new WalletMapper() { };
        service = new WalletBusinessService(explorer, blockchain, mapper);
    }

    @Test
    void wideMapperFieldsRemainExactDecimalStrings() {
        var transfer = pending(HASH, TOKEN, "7", "3").nonce(9_007_199_254_740_993L);
        FeeLevel level = feeLevel("1", "2", "3");
        var fees = new RecommendedFeesDtoV1()
                .slow(level)
                .standard(level)
                .fast(level)
                .mempoolSize(9_007_199_254_740_993L);
        var page = new UnifiedTransferPageDtoV1(
                List.of(), 0, 1, "9007199254740993", 1,
                "9007199254740993", "0", true, true);

        assertThat(mapper.toUnifiedTransfer(transfer).nonce()).isEqualTo("9007199254740993");
        assertThat(page.totalElements()).isEqualTo("9007199254740993");
        assertThat(page.pendingCount()).isEqualTo("9007199254740993");
        assertThat(mapper.toMempoolRecommendedFeesDtoV1(fees).mempoolSize())
                .isEqualTo("9007199254740993");
        assertThatThrownBy(() -> mapper.toMempoolRecommendedFeesDtoV1(
                new RecommendedFeesDtoV1()
                        .slow(level)
                        .standard(level)
                        .fast(level)
                        .mempoolSize(-1L)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("invalid mempool size");
    }

    @Test
    void recommendedFeeLevelsRequireCanonicalUint256Fields() {
        String maximum = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE).toString();
        String overflow = BigInteger.ONE.shiftLeft(256).toString();
        FeeLevel maximumLevel = feeLevel(maximum, maximum, maximum);
        RecommendedFeesDtoV1 valid = new RecommendedFeesDtoV1()
                .slow(maximumLevel)
                .standard(maximumLevel)
                .fast(maximumLevel)
                .mempoolSize(0L);

        assertThat(mapper.toMempoolRecommendedFeesDtoV1(valid).fast().feePerByte())
                .isEqualTo(maximum);

        List<FeeLevel> invalidLevels = List.of(
                feeLevel("01", "1", "1"),
                feeLevel("1", "-1", "1"),
                feeLevel("1", "1", null),
                feeLevel("1", "1", "1").minimumTotalFee(null),
                feeLevel("1", "1", "1").miningFeePerByte(overflow),
                feeLevel(overflow, "1", "1"));
        for (FeeLevel invalid : invalidLevels) {
            assertThatThrownBy(() -> mapper.toMempoolRecommendedFeesDtoV1(
                    new RecommendedFeesDtoV1()
                            .slow(invalid)
                            .standard(maximumLevel)
                            .fast(maximumLevel)
                            .mempoolSize(0L)))
                    .isInstanceOf(GEFailedException.class);
        }
        assertThatThrownBy(() -> mapper.toMempoolRecommendedFeesDtoV1(
                new RecommendedFeesDtoV1()
                        .slow(maximumLevel)
                        .standard(null)
                        .fast(maximumLevel)
                        .mempoolSize(0L)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("missing recommended fee level");
        assertThatThrownBy(() -> mapper.toMempoolRecommendedFeesDtoV1(
                new RecommendedFeesDtoV1()
                        .slow(maximumLevel)
                        .standard(maximumLevel)
                        .fast(maximumLevel)
                        .mempoolSize(null)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("invalid mempool size");
    }

    @Test
    void pendingAmountAndFeeEnforceUint256Boundaries() {
        String maximum = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE).toString();
        String overflow = BigInteger.ONE.shiftLeft(256).toString();
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage(maximum, 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(HASH, TOKEN, maximum, maximum))));

        assertThat(service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .singleElement()
                .satisfies(balance -> assertThat(balance.balance().toBigInteger()).isZero());

        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(HASH, TOKEN, overflow, "0"))));
        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("invalid pending amount");

        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(HASH, TOKEN, "0", overflow))));
        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("invalid pending fee");
    }

    @Test
    void pendingReservationAggregationFailsOnUint256Overflow() {
        String maximum = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE).toString();
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("0", 1L));

        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(
                        pending(HASH, TOKEN, maximum, "0"),
                        pending(OTHER_HASH, TOKEN, "1", "0"))));
        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("pending reservations that exceed the uint256 range");

        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(
                        pending(HASH, TOKEN, "0", maximum),
                        pending(OTHER_HASH, TOKEN, "0", "1"))));
        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("pending reservations that exceed the uint256 range");
    }

    @Test
    void stableNonNativeBalanceScopesPendingReadsAndReservesOnlyThatToken() {
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 9_007_199_254_740_993L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(HASH, TOKEN, "7", "3"))));

        var result = service.getBalances(Set.of(WALLET), Set.of(TOKEN));

        assertThat(result).singleElement().satisfies(balance -> {
            assertThat(balance.balance().toBigInteger()).isEqualTo(93);
            assertThat(balance.updatedAtBlockHeight()).isEqualTo("9007199254740993");
        });
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Set<Address>> tokens = ArgumentCaptor.forClass(Set.class);
        verify(explorer, times(2)).getOutgoingMemTransfersBulkForObservation(
                eq(0), eq(100), eq(Set.of(WALLET)), tokens.capture());
        assertThat(tokens.getAllValues()).allSatisfy(value -> assertThat(value).containsExactly(TOKEN));
    }

    @Test
    void balanceRowsOutsideTheRequestedTokenScopeFailClosed() {
        AccountBalanceDtoV1 balance = new AccountBalanceDtoV1()
                .version(AccountBalanceDtoV1.VersionEnum.V1)
                .address(WALLET.toChecksumAddress())
                .tokenAddress(Address.ZERO.toChecksumAddress())
                .balance("100")
                .updatedAtBlockHeight(1L);
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(new AccountBalanceDtoV1Page()._list(List.of(balance)).totalElements(1L));

        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("unexpected account balance");
        verify(explorer, never()).getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any());
    }

    @Test
    void changingBalanceObservationsFailClosedAfterTheBoundedRetry() {
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 1L), balancePage("101", 1L), balancePage("102", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of()));

        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(UpstreamObservationUnstableException.class)
                .hasMessageContaining("did not stabilize");
        verify(explorer, times(3)).getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any());
    }

    @Test
    void changingTotalsInsideOnePendingObservationFailClosed() {
        List<MemTransferDtoV1> firstRows = new ArrayList<>();
        for (int index = 0; index < 100; index++) {
            firstRows.add(pending("0x" + String.format("%064x", index), TOKEN, "1", "1"));
        }
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(
                        new MemTransferDtoV1Page()._list(firstRows).totalElements(101L),
                        new MemTransferDtoV1Page()._list(List.of()).totalElements(100L));

        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("inconsistent pending page totals");
    }

    @Test
    void identicalPendingHashesReserveAmountAndFeeOnlyOnce() {
        var duplicate = pending(HASH, TOKEN, "7", "3");
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(duplicate, duplicate)));

        var result = service.getBalances(Set.of(WALLET), Set.of(TOKEN));

        assertThat(result).singleElement().satisfies(balance ->
                assertThat(balance.balance().toBigInteger()).isEqualTo(93));
    }

    @Test
    void duplicatePendingRowsMayAppearAndDisappearWithoutDoubleReservation() {
        var duplicate = pending(HASH, TOKEN, "7", "3");
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(
                        pendingPage(List.of(duplicate)),
                        pendingPage(List.of(duplicate, duplicate)),
                        pendingPage(List.of(duplicate)));

        var result = service.getBalances(Set.of(WALLET), Set.of(TOKEN));

        assertThat(result).singleElement().satisfies(balance ->
                assertThat(balance.balance().toBigInteger()).isEqualTo(93));
        verify(explorer, times(2)).getOutgoingMemTransfersBulkForObservation(
                anyInt(), anyInt(), any(), any());
        verify(explorer, never()).getOutgoingMemTransfersBulk(anyInt(), anyInt(), any(), any());
    }

    @Test
    void balanceObservationIgnoresUnrelatedPendingMessagePayload() {
        MemTransferDtoV1 first = pending(HASH, TOKEN, "7", "3").message("first");
        MemTransferDtoV1 second = pending(HASH, TOKEN, "7", "3")
                .message("x".repeat(100_001));
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(first)), pendingPage(List.of(second)));

        var result = service.getBalances(Set.of(WALLET), Set.of(TOKEN));

        assertThat(result).singleElement().satisfies(balance ->
                assertThat(balance.balance().toBigInteger()).isEqualTo(93));
        verify(explorer, times(2)).getOutgoingMemTransfersBulkForObservation(
                anyInt(), anyInt(), any(), any());
    }

    @Test
    void feeOnlyGovernanceReservesNativeFeeButNoAmount() {
        MemTransferDtoV1 governance = pending(HASH, Address.ZERO, null, "3")
                .txType(MemTransferDtoV1.TxTypeEnum.BIP_CREATE);
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage(Address.ZERO, "100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(governance)));

        var result = service.getBalances(Set.of(WALLET), Set.of(Address.ZERO));

        assertThat(result).singleElement().satisfies(balance ->
                assertThat(balance.balance().toBigInteger()).isEqualTo(97));
    }

    @Test
    void nullAmountWithoutAnExplicitFeeOnlyGovernanceTypeFailsClosed() {
        MemTransferDtoV1 unknown = pending(HASH, Address.ZERO, null, "3")
                .txType(null);
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage(Address.ZERO, "100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(unknown)));

        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(Address.ZERO)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("invalid pending amount");
    }

    @Test
    void partialV2BalancesNeverFallBackToLegacyDefaults() {
        AccountBalanceDtoV1 partial = new AccountBalanceDtoV1()
                .version(AccountBalanceDtoV1.VersionEnum.V2)
                .address(WALLET.toChecksumAddress())
                .tokenAddress(TOKEN.toChecksumAddress())
                .balance("100")
                .spendableBalance("100")
                .updatedAtBlockHeight(1L);

        assertThatThrownBy(() -> mapper.toWalletBalance(partial))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("incomplete V2");
    }

    @Test
    void interruptedBalanceObservationCancelsItsPhysicalNodeCall() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch cancelled = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenAnswer(invocation -> {
                    started.countDown();
                    try {
                        new CountDownLatch(1).await();
                        throw new AssertionError("unreachable");
                    } catch (InterruptedException exception) {
                        cancelled.countDown();
                        Thread.currentThread().interrupt();
                        throw new GEFailedException("interrupted node call");
                    }
                });

        Thread request = Thread.ofVirtual().start(() -> {
            try {
                service.getBalances(Set.of(WALLET), Set.of(TOKEN));
            } catch (Throwable throwable) {
                failure.set(throwable);
            }
        });
        assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
        request.interrupt();
        request.join(2_000);

        assertThat(request.isAlive()).isFalse();
        assertThat(cancelled.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(failure.get()).isInstanceOf(UpstreamObservationUnstableException.class);
    }

    @Test
    void missingPendingAmountOrHashNeverUnderReservesFunds() {
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(HASH, TOKEN, null, "3"))));

        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("invalid pending amount");

        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(null, TOKEN, "7", "3"))));
        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("invalid pending transaction hash");
    }

    @Test
    void conflictingPendingRowsForOneHashFailClosed() {
        when(explorer.getAccountBalancesBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(balancePage("100", 1L));
        when(explorer.getOutgoingMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any()))
                .thenReturn(pendingPage(List.of(
                        pending(HASH, TOKEN, "7", "3"),
                        pending(HASH, TOKEN, "8", "3"))));

        assertThatThrownBy(() -> service.getBalances(Set.of(WALLET), Set.of(TOKEN)))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("conflicting pending transfers");
    }

    @Test
    void changingHistoryObservationsFailClosedBeforeHeightLookup() {
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of()));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(
                        confirmedPage(List.of(confirmed(HASH, 10L, 1L))),
                        confirmedPage(List.of(confirmed(OTHER_HASH, 10L, 1L))),
                        confirmedPage(List.of(confirmed("0x" + "77".repeat(32), 10L, 1L))));

        assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 1, null))
                .isInstanceOf(UpstreamObservationUnstableException.class)
                .hasMessageContaining("did not stabilize");
        verify(blockchain, never()).getLatestBlockHeightForObservation();
    }

    @Test
    void confirmedTransferWinsAStablePendingDuplicateAndUsesAValidatedHeight() {
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(HASH, TOKEN, "7", "3"))));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of(
                        confirmed(HASH, 10L, 1L),
                        confirmed(OTHER_HASH, 9L, 2L))));
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 2, null);

        assertThat(page.content()).extracting(transfer -> transfer.status().name())
                .containsExactly("CONFIRMED", "CONFIRMED");
        assertThat(page.content()).extracting(transfer -> transfer.txHash().toHexString())
                .containsExactly(HASH, OTHER_HASH);
        assertThat(page.content()).extracting(transfer -> transfer.confirmations())
                .containsExactly("1", "2");
        assertThat(page.totalElements()).isEqualTo("2");
        assertThat(page.pendingCount()).isEqualTo("0");
        assertThat(page.confirmedCount()).isEqualTo("2");
        verify(blockchain).getLatestBlockHeightForObservation();
    }

    @Test
    void nativeTokenAliasesDeduplicatePendingAndConfirmedCopies() {
        MemTransferDtoV1 pending = pending(HASH, Address.ZERO, "7", "3").tokenAddress(null);
        TransferDtoV1 confirmed = confirmed(HASH, 10L, 1L)
                .tokenAddress(Address.ZERO.toChecksumAddress());
        stubHistory(List.of(pending), List.of(confirmed));
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);

        var page = service.getTransfers(Set.of(WALLET), Set.of(Address.ZERO), 0, 10, null);

        assertThat(page.content()).singleElement().satisfies(transfer -> {
            assertThat(transfer.status().name()).isEqualTo("CONFIRMED");
            assertThat(transfer.tokenAddress()).isEqualTo(Address.ZERO);
        });
        assertThat(page.pendingCount()).isEqualTo("0");
        assertThat(page.confirmedCount()).isEqualTo("1");
    }

    @Test
    void validHashlessSystemTransfersRemainVisible() {
        List<TransferDtoV1> rows = List.of(
                systemTransfer(TransferDtoV1.TypeEnum.BLOCK_REWARD, null, WALLET.toChecksumAddress(), null),
                systemTransfer(TransferDtoV1.TypeEnum.BLOCK_FEES, null, WALLET.toChecksumAddress(), ""),
                systemTransfer(TransferDtoV1.TypeEnum.MINT, null, WALLET.toChecksumAddress(), TOKEN.toChecksumAddress()),
                systemTransfer(TransferDtoV1.TypeEnum.BURN, WALLET.toChecksumAddress(), null, TOKEN.toChecksumAddress()));
        stubHistory(List.of(), rows);
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);

        var page = service.getTransfers(Set.of(WALLET), Set.of(), 0, 10, null);

        assertThat(page.content()).hasSize(4).allSatisfy(transfer -> {
            assertThat(transfer.txHash()).isNull();
            assertThat(transfer.nonce()).isNull();
            assertThat(transfer.status().name()).isEqualTo("CONFIRMED");
        });
        assertThat(page.content()).extracting(transfer -> transfer.transferType().name())
                .containsExactlyInAnyOrder("BLOCK_REWARD", "BLOCK_FEES", "MINT", "BURN");
    }

    @Test
    void duplicateHashlessSystemRowsDeduplicateWithoutExplorerIds() {
        TransferDtoV1 first = systemTransfer(
                TransferDtoV1.TypeEnum.BLOCK_REWARD,
                null,
                WALLET.toChecksumAddress(),
                null).id(10L);
        TransferDtoV1 duplicate = systemTransfer(
                TransferDtoV1.TypeEnum.BLOCK_REWARD,
                null,
                WALLET.toChecksumAddress(),
                Address.ZERO.toChecksumAddress()).id(11L);
        stubHistory(List.of(), List.of(first, duplicate));
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);

        var page = service.getTransfers(Set.of(WALLET), Set.of(), 0, 10, null);

        assertThat(page.content()).singleElement();
        assertThat(page.totalElements()).isEqualTo("1");
        assertThat(page.confirmedCount()).isEqualTo("1");
    }

    @Test
    void changingExplorerIdsDoNotDestabilizePublicHistory() {
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of()));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(
                        confirmedPage(List.of(confirmed(HASH, 10L, 1L).id(10L))),
                        confirmedPage(List.of(confirmed(HASH, 10L, 1L).id(11L))));
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null);

        assertThat(page.content()).singleElement();
        verify(explorer, times(2)).getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void requiredPendingPublicFieldsFailClosed() {
        List<MemTransferDtoV1> invalid = List.of(
                pending(hash(11), TOKEN, "7", "3").from(null),
                pending(hash(12), TOKEN, "7", "3").transferType(null),
                pending(hash(13), TOKEN, "7", "3").addedAt(null));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of()));

        for (MemTransferDtoV1 row : invalid) {
            when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                    .thenReturn(pendingPage(List.of(row)));
            assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null))
                    .isInstanceOf(GEFailedException.class);
        }
    }

    @Test
    void requiredConfirmedPublicFieldsFailClosed() {
        List<TransferDtoV1> invalid = List.of(
                confirmed(hash(21), 10L, 1L).blockHash(null),
                confirmed(hash(22), 10L, 1L).timestamp(null),
                confirmed(hash(23), 10L, 1L).from(null),
                confirmed(hash(24), 10L, 1L).to(null));
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of()));

        for (TransferDtoV1 row : invalid) {
            when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                    .thenReturn(confirmedPage(List.of(row)));
            assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null))
                    .isInstanceOf(GEFailedException.class);
        }
    }

    @Test
    void rawPendingFieldsAreExcludedFromStableCachedProjection() {
        MemTransferDtoV1 first = pending(HASH, TOKEN, "7", "3").size(100);
        MemTransferDtoV1 second = pending(HASH, TOKEN, "7", "3").size(200);
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of(first)), pendingPage(List.of(second)));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of()));

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null);

        assertThat(page.content()).singleElement();
        verify(explorer, times(2)).getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void oversizedPendingMessagesFailBeforeCaching() {
        MemTransferDtoV1 oversized = pending(HASH, TOKEN, "7", "3")
                .message("x".repeat(100_001));
        stubHistory(List.of(oversized), List.of());

        for (int attempt = 0; attempt < 2; attempt++) {
            assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null))
                    .isInstanceOf(GEFailedException.class)
                    .hasMessageContaining("oversized pending message");
        }
        verify(explorer, times(2)).getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void oversizedConfirmedMessagesFailBeforeCaching() {
        TransferDtoV1 oversized = confirmed(HASH, 10L, 1L)
                .message("x".repeat(100_001));
        stubHistory(List.of(), List.of(oversized));

        for (int attempt = 0; attempt < 2; attempt++) {
            assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null))
                    .isInstanceOf(GEFailedException.class)
                    .hasMessageContaining("oversized confirmed message");
        }
        verify(explorer, times(2)).getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void cumulativeHistoryProjectionBytesFailBeforeTheConfirmedDatasetIsRead() {
        String boundedMessage = "x".repeat(50_000);
        List<MemTransferDtoV1> rows = new ArrayList<>();
        for (int index = 0; index < 200; index++) {
            rows.add(pending(hash(100 + index), TOKEN, "7", "3").message(boundedMessage));
        }
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(
                        new MemTransferDtoV1Page()._list(rows.subList(0, 100)).totalElements(200L),
                        new MemTransferDtoV1Page()._list(rows.subList(100, 200)).totalElements(200L));

        assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null))
                .isInstanceOf(GEValidationException.class)
                .hasMessageContaining("16 MiB observation limit");
        verify(explorer, times(2)).getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
        verify(explorer, never()).getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void historyRowsOutsideAddressTokenOrTypeScopeFailClosed() {
        MemTransferDtoV1 outsideAddress = pending(HASH, TOKEN, "7", "3")
                .from("0x9999999999999999999999999999999999999999")
                .to(RECIPIENT);
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of(outsideAddress)));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of()));
        assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("outside the requested address scope");

        MemTransferDtoV1 outsideToken = pending(OTHER_HASH, Address.ZERO, "7", "3");
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of(outsideToken)));
        assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("outside the requested token scope");

        MemTransferDtoV1 outsideType = pending(hash(9), TOKEN, "7", "3");
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of(outsideType)));
        assertThatThrownBy(() -> service.getTransfers(
                Set.of(WALLET), Set.of(TOKEN), 0, 10, TransferTypeEnum.BURN))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("outside the requested type scope");
    }

    @Test
    void normalizedHistoryOrderStabilizesAcrossMutableNodeOrdering() {
        MemTransferDtoV1 first = pending(hash(1), TOKEN, "7", "3");
        MemTransferDtoV1 second = pending(hash(2), TOKEN, "7", "3");
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(
                        pendingPage(List.of(second, first)),
                        pendingPage(List.of(first, second)));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of()));

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 10, null);

        assertThat(page.content()).extracting(transfer -> transfer.txHash().toHexString())
                .containsExactly(hash(1), hash(2));
        verify(explorer, times(2)).getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void adjacentPagesAndPageSizesShareOneStableHistorySnapshot() {
        stubHistory(List.of(
                pending(hash(3), TOKEN, "7", "3"),
                pending(hash(1), TOKEN, "7", "3"),
                pending(hash(2), TOKEN, "7", "3")), List.of());

        var first = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 2, null);
        var second = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 1, 2, null);
        var smaller = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 1, null);

        assertThat(first.content()).extracting(transfer -> transfer.txHash().toHexString())
                .containsExactly(hash(1), hash(2));
        assertThat(second.content()).extracting(transfer -> transfer.txHash().toHexString())
                .containsExactly(hash(3));
        assertThat(smaller.content()).extracting(transfer -> transfer.txHash().toHexString())
                .containsExactly(hash(1));
        verify(explorer, times(2)).getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
        verify(explorer, times(2)).getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any());
    }

    @Test
    void globalHashDedupProducesStableTotalsAndBoundariesAcrossEveryPageSize() {
        String firstPending = hash(1);
        String secondPending = hash(2);
        String thirdPending = hash(3);
        String fourthPending = hash(4);
        String firstConfirmed = hash(5);
        String lastConfirmed = hash(6);
        stubHistory(
                List.of(
                        pending(firstPending, TOKEN, "7", "3"),
                        pending(secondPending, TOKEN, "7", "3"),
                        pending(thirdPending, TOKEN, "7", "3"),
                        pending(fourthPending, TOKEN, "7", "3")),
                List.of(
                        confirmed(firstConfirmed, 10L, 1L),
                        confirmed(thirdPending, 10L, 1L),
                        confirmed(firstPending, 10L, 1L),
                        confirmed(lastConfirmed, 10L, 1L)));
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);
        List<String> expected = List.of(
                secondPending, fourthPending, firstPending,
                thirdPending, firstConfirmed, lastConfirmed);

        for (int pageSize = 1; pageSize <= expected.size(); pageSize++) {
            int totalPages = (expected.size() + pageSize - 1) / pageSize;
            List<String> actual = new ArrayList<>();
            for (int pageNumber = 0; pageNumber < totalPages; pageNumber++) {
                var page = service.getTransfers(
                        Set.of(WALLET), Set.of(TOKEN), pageNumber, pageSize, null);
                actual.addAll(page.content().stream()
                        .map(transfer -> transfer.txHash().toHexString())
                        .toList());
                assertThat(page.totalElements()).isEqualTo("6");
                assertThat(page.pendingCount()).isEqualTo("2");
                assertThat(page.confirmedCount()).isEqualTo("4");
                assertThat(page.totalPages()).isEqualTo(totalPages);
                assertThat(page.first()).isEqualTo(pageNumber == 0);
                assertThat(page.last()).isEqualTo(pageNumber == totalPages - 1);
            }
            assertThat(actual).containsExactlyElementsOf(expected);
        }
    }

    @Test
    void completeMultiPageHistoryObservationsDeduplicateHashesOutsideTheFirstPages() {
        List<MemTransferDtoV1> pendingRows = new ArrayList<>();
        for (int i = 1; i <= 101; i++) {
            pendingRows.add(pending(hash(i), TOKEN, "7", "3"));
        }
        List<TransferDtoV1> confirmedRows = new ArrayList<>();
        confirmedRows.add(confirmed(hash(101), 10L, 1L));
        for (int i = 200; i < 299; i++) {
            confirmedRows.add(confirmed(hash(i), 10L, 1L));
        }
        confirmedRows.add(confirmed(hash(1), 10L, 1L));
        stubHistory(pendingRows, confirmedRows);
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 100, null);

        assertThat(page.totalElements()).isEqualTo("200");
        assertThat(page.pendingCount()).isEqualTo("99");
        assertThat(page.confirmedCount()).isEqualTo("101");
        assertThat(page.totalPages()).isEqualTo(2);
        assertThat(page.content()).hasSize(100);
        assertThat(page.content().getFirst().txHash().toHexString()).isEqualTo(hash(2));
        assertThat(page.content().get(98).txHash().toHexString()).isEqualTo(hash(100));
        assertThat(page.content().getLast().txHash().toHexString()).isEqualTo(hash(1));
        assertThat(page.content().getLast().status().name()).isEqualTo("CONFIRMED");
        verify(explorer, times(4)).getMemTransfersBulkForObservation(anyInt(), eq(100), any(), any(), any());
        verify(explorer, times(4)).getTransfersBulkForObservation(anyInt(), eq(100), any(), any(), any());
    }

    @Test
    void conflictingPendingAndConfirmedRowsForOneHashFailClosedGlobally() {
        stubHistory(
                List.of(pending(HASH, TOKEN, "7", "3")),
                List.of(confirmed(HASH, 10L, 1L).amount("8")));

        assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 1, null))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("conflicting pending and confirmed history");
        verify(blockchain, never()).getLatestBlockHeightForObservation();
    }

    @Test
    void pendingOnlyWindowDoesNotFetchLatestHeight() {
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of(pending(HASH, TOKEN, "7", "3"))));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of()));

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 1, null);

        assertThat(page.content()).singleElement().satisfies(transfer ->
                assertThat(transfer.status().name()).isEqualTo("PENDING"));
        verify(blockchain, never()).getLatestBlockHeightForObservation();
    }

    @Test
    void twoThousandPendingRowsRemainSupportedWhenOneConfirmedRowOverlaps() {
        List<MemTransferDtoV1> pendingRows = new ArrayList<>();
        for (int index = 1; index <= 2_000; index++) {
            pendingRows.add(pending(hash(index), TOKEN, "1", "1"));
        }
        stubHistory(pendingRows, List.of(confirmed(hash(2_000), 10L, 1L).amount("1").fee("1")));

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 100, null);

        assertThat(page.totalElements()).isEqualTo("2000");
        assertThat(page.pendingCount()).isEqualTo("1999");
        assertThat(page.confirmedCount()).isEqualTo("1");
        assertThat(page.totalPages()).isEqualTo(20);
    }

    @Test
    void historyAboveTheGlobalObservationCapFailsClosed() {
        List<MemTransferDtoV1> pendingRows = new ArrayList<>();
        for (int index = 1; index <= 2_001; index++) {
            pendingRows.add(pending(hash(index), TOKEN, "1", "1"));
        }
        stubHistory(pendingRows, List.of());

        assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 1, null))
                .isInstanceOf(GEValidationException.class)
                .hasMessageContaining("exceeds 2000 rows");
    }

    @Test
    void maximumHeightProducesAnExactConfirmationStringWithoutOverflow() {
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of()));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of(confirmed(HASH, 0L, 1L))));
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(Long.MAX_VALUE);

        var page = service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 1, null);

        assertThat(page.content()).singleElement().satisfies(transfer ->
                assertThat(transfer.confirmations()).isEqualTo("9223372036854775808"));
    }

    @Test
    void staleLatestHeightNeverCreatesZeroOrNegativeConfirmations() {
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(pendingPage(List.of()));
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenReturn(confirmedPage(List.of(confirmed(HASH, 11L, 1L))));
        when(blockchain.getLatestBlockHeightForObservation()).thenReturn(10L);

        assertThatThrownBy(() -> service.getTransfers(Set.of(WALLET), Set.of(TOKEN), 0, 1, null))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("older than confirmed wallet history");
    }

    @Test
    void nextNonceRemainsExactAndRejectsInvalidNodeValues() {
        when(blockchain.getAccountSummary(WALLET, null))
                .thenReturn(new AccountSummaryDtoV1().nextNonce(9_007_199_254_740_993L));
        assertThat(service.getNextNonce(WALLET)).isEqualTo("9007199254740993");

        when(blockchain.getAccountSummary(WALLET, null))
                .thenReturn(new AccountSummaryDtoV1().nextNonce(-1L));
        assertThatThrownBy(() -> service.getNextNonce(WALLET))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("negative next nonce");

        when(blockchain.getAccountSummary(WALLET, null))
                .thenReturn(new AccountSummaryDtoV1());
        assertThatThrownBy(() -> service.getNextNonce(WALLET))
                .isInstanceOf(GEFailedException.class)
                .hasMessageContaining("missing next nonce");
    }

    private void stubHistory(List<MemTransferDtoV1> pendingRows, List<TransferDtoV1> confirmedRows) {
        when(explorer.getMemTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    int pageNumber = invocation.getArgument(0);
                    int pageSize = invocation.getArgument(1);
                    int start = Math.min(pageNumber * pageSize, pendingRows.size());
                    int end = Math.min(start + pageSize, pendingRows.size());
                    return new MemTransferDtoV1Page()
                            ._list(List.copyOf(pendingRows.subList(start, end)))
                            .totalElements((long) pendingRows.size());
                });
        when(explorer.getTransfersBulkForObservation(anyInt(), anyInt(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    int pageNumber = invocation.getArgument(0);
                    int pageSize = invocation.getArgument(1);
                    int start = Math.min(pageNumber * pageSize, confirmedRows.size());
                    int end = Math.min(start + pageSize, confirmedRows.size());
                    return new TransferDtoV1Page()
                            ._list(List.copyOf(confirmedRows.subList(start, end)))
                            .totalElements((long) confirmedRows.size());
                });
    }

    private static String hash(int suffix) {
        return "0x" + String.format("%064x", suffix);
    }

    private static AccountBalanceDtoV1Page balancePage(String amount, long height) {
        return balancePage(TOKEN, amount, height);
    }

    private static AccountBalanceDtoV1Page balancePage(Address token, String amount, long height) {
        AccountBalanceDtoV1 balance = new AccountBalanceDtoV1()
                .version(AccountBalanceDtoV1.VersionEnum.V1)
                .address(WALLET.toChecksumAddress())
                .tokenAddress(token.toChecksumAddress())
                .balance(amount)
                .updatedAtBlockHeight(height);
        return new AccountBalanceDtoV1Page()._list(List.of(balance)).totalElements(1L);
    }

    private static FeeLevel feeLevel(String baseFee, String feePerByte, String totalForAverageTx) {
        return new FeeLevel()
                .baseFee(baseFee)
                .feePerByte(feePerByte)
                .minimumTotalFee(totalForAverageTx)
                .miningFeePerByte(feePerByte)
                .totalForAverageTx(totalForAverageTx);
    }

    private static MemTransferDtoV1 pending(String hash, Address token, String amount, String fee) {
        return new MemTransferDtoV1()
                .hash(hash)
                .from(WALLET.toChecksumAddress())
                .to(RECIPIENT)
                .tokenAddress(token.toChecksumAddress())
                .amount(amount)
                .fee(fee)
                .nonce(1L)
                .addedAt(OffsetDateTime.parse("2026-09-01T12:00:00Z"))
                .transferType(MemTransferDtoV1.TransferTypeEnum.TRANSFER);
    }

    private static MemTransferDtoV1Page pendingPage(List<MemTransferDtoV1> rows) {
        return new MemTransferDtoV1Page()._list(rows).totalElements((long) rows.size());
    }

    private static TransferDtoV1 confirmed(String hash, long height, long nonce) {
        return new TransferDtoV1()
                .txHash(hash)
                .blockHeight(height)
                .blockHash("0x" + "66".repeat(32))
                .timestamp(OffsetDateTime.parse("2026-09-01T12:00:00Z"))
                .type(TransferDtoV1.TypeEnum.TRANSFER)
                .from(WALLET.toChecksumAddress())
                .to(RECIPIENT)
                .tokenAddress(TOKEN.toChecksumAddress())
                .amount("7")
                .fee("3")
                .nonce(nonce);
    }

    private static TransferDtoV1 systemTransfer(TransferDtoV1.TypeEnum type, String from, String to,
            String tokenAddress) {
        return new TransferDtoV1()
                .txHash(null)
                .blockHeight(10L)
                .blockHash("0x" + "66".repeat(32))
                .timestamp(OffsetDateTime.parse("2026-09-01T12:00:00Z"))
                .type(type)
                .from(from)
                .to(to)
                .tokenAddress(tokenAddress)
                .amount("7")
                .fee(null)
                .nonce(null);
    }

    private static TransferDtoV1Page confirmedPage(List<TransferDtoV1> rows) {
        return new TransferDtoV1Page()._list(rows).totalElements((long) rows.size());
    }
}
