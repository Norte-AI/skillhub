package com.iflytek.skillhub.repository;

import com.iflytek.skillhub.dto.GitSourceResponse;
import com.iflytek.skillhub.dto.GitSourceRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.time.Instant;
import java.util.*;

/** SQL owns source leases and owner-scoped query projection; source credentials remain configuration-only. */
@Repository
public class GitSourceRepository {
    public record Stored(GitSourceResponse source, String owner, UUID nonce) {}
    private final JdbcTemplate jdbc;
    public GitSourceRepository(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    private static final org.springframework.jdbc.core.RowMapper<Stored> MAPPER=(rs,n)-> {
        var checked=rs.getTimestamp("last_checked_at");
        return new Stored(new GitSourceResponse(rs.getObject("id", UUID.class),rs.getString("repository"),
            rs.getString("requested_ref"),rs.getString("subdir"),rs.getString("credential_id"),
            rs.getString("namespace"),rs.getString("visibility"),rs.getBoolean("auto_sync"),rs.getBoolean("enabled"),
            rs.getString("last_commit"),rs.getString("last_version"),rs.getString("last_status"),
            rs.getString("last_error"),checked==null?null:checked.toInstant()),rs.getString("owner_id"),rs.getObject("hook_nonce",UUID.class));
    };
    public List<GitSourceResponse> list(String owner) {
        return jdbc.query("SELECT * FROM git_source WHERE owner_id=? ORDER BY created_at DESC",MAPPER,owner).stream().map(Stored::source).toList();
    }
    public Optional<Stored> find(UUID id) {
        return jdbc.query("SELECT * FROM git_source WHERE id=?",MAPPER,id).stream().findFirst();
    }
    public void create(UUID id,String owner,GitSourceRequest request,String url,String ref,String subdir) {
        jdbc.update("""
            INSERT INTO git_source(id,owner_id,repository,requested_ref,subdir,credential_id,namespace,visibility,auto_sync,hook_nonce)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            """,id,owner,url,ref,subdir,request.credentialId(),request.namespace(),request.visibility().toUpperCase(Locale.ROOT),request.autoSync(),UUID.randomUUID());
    }
    public boolean acquire(UUID id) {
        return jdbc.update("""
            UPDATE git_source SET lease_until=CURRENT_TIMESTAMP + INTERVAL '3 minutes'
            WHERE id=? AND enabled AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)
            """,id)==1;
    }
    public boolean activeLease(UUID id) {
        Integer count=jdbc.queryForObject("SELECT COUNT(*) FROM git_source WHERE id=? AND enabled AND lease_until>CURRENT_TIMESTAMP",Integer.class,id);
        return count!=null && count==1;
    }
    public void finish(UUID id,String commit,String version,String status,String error) {
        jdbc.update("""
            UPDATE git_source SET last_commit=COALESCE(?,last_commit),last_version=COALESCE(?,last_version),
              last_status=?,last_error=?,last_checked_at=CURRENT_TIMESTAMP,lease_until=NULL WHERE id=?
            """,commit,version,status,error,id);
    }
    public void update(UUID id,boolean enabled,boolean automatic) {
        jdbc.update("UPDATE git_source SET enabled=?,auto_sync=? WHERE id=?",enabled,automatic,id);
    }
    public boolean delete(UUID id) {
        return jdbc.update("DELETE FROM git_source WHERE id=? AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)",id)==1;
    }
    public void rotate(UUID id) { jdbc.update("UPDATE git_source SET hook_nonce=? WHERE id=?",UUID.randomUUID(),id); }
    public List<UUID> due() {
        return jdbc.queryForList("""
            SELECT id FROM git_source WHERE enabled AND auto_sync
              AND (last_checked_at IS NULL OR last_checked_at<CURRENT_TIMESTAMP-INTERVAL '15 minutes')
            ORDER BY last_checked_at NULLS FIRST LIMIT 10
            """,UUID.class);
    }
}
