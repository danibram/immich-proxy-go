# Multi-stage build for Immich Public Proxy

# Stage 1: Build the web UI
FROM node:22-alpine AS web-builder

WORKDIR /app/web

# Copy package files
COPY web/package*.json ./

# Install dependencies
RUN npm install

# Copy source files
COPY web/ ./

# Build the web UI
RUN npm run build

# Stage 2: Build the Go proxy
FROM golang:1.22-alpine AS go-builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go module files
COPY proxy/go.mod proxy/go.sum ./proxy/

# Download dependencies
WORKDIR /app/proxy
RUN go mod download

# Copy source files
COPY proxy/ ./

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /app/immich-proxy ./cmd/server/

# Stage 3: Final image
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apk --no-cache add ca-certificates tzdata

# Create non-root user
RUN adduser -D -g '' appuser

# Copy the binary from go-builder
COPY --from=go-builder /app/immich-proxy /app/immich-proxy

# Copy the web UI from web-builder
COPY --from=web-builder /app/web/dist /app/web/dist

# Set ownership
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthcheck || exit 1

# Run the proxy
ENTRYPOINT ["/app/immich-proxy"]
CMD ["--web-dir", "/app/web/dist"]
