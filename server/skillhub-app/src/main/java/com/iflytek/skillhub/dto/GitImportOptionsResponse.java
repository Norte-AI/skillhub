package com.iflytek.skillhub.dto;
import java.util.List;
public record GitImportOptionsResponse(List<Provider> providers,List<Credential> credentials,boolean automaticSyncEnabled) {
    public record Provider(String host,String kind) {}
    public record Credential(String id,String repository) {}
}
