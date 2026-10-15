package com.iflytek.skillhub.controller.portal;

import com.iflytek.skillhub.controller.BaseApiController;
import com.iflytek.skillhub.auth.rbac.PlatformPrincipal;
import com.iflytek.skillhub.config.GitImportProperties;
import com.iflytek.skillhub.dto.*;
import com.iflytek.skillhub.ratelimit.RateLimit;
import com.iflytek.skillhub.service.GitImportService;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Prepares a package only; namespace authorization and publishing remain in the existing endpoint. */
@RestController
@RequestMapping({"/api/web/skills/git-import", "/api/v1/skills/git-import"})
public class GitImportController extends BaseApiController {
    private final GitImportService service;
    private final GitImportProperties properties;
    public GitImportController(GitImportService service, ApiResponseFactory responseFactory,GitImportProperties properties) {
        super(responseFactory);this.service=service;this.properties=properties;
    }
    @PostMapping
    @RateLimit(category="git-import",authenticated=5,anonymous=0)
    public ApiResponse<GitImportResponse> prepare(@Valid @RequestBody GitImportRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ok("response.success",service.prepare(request,principal.userId()));
    }
    @GetMapping("/options")
    public ApiResponse<GitImportOptionsResponse> options(@AuthenticationPrincipal PlatformPrincipal principal) {
        var providers=properties.getProviders().entrySet().stream()
            .map(e->new GitImportOptionsResponse.Provider(e.getKey(),e.getValue().getKind().name())).toList();
        var credentials=properties.getCredentials().entrySet().stream()
            .filter(e->e.getValue().getUserIds().contains(principal.userId()))
            .map(e->new GitImportOptionsResponse.Credential(e.getKey(),e.getValue().getRepository())).toList();
        return ok("response.success",new GitImportOptionsResponse(providers,credentials,properties.isAutomaticSyncEnabled()));
    }
}
