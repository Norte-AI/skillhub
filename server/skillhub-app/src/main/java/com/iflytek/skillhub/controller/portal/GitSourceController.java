package com.iflytek.skillhub.controller.portal;

import com.iflytek.skillhub.controller.BaseApiController;
import com.iflytek.skillhub.auth.rbac.PlatformPrincipal;
import com.iflytek.skillhub.dto.*;
import com.iflytek.skillhub.ratelimit.RateLimit;
import com.iflytek.skillhub.service.GitSourceService;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping({"/api/web/git-sources","/api/v1/git-sources"})
public class GitSourceController extends BaseApiController {
    private final GitSourceService service;
    public GitSourceController(GitSourceService service,ApiResponseFactory responseFactory) {
        super(responseFactory);this.service=service;
    }
    @GetMapping public ApiResponse<List<GitSourceResponse>> list(@AuthenticationPrincipal PlatformPrincipal principal) {
        return ok("response.success",service.list(principal.userId()));
    }
    @PostMapping @RateLimit(category="git-source-create",authenticated=10,anonymous=0)
    public ApiResponse<GitSourceResponse> create(@Valid @RequestBody GitSourceRequest request,@AuthenticationPrincipal PlatformPrincipal principal) {
        return ok("response.success",service.create(principal.userId(),request));
    }
    @PostMapping("/{id}/sync") @RateLimit(category="git-source-sync",authenticated=5,anonymous=0)
    public ApiResponse<GitSourceResponse> sync(@PathVariable UUID id,@AuthenticationPrincipal PlatformPrincipal principal) {
        return ok("response.success",service.syncOwned(id,principal.userId()));
    }
    @PatchMapping("/{id}") public ApiResponse<GitSourceResponse> update(@PathVariable UUID id,@RequestBody GitSourceUpdateRequest request,
            @AuthenticationPrincipal PlatformPrincipal principal) {
        return ok("response.success",service.update(id,principal.userId(),request.enabled(),request.autoSync()));
    }
    @DeleteMapping("/{id}") public ApiResponse<Void> delete(@PathVariable UUID id,@AuthenticationPrincipal PlatformPrincipal principal) {
        service.delete(id,principal.userId());return ok("response.success",null);
    }
    @PostMapping("/{id}/webhook-secret") @RateLimit(category="git-source-secret",authenticated=5,anonymous=0)
    public ApiResponse<GitWebhookSecretResponse> secret(@PathVariable UUID id,@AuthenticationPrincipal PlatformPrincipal principal) {
        return ok("response.success",service.rotateWebhook(id,principal.userId()));
    }
}
