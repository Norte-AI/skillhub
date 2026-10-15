package com.iflytek.skillhub.dto;
import jakarta.validation.constraints.*;
public record GitSourceRequest(
    @NotBlank @Size(max=2048) String repository,
    @Size(max=256) String ref,
    @Size(max=1024) String subdir,
    @Size(max=128) String credentialId,
    @NotBlank @Pattern(regexp="[a-z0-9][a-z0-9-]{0,127}") String namespace,
    @NotBlank @Pattern(regexp="(?i)public|private|namespace_only") String visibility,
    boolean autoSync
) {}
