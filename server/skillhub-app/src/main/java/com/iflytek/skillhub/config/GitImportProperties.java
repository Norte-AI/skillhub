package com.iflytek.skillhub.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import java.util.*;

/** Operator-owned exact provider allowlist and secret references; never serialized by API. */
@Component
@ConfigurationProperties(prefix = "skillhub.git")
public class GitImportProperties {
    public enum Kind { GITHUB, GITLAB, GITEE }
    public static class Provider {
        private Kind kind = Kind.GITHUB;
        private String apiBase;
        private String archiveBase;
        public Kind getKind() { return kind; }
        public void setKind(Kind value) { kind = value; }
        public String getApiBase() { return apiBase; }
        public void setApiBase(String value) { apiBase = value; }
        public String getArchiveBase() { return archiveBase; }
        public void setArchiveBase(String value) { archiveBase = value; }
    }
    public static class Credential {
        private String token;
        private String repository;
        private Set<String> userIds = new HashSet<>();
        public String getToken() { return token; }
        public void setToken(String value) { token = value; }
        public String getRepository() { return repository; }
        public void setRepository(String value) { repository = value; }
        public Set<String> getUserIds() { return userIds; }
        public void setUserIds(Set<String> value) { userIds = value; }
    }
    private Map<String, Provider> providers = new LinkedHashMap<>();
    private Map<String, Credential> credentials = new HashMap<>();
    private String webhookSecret;
    private boolean automaticSyncEnabled;
    public GitImportProperties() {
        Provider github = new Provider();
        github.setApiBase("https://api.github.com");
        github.setArchiveBase("https://codeload.github.com");
        providers.put("github.com", github);
    }
    public Map<String, Provider> getProviders() { return providers; }
    public void setProviders(Map<String, Provider> value) { providers = value; }
    public Map<String, Credential> getCredentials() { return credentials; }
    public void setCredentials(Map<String, Credential> value) { credentials = value; }
    public String getWebhookSecret() { return webhookSecret; }
    public void setWebhookSecret(String value) { webhookSecret = value; }
    public boolean isAutomaticSyncEnabled() { return automaticSyncEnabled; }
    public void setAutomaticSyncEnabled(boolean value) { automaticSyncEnabled = value; }
}
