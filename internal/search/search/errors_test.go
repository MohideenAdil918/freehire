package search

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/meilisearch/meilisearch-go"
)

// A 400 from Meilisearch is the engine rejecting a malformed query or filter —
// the request's fault. isBadRequest must single it out so Search can tag it with
// ErrBadQuery (which handlers map to 400 and keep out of Sentry), while transport
// failures and other status codes stay unexpected faults.
func TestIsBadRequest(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"meili 400 is a bad request", &meilisearch.Error{StatusCode: http.StatusBadRequest}, true},
		{"wrapped meili 400 is a bad request", fmt.Errorf("search: query: %w", &meilisearch.Error{StatusCode: http.StatusBadRequest}), true},
		{"meili 500 is not a bad request", &meilisearch.Error{StatusCode: http.StatusInternalServerError}, false},
		{"non-meili error is not a bad request", errors.New("context canceled"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isBadRequest(tt.err); got != tt.want {
				t.Errorf("isBadRequest = %v, want %v", got, tt.want)
			}
		})
	}
}

// A query against an index that does not exist yet is a fresh catalogue, not an
// engine fault: retryOnMissingIndex keys off exactly this code to build it and
// retry, so a different API error must not match.
func TestIsIndexNotFound(t *testing.T) {
	notFound := &meilisearch.Error{StatusCode: http.StatusNotFound}
	notFound.MeilisearchApiError.Code = "index_not_found"
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"meili index_not_found", notFound, true},
		{"wrapped meili index_not_found", fmt.Errorf("search: query: %w", notFound), true},
		{"meili bad request", &meilisearch.Error{StatusCode: http.StatusBadRequest}, false},
		{"non-meili error", errors.New("context canceled"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isIndexNotFound(tt.err); got != tt.want {
				t.Errorf("isIndexNotFound = %v, want %v", got, tt.want)
			}
		})
	}
}
