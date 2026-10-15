package com.iflytek.skillhub.dto;
import java.util.Map;
public record RuntimeImportResponse(String contentId,int revision,String digest,Map<String,String> source) {}
