package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TransactionStatusDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TransactionStatusDtoV1.Status;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapper;
import global.goldenera.wallet.client.node.model.v1.AccountSummaryDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainTxDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainTxMetadataDtoV1;
import global.goldenera.wallet.client.node.model.v1.TxDtoV1;
import global.goldenera.wallet.exceptions.GEValidationException;
import global.goldenera.wallet.service.business.WalletBusinessService;
import global.goldenera.wallet.service.node.BlockchainNodeService;
import global.goldenera.wallet.service.node.ExplorerNodeService;

class WalletTransactionStatusTest {

    private static final String HASH = "0x" + "11".repeat(32);
    private static final String OTHER_HASH = "0x" + "33".repeat(32);
    private static final String SENDER = "0x" + "22".repeat(20);
    private static final Address SENDER_ADDRESS = Address.fromHexString(SENDER);
    private static final long NONCE = 5L;

    private ExplorerNodeService explorer;
    private BlockchainNodeService node;
    private WalletBusinessService service;

    @BeforeEach
    void setUp() {
        explorer = mock(ExplorerNodeService.class);
        node = mock(BlockchainNodeService.class);
        service = new WalletBusinessService(explorer, node, mock(WalletMapper.class));
    }

    @AfterEach
    void neverSubmitsOrUsesExplorerProjectionsWhileObserving() {
        verify(node, never()).submitTransaction(any());
        verifyNoInteractions(explorer);
    }

    @Test
    void returnsConfirmedOnlyAfterTwoStableCanonicalObservations() {
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.of(confirmed), Optional.of(confirmed));
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE + 1));
        when(node.getTransactionConfirmationsForObservation(HASH)).thenReturn(6L, 6L);

        TransactionStatusDtoV1 result = service.getTransactionStatus(HASH, SENDER_ADDRESS, "5");

        assertStatus(result, Status.CONFIRMED, "6");
        verify(node, org.mockito.Mockito.times(2)).findBlockchainTransactionByHash(HASH);
        verify(node, org.mockito.Mockito.times(2)).findMempoolTransactionByHash(HASH);
        verify(node, org.mockito.Mockito.times(2)).getAccountSummaryForObservation(SENDER_ADDRESS);
        verify(node, org.mockito.Mockito.times(2)).getTransactionConfirmationsForObservation(HASH);
    }

    @Test
    void reportsShallowCanonicalInclusionAsReorgSafeConfirming() {
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.of(confirmed), Optional.of(confirmed));
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE + 1));
        when(node.getTransactionConfirmationsForObservation(HASH)).thenReturn(1L, 2L);

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"),
                Status.CONFIRMING, "6", "2");
    }

    @Test
    void shallowInclusionCanReconcileBackToStableAbsenceAfterAReorg() {
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.of(confirmed), Optional.empty(), Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty(), Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE), summary(NONCE));
        when(node.getTransactionConfirmationsForObservation(HASH)).thenReturn(1L);

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"),
                Status.ABSENT_REUSABLE, "5");
    }

    @Test
    void returnsPendingOnlyAfterTwoStableCanonicalObservations() {
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.of(pending), Optional.of(pending));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.PENDING, "6");
    }

    @Test
    void acceptsAStablePendingToConfirmedHandoff() {
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.of(confirmed), Optional.of(confirmed));
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.of(pending), Optional.of(pending), Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE + 1), summary(NONCE + 1));
        when(node.getTransactionConfirmationsForObservation(HASH)).thenReturn(6L, 6L);

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.CONFIRMED, "6");
    }

    @Test
    void reusesNonceOnlyAfterStableDualAbsenceAndExactNonceEquality() {
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE), summary(NONCE));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.ABSENT_REUSABLE, "5");
    }

    @Test
    void lowerAccountNonceBlocksImmediately() {
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(summary(NONCE - 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, "4");
    }

    @Test
    void stableAdvancedAccountNonceMarksTheAbsentOriginalConsumedOrSuperseded() {
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"),
                Status.CONSUMED_SUPERSEDED, "6");
    }

    @Test
    void futureNonceTransactionRemainsPendingWhenNextNoncePointsToAnEarlierGap() {
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.of(pending), Optional.of(pending));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE - 1), summary(NONCE - 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.PENDING, "4");
    }

    @Test
    void exactPendingEvidenceIsAuthoritativeForEveryRepresentableNextNonce() {
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        for (long nextNonce : List.of(0L, NONCE - 1, NONCE, NONCE + 1, Long.MAX_VALUE)) {
            BlockchainNodeService caseNode = mock(BlockchainNodeService.class);
            WalletBusinessService caseService = new WalletBusinessService(
                    explorer, caseNode, mock(WalletMapper.class));
            when(caseNode.findBlockchainTransactionByHash(HASH)).thenReturn(
                    Optional.empty(), Optional.empty());
            when(caseNode.findMempoolTransactionByHash(HASH)).thenReturn(
                    Optional.of(pending), Optional.of(pending));
            when(caseNode.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                    summary(nextNonce), summary(nextNonce));

            assertStatus(caseService.getTransactionStatus(HASH, SENDER_ADDRESS, "5"),
                    Status.PENDING, Long.toString(nextNonce));
            verify(caseNode, never()).submitTransaction(any());
        }
    }

    @Test
    void exactConfirmedEvidenceIsAuthoritativeForEveryRepresentableNextNonce() {
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        for (long nextNonce : List.of(0L, NONCE - 1, NONCE, NONCE + 1, Long.MAX_VALUE)) {
            BlockchainNodeService caseNode = mock(BlockchainNodeService.class);
            WalletBusinessService caseService = new WalletBusinessService(
                    explorer, caseNode, mock(WalletMapper.class));
            when(caseNode.findBlockchainTransactionByHash(HASH)).thenReturn(
                    Optional.of(confirmed), Optional.of(confirmed));
            when(caseNode.findMempoolTransactionByHash(HASH)).thenReturn(
                    Optional.empty(), Optional.empty());
            when(caseNode.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                    summary(nextNonce), summary(nextNonce));
            when(caseNode.getTransactionConfirmationsForObservation(HASH)).thenReturn(6L, 6L);

            assertStatus(caseService.getTransactionStatus(HASH, SENDER_ADDRESS, "5"),
                    Status.CONFIRMED, Long.toString(nextNonce));
            verify(caseNode, never()).submitTransaction(any());
        }
    }

    @Test
    void accountSummaryMustCarryTheRequestedSenderIdentity() {
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                new AccountSummaryDtoV1().nextNonce(NONCE));
        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);

        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                new AccountSummaryDtoV1()
                        .address("0x" + "99".repeat(20))
                        .nextNonce(NONCE));
        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);
    }

    @Test
    void malformedOrMismatchedTransactionIdentityBlocks() {
        BlockchainTxDtoV1 wrongHash = transaction(OTHER_HASH, SENDER, NONCE, null);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.of(wrongHash));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);
    }

    @Test
    void conflictingDuplicateMetadataBlocks() {
        BlockchainTxDtoV1 transaction = transaction(HASH, SENDER, NONCE, 100L);
        transaction.getMetadata().setHash(OTHER_HASH);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.of(transaction));
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);
    }

    @Test
    void conflictingPendingAndConfirmedTransactionCoresBlock() {
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        pending.getTx().setAmount("2");
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.of(confirmed));
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.of(pending));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);
    }

    @Test
    void conflictingMetadataAcrossPendingAndConfirmedSourcesBlocks() {
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        pending.getMetadata().setSize(101);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.of(confirmed));
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.of(pending));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);
    }

    @Test
    void productionShapedMetadataProvidesIdentityWhenCoreFieldsAreAbsent() {
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        assertThat(pending.getTx().getHash()).isNull();
        assertThat(pending.getTx().getSender()).isNull();
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.of(pending), Optional.of(pending));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.PENDING, "6");
    }

    @Test
    void nullAndEmptyTransactionFieldsRemainDistinct() {
        BlockchainTxDtoV1 confirmed = transaction(HASH, SENDER, NONCE, 100L);
        BlockchainTxDtoV1 pending = transaction(HASH, SENDER, NONCE, null);
        pending.getTx().setMessage("");
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.of(confirmed));
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.of(pending));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);
    }

    @Test
    void unstableObservationsExhaustTheBoundAndRemainBlocked() {
        BlockchainTxDtoV1 first = transaction(HASH, SENDER, NONCE, null);
        BlockchainTxDtoV1 second = transaction(HASH, SENDER, NONCE, null);
        BlockchainTxDtoV1 third = transaction(HASH, SENDER, NONCE, null);
        first.getMetadata().setSize(101);
        second.getMetadata().setSize(102);
        third.getMetadata().setSize(103);
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(
                Optional.empty(), Optional.empty(), Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(
                Optional.of(first), Optional.of(second), Optional.of(third));
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(
                summary(NONCE + 1), summary(NONCE + 1), summary(NONCE + 1));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, "6");
        verify(node, org.mockito.Mockito.times(3)).findMempoolTransactionByHash(HASH);
    }

    @Test
    void interruptedStatusObservationCancelsItsPhysicalNodeCall() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch cancelled = new CountDownLatch(1);
        AtomicReference<TransactionStatusDtoV1> result = new AtomicReference<>();
        when(node.findBlockchainTransactionByHash(HASH)).thenAnswer(invocation -> {
            started.countDown();
            try {
                new CountDownLatch(1).await();
                throw new AssertionError("unreachable");
            } catch (InterruptedException exception) {
                cancelled.countDown();
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted node call");
            }
        });

        Thread request = Thread.ofVirtual().start(() ->
                result.set(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5")));
        assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
        request.interrupt();
        request.join(2_000);

        assertThat(request.isAlive()).isFalse();
        assertThat(cancelled.await(2, TimeUnit.SECONDS)).isTrue();
        assertStatus(result.get(), Status.BLOCKED_UNKNOWN, null);
    }

    @Test
    void anyUpstreamFailureRemainsBlockedAndIsNeverRetriedAsSubmission() {
        when(node.findBlockchainTransactionByHash(HASH)).thenThrow(new IllegalStateException("timeout"));

        assertStatus(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"), Status.BLOCKED_UNKNOWN, null);
        verify(node, never()).findMempoolTransactionByHash(HASH);
        verify(node, never()).getAccountSummaryForObservation(SENDER_ADDRESS);
    }

    @Test
    void acceptsMaximumUint256NonceWithoutNarrowingItToNodeLongIdentity() {
        String maximum = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE).toString();
        when(node.findBlockchainTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.findMempoolTransactionByHash(HASH)).thenReturn(Optional.empty());
        when(node.getAccountSummaryForObservation(SENDER_ADDRESS)).thenReturn(summary(0L));

        TransactionStatusDtoV1 result = service.getTransactionStatus(HASH, SENDER_ADDRESS, maximum);

        assertThat(result.status()).isEqualTo(Status.BLOCKED_UNKNOWN);
        assertThat(result.hash()).isEqualTo(HASH);
        assertThat(result.sender()).isEqualTo(SENDER);
        assertThat(result.nonce()).isEqualTo(maximum);
        assertThat(result.nextNonce()).isEqualTo("0");
        assertThat(result.confirmations()).isNull();
        assertThat(result.requiredConfirmations()).isEqualTo("6");
    }

    @Test
    void rejectsNonCanonicalInputsBeforeAnyNodeObservation() {
        String overflow = BigInteger.ONE.shiftLeft(256).toString();
        assertThatThrownBy(() -> service.getTransactionStatus("0x" + "AA".repeat(32), SENDER_ADDRESS, "5"))
                .isInstanceOf(GEValidationException.class);
        assertThatThrownBy(() -> service.getTransactionStatus(HASH, null, "5"))
                .isInstanceOf(GEValidationException.class);
        assertThatThrownBy(() -> service.getTransactionStatus(HASH, SENDER_ADDRESS, "05"))
                .isInstanceOf(GEValidationException.class);
        assertThatThrownBy(() -> service.getTransactionStatus(HASH, SENDER_ADDRESS, overflow))
                .isInstanceOf(GEValidationException.class);
        assertThatThrownBy(() -> service.getTransactionStatus(HASH, SENDER_ADDRESS, "1".repeat(79)))
                .isInstanceOf(GEValidationException.class);

        verifyNoInteractions(node);
    }

    private static void assertStatus(TransactionStatusDtoV1 result, Status status, String nextNonce) {
        assertStatus(result, status, nextNonce, status == Status.CONFIRMED ? "6" : null);
    }

    private static void assertStatus(TransactionStatusDtoV1 result, Status status, String nextNonce,
            String confirmations) {
        assertThat(result.status()).isEqualTo(status);
        assertThat(result.hash()).isEqualTo(HASH);
        assertThat(result.sender()).isEqualTo(SENDER);
        assertThat(result.nonce()).isEqualTo("5");
        assertThat(result.nextNonce()).isEqualTo(nextNonce);
        assertThat(result.confirmations()).isEqualTo(confirmations);
        assertThat(result.requiredConfirmations()).isEqualTo("6");
    }

    private static AccountSummaryDtoV1 summary(long nextNonce) {
        return new AccountSummaryDtoV1().address(SENDER).nextNonce(nextNonce);
    }

    private static BlockchainTxDtoV1 transaction(String hash, String sender, long nonce, Long blockHeight) {
        TxDtoV1 tx = new TxDtoV1()
                .nonce(nonce)
                .recipient("0x" + "44".repeat(20))
                .amount("1")
                .fee("1");
        BlockchainTxMetadataDtoV1 metadata = new BlockchainTxMetadataDtoV1()
                .hash(hash)
                .sender(sender)
                .size(100);
        if (blockHeight != null) {
            metadata.blockHeight(blockHeight)
                    .index(0)
                    .blockHash("0x" + "55".repeat(32))
                    .blockTimestamp(OffsetDateTime.parse("2026-09-01T12:00:00Z"));
        }
        return new BlockchainTxDtoV1().tx(tx).metadata(metadata);
    }
}
