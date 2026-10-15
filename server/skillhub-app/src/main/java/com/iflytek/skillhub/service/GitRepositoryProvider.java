package com.iflytek.skillhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.config.GitImportProperties;
import com.iflytek.skillhub.domain.shared.exception.DomainBadRequestException;
import org.springframework.stereotype.Component;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Constructs all remote URLs from operator configuration; request data never selects an API host. */
@Component
public class GitRepositoryProvider {
    public record Repository(String coordinate, String url, GitImportProperties.Provider provider) {}
    public record Fetch(URI uri, String accept, Map<String, String> headers) {}
    private final GitImportProperties properties;
    private final ObjectMapper mapper;
    public GitRepositoryProvider(GitImportProperties properties, ObjectMapper mapper) {
        this.properties = properties;
        this.mapper = mapper;
    }
    public Repository parse(String input) {
        try {
            URI uri = URI.create(input == null ? "" : input.trim());
            String host = uri.getHost();
            var provider = properties.getProviders().get(host);
            if (!"https".equals(uri.getScheme()) || uri.getRawAuthority() == null
                    || !uri.getRawAuthority().equals(host) || provider == null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null) throw invalid();
            String path = uri.getRawPath().replaceAll("/$", "");
            if (path.endsWith(".git")) path = path.substring(0, path.length() - 4);
            String[] parts = path.substring(1).split("/", -1);
            if (parts.length < 2 || parts.length > 10
                    || provider.getKind() != GitImportProperties.Kind.GITLAB && parts.length != 2) throw invalid();
            for (String part : parts) if (!part.matches("[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}")
                    || part.equals(".") || part.equals("..")) throw invalid();
            validateBase(provider.getApiBase());
            validateBase(provider.getArchiveBase());
            String coordinate = String.join("/", parts);
            return new Repository(coordinate, "https://" + host + "/" + coordinate + ".git", provider);
        } catch (IllegalArgumentException | IndexOutOfBoundsException e) { throw invalid(); }
    }
    private static void validateBase(String value) {
        URI uri = URI.create(value == null ? "" : value);
        if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || uri.getPort() != -1 || uri.getQuery() != null || uri.getFragment() != null
                || value.endsWith("/")) throw invalid();
    }
    public Fetch commit(Repository repository, String ref, String credentialId, String actor) {
        String base = repository.provider().getApiBase();
        String path = switch (repository.provider().getKind()) {
            case GITHUB -> "/repos/" + repository.coordinate() + "/commits/" + encode(ref);
            case GITLAB -> "/projects/" + encode(repository.coordinate()) + "/repository/commits/" + encode(ref);
        };
        return new Fetch(URI.create(base + path), repository.provider().getKind() == GitImportProperties.Kind.GITHUB ? "application/vnd.github.sha" : "application/json", headers(repository, credentialId, actor));
    }
    public String commitSha(Repository repository, byte[] response) {
        try {
            if (repository.provider().getKind() == GitImportProperties.Kind.GITHUB) {
                String sha = new String(response, StandardCharsets.UTF_8).trim();
                if (!sha.matches("[0-9a-f]{40}")) throw invalid();
                return sha;
            }
            var node = mapper.readTree(response);
            String sha = node.path(repository.provider().getKind() == GitImportProperties.Kind.GITLAB ? "id" : "sha").asText();
            if (!sha.matches("[0-9a-f]{40}|[0-9a-f]{64}")) throw invalid();
            return sha;
        } catch (java.io.IOException e) { throw invalid(); }
    }
    public Fetch archive(Repository repository, String sha, String credentialId, String actor) {
        String path = switch (repository.provider().getKind()) {
            case GITHUB -> "/" + repository.coordinate() + "/zip/" + sha;
            case GITLAB -> "/projects/" + encode(repository.coordinate()) + "/repository/archive.zip?sha=" + sha;
        };
        return new Fetch(URI.create(repository.provider().getArchiveBase() + path), "application/zip", headers(repository, credentialId, actor));
    }
    public Fetch githubObject(Repository repository, String objectType, String sha, String credentialId, String actor) {
        if (repository.provider().getKind() != GitImportProperties.Kind.GITHUB || !sha.matches("[0-9a-f]{40}")) throw invalid();
        String suffix = objectType.equals("trees") ? "?recursive=1" : "";
        if (!objectType.equals("trees") && !objectType.equals("blobs")) throw invalid();
        return new Fetch(URI.create(repository.provider().getApiBase() + "/repos/" + repository.coordinate()
                + "/git/" + objectType + "/" + sha + suffix),
                objectType.equals("blobs") ? "application/vnd.github.raw+json" : "application/json",
                headers(repository, credentialId, actor));
    }

    private Map<String,String> headers(Repository repository, String id, String actor) {
        if (id == null || id.isBlank()) return Map.of();
        var secret = properties.getCredentials().get(id);
        if (secret == null || actor == null || !secret.getUserIds().contains(actor)
                || !repository.url().equals(secret.getRepository()) || secret.getToken() == null
                || secret.getToken().isBlank() || secret.getToken().chars().anyMatch(c -> c < 32 || c == 127)) {
            throw new DomainBadRequestException("error.skill.gitImport.invalid", "Git credential is unavailable for this user/repository.");
        }
        return repository.provider().getKind() == GitImportProperties.Kind.GITLAB
                ? Map.of("PRIVATE-TOKEN", secret.getToken()) : Map.of("Authorization", "Bearer " + secret.getToken());
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
    private static DomainBadRequestException invalid() {
        return new DomainBadRequestException("error.skill.gitImport.invalid", "Use an enabled HTTPS repository URL and valid provider configuration.");
    }
}
