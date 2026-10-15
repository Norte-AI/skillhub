package com.iflytek.skillhub.service;
import com.iflytek.skillhub.config.GitImportProperties;
import com.iflytek.skillhub.repository.GitSourceRepository;
import com.iflytek.skillhub.task.GitSourceSyncTask;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.mockito.Mockito.*;
class GitSourceSyncTaskTest {
    @Test void processesExplicitQueuedWorkWhenAutomaticPollingIsDisabled() {
        var properties=new GitImportProperties();
        var sources=mock(GitSourceRepository.class);
        var service=mock(GitSourceService.class);
        UUID id=UUID.randomUUID();when(sources.due(false)).thenReturn(List.of(id));
        new GitSourceSyncTask(properties,sources,service).poll();
        verify(sources).due(false);verify(service).sync(id);
    }
}
