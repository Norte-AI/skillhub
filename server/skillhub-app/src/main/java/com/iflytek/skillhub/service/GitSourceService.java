package com.iflytek.skillhub.service;

import com.iflytek.skillhub.config.GitImportProperties;
import com.iflytek.skillhub.domain.namespace.*;
import com.iflytek.skillhub.domain.user.UserAccountRepository;
import com.iflytek.skillhub.domain.shared.exception.DomainBadRequestException;
import com.iflytek.skillhub.domain.skill.SkillVisibility;
import com.iflytek.skillhub.domain.skill.validation.PackageEntry;
import com.iflytek.skillhub.dto.*;
import com.iflytek.skillhub.repository.GitSourceRepository;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.util.*;
import java.util.zip.ZipInputStream;

/** Every sync rechecks the owner's live account/membership and uses the normal scan/review publish flow. */
@Service
public class GitSourceService {
    private final GitSourceRepository sources;
    private final GitRepositoryProvider providers;
    private final GitImportService imports;
    private final SkillPublishAppService publications;
    private final UserAccountRepository users;
    private final NamespaceRepository namespaces;
    private final NamespaceMemberRepository members;
    private final GitImportProperties properties;
    public GitSourceService(GitSourceRepository sources,GitRepositoryProvider providers,GitImportService imports,
        SkillPublishAppService publications,UserAccountRepository users,NamespaceRepository namespaces,
        NamespaceMemberRepository members,GitImportProperties properties) {
        this.sources=sources;this.providers=providers;this.imports=imports;this.publications=publications;
        this.users=users;this.namespaces=namespaces;this.members=members;this.properties=properties;
    }
    public List<GitSourceResponse> list(String owner) { return sources.list(owner); }
    public GitSourceResponse create(String owner,GitSourceRequest request) {
        assertPublisher(owner,request.namespace());
        var repo=providers.parse(request.repository());
        String ref=request.ref()==null||request.ref().isBlank()?"HEAD":request.ref().trim();
        if(ref.length()>256 || ref.chars().anyMatch(c->c<32||c==127)) throw invalid("Invalid Git ref.");
        String subdir=GitImportService.normalizeSubdir(request.subdir());
        providers.commit(repo,ref,request.credentialId(),owner); // Validate credential binding without a network request.
        if(sources.list(owner).size()>=20) throw invalid("At most 20 Git sources per user.");
        if(request.autoSync()&&!properties.isAutomaticSyncEnabled()) throw invalid("Automatic sync is disabled by the operator.");
        UUID id=UUID.randomUUID();
        sources.create(id,owner,request,repo.url(),ref,subdir);
        return sources.find(id).orElseThrow().source();
    }
    private GitSourceRepository.Stored owned(UUID id,String owner) {
        var stored=sources.find(id).orElseThrow(()->invalid("Git source is unavailable."));
        if(!stored.owner().equals(owner)) throw invalid("Git source is unavailable.");
        return stored;
    }
    public GitSourceResponse update(UUID id,String owner,boolean enabled,boolean automatic) {
        owned(id,owner);
        if(automatic&&!properties.isAutomaticSyncEnabled()) throw invalid("Automatic sync is disabled by the operator.");
        sources.update(id,enabled,automatic);
        return sources.find(id).orElseThrow().source();
    }
    public void delete(UUID id,String owner) {
        owned(id,owner);
        if(!sources.delete(id)) throw invalid("Sync is running; retry deletion shortly.");
    }
    public GitSourceResponse syncOwned(UUID id,String owner) { owned(id,owner);return sync(id); }
    public GitSourceResponse sync(UUID id) {
        var stored=sources.find(id).orElseThrow(()->invalid("Git source is unavailable."));
        UUID lease=sources.acquire(id).orElseThrow(()->invalid("Git source is disabled or a sync is already running."));
        stored=sources.find(id).orElseThrow(()->invalid("Git source is unavailable."));
        var source=stored.source();
        try {
            assertPublisher(stored.owner(),source.namespace());
            var prepared=imports.prepare(new GitImportRequest(source.repository(),source.ref(),source.subdir(),source.credentialId()),stored.owner());
            if(prepared.source().commit().equals(source.lastCommit())) {
                sources.finish(id,lease,null,null,"UNCHANGED",null);
            } else {
                // Automatic imports never confirm fresh warnings or inherit platform-admin direct publication privileges.
                if(!prepared.warnings().isEmpty()) throw invalid("Git package has warnings. Import and confirm manually before syncing this source.");
                assertPublisher(stored.owner(),source.namespace());
                if(!sources.activeLease(id,lease)) throw invalid("Git source was disabled or its sync lease expired.");
                var result=publications.publish(source.namespace(),entries(prepared.packageBase64()),stored.owner(),
                    SkillVisibility.valueOf(source.visibility()),Set.of(),false,SkillPublishAppService.AvatarAction.KEEP,
                    null,null,new AuditRequestContext(null,"SkillHub Git source sync"));
                sources.finish(id,lease,prepared.source().commit(),result.version().getVersion(),result.version().getStatus().name(),null);
            }
        } catch(Exception e) {
            // Deliberately do not persist remote errors, response bodies or credentials.
            sources.finish(id,lease,null,null,"FAILED","Sync failed. Check source access, namespace permission, package warnings and a new SKILL.md version; retry manually.");
        }
        return sources.find(id).orElseThrow().source();
    }
    private void assertPublisher(String owner,String namespace) {
        if(users.findById(owner).filter(u->u.isActive()).isEmpty()) throw invalid("Source owner is inactive.");
        var ns=namespaces.findBySlug(namespace).orElseThrow(()->invalid("Namespace is unavailable."));
        if(members.findByNamespaceIdAndUserId(ns.getId(),owner).isEmpty()) throw invalid("Join the target namespace before configuring Git sync.");
    }
    static List<PackageEntry> entries(String base64) throws IOException {
        List<PackageEntry> result=new ArrayList<>();
        try(var zip=new ZipInputStream(new ByteArrayInputStream(Base64.getDecoder().decode(base64)))) {
            java.util.zip.ZipEntry entry;
            while((entry=zip.getNextEntry())!=null) {
                byte[] bytes=zip.readAllBytes();
                result.add(new PackageEntry(entry.getName(),bytes,bytes.length,"application/octet-stream"));
            }
        }
        return result;
    }
    public GitWebhookSecretResponse rotateWebhook(UUID id,String owner) {
        owned(id,owner);
        masterSecret();
        sources.rotate(id);
        var stored=sources.find(id).orElseThrow();
        boolean gitlab=providers.parse(stored.source().repository()).provider().getKind()==GitImportProperties.Kind.GITLAB;
        return new GitWebhookSecretResponse(hookKey(stored),"/api/v1/git-source-hooks/"+id,gitlab?"X-Gitlab-Token":"X-Hub-Signature-256");
    }
    public GitSourceResponse webhook(UUID id,byte[] body,String githubSignature,String gitlabToken) {
        var stored=sources.find(id).orElseThrow(()->invalid("Invalid webhook."));
        String key=hookKey(stored);
        boolean gitlab=providers.parse(stored.source().repository()).provider().getKind()==GitImportProperties.Kind.GITLAB;
        String expected=gitlab?key:"sha256="+hmac(key,body);
        String actual=gitlab?gitlabToken:githubSignature;
        if(actual==null||!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),actual.getBytes(StandardCharsets.UTF_8))) throw invalid("Invalid webhook signature.");
        // Body is only an authenticated wake-up signal: always resolve configured repository/ref ourselves.
        if(!sources.enqueue(id)) throw invalid("Git source is disabled or unavailable.");
        return sources.find(id).orElseThrow(()->invalid("Git source is unavailable.")).source();
    }
    private String masterSecret() {
        String secret=properties.getWebhookSecret();
        if(secret==null||secret.length()<32) throw invalid("Webhook secret is not configured by the operator.");
        return secret;
    }
    private String hookKey(GitSourceRepository.Stored stored) {
        return hmac(masterSecret(),("git-source:"+stored.source().id()+":"+stored.nonce()).getBytes(StandardCharsets.UTF_8));
    }
    static String hmac(String secret,byte[] body) {
        try {
            Mac mac=Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(body));
        } catch(GeneralSecurityException e) { throw new IllegalStateException("HMAC unavailable",e); }
    }
    private static DomainBadRequestException invalid(String message) { return new DomainBadRequestException("error.skill.gitImport.invalid",message); }
}
