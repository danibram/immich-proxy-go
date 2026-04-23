package middleware

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"go.uber.org/zap"
)

// sensitiveQueryKeys is the set of query parameter names that must never
// appear in logs. If a request's query string contains one of these, we
// replace its value with "[REDACTED]" before logging.
var sensitiveQueryKeys = map[string]struct{}{
	"password":  {},
	"key":       {},
	"slug":      {},
	"api_key":   {},
	"apikey":    {},
	"token":     {},
}

// redactQuery parses the raw query and returns a log-safe representation.
// Keys are preserved but their values are replaced with [REDACTED] when
// they match a known-sensitive parameter name.
func redactQuery(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		// If we can't parse it cleanly, don't log it at all — better to
		// lose a log field than to accidentally leak a password.
		return "[unparseable]"
	}
	for k, vs := range values {
		if _, sensitive := sensitiveQueryKeys[strings.ToLower(k)]; sensitive {
			for i := range vs {
				vs[i] = "[REDACTED]"
			}
			values[k] = vs
		}
	}
	return values.Encode()
}

// Logger returns a middleware that logs HTTP requests
func Logger(logger *zap.Logger) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap response writer to capture status code
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

			defer func() {
				logger.Info("request",
					zap.String("method", r.Method),
					zap.String("path", r.URL.Path),
					zap.String("query", redactQuery(r.URL.RawQuery)),
					zap.Int("status", ww.Status()),
					zap.Int("bytes", ww.BytesWritten()),
					zap.Duration("duration", time.Since(start)),
					zap.String("remote_addr", r.RemoteAddr),
					zap.String("user_agent", r.UserAgent()),
				)
			}()

			next.ServeHTTP(ww, r)
		})
	}
}

// Recovery returns a middleware that recovers from panics
func Recovery(logger *zap.Logger) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					logger.Error("panic recovered",
						zap.Any("error", err),
						zap.String("path", r.URL.Path),
					)
					http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}
