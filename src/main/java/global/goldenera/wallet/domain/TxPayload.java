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
package global.goldenera.wallet.domain;

import java.math.BigInteger;

import org.apache.tuweni.units.ethereum.Wei;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.enums.BipVoteType;
import global.goldenera.cryptoj.enums.TxPayloadType;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.EqualsAndHashCode;
import lombok.NoArgsConstructor;

@Data
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "payloadType", visible = true)
@JsonSubTypes({
        @JsonSubTypes.Type(value = TxPayload.AddressAliasAdd.class, name = "BIP_ADDRESS_ALIAS_ADD"),
        @JsonSubTypes.Type(value = TxPayload.AddressAliasRemove.class, name = "BIP_ADDRESS_ALIAS_REMOVE"),
        @JsonSubTypes.Type(value = TxPayload.AuthorityAdd.class, name = "BIP_AUTHORITY_ADD"),
        @JsonSubTypes.Type(value = TxPayload.AuthorityRemove.class, name = "BIP_AUTHORITY_REMOVE"),
        @JsonSubTypes.Type(value = TxPayload.NetworkParamsSet.class, name = "BIP_NETWORK_PARAMS_SET"),
        @JsonSubTypes.Type(value = TxPayload.TokenBurn.class, name = "BIP_TOKEN_BURN"),
        @JsonSubTypes.Type(value = TxPayload.TokenCreate.class, name = "BIP_TOKEN_CREATE"),
        @JsonSubTypes.Type(value = TxPayload.TokenMint.class, name = "BIP_TOKEN_MINT"),
        @JsonSubTypes.Type(value = TxPayload.TokenUpdate.class, name = "BIP_TOKEN_UPDATE"),
        @JsonSubTypes.Type(value = TxPayload.Vote.class, name = "BIP_VOTE")
})
public abstract sealed class TxPayload permits
        TxPayload.AddressAliasAdd,
        TxPayload.AddressAliasRemove,
        TxPayload.AuthorityAdd,
        TxPayload.AuthorityRemove,
        TxPayload.NetworkParamsSet,
        TxPayload.TokenBurn,
        TxPayload.TokenCreate,
        TxPayload.TokenMint,
        TxPayload.TokenUpdate,
        TxPayload.Vote {

    public int version = 1;

    @JsonIgnore
    public abstract TxPayloadType getPayloadType();

    // --- Concrete Payload Types ---

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class AddressAliasAdd extends TxPayload {
        Address address;
        String alias;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_ADDRESS_ALIAS_ADD;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class AddressAliasRemove extends TxPayload {
        String alias;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_ADDRESS_ALIAS_REMOVE;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class AuthorityAdd extends TxPayload {
        Address address;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_AUTHORITY_ADD;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class AuthorityRemove extends TxPayload {
        Address address;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_AUTHORITY_REMOVE;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class NetworkParamsSet extends TxPayload {
        Wei blockReward;
        Address blockRewardPoolAddress;
        Long targetMiningTimeMs;
        Long asertHalfLifeBlocks;
        BigInteger minDifficulty;
        Wei minTxBaseFee;
        Wei minTxByteFee;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_NETWORK_PARAMS_SET;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class TokenBurn extends TxPayload {
        Address tokenAddress;
        Address sender;
        Wei amount;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_TOKEN_BURN;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class TokenCreate extends TxPayload {
        String name;
        String smallestUnitName;
        int numberOfDecimals;
        String websiteUrl;
        String logoUrl;
        BigInteger maxSupply;
        boolean userBurnable;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_TOKEN_CREATE;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class TokenMint extends TxPayload {
        Address tokenAddress;
        Address recipient;
        Wei amount;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_TOKEN_MINT;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class TokenUpdate extends TxPayload {
        Address tokenAddress;
        String name;
        String smallestUnitName;
        String websiteUrl;
        String logoUrl;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_TOKEN_UPDATE;
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode(callSuper = false)
    public static final class Vote extends TxPayload {
        BipVoteType type;

        @Override
        @JsonProperty("payloadType")
        public TxPayloadType getPayloadType() {
            return TxPayloadType.BIP_VOTE;
        }
    }
}