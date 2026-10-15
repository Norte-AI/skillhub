package com.iflytek.skillhub.controller.portal;

import com.iflytek.skillhub.controller.BaseApiController;
import com.iflytek.skillhub.dto.*;
import com.iflytek.skillhub.ratelimit.RateLimit;
import com.iflytek.skillhub.service.GitImportService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

/** Prepares a package only; namespace authorization and publishing remain in the existing endpoint. */
@RestController
@RequestMapping({"/api/web/skills/git-import", "/api/v1/skills/git-import"})
public class GitImportController extends BaseApiController {
    private final GitImportService service;

    public GitImportController(GitImportService service, ApiResponseFactory responseFactory) {
        super(responseFactory);
        this.service = service;
    }

    @PostMapping
    @RateLimit(category = "git-import", authenticated = 5, anonymous = 0)
    public ApiResponse<GitImportResponse> prepare(@Valid @RequestBody GitImportRequest request) {
        return ok("response.success", service.prepare(request));
    }
}
