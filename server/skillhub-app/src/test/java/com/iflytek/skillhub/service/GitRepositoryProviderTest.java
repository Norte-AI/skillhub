package com.iflytek.skillhub.service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.config.*;
import com.iflytek.skillhub.domain.skill.metadata.SkillMetadataParser;
import com.iflytek.skillhub.domain.skill.validation.SkillPackageValidator;
import com.iflytek.skillhub.dto.GitImportRequest;
import org.junit.jupiter.api.Test;
import java.util.*;
import java.net.http.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GitRepositoryProviderTest {
    private static final String SHA="a".repeat(40);
    private final GitImportProperties properties=new GitImportProperties();
    private GitRepositoryProvider provider() { return new GitRepositoryProvider(properties,new ObjectMapper()); }
    private void enableGitlab() {
        var gitlab=new GitImportProperties.Provider();gitlab.setKind(GitImportProperties.Kind.GITLAB);
        gitlab.setApiBase("https://gitlab.com/api/v4");gitlab.setArchiveBase("https://gitlab.com/api/v4");
        properties.getProviders().put("gitlab.com",gitlab);
    }
    @Test void enforcesExactProviderHostAndRepositoryGrammar() {
        enableGitlab();
        assertEquals("org/group/skills",provider().parse("https://gitlab.com/org/group/skills.git").coordinate());
        assertEquals("https://github.com/org/skills.git",provider().parse("https://github.com/org/skills").url());
        for(String url:List.of("https://gitlab.com.evil/org/repo","https://gitlab.com:443/org/repo",
            "https://user@gitlab.com/org/repo","https://gitee.com/org/repo","https://gitlab.com/org/repo?token=x",
            "https://gitlab.com/org/%2e%2e/repo","https://gitlab.com/org/repo#fragment","http://gitlab.com/org/repo")) {
            assertThrows(RuntimeException.class,()->provider().parse(url));
        }
    }
    @Test void bindsCredentialToExactRepositoryAndOwnerWithoutPuttingTokenInUrl() {
        enableGitlab();
        var secret=new GitImportProperties.Credential();secret.setToken("private-test-token");
        secret.setRepository("https://gitlab.com/org/skills.git");secret.setUserIds(Set.of("owner"));
        properties.getCredentials().put("read-only",secret);
        var repo=provider().parse(secret.getRepository());
        var fetch=provider().commit(repo,"feature/x","read-only","owner");
        assertEquals("private-test-token",fetch.headers().get("PRIVATE-TOKEN"));
        assertEquals("https://gitlab.com/api/v4/projects/org%2Fskills/repository/commits/feature%2Fx",fetch.uri().toString());
        assertFalse(fetch.uri().toString().contains("private-test-token"));
        assertThrows(RuntimeException.class,()->provider().commit(repo,"main","read-only","stranger"));
        assertThrows(RuntimeException.class,()->provider().commit(provider().parse("https://gitlab.com/org/other"),"main","read-only","owner"));
    }
    @SuppressWarnings("unchecked")
    @Test void importsPrivateGitlabViaFakeProviderTransportAndPinnedArchive() throws Exception {
        enableGitlab();
        var secret=new GitImportProperties.Credential();secret.setToken("fixture-secret");
        secret.setRepository("https://gitlab.com/org/group/skills.git");secret.setUserIds(Set.of("owner"));
        properties.getCredentials().put("fixture",secret);
        byte[] archive;
        try(var bytes=new ByteArrayOutputStream();var zip=new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("project-commit/skills/weather/SKILL.md"));
            zip.write("---\nname: weather\ndescription: Weather fixture\nversion: 2.0.0\n---\n# Weather".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();zip.finish();archive=bytes.toByteArray();
        }
        var client=mock(HttpClient.class);
        List<HttpRequest> requests=new ArrayList<>();
        when(client.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenAnswer(call->{
            HttpRequest request=call.getArgument(0);requests.add(request);
            assertEquals("fixture-secret",request.headers().firstValue("PRIVATE-TOKEN").orElseThrow());
            var response=mock(HttpResponse.class);when(response.statusCode()).thenReturn(200);
            byte[] bytes=request.uri().getPath().endsWith("archive.zip")?archive:("{\"id\":\""+SHA+"\"}").getBytes(StandardCharsets.UTF_8);
            when(response.body()).thenReturn(new ByteArrayInputStream(bytes));return response;
        });
        var mapper=new ObjectMapper();var parser=new SkillMetadataParser();
        var service=new GitImportService(mapper,new SkillPackageValidator(parser),parser,new SkillPublishProperties(),provider(),client);
        try {
            var result=service.prepare(new GitImportRequest(secret.getRepository(),"main","skills/weather","fixture"),"owner");
            assertEquals(SHA,result.source().commit());assertEquals("2.0.0",result.version());
            assertEquals(2,requests.size());
            assertEquals("sha="+SHA,requests.get(1).uri().getRawQuery());
            assertTrue(result.files().contains(".skillhub-source.json"));
            assertFalse(new String(Base64.getDecoder().decode(result.packageBase64()),StandardCharsets.ISO_8859_1).contains("fixture-secret"));
        } finally {service.close();}
    }
    @SuppressWarnings("unchecked")
    @Test void privateGithubUsesOnlyAuthenticatedTreeBlobApiWithoutCodeloadOrRedirects() throws Exception {
        var secret=new GitImportProperties.Credential();secret.setToken("github-fixture-token");
        secret.setRepository("https://github.com/org/private-skills.git");secret.setUserIds(Set.of("owner"));
        properties.getCredentials().put("private",secret);
        String blob="b".repeat(40);
        byte[] skill="---\nname: weather\ndescription: Private weather\nversion: 3.0.0\n---\n# Weather".getBytes(StandardCharsets.UTF_8);
        String tree="{\"truncated\":false,\"tree\":[{\"path\":\"skills/weather/SKILL.md\",\"mode\":\"100644\",\"type\":\"blob\",\"sha\":\""+blob+"\",\"size\":"+skill.length+"}]}";
        var client=mock(HttpClient.class);List<HttpRequest> requests=new ArrayList<>();
        when(client.send(any(HttpRequest.class),any(HttpResponse.BodyHandler.class))).thenAnswer(call->{
            HttpRequest request=call.getArgument(0);requests.add(request);
            assertEquals("api.github.com",request.uri().getHost());
            assertEquals("Bearer github-fixture-token",request.headers().firstValue("Authorization").orElseThrow());
            var response=mock(HttpResponse.class);when(response.statusCode()).thenReturn(200);
            byte[] body=request.uri().getPath().contains("/git/trees/")?tree.getBytes(StandardCharsets.UTF_8):
                request.uri().getPath().contains("/git/blobs/")?skill:SHA.getBytes(StandardCharsets.UTF_8);
            when(response.body()).thenReturn(new ByteArrayInputStream(body));return response;
        });
        var mapper=new ObjectMapper();var parser=new SkillMetadataParser();
        var service=new GitImportService(mapper,new SkillPackageValidator(parser),parser,new SkillPublishProperties(),provider(),client);
        try {
            var result=service.prepare(new GitImportRequest(secret.getRepository(),"main","skills/weather","private"),"owner");
            assertEquals(SHA,result.source().commit());assertEquals("3.0.0",result.version());assertEquals(3,requests.size());
            assertTrue(requests.get(1).uri().getPath().endsWith(SHA));
            assertEquals("application/vnd.github.raw+json",requests.get(2).headers().firstValue("Accept").orElseThrow());
        } finally {service.close();}
    }

    @Test void rejectsProviderRedirectAndMalformedCommitWithoutArchiveFetch() {
        enableGitlab();var repo=provider().parse("https://gitlab.com/org/repo");
        assertThrows(RuntimeException.class,()->provider().commitSha(repo,"{\"id\":\"main\"}".getBytes(StandardCharsets.UTF_8)));
        assertEquals("https://gitlab.com/api/v4/projects/org%2Frepo/repository/archive.zip?sha="+SHA,
            provider().archive(repo,SHA,null,null).uri().toString());
    }
}
