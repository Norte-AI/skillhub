package com.iflytek.skillhub.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.config.GitImportProperties;
import com.iflytek.skillhub.domain.namespace.*;
import com.iflytek.skillhub.domain.user.*;
import com.iflytek.skillhub.domain.skill.*;
import com.iflytek.skillhub.domain.skill.service.SkillPublishService;
import com.iflytek.skillhub.dto.*;
import com.iflytek.skillhub.repository.GitSourceRepository;
import org.junit.jupiter.api.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import java.io.*;
import java.util.zip.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GitSourceServiceTest {
    private static final String SHA="a".repeat(40);
    private final GitSourceRepository repository=mock(GitSourceRepository.class);
    private final GitImportService imports=mock(GitImportService.class);
    private final SkillPublishAppService publications=mock(SkillPublishAppService.class);
    private final UserAccountRepository users=mock(UserAccountRepository.class);
    private final NamespaceRepository namespaces=mock(NamespaceRepository.class);
    private final NamespaceMemberRepository members=mock(NamespaceMemberRepository.class);
    private final GitImportProperties properties=new GitImportProperties();
    private final UUID id=UUID.randomUUID();
    private final AtomicReference<GitSourceRepository.Stored> stored=new AtomicReference<>();
    private GitSourceService service;
    @BeforeEach void setup() throws Exception {
        properties.setWebhookSecret("fixture-only-master-secret-at-least-32-characters");
        stored.set(new GitSourceRepository.Stored(new GitSourceResponse(id,"https://github.com/org/skills.git","main",".",null,"team","PUBLIC",false,true,null,null,"READY",null,null),"owner",UUID.randomUUID()));
        when(repository.find(id)).thenAnswer(i->Optional.of(stored.get()));
        when(repository.acquire(id)).thenReturn(true);
        when(repository.activeLease(id)).thenReturn(true);
        doAnswer(i->{var s=stored.get().source();stored.set(new GitSourceRepository.Stored(new GitSourceResponse(s.id(),s.repository(),s.ref(),s.subdir(),s.credentialId(),s.namespace(),s.visibility(),s.autoSync(),s.enabled(),
            i.getArgument(1)==null?s.lastCommit():i.getArgument(1),i.getArgument(2)==null?s.lastVersion():i.getArgument(2),i.getArgument(3),i.getArgument(4),java.time.Instant.now()),"owner",stored.get().nonce()));return null;}).when(repository).finish(eq(id),any(),any(),anyString(),any());
        when(users.findById("owner")).thenReturn(Optional.of(new UserAccount("owner","Owner",null,null)));
        Namespace ns=mock(Namespace.class);when(ns.getId()).thenReturn(7L);
        when(namespaces.findBySlug("team")).thenReturn(Optional.of(ns));
        when(members.findByNamespaceIdAndUserId(7L,"owner")).thenReturn(Optional.of(new NamespaceMember(7L,"owner",NamespaceRole.MEMBER)));
        var version=new SkillVersion(1L,"2.0.0","owner");version.setStatus(SkillVersionStatus.SCANNING);
        when(publications.publish(eq("team"),anyList(),eq("owner"),eq(SkillVisibility.PUBLIC),eq(Set.of()),eq(false),eq(SkillPublishAppService.AvatarAction.KEEP),isNull(),isNull(),any()))
            .thenReturn(new SkillPublishService.PublishResult(1L,"weather",version));
        String base64;
        try(var bytes=new ByteArrayOutputStream();var zip=new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("SKILL.md"));zip.write("fixture".getBytes());zip.closeEntry();zip.finish();base64=Base64.getEncoder().encodeToString(bytes.toByteArray());
        }
        when(imports.prepare(any(),eq("owner"))).thenReturn(new GitImportResponse(new GitImportResponse.Source(stored.get().source().repository(),"main",SHA,"."),"weather","2.0.0","Weather",List.of("SKILL.md"),7,List.of(),base64));
        service=new GitSourceService(repository,new GitRepositoryProvider(properties,new ObjectMapper()),imports,publications,users,namespaces,members,properties);
    }
    @Test void publishesThroughOrdinaryScanningFlowAndDeduplicatesCommit() {
        var result=service.syncOwned(id,"owner");assertEquals("SCANNING",result.lastStatus());assertEquals(SHA,result.lastCommit());
        assertEquals("UNCHANGED",service.syncOwned(id,"owner").lastStatus());
        verify(publications,times(1)).publish(any(),any(),any(),any(),eq(Set.of()),eq(false),any(),any(),any(),any());
    }
    @Test void refusesOtherOwnersAndRevokedMembershipBeforeRemoteRead() {
        assertThrows(RuntimeException.class,()->service.syncOwned(id,"stranger"));
        when(members.findByNamespaceIdAndUserId(7L,"owner")).thenReturn(Optional.empty());
        assertEquals("FAILED",service.syncOwned(id,"owner").lastStatus());verifyNoInteractions(imports);
    }
    @Test void preservesPreviousCommitWhenImmutableVersionPublicationIsRejected() {
        when(publications.publish(any(),any(),any(),any(),any(),anyBoolean(),any(),any(),any(),any())).thenThrow(new IllegalArgumentException("duplicate version fixture-secret"));
        var result=service.syncOwned(id,"owner");assertEquals("FAILED",result.lastStatus());assertNull(result.lastCommit());
        assertFalse(result.lastError().contains("fixture-secret"));
    }
    @Test void rejectsForgedWebhookAndTreatsRepeatedSignedDeliveriesAsNoOp() {
        byte[] body="{}".getBytes();
        assertThrows(RuntimeException.class,()->service.webhook(id,body,"sha256=bad",null));verifyNoInteractions(imports);
        String key=GitSourceService.hmac(properties.getWebhookSecret(),("git-source:"+id+":"+stored.get().nonce()).getBytes());
        String signature="sha256="+GitSourceService.hmac(key,body);
        assertEquals("SCANNING",service.webhook(id,body,signature,null).lastStatus());
        assertEquals("UNCHANGED",service.webhook(id,body,signature,null).lastStatus());
    }
    @Test void supportsNativeGitlabSecretTokenAndRotatesPerSourceKey() {
        var gitlab=new GitImportProperties.Provider();gitlab.setKind(GitImportProperties.Kind.GITLAB);gitlab.setApiBase("https://gitlab.com/api/v4");gitlab.setArchiveBase("https://gitlab.com/api/v4");properties.getProviders().put("gitlab.com",gitlab);
        var s=stored.get().source();stored.set(new GitSourceRepository.Stored(new GitSourceResponse(id,"https://gitlab.com/org/skills.git",s.ref(),s.subdir(),null,s.namespace(),s.visibility(),false,true,null,null,"READY",null,null),"owner",stored.get().nonce()));
        doAnswer(i->{stored.set(new GitSourceRepository.Stored(stored.get().source(),"owner",UUID.randomUUID()));return null;}).when(repository).rotate(id);
        var first=service.rotateWebhook(id,"owner");assertEquals("X-Gitlab-Token",first.header());
        var second=service.rotateWebhook(id,"owner");assertNotEquals(first.secret(),second.secret());
        assertThrows(RuntimeException.class,()->service.webhook(id,new byte[0],null,first.secret()));
        assertEquals("SCANNING",service.webhook(id,new byte[0],null,second.secret()).lastStatus());
    }
    @Test void disablingSourceDuringFetchPreventsPublication() {
        when(repository.activeLease(id)).thenReturn(false);
        assertEquals("FAILED",service.syncOwned(id,"owner").lastStatus());
        verifyNoInteractions(publications);
    }
    @Test void rejectsConcurrentOrDisabledSyncBeforeImport() {
        when(repository.acquire(id)).thenReturn(false);
        assertThrows(RuntimeException.class,()->service.syncOwned(id,"owner"));verifyNoInteractions(imports);
    }
}
