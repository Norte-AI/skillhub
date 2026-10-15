package com.iflytek.skillhub.dto;

import java.util.List;

/** A validated, immutable package held by the browser until ordinary publish. */
public record GitImportResponse(
        Source source, String name, String version, String description,
        List<String> files, long totalSize, List<String> warnings, String packageBase64
) {
    public record Source(String repository, String requestedRef, String commit, String subdir) {}
}
