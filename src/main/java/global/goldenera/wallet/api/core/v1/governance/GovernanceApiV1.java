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
package global.goldenera.wallet.api.core.v1.governance;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.cryptoj.datatypes.Hash;
import global.goldenera.wallet.api.core.v1.governance.dtos.AuthorityStatusDtoV1;
import global.goldenera.wallet.api.core.v1.governance.dtos.BipDtoV1;
import global.goldenera.wallet.api.core.v1.governance.dtos.BipPageDtoV1;
import global.goldenera.wallet.api.core.v1.governance.dtos.GovernanceOptionsDtoV1;
import global.goldenera.wallet.service.business.GovernanceBusinessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

@RestController
@RequestMapping("/api/core/v1/governance")
@Tag(name = "Governance API V1", description = "Authority membership and BIP state")
public class GovernanceApiV1 {

    private final GovernanceBusinessService governanceBusinessService;

    public GovernanceApiV1(GovernanceBusinessService governanceBusinessService) {
        this.governanceBusinessService = governanceBusinessService;
    }

    @GetMapping("/authority-status")
    @Operation(summary = "Check whether an address is a current authority")
    public AuthorityStatusDtoV1 getAuthorityStatus(@RequestParam Address address) {
        return governanceBusinessService.getAuthorityStatus(address);
    }

    @GetMapping("/bips")
    @Operation(summary = "Get the BIP overview")
    public BipPageDtoV1 getBips(
            @RequestParam(defaultValue = "0") @Min(0) @Max(100_000) int pageNumber,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int pageSize,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String type) {
        return governanceBusinessService.getBips(pageNumber, pageSize, status, type);
    }

    @GetMapping("/bip")
    @Operation(summary = "Get a BIP by its creation transaction hash")
    public BipDtoV1 getBip(@RequestParam Hash hash) {
        return governanceBusinessService.getBip(hash);
    }

    @GetMapping("/options")
    @Operation(summary = "Get current entities available to BIP creation forms")
    public GovernanceOptionsDtoV1 getOptions() {
        return governanceBusinessService.getOptions();
    }
}
