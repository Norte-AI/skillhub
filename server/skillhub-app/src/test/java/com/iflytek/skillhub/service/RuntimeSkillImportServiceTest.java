package com.iflytek.skillhub.service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.domain.skill.service.*;
import com.iflytek.skillhub.dto.RuntimeImportRequest;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.util.*;
import java.util.zip.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class RuntimeSkillImportServiceTest {
    @Test void importsOnlyPublishedPublicFixedVersionAndPassesActorWithoutFetchingExternalUrl() throws Exception {
        var queries=mock(SkillQueryService.class);var downloads=mock(SkillDownloadService.class);var gateway=mock(RuntimeGatewayService.class);
        var skill=detail("PUBLIC");
        var version=new SkillQueryService.SkillVersionDetailDTO(1L,"1.0.0","PUBLISHED",null,1,9L,null,null,null);
        when(queries.getSkillDetail("global","weather","owner",Map.of())).thenReturn(skill);
        when(queries.getVersionDetail("global","weather","1.0.0","owner",Map.of())).thenReturn(version);
        byte[] archive;try(var bytes=new ByteArrayOutputStream();var zip=new ZipOutputStream(bytes)){
            zip.putNextEntry(new ZipEntry("SKILL.md"));zip.write("# Weather".getBytes());zip.closeEntry();zip.finish();archive=bytes.toByteArray();
        }
        when(downloads.downloadVersion("global","weather","1.0.0","owner",Map.of())).thenReturn(new SkillDownloadService.DownloadResult(()->new ByteArrayInputStream(archive),"skill.zip",archive.length,"application/zip","https://must-not-fetch.invalid",false));
        var response=new RuntimeGatewayService.Result(200,"application/json","{}".getBytes());
        when(gateway.request(eq("POST"),eq("/internal/registry-import"),isNull(),eq("application/json"),any(),eq("owner"),eq(true))).thenReturn(response);
        var service=new RuntimeSkillImportService(queries,downloads,gateway,new ObjectMapper());
        assertSame(response,service.importSkill(new RuntimeImportRequest("global","weather","1.0.0"),"owner",Map.of()));
        var body=org.mockito.ArgumentCaptor.forClass(byte[].class);
        verify(gateway).request(eq("POST"),eq("/internal/registry-import"),isNull(),eq("application/json"),body.capture(),eq("owner"),eq(true));
        var json=new ObjectMapper().readTree(body.getValue());assertTrue(json.path("id").asText().startsWith("registry-"));assertEquals("1.0.0",json.path("source").path("version").asText());
        when(queries.getSkillDetail("global","weather","owner",Map.of())).thenReturn(detail("PRIVATE"));assertThrows(RuntimeException.class,()->service.importSkill(new RuntimeImportRequest("global","weather","1.0.0"),"owner",Map.of()));
        when(queries.getSkillDetail("global","weather","owner",Map.of())).thenReturn(skill);when(queries.getVersionDetail("global","weather","1.0.0","owner",Map.of())).thenReturn(new SkillQueryService.SkillVersionDetailDTO(1L,"1.0.0","PENDING_REVIEW",null,1,9L,null,null,null));assertThrows(RuntimeException.class,()->service.importSkill(new RuntimeImportRequest("global","weather","1.0.0"),"owner",Map.of()));
        verify(downloads,times(1)).downloadVersion(anyString(),anyString(),anyString(),anyString(),any());
    }
    private SkillQueryService.SkillDetailDTO detail(String visibility) {
        return new SkillQueryService.SkillDetailDTO(1L,"weather","Weather","owner","Owner","Weather",visibility,"ACTIVE",0L,0,0,null,0,false,1L,null,null,true,false,true,false,null,null,null,null,null,null,null);
    }
    @Test void gatewayRejectsClientSelectedHostsAndInternalRoutesBeforeNetwork() {
        var properties=new com.iflytek.skillhub.config.RuntimeProperties();properties.setServiceToken("fixture-token-at-least-thirty-two-chars");
        var service=new RuntimeGatewayService(properties);
        try {for(String path:List.of("//evil.example/path","/internal/registry-import","/api/../internal","/api/%2e%2e/x"))assertThrows(RuntimeException.class,()->service.request("GET",path,null,null,new byte[0],"owner",false));}
        finally {service.close();}
    }
}
