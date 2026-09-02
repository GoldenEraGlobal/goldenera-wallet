package global.goldenera.wallet;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigInteger;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import global.goldenera.wallet.api.core.v1.wallet.WalletApiV1;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapper;
import global.goldenera.wallet.client.node.model.v1.FeeLevel;
import global.goldenera.wallet.client.node.model.v1.RecommendedFeesDtoV1;
import global.goldenera.wallet.config.ExceptionHandlerConfig;
import global.goldenera.wallet.service.business.WalletBusinessService;
import global.goldenera.wallet.service.node.BlockchainNodeService;
import global.goldenera.wallet.service.node.ExplorerNodeService;
import global.goldenera.wallet.service.system.ApiErrorResponseWriter;
import tools.jackson.databind.json.JsonMapper;

class WalletRecommendedFeesApiTest {

    private static final String PATH = "/api/core/v1/wallet/mempool-recommended-fees";

    private BlockchainNodeService node;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        node = mock(BlockchainNodeService.class);
        WalletMapper mapper = new WalletMapper() { };
        WalletBusinessService service = new WalletBusinessService(
                mock(ExplorerNodeService.class), node, mapper);
        ApiErrorResponseWriter apiErrors = new ApiErrorResponseWriter(JsonMapper.builder().build());
        mvc = MockMvcBuilders.standaloneSetup(new WalletApiV1(service))
                .setControllerAdvice(new ExceptionHandlerConfig(apiErrors))
                .build();
    }

    @Test
    void returnsOnlyCanonicalUint256FeeStrings() throws Exception {
        String maximum = BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE).toString();
        when(node.getMempoolRecommendedFees()).thenReturn(recommended(feeLevel(maximum, maximum, maximum)));

        mvc.perform(get(PATH))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slow.baseFee").value(maximum))
                .andExpect(jsonPath("$.standard.feePerByte").value(maximum))
                .andExpect(jsonPath("$.fast.totalForAverageTx").value(maximum))
                .andExpect(jsonPath("$.mempoolSize").value("0"));
    }

    @Test
    void malformedOrMissingNodeFeeFieldsNeverReachTheApiContract() throws Exception {
        String overflow = BigInteger.ONE.shiftLeft(256).toString();
        FeeLevel valid = feeLevel("1", "2", "3");
        List<RecommendedFeesDtoV1> invalid = List.of(
                recommended(feeLevel("01", "2", "3")),
                new RecommendedFeesDtoV1()
                        .slow(valid)
                        .standard(feeLevel("1", "-2", "3"))
                        .fast(valid)
                        .mempoolSize(0L),
                new RecommendedFeesDtoV1()
                        .slow(valid)
                        .standard(valid)
                        .fast(feeLevel("1", "2", null))
                        .mempoolSize(0L),
                recommended(feeLevel(overflow, "2", "3")),
                new RecommendedFeesDtoV1()
                        .slow(valid)
                        .standard(null)
                        .fast(valid)
                        .mempoolSize(0L),
                new RecommendedFeesDtoV1()
                        .slow(valid)
                        .standard(valid)
                        .fast(valid)
                        .mempoolSize(null));

        for (RecommendedFeesDtoV1 response : invalid) {
            when(node.getMempoolRecommendedFees()).thenReturn(response);
            mvc.perform(get(PATH))
                    .andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                    .andExpect(jsonPath("$.message").value("An internal error occurred."));
        }
    }

    private static RecommendedFeesDtoV1 recommended(FeeLevel level) {
        return new RecommendedFeesDtoV1()
                .slow(level)
                .standard(level)
                .fast(level)
                .mempoolSize(0L);
    }

    private static FeeLevel feeLevel(String baseFee, String feePerByte, String totalForAverageTx) {
        return new FeeLevel()
                .baseFee(baseFee)
                .feePerByte(feePerByte)
                .totalForAverageTx(totalForAverageTx);
    }
}
