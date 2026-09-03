package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapper;
import global.goldenera.wallet.client.node.api.v1.BlockchainApiV1Api;
import global.goldenera.wallet.client.node.api.v1.MempoolApiV1Api;
import global.goldenera.wallet.client.node.model.v1.AccountSummaryDtoV1;
import global.goldenera.wallet.client.node.model.v1.BlockchainTxDtoV1;
import global.goldenera.wallet.client.node.model.v1.RecommendedFeesDtoV1;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.service.node.BlockchainNodeService;

class BlockchainNodeTransactionLookupTest {

    private static final String HASH = "0x" + "11".repeat(32);
    private static final Address SENDER = Address.fromHexString("0x" + "22".repeat(20));

    private BlockchainApiV1Api blockchainApi;
    private MempoolApiV1Api mempoolApi;
    private BlockchainNodeService service;

    @BeforeEach
    void setUp() {
        blockchainApi = mock(BlockchainApiV1Api.class);
        mempoolApi = mock(MempoolApiV1Api.class);
        service = new BlockchainNodeService(blockchainApi, mempoolApi, mock(WalletMapper.class));
    }

    @AfterEach
    void neverSubmitsWhileLookingUpTransactions() {
        verify(mempoolApi, never()).submitTx(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void exactNotFoundIsTheOnlyResponseConvertedToAbsence() {
        when(blockchainApi.getTransactionByHash(HASH)).thenThrow(notFound());
        when(mempoolApi.getMempoolTransactionByHash(HASH)).thenThrow(notFound());

        assertThat(service.findBlockchainTransactionByHash(HASH)).isEmpty();
        assertThat(service.findMempoolTransactionByHash(HASH)).isEmpty();
    }

    @Test
    void directExactNotFoundResponsesAreAlsoAbsence() {
        when(blockchainApi.getTransactionByHash(HASH)).thenReturn(
                ResponseEntity.status(HttpStatus.NOT_FOUND).build());
        when(mempoolApi.getMempoolTransactionByHash(HASH)).thenReturn(
                ResponseEntity.status(HttpStatus.NOT_FOUND).build());

        assertThat(service.findBlockchainTransactionByHash(HASH)).isEmpty();
        assertThat(service.findMempoolTransactionByHash(HASH)).isEmpty();
    }

    @Test
    void bodyBearingNonOkResponsesAreIndeterminateFailures() {
        BlockchainTxDtoV1 transaction = new BlockchainTxDtoV1();
        AccountSummaryDtoV1 summary = new AccountSummaryDtoV1().address(SENDER.toHexString()).nextNonce(5L);
        when(blockchainApi.getTransactionByHash(HASH)).thenReturn(
                ResponseEntity.status(HttpStatus.PARTIAL_CONTENT).body(transaction));
        when(mempoolApi.getMempoolTransactionByHash(HASH)).thenReturn(
                ResponseEntity.status(HttpStatus.PARTIAL_CONTENT).body(transaction));
        when(blockchainApi.getAccountSummary(SENDER.toChecksumAddress(), null)).thenReturn(
                ResponseEntity.status(HttpStatus.PARTIAL_CONTENT).body(summary));
        when(blockchainApi.getTransactionConfirmations(HASH)).thenReturn(
                ResponseEntity.status(HttpStatus.PARTIAL_CONTENT).body(1L));
        when(mempoolApi.getRecommendedFees()).thenReturn(
                ResponseEntity.status(HttpStatus.PARTIAL_CONTENT).body(new RecommendedFeesDtoV1()));

        assertThatThrownBy(() -> service.findBlockchainTransactionByHash(HASH))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.findMempoolTransactionByHash(HASH))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.getAccountSummaryForObservation(SENDER))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.getTransactionConfirmationsForObservation(HASH))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.getMempoolRecommendedFees())
                .isInstanceOf(GEFailedException.class);
    }

    @Test
    void nullSuccessfulBodiesAreIndeterminateFailures() {
        when(blockchainApi.getTransactionByHash(HASH)).thenReturn(ResponseEntity.ok(null));
        when(mempoolApi.getMempoolTransactionByHash(HASH)).thenReturn(ResponseEntity.ok(null));
        when(blockchainApi.getAccountSummary(SENDER.toChecksumAddress(), null)).thenReturn(ResponseEntity.ok(null));
        when(blockchainApi.getTransactionConfirmations(HASH)).thenReturn(ResponseEntity.ok(null));
        when(mempoolApi.getRecommendedFees()).thenReturn(ResponseEntity.ok(null));

        assertThatThrownBy(() -> service.findBlockchainTransactionByHash(HASH))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.findMempoolTransactionByHash(HASH))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.getAccountSummaryForObservation(SENDER))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.getTransactionConfirmationsForObservation(HASH))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.getMempoolRecommendedFees())
                .isInstanceOf(GEFailedException.class);
    }

    @Test
    void serverAndTransportFailuresNeverBecomeAbsence() {
        when(blockchainApi.getTransactionByHash(HASH)).thenThrow(HttpServerErrorException.create(
                HttpStatus.SERVICE_UNAVAILABLE, "unavailable", HttpHeaders.EMPTY, new byte[0],
                StandardCharsets.UTF_8));
        when(mempoolApi.getMempoolTransactionByHash(HASH))
                .thenThrow(new ResourceAccessException("timeout"));

        assertThatThrownBy(() -> service.findBlockchainTransactionByHash(HASH))
                .isInstanceOf(HttpServerErrorException.class);
        assertThatThrownBy(() -> service.findMempoolTransactionByHash(HASH))
                .isInstanceOf(ResourceAccessException.class);
    }

    @Test
    void nonPositiveConfirmationCountsAreIndeterminateFailures() {
        when(blockchainApi.getTransactionConfirmations(HASH))
                .thenReturn(ResponseEntity.ok(0L), ResponseEntity.ok(-1L));

        assertThatThrownBy(() -> service.getTransactionConfirmationsForObservation(HASH))
                .isInstanceOf(GEFailedException.class);
        assertThatThrownBy(() -> service.getTransactionConfirmationsForObservation(HASH))
                .isInstanceOf(GEFailedException.class);
    }

    @Test
    void validBodiesAreReturnedWithoutMutation() {
        BlockchainTxDtoV1 transaction = new BlockchainTxDtoV1();
        AccountSummaryDtoV1 summary = new AccountSummaryDtoV1().address(SENDER.toHexString()).nextNonce(5L);
        when(blockchainApi.getTransactionByHash(HASH)).thenReturn(ResponseEntity.ok(transaction));
        when(mempoolApi.getMempoolTransactionByHash(HASH)).thenReturn(ResponseEntity.ok(transaction));
        RecommendedFeesDtoV1 fees = new RecommendedFeesDtoV1();
        when(blockchainApi.getAccountSummary(SENDER.toChecksumAddress(), null)).thenReturn(ResponseEntity.ok(summary));
        when(blockchainApi.getTransactionConfirmations(HASH)).thenReturn(ResponseEntity.ok(6L));
        when(mempoolApi.getRecommendedFees()).thenReturn(ResponseEntity.ok(fees));

        assertThat(service.findBlockchainTransactionByHash(HASH)).containsSame(transaction);
        assertThat(service.findMempoolTransactionByHash(HASH)).containsSame(transaction);
        assertThat(service.getAccountSummaryForObservation(SENDER)).isSameAs(summary);
        assertThat(service.getTransactionConfirmationsForObservation(HASH)).isEqualTo(6L);
        assertThat(service.getMempoolRecommendedFees()).isSameAs(fees);
    }

    private static HttpClientErrorException notFound() {
        return HttpClientErrorException.create(HttpStatus.NOT_FOUND, "not found", HttpHeaders.EMPTY,
                new byte[0], StandardCharsets.UTF_8);
    }
}
