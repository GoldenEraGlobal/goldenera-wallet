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
package global.goldenera.wallet.config;

import static lombok.AccessLevel.PRIVATE;

import java.io.IOException;
import java.time.format.DateTimeParseException;

import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.authorization.AuthorizationDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.firewall.RequestRejectedException;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import tools.jackson.databind.DatabindException;

import global.goldenera.cryptoj.exceptions.CryptoJException;
import global.goldenera.cryptoj.exceptions.CryptoJFailedException;
import global.goldenera.cryptoj.exceptions.CryptoJRuntimeException;
import global.goldenera.wallet.api.core.v1.common.dtos.ApiErrorDtoV1;
import global.goldenera.wallet.exceptions.GEAuthenticationException;
import global.goldenera.wallet.exceptions.GEFailedException;
import global.goldenera.wallet.exceptions.GENotFoundException;
import global.goldenera.wallet.exceptions.GEValidationException;
import global.goldenera.wallet.exceptions.MalformedRequestException;
import global.goldenera.wallet.exceptions.RequestBodyTooLargeException;
import global.goldenera.wallet.exceptions.UpstreamObservationUnstableException;
import global.goldenera.wallet.exceptions.WebhookAuthenticationException;
import global.goldenera.wallet.service.system.ApiErrorResponseWriter;
import lombok.AllArgsConstructor;
import lombok.NonNull;
import lombok.experimental.FieldDefaults;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@ControllerAdvice
@AllArgsConstructor
@FieldDefaults(level = PRIVATE, makeFinal = true)
public class ExceptionHandlerConfig {

    ApiErrorResponseWriter apiErrors;

    @ResponseBody
    @ExceptionHandler(CryptoJFailedException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleCryptoJFailedException(@NonNull CryptoJFailedException exception) {
        return error("CRYPTOGRAPHIC_INPUT_INVALID", "The cryptographic input is invalid.");
    }

    @ResponseBody
    @ExceptionHandler({ CryptoJRuntimeException.class, CryptoJException.class })
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    ApiErrorDtoV1 handleCryptoJInternalException(@NonNull Exception exception) {
        log.error("Cryptographic operation failed", exception);
        return error("INTERNAL_ERROR", "An internal error occurred.");
    }

    @ResponseBody
    @ExceptionHandler(GEAuthenticationException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    ApiErrorDtoV1 handleGEAuthenticationException(@NonNull GEAuthenticationException exception) {
        return error("AUTHENTICATION_REQUIRED", "Authentication is required.");
    }

    @ResponseBody
    @ExceptionHandler(AuthorizationDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    ApiErrorDtoV1 handleAuthorizationDeniedException(@NonNull AuthorizationDeniedException exception) {
        return error("ACCESS_DENIED", "Access is denied.");
    }

    @ResponseBody
    @ExceptionHandler(GENotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    ApiErrorDtoV1 handleGENotFoundException(@NonNull GENotFoundException exception) {
        return error("NOT_FOUND", "The requested resource was not found.");
    }

    @ResponseBody
    @ExceptionHandler(GEValidationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleGEValidationException(@NonNull GEValidationException exception) {
        return error("VALIDATION_ERROR", "The request is invalid.");
    }

    @ResponseBody
    @ExceptionHandler(GEFailedException.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    ApiErrorDtoV1 handleGEFailedException(@NonNull GEFailedException exception) {
        log.error("Unexpected internal server exception: {}", exception.getMessage(), exception);
        return error("INTERNAL_ERROR", "An internal error occurred.");
    }

    @ResponseBody
    @ExceptionHandler({ IllegalArgumentException.class, IllegalStateException.class })
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleInvalidRuntimeState(@NonNull RuntimeException exception) {
        return error("INVALID_REQUEST", "The request is invalid.");
    }

    @ResponseBody
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleMethodArgumentNotValidException(@NonNull MethodArgumentNotValidException exception) {
        return error("VALIDATION_ERROR", "Request validation failed.");
    }

    @ResponseBody
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleMethodArgumentTypeMismatchException(@NonNull MethodArgumentTypeMismatchException exception) {
        return error("INVALID_PARAMETER", "A request parameter has an invalid value.");
    }

    @ResponseBody
    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ApiErrorDtoV1> handleHttpMessageNotReadableException(
            @NonNull HttpMessageNotReadableException exception) {
        if (hasCause(exception, RequestBodyTooLargeException.class)) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(error("PAYLOAD_TOO_LARGE", "Request body exceeds the supported size."));
        }
        return ResponseEntity.badRequest().body(error("MALFORMED_REQUEST", "The request body is malformed."));
    }

    @ResponseBody
    @ExceptionHandler(DatabindException.class)
    ResponseEntity<ApiErrorDtoV1> handleDatabindException(@NonNull DatabindException exception) {
        if (hasCause(exception, RequestBodyTooLargeException.class)) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(error("PAYLOAD_TOO_LARGE", "Request body exceeds the supported size."));
        }
        return ResponseEntity.badRequest().body(error("MALFORMED_REQUEST", "The request body is malformed."));
    }

    @ResponseBody
    @ExceptionHandler(MalformedRequestException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleMalformedRequestException(@NonNull MalformedRequestException exception) {
        return error("MALFORMED_REQUEST", "The request body is malformed.");
    }

    @ResponseBody
    @ExceptionHandler(WebhookAuthenticationException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    ApiErrorDtoV1 handleWebhookAuthenticationException(@NonNull WebhookAuthenticationException exception) {
        return error("WEBHOOK_AUTHENTICATION_FAILED", "Invalid webhook authentication.");
    }

    @ResponseBody
    @ExceptionHandler(MissingRequestHeaderException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleMissingRequestHeaderException(@NonNull MissingRequestHeaderException exception) {
        return error("MISSING_HEADER", "A required request header is missing.");
    }

    @ResponseBody
    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleMissingServletRequestParameterException(
            @NonNull MissingServletRequestParameterException exception) {
        return error("MISSING_PARAMETER", "A required request parameter is missing.");
    }

    @ResponseBody
    @ExceptionHandler(DateTimeParseException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleDateTimeParseException(@NonNull DateTimeParseException exception) {
        return error("INVALID_DATE_TIME", "A date or time value is invalid.");
    }

    @ResponseBody
    @ExceptionHandler(RequestRejectedException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    ApiErrorDtoV1 handleRequestRejectedException(@NonNull RequestRejectedException exception) {
        return error("REQUEST_REJECTED", "The request was rejected.");
    }

    @ResponseBody
    @ExceptionHandler(ConcurrencyFailureException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    ApiErrorDtoV1 handleConcurrencyFailureException(@NonNull ConcurrencyFailureException exception) {
        return error("CONCURRENT_MODIFICATION", "The resource changed concurrently. Retry the operation.");
    }

    @ResponseBody
    @ExceptionHandler(NoResourceFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    ApiErrorDtoV1 handleNoResourceFoundException(@NonNull NoResourceFoundException exception) {
        return error("NOT_FOUND", "The requested resource was not found.");
    }

    @ResponseBody
    @ExceptionHandler({ MaxUploadSizeExceededException.class, RequestBodyTooLargeException.class })
    @ResponseStatus(HttpStatus.PAYLOAD_TOO_LARGE)
    ApiErrorDtoV1 handlePayloadTooLargeException(@NonNull RuntimeException exception) {
        return error("PAYLOAD_TOO_LARGE", "Request body exceeds the supported size.");
    }

    @ResponseBody
    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    @ResponseStatus(HttpStatus.NOT_ACCEPTABLE)
    ApiErrorDtoV1 handleHttpMediaTypeNotAcceptableException(@NonNull HttpMediaTypeNotAcceptableException exception) {
        return error("MEDIA_TYPE_NOT_ACCEPTABLE", "The requested response media type is not supported.");
    }

    @ResponseBody
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    @ResponseStatus(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
    ApiErrorDtoV1 handleHttpMediaTypeNotSupportedException(@NonNull HttpMediaTypeNotSupportedException exception) {
        return error("UNSUPPORTED_MEDIA_TYPE", "The request media type is not supported.");
    }

    @ResponseBody
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseStatus(HttpStatus.METHOD_NOT_ALLOWED)
    ApiErrorDtoV1 handleHttpRequestMethodNotSupportedException(
            @NonNull HttpRequestMethodNotSupportedException exception) {
        return error("METHOD_NOT_ALLOWED", "The request method is not supported for this route.");
    }

    @ResponseBody
    @ExceptionHandler(AuthenticationException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    ApiErrorDtoV1 handleAuthenticationException(@NonNull AuthenticationException exception) {
        return error("AUTHENTICATION_REQUIRED", "Authentication is required.");
    }

    @ResponseBody
    @ExceptionHandler(NullPointerException.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    ApiErrorDtoV1 handleNullPointerException(@NonNull NullPointerException exception) {
        log.error("Unexpected null pointer exception: {}", exception.getMessage(), exception);
        return error("INTERNAL_ERROR", "An internal error occurred.");
    }

    @ResponseBody
    @ExceptionHandler(ResourceAccessException.class)
    @ResponseStatus(HttpStatus.GATEWAY_TIMEOUT)
    ApiErrorDtoV1 handleNodeTransportException(ResourceAccessException exception) {
        log.warn("Node request did not complete: {}", exception.getClass().getSimpleName());
        return error("NODE_TIMEOUT", "The upstream node did not respond. Retry the request.");
    }

    @ResponseBody
    @ExceptionHandler(UpstreamObservationUnstableException.class)
    @ResponseStatus(HttpStatus.SERVICE_UNAVAILABLE)
    ApiErrorDtoV1 handleUpstreamObservationUnstableException(UpstreamObservationUnstableException exception) {
        return error("UPSTREAM_OBSERVATION_UNSTABLE",
                "The upstream wallet state changed while it was being read. Retry the request.");
    }

    @ResponseBody
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    ApiErrorDtoV1 handleException(@NonNull Exception exception) {
        log.error("Unexpected internal server exception: {}", exception.getMessage(), exception);
        return error("INTERNAL_ERROR", "An internal error occurred.");
    }

    @ExceptionHandler(IOException.class)
    void handleIOException(@NonNull IOException exception) {
        // The client disconnected or the response stream failed; writing again can mask the cause.
    }

    private ApiErrorDtoV1 error(String code, String message) {
        return apiErrors.error(code, message);
    }

    private static boolean hasCause(Throwable exception, Class<? extends Throwable> type) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (type.isInstance(cause)) {
                return true;
            }
        }
        return false;
    }
}
