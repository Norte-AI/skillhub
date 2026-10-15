package com.iflytek.skillhub.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GitImportRequest(
        @NotBlank @Size(max = 2048) String repository,
        @Size(max = 256) String ref,
        @Size(max = 1024) String subdir
) {}
