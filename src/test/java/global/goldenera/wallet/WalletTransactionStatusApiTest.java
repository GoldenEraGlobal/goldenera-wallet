package global.goldenera.wallet;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.format.support.DefaultFormattingConversionService;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.api.core.v1.wallet.WalletApiV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TransactionStatusDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TransactionStatusDtoV1.Status;
import global.goldenera.wallet.config.ExceptionHandlerConfig;
import global.goldenera.wallet.config.WebConfig;
import global.goldenera.wallet.exceptions.GEValidationException;
import global.goldenera.wallet.service.business.WalletBusinessService;
import global.goldenera.wallet.service.system.ApiErrorResponseWriter;
import tools.jackson.databind.json.JsonMapper;

class WalletTransactionStatusApiTest {

    private static final String PATH = "/api/core/v1/wallet/transaction-status";
    private static final String HASH = "0x" + "11".repeat(32);
    private static final String SENDER = "0x" + "22".repeat(20);
    private static final Address SENDER_ADDRESS = Address.fromHexString(SENDER);

    private WalletBusinessService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(WalletBusinessService.class);
        ApiErrorResponseWriter apiErrors = new ApiErrorResponseWriter(JsonMapper.builder().build());
        DefaultFormattingConversionService conversionService = new DefaultFormattingConversionService();
        new WebConfig().addFormatters(conversionService);
        mvc = MockMvcBuilders.standaloneSetup(new WalletApiV1(service))
                .setConversionService(conversionService)
                .setControllerAdvice(new ExceptionHandlerConfig(apiErrors))
                .build();
    }

    @Test
    void returnsCanonicalObservationalStatusWithoutSubmissionData() throws Exception {
        when(service.getTransactionStatus(HASH, SENDER_ADDRESS, "5"))
                .thenReturn(new TransactionStatusDtoV1(
                        Status.CONFIRMING, HASH, SENDER, "5", "6", "2", "6"));

        mvc.perform(get(PATH).param("hash", HASH).param("sender", SENDER).param("nonce", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CONFIRMING"))
                .andExpect(jsonPath("$.hash").value(HASH))
                .andExpect(jsonPath("$.sender").value(SENDER))
                .andExpect(jsonPath("$.nonce").value("5"))
                .andExpect(jsonPath("$.nextNonce").value("6"))
                .andExpect(jsonPath("$.confirmations").value("2"))
                .andExpect(jsonPath("$.requiredConfirmations").value("6"))
                .andExpect(jsonPath("$.hexData").doesNotExist());

        verify(service).getTransactionStatus(HASH, SENDER_ADDRESS, "5");
    }

    @Test
    void invalidCanonicalHashAndNonceReturnTypedBadRequests() throws Exception {
        String invalidHash = "0x" + "AA".repeat(32);
        when(service.getTransactionStatus(invalidHash, SENDER_ADDRESS, "5"))
                .thenThrow(new GEValidationException("invalid hash"));
        when(service.getTransactionStatus(HASH, SENDER_ADDRESS, "05"))
                .thenThrow(new GEValidationException("invalid nonce"));

        mvc.perform(get(PATH).param("hash", invalidHash).param("sender", SENDER).param("nonce", "5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mvc.perform(get(PATH).param("hash", HASH).param("sender", SENDER).param("nonce", "05"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void invalidOrMissingSenderReturnsTypedBadRequest() throws Exception {
        mvc.perform(get(PATH).param("hash", HASH).param("sender", "not-an-address").param("nonce", "5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
        mvc.perform(get(PATH).param("hash", HASH).param("nonce", "5"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MISSING_PARAMETER"));
    }
}
