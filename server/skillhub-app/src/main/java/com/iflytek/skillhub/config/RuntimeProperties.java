package com.iflytek.skillhub.config;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
@Component
@ConfigurationProperties(prefix="skillhub.runtime")
public class RuntimeProperties {
    private String baseUrl="http://runtime:4317";
    private String serviceToken;
    public String getBaseUrl(){return baseUrl;}
    public void setBaseUrl(String value){baseUrl=value;}
    public String getServiceToken(){return serviceToken;}
    public void setServiceToken(String value){serviceToken=value;}
}
