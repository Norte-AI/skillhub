package com.iflytek.skillhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.config.SkillPublishProperties;
import com.iflytek.skillhub.domain.shared.exception.DomainBadRequestException;
import com.iflytek.skillhub.domain.skill.metadata.SkillMetadataParser;
import com.iflytek.skillhub.domain.skill.validation.PackageEntry;
import com.iflytek.skillhub.domain.skill.validation.SkillPackageValidator;
import com.iflytek.skillhub.dto.GitImportRequest;
import com.iflytek.skillhub.dto.GitImportResponse;
import jakarta.annotation.PreDestroy;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.springframework.stereotype.Service;

import java.io.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Pattern;
import java.util.zip.*;

/**
 * Imports public GitHub archives without invoking Git or executing repository code.
 * All remote URLs are constructed from a strict owner/repository grammar against two fixed
 * HTTPS hosts. Redirects, user-provided credentials, custom hosts and ports are never used.
 */
@Service
public class GitImportService {
    static final int MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
    static final int MAX_SELECTED_BYTES = 20 * 1024 * 1024;
    private static final String MANIFEST = ".skillhub-source.json";
    private static final Pattern REPOSITORY = Pattern.compile(
            "https://github\\.com/([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9_.-]{1,100})/?");
    private final ObjectMapper mapper;
    private final SkillPackageValidator validator;
    private final SkillMetadataParser parser;
    private final SkillPublishProperties limits;
    private final Semaphore slots = new Semaphore(2);
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "git-import-deadline");
        thread.setDaemon(true);
        return thread;
    });

    public GitImportService(ObjectMapper mapper, SkillPackageValidator validator,
                            SkillMetadataParser parser, SkillPublishProperties limits) {
        this.mapper = mapper;
        this.validator = validator;
        this.parser = parser;
        this.limits = limits;
    }

    @PreDestroy
    void close() {
        deadlines.shutdownNow();
        client.close();
    }

    public GitImportResponse prepare(GitImportRequest request) {
        Repository repository = parseRepository(request.repository());
        String ref = request.ref() == null || request.ref().isBlank() ? "HEAD" : request.ref().trim();
        if (ref.length() > 256 || ref.chars().anyMatch(c -> c < 32 || c == 127)) {
            throw invalid("Invalid branch, tag or commit.");
        }
        String subdir = normalizeSubdir(request.subdir());
        if (!slots.tryAcquire()) throw invalid("Git imports are busy. Please retry shortly.");
        Path archive = null;
        try {
            String encodedRef = URLEncoder.encode(ref, StandardCharsets.UTF_8).replace("+", "%20");
            // GitHub's SHA media type avoids downloading an unbounded commit diff.
            String commit = new String(download(URI.create("https://api.github.com/repos/"
                    + repository.coordinate() + "/commits/" + encodedRef),
                    "application/vnd.github.sha", 1024), StandardCharsets.UTF_8).trim();
            if (!commit.matches("[0-9a-f]{40}")) throw invalid("GitHub returned an invalid commit.");
            archive = Files.createTempFile("skillhub-git-import-", ".zip");
            downloadArchive(URI.create("https://codeload.github.com/" + repository.coordinate()
                    + "/zip/" + commit), archive);
            return packageArchive(archive, new GitImportResponse.Source(repository.url(), ref, commit, subdir));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw invalid("Git import was interrupted. Please retry.");
        } catch (IOException e) {
            throw invalid("Could not read the GitHub repository. Check the repository/ref and retry; large or slow repositories may exceed import limits.");
        } finally {
            if (archive != null) {
                try { Files.deleteIfExists(archive); } catch (IOException ignored) { archive.toFile().deleteOnExit(); }
            }
            slots.release();
        }
    }

    record Repository(String coordinate, String url) {}

    static Repository parseRepository(String input) {
        if (input == null) throw invalid("Enter a public GitHub HTTPS repository URL.");
        var match = REPOSITORY.matcher(input.trim());
        if (!match.matches()) throw invalid("Use https://github.com/owner/repository. Only public GitHub repositories are supported.");
        String repo = match.group(2);
        if (repo.endsWith(".git")) repo = repo.substring(0, repo.length() - 4);
        if (repo.isBlank() || repo.equals(".") || repo.equals("..")) throw invalid("Invalid repository name.");
        String coordinate = match.group(1) + "/" + repo;
        return new Repository(coordinate, "https://github.com/" + coordinate + ".git");
    }

    static String normalizeSubdir(String input) {
        if (input == null || input.isBlank() || input.trim().equals(".")) return ".";
        String path = input.trim();
        validatePath(path);
        if (path.length() > 1024) throw invalid("Skill directory is too long.");
        return path;
    }

    private static void validatePath(String path) {
        if (path.isBlank() || path.startsWith("/") || path.contains("\\") || path.contains(":")
                || path.chars().anyMatch(c -> c < 32 || c == 127)
                || Arrays.stream(path.split("/", -1)).anyMatch(p -> p.isBlank() || p.equals(".") || p.equals(".."))) {
            throw invalid("Unsafe path in repository or skill directory.");
        }
    }

    private byte[] download(URI uri, String accept, int max) throws IOException, InterruptedException {
        try (InputStream input = open(uri, accept); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            copyBounded(input, output, max);
            return output.toByteArray();
        }
    }

    private void downloadArchive(URI uri, Path path) throws IOException, InterruptedException {
        try (InputStream input = open(uri, "application/zip"); OutputStream output = Files.newOutputStream(path)) {
            copyBounded(input, output, MAX_ARCHIVE_BYTES);
        }
    }

    private InputStream open(URI uri, String accept) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20))
                .header("Accept", accept).header("User-Agent", "Norte-AI-SkillHub-Git-Import").GET().build();
        HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
        if (response.statusCode() != 200) {
            response.body().close();
            if (response.statusCode() == 403 || response.statusCode() == 429) {
                throw invalid("GitHub rate limit reached. Retry later or upload a ZIP package.");
            }
            throw invalid("GitHub repository/ref is unavailable. Use a public repository and an existing branch, tag or commit.");
        }
        InputStream body = response.body();
        ScheduledFuture<?> deadline = deadlines.schedule(() -> {
            try { body.close(); } catch (IOException ignored) { /* Caller handles failed read. */ }
        }, 30, TimeUnit.SECONDS);
        return new FilterInputStream(body) {
            @Override public void close() throws IOException {
                deadline.cancel(false);
                super.close();
            }
        };
    }

    private static void copyBounded(InputStream input, OutputStream output, long max) throws IOException {
        byte[] buffer = new byte[8192];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > max) throw invalid("Git import exceeds the size limit (50 MiB archive, 20 MiB skill, 10 MiB per file).");
            output.write(buffer, 0, count);
        }
    }

    // Package-visible for tests using actual ZIP archives, with no network access.
    GitImportResponse packageArchive(Path archive, GitImportResponse.Source source) throws IOException {
        Map<String, byte[]> selected = new LinkedHashMap<>();
        Set<String> paths = new HashSet<>();
        String root = null;
        long total = 0;
        int inspected = 0;
        try (ZipFile zip = ZipFile.builder().setPath(archive).get()) {
            var entries = zip.getEntries();
            while (entries.hasMoreElements()) {
                var entry = entries.nextElement();
                if (++inspected > 100_000) throw invalid("Repository archive has too many entries.");
                String name = entry.getName();
                validatePath(entry.isDirectory() && name.endsWith("/") ? name.substring(0, name.length() - 1) : name);
                int slash = name.indexOf('/');
                if (slash <= 0) throw invalid("Invalid GitHub archive layout.");
                String entryRoot = name.substring(0, slash + 1);
                if (root == null) root = entryRoot;
                if (!root.equals(entryRoot)) throw invalid("Invalid GitHub archive roots.");
                String relative = name.substring(slash + 1);
                String prefix = source.subdir().equals(".") ? "" : source.subdir() + "/";
                if (!relative.startsWith(prefix) || entry.isDirectory()) continue;
                String path = relative.substring(prefix.length());
                validatePath(path);
                int type = entry.getUnixMode() & 0170000;
                if (entry.isUnixSymlink() || (type != 0 && type != 0100000) || !zip.canReadEntryData(entry)) {
                    throw invalid("Skill contains a symlink or unsupported archive entry.");
                }
                String canonical = path.toLowerCase(Locale.ROOT);
                if (path.equalsIgnoreCase(MANIFEST) || paths.stream().anyMatch(existing ->
                        existing.equals(canonical) || existing.startsWith(canonical + "/") || canonical.startsWith(existing + "/"))) {
                    throw invalid("Skill contains a reserved source manifest or colliding file paths.");
                }
                paths.add(canonical);
                if (selected.size() >= Math.min(499, limits.getMaxFileCount() - 1)) throw invalid("Skill has too many files (max 499 plus source manifest).");
                byte[] content;
                try (InputStream input = zip.getInputStream(entry); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    copyBounded(input, output, Math.min(limits.getMaxSingleFileSize(), 10 * 1024 * 1024));
                    content = output.toByteArray();
                }
                String start = new String(content, 0, Math.min(160, content.length), StandardCharsets.UTF_8);
                if (start.startsWith("version https://git-lfs.github.com/spec/v1\n")
                        || start.startsWith("version https://git-lfs.github.com/spec/v1\r\n")) {
                    throw invalid("Git LFS pointers are unsupported. Upload a package containing the actual files.");
                }
                total += content.length;
                if (total > Math.min(MAX_SELECTED_BYTES, limits.getMaxPackageSize()) - 8192) throw invalid("Selected skill exceeds 20 MiB.");
                selected.put(path, content);
            }
        }
        byte[] skillMd = selected.get("SKILL.md");
        if (skillMd == null) throw invalid("No SKILL.md found in the selected directory. Enter the directory containing SKILL.md.");
        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("schemaVersion", 1);
        manifest.put("repository", source.repository());
        manifest.put("requestedRef", source.requestedRef());
        manifest.put("commit", source.commit());
        manifest.put("subdir", source.subdir());
        selected.put(MANIFEST, mapper.writeValueAsBytes(manifest));
        List<PackageEntry> packageEntries = selected.entrySet().stream()
                .map(e -> new PackageEntry(e.getKey(), e.getValue(), e.getValue().length, "application/octet-stream")).toList();
        var validation = validator.validate(packageEntries);
        if (!validation.passed()) throw invalid(String.join("\n", validation.errors()));
        var metadata = parser.parse(new String(skillMd, StandardCharsets.UTF_8));
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            for (var entry : selected.entrySet()) {
                ZipEntry target = new ZipEntry(entry.getKey());
                target.setTime(0);
                zip.putNextEntry(target);
                zip.write(entry.getValue());
                zip.closeEntry();
            }
        }
        return new GitImportResponse(source, metadata.name(), metadata.version(), metadata.description(),
                List.copyOf(selected.keySet()), packageEntries.stream().mapToLong(PackageEntry::size).sum(),
                validation.warnings(), Base64.getEncoder().encodeToString(output.toByteArray()));
    }

    private static DomainBadRequestException invalid(String message) {
        return new DomainBadRequestException("error.skill.gitImport.invalid", message);
    }
}
