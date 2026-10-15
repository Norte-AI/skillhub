package com.iflytek.skillhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.config.SkillPublishProperties;
import com.iflytek.skillhub.domain.skill.metadata.SkillMetadataParser;
import com.iflytek.skillhub.domain.skill.validation.SkillPackageValidator;
import com.iflytek.skillhub.dto.GitImportResponse;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipInputStream;
import java.io.ByteArrayInputStream;
import static org.junit.jupiter.api.Assertions.*;

class GitImportServiceTest {
    @TempDir Path temp;
    private GitImportService service;
    private final SkillPublishProperties limits = new SkillPublishProperties();
    private static final String SKILL = "---\nname: weather\ndescription: Test weather skill\nversion: 1.0.0\n---\n# Weather\n";
    private static final GitImportResponse.Source SOURCE = new GitImportResponse.Source(
            "https://github.com/Norte-AI/skillhub.git", "main", "a".repeat(40), "skills/weather");

    @BeforeEach void setup() {
        var parser = new SkillMetadataParser();
        service = new GitImportService(new ObjectMapper(), new SkillPackageValidator(parser), parser, limits);
    }
    @AfterEach void cleanup() { service.close(); }

    @Test void validatesStrictRepositoryAllowlist() {
        assertEquals("Norte-AI/skillhub", GitImportService.parseRepository("https://github.com/Norte-AI/skillhub.git/").coordinate());
        for (String input : List.of("http://github.com/a/b", "https://github.com.evil/a/b", "https://localhost/a/b",
                "https://github.com:443/a/b", "https://user@github.com/a/b", "https://github.com/a/b?x=y",
                "https://github.com/a/..", "https://github.com/a/b/tree/main", "file:///tmp/repo")) {
            assertThrows(RuntimeException.class, () -> GitImportService.parseRepository(input), input);
        }
    }

    @Test void rejectsTraversalSubdirectories() {
        assertEquals(".", GitImportService.normalizeSubdir(""));
        for (String path : List.of("../secret", "/etc", "a/../b", "a//b", "a\\b", "a/", "a\nb")) {
            assertThrows(RuntimeException.class, () -> GitImportService.normalizeSubdir(path), path);
        }
    }

    @Test void exportsOnlySelectedSubtreeAndPinsProvenance() throws Exception {
        Path archive = archive(Map.of("root/skills/weather/SKILL.md", SKILL, "root/README.md", "outside"), null);
        var result = service.packageArchive(archive, SOURCE);
        assertEquals("weather", result.name());
        assertEquals("1.0.0", result.version());
        assertEquals(SOURCE, result.source());
        assertEquals(Set.of("SKILL.md", ".skillhub-source.json"), new HashSet<>(result.files()));
        try (var zip = new ZipInputStream(new ByteArrayInputStream(Base64.getDecoder().decode(result.packageBase64())))) {
            Map<String, String> files = new HashMap<>();
            java.util.zip.ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) files.put(entry.getName(), new String(zip.readAllBytes()));
            assertEquals(SKILL, files.get("SKILL.md"));
            var manifest = new ObjectMapper().readTree(files.get(".skillhub-source.json"));
            assertEquals(SOURCE.commit(), manifest.get("commit").asText());
            assertEquals(SOURCE.repository(), manifest.get("repository").asText());
            assertEquals(1, manifest.get("schemaVersion").asInt());
        }
    }

    @Test void supportsRootDirectoryAndRejectsMissingSkillMd() throws Exception {
        var rootSource = new GitImportResponse.Source(SOURCE.repository(), "HEAD", SOURCE.commit(), ".");
        assertEquals("weather", service.packageArchive(archive(Map.of("root/SKILL.md", SKILL), null), rootSource).name());
        assertThrows(RuntimeException.class, () -> service.packageArchive(archive(Map.of("root/README.md", "x"), null), SOURCE));
    }

    @Test void rejectsSymlinksLfsReservedAndCaseCollisions() throws Exception {
        assertThrows(RuntimeException.class, () -> service.packageArchive(archive(Map.of("root/skills/weather/SKILL.md", SKILL), "root/skills/weather/link"), SOURCE));
        for (Map<String,String> bad : List.of(
                Map.of("root/skills/weather/.skillhub-source.json", "{}"),
                Map.of("root/skills/weather/file.txt", "version https://git-lfs.github.com/spec/v1\r\noid sha256:abc\r\n"),
                Map.of("root/skills/weather/Readme.md", "a", "root/skills/weather/readme.md", "b"),
                Map.of("root/skills/weather/../escape.md", "unsafe"),
                Map.of("root/skills/weather/README.md", "a", "root/skills/weather/readme.md/nested.txt", "b"))) {
            Map<String,String> entries = new HashMap<>(bad);
            entries.put("root/skills/weather/SKILL.md", SKILL);
            assertThrows(RuntimeException.class, () -> service.packageArchive(archive(entries, null), SOURCE));
        }
    }

    @Test void enforcesFileCountSizeAndMetadataValidation() throws Exception {
        limits.setMaxFileCount(2);
        assertThrows(RuntimeException.class, () -> service.packageArchive(archive(Map.of("root/skills/weather/SKILL.md", SKILL,
                "root/skills/weather/README.md", "x"), null), SOURCE));
        limits.setMaxFileCount(500);
        limits.setMaxSingleFileSize(10);
        assertThrows(RuntimeException.class, () -> service.packageArchive(archive(Map.of("root/skills/weather/SKILL.md", SKILL), null), SOURCE));
        limits.setMaxSingleFileSize(1024);
        assertThrows(RuntimeException.class, () -> service.packageArchive(archive(Map.of("root/skills/weather/SKILL.md", "no frontmatter"), null), SOURCE));
    }

    private Path archive(Map<String,String> files, String symlink) throws Exception {
        Path path = Files.createTempFile(temp, "fixture", ".zip");
        try (var zip = new ZipArchiveOutputStream(path)) {
            for (var file : files.entrySet()) {
                var entry = new ZipArchiveEntry(file.getKey());
                entry.setUnixMode(0100644);
                zip.putArchiveEntry(entry);
                zip.write(file.getValue().getBytes());
                zip.closeArchiveEntry();
            }
            if (symlink != null) {
                var entry = new ZipArchiveEntry(symlink);
                entry.setUnixMode(0120777);
                zip.putArchiveEntry(entry);
                zip.write("/etc/passwd".getBytes());
                zip.closeArchiveEntry();
            }
        }
        return path;
    }
}
