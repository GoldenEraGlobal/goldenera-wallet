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

import static lombok.AccessLevel.PRIVATE;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.api.core.v1.wallet.dtos.TokenDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapper;
import global.goldenera.wallet.client.node.api.v1.BlockchainApiV1Api;
import global.goldenera.wallet.client.node.api.v1.MempoolApiV1Api;
import global.goldenera.wallet.client.node.model.v1.AccountSummaryDtoV1;
import global.goldenera.wallet.client.node.model.v1.MempoolResult;
import global.goldenera.wallet.client.node.model.v1.MempoolSubmitTxDtoV1;
import global.goldenera.wallet.client.node.model.v1.RecommendedFeesDtoV1;
import global.goldenera.wallet.client.node.model.v1.TokenStateDtoV1;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

/**
 * Service layer for Blockchain API with caching and retry support.
 * Wraps the generated BlockchainApiV1Api client interface.
 */
@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class BlockchainNodeService {

    BlockchainApiV1Api blockchainApi;
    MempoolApiV1Api mempoolApi;
    WalletMapper walletMapper;

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public Long getLatestBlockHeight() {
        return blockchainApi.getLatestBlockHeight().getBody();
    }

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public AccountSummaryDtoV1 getAccountSummary(Address address, Address tokenAddress) {
        return blockchainApi.getAccountSummary(address.toChecksumAddress(),
                tokenAddress == null ? null : tokenAddress.toChecksumAddress()).getBody();
    }

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public RecommendedFeesDtoV1 getMempoolRecommendedFees() {
        return mempoolApi.getRecommendedFees().getBody();
    }

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public List<TokenDtoV1> getAllTokens() {
        Map<String, TokenStateDtoV1> tokens = blockchainApi.getAllTokens().getBody();
        List<TokenDtoV1> result = new ArrayList<>();
        for (Map.Entry<String, TokenStateDtoV1> entry : tokens.entrySet()) {
            TokenStateDtoV1 token = entry.getValue();
            result.add(new TokenDtoV1(
                    Address.fromHexString(entry.getKey()),
                    token.getName(),
                    token.getSmallestUnitName(),
                    token.getNumberOfDecimals(),
                    token.getWebsiteUrl(),
                    token.getLogoUrl(),
                    walletMapper.stringToWei(token.getMaxSupply()),
                    token.getUserBurnable(),
                    walletMapper.stringToHash(token.getOriginTxHash()),
                    walletMapper.stringToWei(token.getTotalSupply())));
        }
        return result;
    }

    @Retryable(retryFor = ResourceAccessException.class, maxAttempts = 3, backoff = @Backoff(delay = 500))
    public MempoolResult submitTransaction(String hexData) {
        return mempoolApi.submitTx(new MempoolSubmitTxDtoV1().rawTxDataInHex(hexData)).getBody();
    }
}
