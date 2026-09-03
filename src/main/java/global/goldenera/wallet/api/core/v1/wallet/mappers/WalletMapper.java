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
import global.goldenera.wallet.exceptions.GEFailedException;

/**
 * Mapper for wallet-related DTOs.
 */
@Mapper(componentModel = "spring")
public interface WalletMapper {

    /**
     * Map AccountBalanceDtoV1 to WalletBalanceDtoV1.
     */
    default WalletBalanceDtoV1 toWalletBalance(AccountBalanceDtoV1 source) {
        if (source == null) {
            return null;
        }
        Wei total = stringToWei(source.getBalance());
        if (source.getVersion() == null) {
            throw new GEFailedException("Node returned an account balance without a version");
        }
        boolean legacy = source.getVersion() == AccountBalanceDtoV1.VersionEnum.V1;
        if (!legacy && (source.getLockedMiningReward() == null || source.getSpendableBalance() == null)) {
            throw new GEFailedException("Node returned an incomplete V2 account balance");
        }
        Wei locked = source.getLockedMiningReward() == null ? Wei.ZERO : stringToWei(source.getLockedMiningReward());
        if (total == null || locked == null || locked.compareTo(total) > 0) {
            throw new GEFailedException("Node returned an invalid account balance");
        }
        Wei unlocked = total.subtract(locked);
        Wei spendable = source.getSpendableBalance() == null ? unlocked : stringToWei(source.getSpendableBalance());
        if (spendable == null || spendable.compareTo(unlocked) > 0) {
            throw new GEFailedException("Node returned an invalid spendable balance");
        }
        return new WalletBalanceDtoV1(stringToAddress(source.getAddress()), stringToTokenAddress(source.getTokenAddress()),
                spendable, nonNegativeLongToString(source.getUpdatedAtBlockHeight(), "balance block height"),
                offsetDateTimeToInstant(source.getUpdatedAtTimestamp()), total, locked, spendable);
    }

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
                nonNegativeLongToString(source.getNonce(), "transaction nonce"),
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
        String blockHeight = nonNegativeLongToString(source.getBlockHeight(), "confirmed block height");
        String confirmations = null;
        if (currentBlockHeight != null && source.getBlockHeight() != null) {
            if (currentBlockHeight < source.getBlockHeight()) {
                throw new GEFailedException("Node returned a block height older than a confirmed transfer");
            }
            confirmations = BigInteger.valueOf(currentBlockHeight)
                    .subtract(BigInteger.valueOf(source.getBlockHeight()))
                    .add(BigInteger.ONE)
                    .toString();
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
                nonNegativeLongToString(source.getNonce(), "transaction nonce"),
                source.getMessage(),
                offsetDateTimeToInstant(source.getTimestamp()),
                blockHeight,
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

    default String nonNegativeLongToString(Long value, String field) {
        if (value == null) {
            return null;
        }
        if (value < 0) {
            throw new GEFailedException("Node returned a negative " + field);
        }
        return value.toString();
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
            throw new GEFailedException("Node returned a missing recommended fee level");
        }
        return new MempoolRecommendedFeesLevelDtoV1(
                requiredCanonicalUint256(source.getBaseFee(), "recommended base fee"),
                requiredCanonicalUint256(source.getFeePerByte(), "recommended fee per byte"),
                requiredCanonicalUint256(source.getMinimumTotalFee(), "recommended minimum total fee"),
                requiredCanonicalUint256(source.getMiningFeePerByte(), "recommended mining fee per byte"),
                requiredCanonicalUint256(source.getTotalForAverageTx(), "recommended average transaction fee"));
    }

    default MempoolRecommendedFeesDtoV1 toMempoolRecommendedFeesDtoV1(RecommendedFeesDtoV1 source) {
        if (source == null) {
            throw new GEFailedException("Node returned missing recommended fees");
        }
        return new MempoolRecommendedFeesDtoV1(
                toMempoolRecommendedFeesLevelDtoV1(source.getSlow()),
                toMempoolRecommendedFeesLevelDtoV1(source.getStandard()),
                toMempoolRecommendedFeesLevelDtoV1(source.getFast()),
                requiredNonNegativeLongToString(source.getMempoolSize(), "mempool size"));
    }

    default String requiredCanonicalUint256(String value, String field) {
        if (value == null || value.length() > 78 || !value.matches("^(0|[1-9][0-9]*)$")) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        BigInteger parsed = new BigInteger(value);
        if (parsed.compareTo(BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE)) > 0) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        return value;
    }

    default String requiredNonNegativeLongToString(Long value, String field) {
        if (value == null || value < 0) {
            throw new GEFailedException("Node returned an invalid " + field);
        }
        return value.toString();
    }
}
