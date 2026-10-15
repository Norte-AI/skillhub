package com.iflytek.skillhub.controller.portal;

import com.iflytek.skillhub.controller.BaseApiController;
import com.iflytek.skillhub.dto.*;
import com.iflytek.skillhub.ratelimit.RateLimit;
import com.iflytek.skillhub.service.GitSourceService;
import com.iflytek.skillhub.domain.shared.exception.DomainBadRequestException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/git-source-hooks")
public class GitSourceWebhookController extends BaseApiController {
    private final GitSourceService service;
    public GitSourceWebhookController(GitSourceService service,ApiResponseFactory factory) {super(factory);this.service=service;}
    @PostMapping("/{id}") @RateLimit(category="git-source-hook",authenticated=10,anonymous=10)
    public ApiResponse<GitSourceResponse> hook(@PathVariable UUID id,HttpServletRequest request,
        @RequestHeader(value="X-Hub-Signature-256",required=false) String github,
        @RequestHeader(value="X-Gitlab-Token",required=false) String gitlab) throws IOException {
        byte[] body=request.getInputStream().readNBytes(65537);
        if(body.length>65536) throw new DomainBadRequestException("error.skill.gitImport.invalid","Webhook payload exceeds 64 KiB.");
        return ok("response.success",service.webhook(id,body,github,gitlab));
    }
}
