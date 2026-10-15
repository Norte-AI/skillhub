package com.iflytek.skillhub.controller.portal;
import com.iflytek.skillhub.auth.rbac.PlatformPrincipal;
import com.iflytek.skillhub.service.RuntimeGatewayService;
import com.iflytek.skillhub.service.RuntimeSkillImportService;
import com.iflytek.skillhub.dto.RuntimeImportRequest;
import com.iflytek.skillhub.dto.RuntimeImportResponse;
import com.iflytek.skillhub.dto.ApiResponse;
import com.iflytek.skillhub.dto.ApiResponseFactory;
import com.iflytek.skillhub.controller.BaseApiController;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iflytek.skillhub.domain.namespace.NamespaceRole;
import com.iflytek.skillhub.domain.shared.exception.DomainBadRequestException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.Map;
@RestController
public class RuntimeController extends BaseApiController {
    private final RuntimeGatewayService gateway;
    private final RuntimeSkillImportService imports;
    private final ObjectMapper mapper;
    public RuntimeController(RuntimeGatewayService gateway,RuntimeSkillImportService imports,ObjectMapper mapper,ApiResponseFactory factory){super(factory);this.gateway=gateway;this.imports=imports;this.mapper=mapper;}
    @RequestMapping(value={"/api/web/runtime","/api/web/runtime/","/api/web/runtime/**"},method={RequestMethod.GET,RequestMethod.HEAD,RequestMethod.POST})
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ResponseEntity<byte[]> proxy(HttpServletRequest request,@AuthenticationPrincipal PlatformPrincipal principal)throws IOException {
        byte[] body=request.getInputStream().readNBytes(RuntimeSkillImportService.MAX_PACKAGE_BYTES+1);
        if(body.length>RuntimeSkillImportService.MAX_PACKAGE_BYTES)throw new DomainBadRequestException("error.skill.gitImport.invalid","Runtime request is too large.");
        String path=request.getRequestURI().substring("/api/web/runtime".length());
        var result=gateway.request(request.getMethod(),path.isEmpty()?"/":path,request.getQueryString(),request.getContentType(),body,principal.userId(),false);
        return response(result);
    }
    @PostMapping("/api/web/runtime-import-skill")
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    public ApiResponse<RuntimeImportResponse> importSkill(@Valid @RequestBody RuntimeImportRequest request,
        @AuthenticationPrincipal PlatformPrincipal principal,@RequestAttribute(value="userNsRoles",required=false)Map<Long,NamespaceRole> roles)throws IOException {
        var result=imports.importSkill(request,principal.userId(),roles==null?Map.of():roles);
        if(result.status()!=200)throw new DomainBadRequestException("error.skill.gitImport.invalid","Runtime import failed; the source version may conflict with existing runtime content.");
        return ok("response.success",mapper.readValue(result.body(),RuntimeImportResponse.class));
    }
    private ResponseEntity<byte[]> response(RuntimeGatewayService.Result result){return ResponseEntity.status(result.status()).header("Content-Type",result.contentType()).header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'").header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").body(result.body());}
}
