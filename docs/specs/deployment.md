# Deployment Guide

## Docker Deployment

### Docker Compose

```yaml
version: '3.8'
services:
  immich-public-proxy:
    image: ghcr.io/danibram/immich-proxy-go:latest
    environment:
      - IMMICH_URL=http://immich-server:2283
      - PUBLIC_BASE_URL=https://photos.example.com
      - IPP_SECURITY_ALLOWED_ORIGINS=https://photos.example.com
      - IPP_COOKIE_SECRET=your-secret-here
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
```

### Build from Source

```dockerfile
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY proxy/ ./proxy/
RUN cd proxy && go build -o /immich-proxy ./cmd/server/

FROM alpine:3.19
RUN adduser -D appuser
COPY --from=builder /immich-proxy /app/immich-proxy
COPY web/dist /app/web/dist
USER appuser
EXPOSE 3000
ENTRYPOINT ["/app/immich-proxy"]
CMD ["--web-dir", "/app/web/dist"]
```

## Reverse Proxy Configuration

### Caddy

```caddyfile
photos.example.com {
    reverse_proxy immich-public-proxy:3000

    # Optional: Add HSTS at proxy level
    header Strict-Transport-Security "max-age=31536000; includeSubDomains"
}
```

### Traefik

```yaml
# docker-compose.yml with Traefik labels
services:
  immich-public-proxy:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ipp.rule=Host(`photos.example.com`)"
      - "traefik.http.routers.ipp.entrypoints=websecure"
      - "traefik.http.routers.ipp.tls.certresolver=letsencrypt"
      - "traefik.http.services.ipp.loadbalancer.server.port=3000"
```

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name photos.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://immich-public-proxy:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # For video streaming
        proxy_buffering off;
        proxy_request_buffering off;
    }
}
```

## Security Checklist

### Network
- [ ] Proxy NOT exposed directly to internet (behind reverse proxy)
- [ ] Immich only accessible from internal network
- [ ] TLS termination at reverse proxy

### Configuration
- [ ] `allowed_origins` explicitly set
- [ ] `cookie_secret` set (persistent across restarts)
- [ ] Rate limits configured appropriately
- [ ] Upload size limit set

### Headers
- [ ] HSTS enabled (at proxy or app level)
- [ ] CSP appropriate for your deployment

## Monitoring

### Health Endpoint

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Metrics to Monitor

- Request rate per endpoint
- Error rate (4xx, 5xx)
- Response latency
- Rate limit hits (429 responses)
- Memory usage

### Logging

The proxy outputs structured JSON logs:

```json
{
  "level": "info",
  "timestamp": "2024-01-15T10:30:00Z",
  "msg": "request",
  "method": "GET",
  "path": "/share/abc123/api/assets/uuid/thumbnail",
  "status": 200,
  "duration": "45.2ms",
  "remote_addr": "192.168.1.100"
}
```

Filter for errors:
```bash
docker logs immich-public-proxy 2>&1 | jq 'select(.level == "error")'
```

## Troubleshooting

### Common Issues

**Thumbnails not loading (404)**
- Check Immich is accessible from the proxy container
- Verify `IMMICH_URL` is correct (internal URL, not public)

**CORS errors**
- Set `allowed_origins` to your public domain
- Check browser console for specific origin being blocked

**Password not persisting**
- Set `cookie_secret` for persistence across restarts
- Check `Secure` cookie flag if testing over HTTP

**Rate limiting in development**
- Increase `rate_limit` temporarily
- Check if you're behind a proxy that shares IPs
