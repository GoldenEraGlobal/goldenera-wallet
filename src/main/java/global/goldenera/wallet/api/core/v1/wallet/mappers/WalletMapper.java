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
package global.goldenera.wallet.api.core.v1.wallet.mappers;

import java.math.BigInteger;
import java.time.Instant;
import java.time.OffsetDateTime;

import org.apache.tuweni.units.ethereum.Wei;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.Named;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.Hash;
import global.goldenera.wallet.api.core.v1.wallet.dtos.MempoolRecommendedFeesDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.MempoolRecommendedFeesLevelDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferDtoV1;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferDtoV1.TransferStatus;
import global.goldenera.wallet.api.core.v1.wallet.dtos.UnifiedTransferDtoV1.TransferType;
import global.goldenera.wallet.api.core.v1.wallet.dtos.WalletBalanceDtoV1;
import global.goldenera.wallet.client.node.model.v1.AccountBalanceDtoV1;
import global.goldenera.wallet.client.node.model.v1.FeeLevel;
import global.goldenera.wallet.client.node.model.v1.MemTransferDtoV1;
import global.goldenera.wallet.client.node.model.v1.RecommendedFeesDtoV1;
import global.goldenera.wallet.client.node.model.v1.TransferDtoV1;

/**
 * Mapper for wallet-related DTOs.
 */
@Mapper(componentModel = "spring")
public interface WalletMapper {

    /**
     * Map AccountBalanceDtoV1 to WalletBalanceDtoV1.
     */
    @Mapping(source = "address", target = "address", qualifiedByName = "stringToAddress")
    @Mapping(source = "tokenAddress", target = "tokenAddress", qualifiedByName = "stringToTokenAddress")
    @Mapping(source = "balance", target = "balance", qualifiedByName = "stringToWei")
    @Mapping(source = "updatedAtTimestamp", target = "updatedAtTimestamp", qualifiedByName = "offsetDateTimeToInstant")
    WalletBalanceDtoV1 toWalletBalance(AccountBalanceDtoV1 source);

    /**
     * Map MemTransferDtoV1 (pending) to UnifiedTransferDtoV1.
     */
    default UnifiedTransferDtoV1 toUnifiedTransfer(MemTransferDtoV1 source) {
        if (source == null) {
            return null;
        }
        return new UnifiedTransferDtoV1(
                TransferStatus.PENDING,
                stringToHash(source.getHash()),
                mapMemTransferType(source.getTransferType()),
                stringToAddress(source.getFrom()),
                stringToAddress(source.getTo()),
                stringToTokenAddress(source.getTokenAddress()),
                stringToWei(source.getAmount()),
                stringToWei(source.getFee()),
                source.getNonce(),
                source.getMessage(),
                offsetDateTimeToInstant(source.getAddedAt()),
                null,
                null,
                null);
    }

    /**
     * Map TransferDtoV1 (confirmed) to UnifiedTransferDtoV1 with confirmations.
     */
    default UnifiedTransferDtoV1 toUnifiedTransferWithConfirmations(TransferDtoV1 source, Long currentBlockHeight) {
        if (source == null) {
            return null;
        }
        Long confirmations = null;
        if (currentBlockHeight != null && source.getBlockHeight() != null) {
            confirmations = currentBlockHeight - source.getBlockHeight() + 1;
        }
        return new UnifiedTransferDtoV1(
                TransferStatus.CONFIRMED,
                stringToHash(source.getTxHash()),
                mapConfirmedTransferType(source.getType()),
                stringToAddress(source.getFrom()),
                stringToAddress(source.getTo()),
                stringToTokenAddress(source.getTokenAddress()),
                stringToWei(source.getAmount()),
                stringToWei(source.getFee()),
                source.getNonce(),
                source.getMessage(),
                offsetDateTimeToInstant(source.getTimestamp()),
                source.getBlockHeight(),
                stringToHash(source.getBlockHash()),
                confirmations);
    }

    @Named("stringToAddress")
    default Address stringToAddress(String value) {
        return value != null ? Address.fromHexString(value) : null;
    }

    /**
     * Converts a string to Address, returning Address.ZERO for null/empty values.
     * Use this for token addresses where null means native token.
     */
    @Named("stringToTokenAddress")
    default Address stringToTokenAddress(String value) {
        return value != null && !value.isEmpty() ? Address.fromHexString(value) : Address.ZERO;
    }

    @Named("stringToHash")
    default Hash stringToHash(String value) {
        return value != null ? Hash.fromHexString(value) : null;
    }

    @Named("stringToWei")
    default Wei stringToWei(String value) {
        return value != null && !value.isBlank() ? Wei.valueOf(new BigInteger(value)) : null;
    }

    @Named("offsetDateTimeToInstant")
    default Instant offsetDateTimeToInstant(OffsetDateTime value) {
        return value != null ? value.toInstant() : null;
    }

    default TransferType mapMemTransferType(MemTransferDtoV1.TransferTypeEnum type) {
        if (type == null)
            return null;
        return switch (type) {
            case TRANSFER -> TransferType.TRANSFER;
            case BLOCK_FEES -> TransferType.BLOCK_FEES;
            case BLOCK_REWARD -> TransferType.BLOCK_REWARD;
            case MINT -> TransferType.MINT;
            case BURN -> TransferType.BURN;
        };
    }

    default TransferType mapConfirmedTransferType(TransferDtoV1.TypeEnum type) {
        if (type == null)
            return null;
        return switch (type) {
            case TRANSFER -> TransferType.TRANSFER;
            case BLOCK_FEES -> TransferType.BLOCK_FEES;
            case BLOCK_REWARD -> TransferType.BLOCK_REWARD;
            case MINT -> TransferType.MINT;
            case BURN -> TransferType.BURN;
        };
    }

    /**
     * Map node TokenDtoV1 to wallet TokenDtoV1.
     */
    default global.goldenera.wallet.api.core.v1.wallet.dtos.TokenDtoV1 toToken(
            global.goldenera.wallet.client.node.model.v1.TokenDtoV1 source) {
        if (source == null) {
            return null;
        }
        return new global.goldenera.wallet.api.core.v1.wallet.dtos.TokenDtoV1(
                stringToAddress(source.getAddress()),
                source.getName(),
                source.getSmallestUnitName(),
                source.getNumberOfDecimals(),
                source.getWebsiteUrl(),
                source.getLogoUrl(),
                stringToWei(source.getMaxSupply()),
                source.getUserBurnable(),
                stringToHash(source.getOriginTxHash()),
                stringToWei(source.getTotalSupply()));
    }

    default MempoolRecommendedFeesLevelDtoV1 toMempoolRecommendedFeesLevelDtoV1(FeeLevel source) {
        if (source == null) {
            return null;
        }
        return new MempoolRecommendedFeesLevelDtoV1(
                source.getBaseFee(),
                source.getFeePerByte(),
                source.getTotalForAverageTx());
    }

    default MempoolRecommendedFeesDtoV1 toMempoolRecommendedFeesDtoV1(RecommendedFeesDtoV1 source) {
        if (source == null) {
            return null;
        }
        return new MempoolRecommendedFeesDtoV1(
                toMempoolRecommendedFeesLevelDtoV1(source.getSlow()),
                toMempoolRecommendedFeesLevelDtoV1(source.getStandard()),
                toMempoolRecommendedFeesLevelDtoV1(source.getFast()),
                source.getMempoolSize());
    }
}
