package com.iflytek.skillhub.repository;

import com.iflytek.skillhub.dto.GitSourceRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
@AutoConfigureTestDatabase(replace=AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
@Testcontainers
@Import(GitSourceRepository.class)
@Transactional(propagation=Propagation.NOT_SUPPORTED)
class GitSourcePostgresTest {
    @Container static final PostgreSQLContainer<?> POSTGRES=new PostgreSQLContainer<>("postgres:16-alpine");
    @DynamicPropertySource static void postgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username",POSTGRES::getUsername);
        registry.add("spring.datasource.password",POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name",()->"org.postgresql.Driver");
        registry.add("spring.jpa.database-platform",()->"org.hibernate.dialect.PostgreSQLDialect");
        registry.add("spring.flyway.enabled",()->true);
        registry.add("spring.jpa.hibernate.ddl-auto",()->"validate");
    }
    @Autowired JdbcTemplate jdbc;
    @Autowired GitSourceRepository sources;
    @Test void sourceLeaseIsExclusiveDurableAndDeletionWaitsForSync() {
        String owner="git-source-"+UUID.randomUUID();UUID id=UUID.randomUUID();
        jdbc.update("INSERT INTO user_account(id,display_name,status,created_at,updated_at) VALUES (?,?,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",owner,"Git owner");
        var request=new GitSourceRequest("https://github.com/org/repo.git","main",".",null,"team","PUBLIC",true);
        sources.create(id,owner,request,request.repository(),"main",".");
        assertEquals(1,sources.list(owner).size());assertTrue(sources.list("stranger").isEmpty());
        assertTrue(sources.acquire(id));assertTrue(sources.activeLease(id));assertFalse(sources.acquire(id));assertFalse(sources.delete(id));
        sources.finish(id,"a".repeat(40),"1.0.0","SCANNING",null);
        assertTrue(sources.acquire(id));
        sources.finish(id,null,null,"UNCHANGED",null);
        assertEquals("a".repeat(40),sources.find(id).orElseThrow().source().lastCommit());
        var nonce=sources.find(id).orElseThrow().nonce();sources.rotate(id);
        assertNotEquals(nonce,sources.find(id).orElseThrow().nonce());
        sources.update(id,false,false);assertFalse(sources.acquire(id));
        assertTrue(sources.delete(id));assertTrue(sources.find(id).isEmpty());
        jdbc.update("DELETE FROM user_account WHERE id=?",owner);
    }
}
