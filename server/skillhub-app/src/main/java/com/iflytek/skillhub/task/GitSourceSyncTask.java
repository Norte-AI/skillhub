package com.iflytek.skillhub.task;
import com.iflytek.skillhub.config.GitImportProperties;
import com.iflytek.skillhub.repository.GitSourceRepository;
import com.iflytek.skillhub.service.GitSourceService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
public class GitSourceSyncTask {
    private final GitImportProperties properties;
    private final GitSourceRepository sources;
    private final GitSourceService service;
    public GitSourceSyncTask(GitImportProperties properties,GitSourceRepository sources,GitSourceService service) {
        this.properties=properties;this.sources=sources;this.service=service;
    }
    @Scheduled(fixedDelayString="${skillhub.git.poll-delay-ms:60000}")
    public void poll() {
        for(var id:sources.due(properties.isAutomaticSyncEnabled())) {
            try { service.sync(id); } catch(RuntimeException ignored) { /* Another worker owns the source or it was deleted. */ }
        }
    }
}
