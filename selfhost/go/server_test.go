package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testToken = "0123456789abcdef0123456789abcdef"

func newTestServer(t *testing.T, origins ...string) (*httptest.Server, string) {
	t.Helper()
	dir := t.TempDir()
	handler := newServer(config{
		token:          testToken,
		dataPath:       filepath.Join(dir, "state.json"),
		staticDir:      dir,
		allowedOrigins: origins,
	})
	return httptest.NewServer(handler), dir
}

func auth(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+testToken)
}

func TestValidateToken(t *testing.T) {
	for _, token := range []string{"", "change-me", "short"} {
		if _, err := validateToken(token); err == nil {
			t.Fatalf("expected %q to fail", token)
		}
	}
	got, err := validateToken(testToken)
	if err != nil || got != testToken {
		t.Fatalf("valid token rejected: %v", err)
	}
}

func TestHealthAndAuth(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()

	health, err := http.Get(server.URL + "/health")
	if err != nil || health.StatusCode != 200 {
		t.Fatalf("health status %v %v", health, err)
	}
	missing, _ := http.Get(server.URL + "/v1/state")
	if missing.StatusCode != 401 {
		t.Fatalf("missing auth status %d", missing.StatusCode)
	}
	wrongReq, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/state", nil)
	wrongReq.Header.Set("Authorization", "Bearer wrong")
	wrong, _ := http.DefaultClient.Do(wrongReq)
	if wrong.StatusCode != 401 {
		t.Fatalf("wrong auth status %d", wrong.StatusCode)
	}
	okReq, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/state", nil)
	auth(okReq)
	ok, _ := http.DefaultClient.Do(okReq)
	if ok.StatusCode != 200 || ok.Header.Get("ETag") != `"0"` {
		t.Fatalf("state status %d etag %q", ok.StatusCode, ok.Header.Get("ETag"))
	}
}

func TestRevisionConflicts(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	body := bytes.NewBufferString(`{"tasks":[],"categories":[]}`)
	missing, _ := http.NewRequest(http.MethodPut, server.URL+"/v1/state", body)
	auth(missing)
	missing.Header.Set("Content-Type", "application/json")
	missingRes, _ := http.DefaultClient.Do(missing)
	if missingRes.StatusCode != 428 {
		t.Fatalf("missing revision status %d", missingRes.StatusCode)
	}
	first, _ := http.NewRequest(http.MethodPut, server.URL+"/v1/state", bytes.NewBufferString(`{"tasks":[],"categories":[]}`))
	auth(first)
	first.Header.Set("If-Match", `"0"`)
	firstRes, _ := http.DefaultClient.Do(first)
	if firstRes.StatusCode != 200 || firstRes.Header.Get("ETag") != `"1"` {
		t.Fatalf("first write status %d etag %q", firstRes.StatusCode, firstRes.Header.Get("ETag"))
	}
	stale, _ := http.NewRequest(http.MethodPut, server.URL+"/v1/state", bytes.NewBufferString(`{"tasks":[],"categories":[]}`))
	auth(stale)
	stale.Header.Set("If-Match", `"0"`)
	staleRes, _ := http.DefaultClient.Do(stale)
	if staleRes.StatusCode != 409 {
		t.Fatalf("stale status %d", staleRes.StatusCode)
	}
}

func TestBodyLimitAndCORSAndHeaders(t *testing.T) {
	server, dir := newTestServer(t)
	defer server.Close()
	huge, _ := http.NewRequest(http.MethodPut, server.URL+"/v1/state", strings.NewReader(strings.Repeat("x", 1_500_001)))
	auth(huge)
	huge.Header.Set("If-Match", `"0"`)
	hugeRes, _ := http.DefaultClient.Do(huge)
	if hugeRes.StatusCode != 413 {
		t.Fatalf("huge status %d", hugeRes.StatusCode)
	}
	health, _ := http.Get(server.URL + "/health")
	if health.StatusCode != 200 {
		t.Fatal("server died after oversized body")
	}
	evil, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/state", nil)
	auth(evil)
	evil.Header.Set("Origin", "https://evil.example")
	evilRes, _ := http.DefaultClient.Do(evil)
	if evilRes.StatusCode != 403 {
		t.Fatalf("evil origin status %d", evilRes.StatusCode)
	}

	allowed := httptest.NewServer(newServer(config{token: testToken, dataPath: filepath.Join(dir, "allowed.json"), staticDir: dir, allowedOrigins: []string{"https://tasks.example"}}))
	defer allowed.Close()
	good, _ := http.NewRequest(http.MethodGet, allowed.URL+"/v1/state", nil)
	auth(good)
	good.Header.Set("Origin", "https://tasks.example")
	goodRes, _ := http.DefaultClient.Do(good)
	if goodRes.StatusCode != 200 || goodRes.Header.Get("Access-Control-Allow-Origin") != "https://tasks.example" || goodRes.Header.Get("Access-Control-Expose-Headers") != "ETag" {
		t.Fatalf("allowed CORS failed: %d %v", goodRes.StatusCode, goodRes.Header)
	}

	os.WriteFile(filepath.Join(dir, "index.html"), []byte("home"), 0o644)
	os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("secret"), 0o644)
	page, _ := http.Get(server.URL + "/")
	if page.StatusCode != 200 || readBody(page) != "home" || page.Header.Get("X-Content-Type-Options") != "nosniff" || page.Header.Get("Referrer-Policy") != "no-referrer" || !strings.Contains(page.Header.Get("Content-Security-Policy"), "default-src 'self'") {
		t.Fatalf("security headers missing: %d %v", page.StatusCode, page.Header)
	}
	fallback, _ := http.Get(server.URL + "/missing")
	if fallback.StatusCode != 200 || readBody(fallback) != "home" {
		t.Fatalf("fallback status %d", fallback.StatusCode)
	}
	direct := httptest.NewRequest(http.MethodGet, "/%2e%2e/secret.txt", nil)
	recorder := httptest.NewRecorder()
	server.Config.Handler.ServeHTTP(recorder, direct)
	if recorder.Code != 200 || recorder.Body.String() != "home" {
		t.Fatalf("encoded traversal status %d", recorder.Code)
	}
}

func TestConcurrentAndRecovery(t *testing.T) {
	server, dir := newTestServer(t)
	defer server.Close()
	body := func(title string) string {
		return `{"tasks":[{"id":"t1","title":"` + title + `","notes":"","categoryId":null,"date":"2026-09-28","completedAt":null,"repeat":{"kind":"none"},"createdAt":"2026-09-28T00:00:00.000Z","updatedAt":"2026-09-28T00:00:00.000Z"}],"categories":[]}`
	}
	results := make(chan int, 2)
	for _, title := range []string{"First", "Second"} {
		title := title
		go func() {
			req, _ := http.NewRequest(http.MethodPut, server.URL+"/v1/state", strings.NewReader(body(title)))
			auth(req)
			req.Header.Set("If-Match", `"0"`)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				results <- 0
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			results <- res.StatusCode
		}()
	}
	statuses := []int{<-results, <-results}
	if !((statuses[0] == 200 && statuses[1] == 409) || (statuses[0] == 409 && statuses[1] == 200)) {
		t.Fatalf("statuses %v", statuses)
	}

	bad := filepath.Join(dir, "cannot-write-here")
	os.WriteFile(bad, []byte("existing-file"), 0o644)
	brokenDir := t.TempDir()
	dataPath := filepath.Join(brokenDir, "state.json")
	broken := httptest.NewServer(newServer(config{token: testToken, dataPath: dataPath, staticDir: dir}))
	defer broken.Close()
	os.RemoveAll(brokenDir)
	os.WriteFile(brokenDir, []byte("existing-file"), 0o644)
	failed, _ := http.NewRequest(http.MethodPut, broken.URL+"/v1/state", strings.NewReader(`{"tasks":[],"categories":[]}`))
	auth(failed)
	failed.Header.Set("If-Match", `"0"`)
	failedRes, _ := http.DefaultClient.Do(failed)
	if failedRes.StatusCode != 500 {
		t.Fatalf("broken write status %d", failedRes.StatusCode)
	}
	stale, _ := http.NewRequest(http.MethodPut, broken.URL+"/v1/state", strings.NewReader(`{"tasks":[],"categories":[]}`))
	auth(stale)
	stale.Header.Set("If-Match", `"999"`)
	staleRes, _ := http.DefaultClient.Do(stale)
	if staleRes.StatusCode != 409 {
		t.Fatalf("post failure conflict status %d", staleRes.StatusCode)
	}

	recoveryPath := filepath.Join(dir, "recover.json")
	os.WriteFile(recoveryPath, []byte("{truncated"), 0o644)
	os.WriteFile(recoveryPath+".bak", []byte(`{"revision":4,"tasks":[],"categories":[]}`), 0o644)
	state, err := loadState(recoveryPath)
	if err != nil || state.Revision != 4 {
		t.Fatalf("recovery failed: %+v %v", state, err)
	}
	raw, _ := os.ReadFile(recoveryPath)
	var restored stateFile
	json.Unmarshal(raw, &restored)
	if restored.Revision != 4 {
		t.Fatal("primary was not restored")
	}
}

func readBody(res *http.Response) string {
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return string(raw)
}
