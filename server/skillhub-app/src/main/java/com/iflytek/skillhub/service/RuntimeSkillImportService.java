package com.iflytek.skillhub.service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.domain.skill.service.SkillQueryService;
import com.iflytek.skillhub.domain.skill.service.SkillDownloadService;
import com.iflytek.skillhub.domain.namespace.NamespaceRole;
import com.iflytek.skillhub.domain.shared.exception.DomainBadRequestException;
import com.iflytek.skillhub.domain.skill.validation.SkillPackagePolicy;
import com.iflytek.skillhub.dto.RuntimeImportRequest;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;
@Service
public class RuntimeSkillImportService {
    public static final int MAX_PACKAGE_BYTES=20*1024*1024;
    private final SkillQueryService queries;
    private final SkillDownloadService downloads;
    private final RuntimeGatewayService gateway;
    private final ObjectMapper mapper;
    public RuntimeSkillImportService(SkillQueryService queries,SkillDownloadService downloads,RuntimeGatewayService gateway,ObjectMapper mapper){this.queries=queries;this.downloads=downloads;this.gateway=gateway;this.mapper=mapper;}
    public RuntimeGatewayService.Result importSkill(RuntimeImportRequest request,String actor,Map<Long,NamespaceRole> roles)throws IOException {
        var skill=queries.getSkillDetail(request.namespace(),request.slug(),actor,roles);
        var version=queries.getVersionDetail(request.namespace(),request.slug(),request.version(),actor,roles);
        if(!skill.visibility().equals("PUBLIC")||!version.status().equals("PUBLISHED"))throw invalid("Only public published fixed skill versions can be imported into runtime.");
        var download=downloads.downloadVersion(request.namespace(),request.slug(),request.version(),actor,roles);
        byte[] archive;
        try(var input=download.openContent()){archive=input.readNBytes(MAX_PACKAGE_BYTES+1);}
        if(archive.length>MAX_PACKAGE_BYTES)throw invalid("Runtime import package exceeds 20 MiB.");
        List<Map<String,String>> resources=new ArrayList<>();Set<String> seen=new HashSet<>();String skillMd=null;long total=0;
        try(var zip=new ZipInputStream(new ByteArrayInputStream(archive))){ZipEntry entry;
            while((entry=zip.getNextEntry())!=null){
                if(entry.isDirectory())continue;
                String path=SkillPackagePolicy.normalizeEntryPath(entry.getName());
                if(!seen.add(path.toLowerCase(Locale.ROOT))||seen.size()>500||path.equalsIgnoreCase(".skillhub-registry.json"))throw invalid("Invalid or reserved runtime import path.");
                byte[] bytes=zip.readNBytes(10*1024*1024+1);total+=bytes.length;
                if(bytes.length>10*1024*1024||total>MAX_PACKAGE_BYTES)throw invalid("Runtime import content exceeds limits.");
                String text;
                try{text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
                catch(CharacterCodingException e){throw invalid("Runtime content currently requires UTF-8 text resources; this skill contains binary files.");}
                if(text.indexOf(0)>=0)throw invalid("Runtime content currently requires text resources.");
                if(path.equals("SKILL.md"))skillMd=text;else resources.add(Map.of("path",path,"body",text));
            }
        }
        if(skillMd==null)throw invalid("Skill package has no SKILL.md.");
        String digest=sha(archive);String id="registry-"+sha((request.namespace()+"/"+request.slug()+"@"+request.version()).getBytes(StandardCharsets.UTF_8)).substring(0,40);
        var source=Map.of("namespace",request.namespace(),"slug",request.slug(),"version",request.version(),"packageSha256",digest);
        byte[] body=mapper.writeValueAsBytes(Map.of("id",id,"title",skill.displayName(),"body",skillMd,"resources",resources,"source",source));
        return gateway.request("POST","/internal/registry-import",null,"application/json",body,actor,true);
    }
    private static String sha(byte[] value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value));}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    private static DomainBadRequestException invalid(String text){return new DomainBadRequestException("error.skill.gitImport.invalid",text);}
}
