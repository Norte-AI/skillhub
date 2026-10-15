package com.iflytek.skillhub.service;
import com.iflytek.skillhub.config.RuntimeProperties;
import com.iflytek.skillhub.domain.shared.exception.DomainBadRequestException;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;
import java.net.*;
import java.net.http.*;
import java.io.*;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
@Service
public class RuntimeGatewayService {
    public record Result(int status,String contentType,byte[] body) {}
    static final int MAX_BYTES=24*1024*1024;
    private final RuntimeProperties properties;
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor(r->{var t=new Thread(r,"runtime-deadline");t.setDaemon(true);return t;});
    public RuntimeGatewayService(RuntimeProperties properties){this.properties=properties;}
    @PreDestroy void close(){deadlines.shutdownNow();client.close();}
    public Result request(String method,String path,String query,String contentType,byte[] body,String actor,boolean internal) {
        if(!method.equals("GET")&&!method.equals("HEAD")&&!method.equals("POST"))throw invalid("Unsupported runtime method.");
        if(path==null||!path.startsWith("/")||path.contains("..")||path.contains("%")||path.contains("\\")||path.contains("//")
            || !(internal?path.equals("/internal/registry-import"):path.equals("/")||path.equals("/health")||path.equals("/ready")||path.startsWith("/api/")||path.startsWith("/assets/")))throw invalid("Invalid runtime path.");
        if(body.length>MAX_BYTES)throw invalid("Runtime request exceeds size limit.");
        try {
            URI base=URI.create(properties.getBaseUrl());
            if(!(base.getScheme().equals("http")||base.getScheme().equals("https"))||base.getHost()==null||base.getUserInfo()!=null
                ||base.getQuery()!=null||base.getFragment()!=null||!(base.getPath().isEmpty()||base.getPath().equals("/")))throw invalid("Invalid runtime service configuration.");
            String token=properties.getServiceToken();
            if(token==null||token.length()<32||token.chars().anyMatch(c->c<=32||c==127))throw invalid("Runtime service is not configured.");
            if(query!=null&&(query.indexOf('#')>=0||query.chars().anyMatch(c->c<32||c==127)))throw invalid("Invalid runtime query.");
            URI uri=URI.create(base.getScheme()+"://"+base.getRawAuthority()+path+(query==null?"":"?"+query));
            var builder=HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(30)).header("Authorization","Bearer "+token)
                .header("X-SkillHub-Actor",actor).header("Content-Type",contentType==null?"application/json":contentType);
            var response=client.send(builder.method(method,body.length==0?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofByteArray(body)).build(),HttpResponse.BodyHandlers.ofInputStream());
            try(var input=response.body()) {
                var timeout=deadlines.schedule(()->{try{input.close();}catch(IOException ignored){}},30,TimeUnit.SECONDS);
                try {
                    byte[] bytes=input.readNBytes(MAX_BYTES+1);
                    if(bytes.length>MAX_BYTES)throw invalid("Runtime response exceeds size limit.");
                    if(response.statusCode()>=300&&response.statusCode()<400)throw invalid("Runtime redirects are not permitted.");
                    String mime=response.headers().firstValue("Content-Type").orElse("application/octet-stream");
                    if(path.equals("/")&&mime.startsWith("text/html")) {
                        String html=new String(bytes,StandardCharsets.UTF_8).replace("<head>","<head><meta name=\"skillhub-base\" content=\"/api/web/runtime\">");
                        bytes=html.getBytes(StandardCharsets.UTF_8);
                    }
                    return new Result(response.statusCode(),mime,bytes);
                } finally {timeout.cancel(false);}
            }
        } catch(InterruptedException e){Thread.currentThread().interrupt();throw invalid("Runtime request interrupted.");}
          catch(IOException|IllegalArgumentException e){throw invalid("Runtime service is unavailable.");}
    }
    private static DomainBadRequestException invalid(String text){return new DomainBadRequestException("error.skill.gitImport.invalid",text);}
}
