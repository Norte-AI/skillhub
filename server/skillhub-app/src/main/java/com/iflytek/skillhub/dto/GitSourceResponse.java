package com.iflytek.skillhub.dto;
import java.time.Instant;
import java.util.UUID;
public record GitSourceResponse(UUID id, String repository, String ref, String subdir,
    String credentialId, String namespace, String visibility, boolean autoSync, boolean enabled,
    String lastCommit, String lastVersion, String lastStatus, String lastError, Instant lastCheckedAt) {}
