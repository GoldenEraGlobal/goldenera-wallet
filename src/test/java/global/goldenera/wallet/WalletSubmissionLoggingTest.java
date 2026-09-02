package global.goldenera.wallet;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import global.goldenera.wallet.api.core.v1.wallet.WalletApiV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TxSubmitDtoV1;
import global.goldenera.wallet.client.node.model.v1.MempoolResult;
import global.goldenera.wallet.service.business.WalletBusinessService;

class WalletSubmissionLoggingTest {

    private static final String SIGNED_HEX_MARKER = "0x" + "deadbeef".repeat(64);

    private Logger walletLogger;
    private Level previousLevel;
    private ListAppender<ILoggingEvent> logCapture;

    @BeforeEach
    void captureWalletApiLogs() {
        walletLogger = (Logger) LoggerFactory.getLogger(WalletApiV1.class);
        previousLevel = walletLogger.getLevel();
        walletLogger.setLevel(Level.DEBUG);
        logCapture = new ListAppender<>();
        logCapture.start();
        walletLogger.addAppender(logCapture);
    }

    @AfterEach
    void restoreWalletApiLogs() {
        walletLogger.detachAppender(logCapture);
        logCapture.stop();
        walletLogger.setLevel(previousLevel);
    }

    @Test
    void submissionDebugLogDoesNotContainSignedTransactionPayload() {
        WalletBusinessService service = mock(WalletBusinessService.class);
        MempoolResult accepted = new MempoolResult().message("accepted");
        when(service.submitTransaction(SIGNED_HEX_MARKER)).thenReturn(accepted);

        assertThat(walletLogger.isDebugEnabled()).isTrue();
        MempoolResult result = new WalletApiV1(service)
                .submitTransaction(new TxSubmitDtoV1(SIGNED_HEX_MARKER));

        assertThat(result).isSameAs(accepted);
        verify(service).submitTransaction(SIGNED_HEX_MARKER);
        assertThat(logCapture.list)
                .extracting(ILoggingEvent::getFormattedMessage)
                .contains("Submitting transaction")
                .allSatisfy(message -> assertThat(message)
                        .doesNotContain(SIGNED_HEX_MARKER)
                        .doesNotContain("TxSubmitDtoV1")
                        .doesNotContain("hexData"));
    }
}
