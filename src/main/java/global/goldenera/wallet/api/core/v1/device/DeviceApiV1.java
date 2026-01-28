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
package global.goldenera.wallet.api.core.v1.device;

import static lombok.AccessLevel.PRIVATE;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import global.goldenera.wallet.api.core.v1.device.dtos.DeviceDtoV1;
import global.goldenera.wallet.api.core.v1.device.dtos.DeviceRegistrationRequestDtoV1;
import global.goldenera.wallet.api.core.v1.device.mappers.DeviceMapper;
import global.goldenera.wallet.entities.Device;
import global.goldenera.wallet.service.business.DeviceBusinessService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@RestController
@RequestMapping("/api/core/v1/device")
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
@Slf4j
@Tag(name = "Device API V1", description = "API for device registration and management")
public class DeviceApiV1 {

    DeviceBusinessService deviceBusinessService;
    DeviceMapper deviceMapper;

    @PostMapping("/register")
    @Operation(summary = "Register device", description = "Register a new device or update existing one")
    public DeviceDtoV1 register(@RequestBody @Valid DeviceRegistrationRequestDtoV1 request) {
        log.info("Registering device with client identifier: {}", request.clientIdentifier());
        Device device = deviceMapper.toEntity(request);
        Device registered = deviceBusinessService.registerDevice(device);
        return deviceMapper.toDto(registered);
    }

}
