package middleware

import "net/http"

// NoIndex tells search engines not to index or follow shared-link pages.
// A "public" shared album is meant to be shared by URL, not discovered via
// Google — this keeps shared content out of search results. The header
// covers crawlers that never execute the SPA's JavaScript (so a <meta robots>
// tag alone would miss them).
func NoIndex(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		next.ServeHTTP(w, r)
	})
}
