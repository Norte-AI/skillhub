package com.iflytek.skillhub.dto;
import jakarta.validation.constraints.*;
public record RuntimeImportRequest(@NotBlank @Size(max=128) String namespace,@NotBlank @Size(max=128) String slug,@NotBlank @Size(max=128) String version) {}
