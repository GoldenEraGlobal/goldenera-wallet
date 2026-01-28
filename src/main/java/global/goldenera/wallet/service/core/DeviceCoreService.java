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
package global.goldenera.wallet.service.core;

import static lombok.AccessLevel.PRIVATE;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import global.goldenera.wallet.entities.Device;
import global.goldenera.wallet.exceptions.GENotFoundException;
import global.goldenera.wallet.repositories.DeviceRepository;
import lombok.AllArgsConstructor;
import lombok.experimental.FieldDefaults;

@Service
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class DeviceCoreService {

    DeviceRepository deviceRepository;

    @Transactional(readOnly = true)
    public Device getById(UUID id) {
        return deviceRepository.findById(id).orElseThrow(() -> new GENotFoundException("Device not found"));
    }

    @Transactional(readOnly = true)
    public Optional<Device> getByIdOptional(UUID id) {
        return deviceRepository.findById(id);
    }

    @Transactional(readOnly = true)
    public Optional<Device> getByClientIdentifierOptional(UUID clientIdentifier) {
        return deviceRepository.findByClientIdentifier(clientIdentifier);
    }

    @Transactional(rollbackFor = Exception.class)
    public void upsert(Device device) {
        deviceRepository.upsert(
                device.getClientIdentifier(),
                device.getPlatform(),
                device.getFcmToken(),
                device.getAppVersion());
    }

    @Transactional(rollbackFor = Exception.class)
    public Device save(Device device) {
        return deviceRepository.persist(device);
    }

    @Transactional(rollbackFor = Exception.class)
    public Device update(Device device) {
        return deviceRepository.update(device);
    }

    @Transactional(rollbackFor = Exception.class)
    public void delete(Device device) {
        deviceRepository.delete(device);
    }

}
