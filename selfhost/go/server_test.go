package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
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
	if page.StatusCode != 200 || readBody(page) != "home" || page.Header.Get("X-Content-Type-Options") != "nosniff" || page.Header.Get("Referrer-Policy") != "no-referrer" || !strings.Contains(page.Header.Get("Content-Security-Policy"), "default-src 'self'") || !strings.Contains(page.Header.Get("Content-Security-Policy"), "script-src 'self' 'unsafe-inline'") {
		t.Fatalf("security headers missing: %d %v", page.StatusCode, page.Header)
	}
	fallback, _ := http.Get(server.URL + "/missing")
	if fallback.StatusCode != 200 || readBody(fallback) != "home" {
		t.Fatalf("fallback status %d", fallback.StatusCode)
	}
	direct := httptest.NewRequest(http.MethodGet, "/%2e%2e/secret.txt", nil)
	recorder := httptest.NewRecorder()
	server.Config.Handler.ServeHTTP(recorder, direct)
	if recorder.Code != 400 || recorder.Body.String() != "invalid URL path\n" {
		t.Fatalf("encoded traversal status %d body %q", recorder.Code, recorder.Body.String())
	}
	if resolved, ok := resolveStaticPath(dir, "/%2e%2e/secret.txt"); ok || strings.Contains(resolved, "secret.txt") {
		t.Fatalf("resolver accepted encoded traversal: %q", resolved)
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

type createdUser struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Token string `json:"token"`
}

func doRequest(t *testing.T, method, target, token string, body string, headers map[string]string) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, target, reader)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func createUserGo(t *testing.T, base, name string) createdUser {
	t.Helper()
	res := doRequest(t, http.MethodPost, base+"/v1/users", testToken, `{"name":"`+name+`"}`, nil)
	defer res.Body.Close()
	if res.StatusCode != 201 {
		t.Fatalf("create user status %d", res.StatusCode)
	}
	var created createdUser
	if err := json.NewDecoder(res.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	return created
}

func taskJSON(id, title, ownerID string, sharedWith []string) string {
	owner := "null"
	if ownerID != "" {
		owner = `"` + ownerID + `"`
	}
	shared, _ := json.Marshal(sharedWith)
	return `{"id":"` + id + `","title":"` + title + `","notes":"","categoryId":null,"projectId":null,"date":null,"repeat":{"kind":"none"},"done":false,"completedAt":null,"createdAt":"2026-09-28T00:00:00.000Z","updatedAt":"2026-09-28T00:00:00.000Z","ownerId":` + owner + `,"sharedWith":` + string(shared) + `}`
}

func putStateGo(t *testing.T, base, token string, revision int, body string) *http.Response {
	t.Helper()
	return doRequest(t, http.MethodPut, base+"/v1/state", token, body, map[string]string{"If-Match": `"` + strconv.Itoa(revision) + `"`})
}

func getStateGo(t *testing.T, base, token string) (map[string][]map[string]any, int) {
	t.Helper()
	res := doRequest(t, http.MethodGet, base+"/v1/state", token, "", nil)
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("get state status %d", res.StatusCode)
	}
	var body struct {
		Tasks []map[string]any `json:"tasks"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	revision, _ := strconv.Atoi(strings.Trim(res.Header.Get("ETag"), `"`))
	out := map[string][]map[string]any{"tasks": body.Tasks}
	return out, revision
}

func taskIDs(tasks []map[string]any) []string {
	ids := []string{}
	for _, task := range tasks {
		ids = append(ids, task["id"].(string))
	}
	return ids
}

func TestAdminCreatesUsersHashOnlyStored(t *testing.T) {
	server, dir := newTestServer(t)
	defer server.Close()
	created := createUserGo(t, server.URL, "Teammate")
	if created.Name != "Teammate" || created.ID == "" || len(created.Token) < 32 {
		t.Fatalf("bad created user %+v", created)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), created.Token) {
		t.Fatal("raw personal token persisted")
	}
	var stored struct {
		Users []userRecord `json:"users"`
	}
	if err := json.Unmarshal(raw, &stored); err != nil || len(stored.Users) != 1 || len(stored.Users[0].TokenHash) != 64 {
		t.Fatalf("stored users wrong: %v %+v", err, stored.Users)
	}
	directory := doRequest(t, http.MethodGet, server.URL+"/v1/users", created.Token, "", nil)
	defer directory.Body.Close()
	if directory.StatusCode != 200 {
		t.Fatalf("directory status %d", directory.StatusCode)
	}
	var users []publicUser
	json.NewDecoder(directory.Body).Decode(&users)
	if len(users) != 1 || users[0].Name != "Teammate" || users[0].ID != created.ID {
		t.Fatalf("directory %+v", users)
	}
	forbidden := doRequest(t, http.MethodPost, server.URL+"/v1/users", created.Token, `{"name":"Nope"}`, nil)
	defer forbidden.Body.Close()
	if forbidden.StatusCode != 403 {
		t.Fatalf("user creating user status %d", forbidden.StatusCode)
	}
	me := doRequest(t, http.MethodGet, server.URL+"/v1/me", created.Token, "", nil)
	defer me.Body.Close()
	var identity map[string]string
	json.NewDecoder(me.Body).Decode(&identity)
	if identity["kind"] != "user" || identity["id"] != created.ID {
		t.Fatalf("me %+v", identity)
	}
	adminMe := doRequest(t, http.MethodGet, server.URL+"/v1/me", testToken, "", nil)
	defer adminMe.Body.Close()
	json.NewDecoder(adminMe.Body).Decode(&identity)
	if identity["kind"] != "admin" {
		t.Fatalf("admin me %+v", identity)
	}
}

func TestUserScopedVisibilityAndSharingRules(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	alice := createUserGo(t, server.URL, "Alice")
	bob := createUserGo(t, server.URL, "Bob")

	// Alice creates a private task (forged owner ignored) and one shared with Bob.
	res := putStateGo(t, server.URL, alice.Token, 0, `{"tasks":[`+taskJSON("a1", "Alice private", bob.ID, nil)+`,`+taskJSON("a2", "Shared chore", "", []string{bob.ID})+`],"categories":[],"projects":[]}`)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("alice put %d", res.StatusCode)
	}
	// Bob creates his own task with a whole-state-style payload of just his tasks.
	res = putStateGo(t, server.URL, bob.Token, 1, `{"tasks":[`+taskJSON("b1", "Bob private", "", nil)+`],"categories":[],"projects":[]}`)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("bob put %d", res.StatusCode)
	}
	// Admin adds a legacy unowned task.
	res = putStateGo(t, server.URL, testToken, 2, `{"tasks":[`+taskJSON("a1", "Alice private", alice.ID, nil)+`,`+taskJSON("a2", "Shared chore", alice.ID, []string{bob.ID})+`,`+taskJSON("b1", "Bob private", bob.ID, nil)+`,`+taskJSON("legacy", "Legacy", "", nil)+`],"categories":[],"projects":[]}`)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("admin put %d", res.StatusCode)
	}

	adminView, revision := getStateGo(t, server.URL, testToken)
	if len(adminView["tasks"]) != 4 {
		t.Fatalf("admin sees %v", taskIDs(adminView["tasks"]))
	}
	aliceView, _ := getStateGo(t, server.URL, alice.Token)
	if got := taskIDs(aliceView["tasks"]); len(got) != 2 || got[0] != "a1" || got[1] != "a2" {
		t.Fatalf("alice sees %v", got)
	}
	bobView, _ := getStateGo(t, server.URL, bob.Token)
	if got := taskIDs(bobView["tasks"]); len(got) != 2 || got[0] != "a2" || got[1] != "b1" {
		t.Fatalf("bob sees %v", got)
	}

	// Bob edits the shared task but cannot re-own or unshare it.
	edited := taskJSON("a2", "Shared chore, done by Bob", bob.ID, nil)
	parsedEdited := map[string]any{}
	json.Unmarshal([]byte(edited), &parsedEdited)
	parsedEdited["done"] = true
	editedRaw, _ := json.Marshal(parsedEdited)
	res = putStateGo(t, server.URL, bob.Token, revision, `{"tasks":[`+string(editedRaw)+`,`+taskJSON("b1", "Bob private", bob.ID, nil)+`],"categories":[],"projects":[]}`)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("bob edit %d", res.StatusCode)
	}
	adminView, revision = getStateGo(t, server.URL, testToken)
	var shared map[string]any
	for _, task := range adminView["tasks"] {
		if task["id"] == "a2" {
			shared = task
		}
	}
	if shared["title"] != "Shared chore, done by Bob" || shared["done"] != true || shared["ownerId"] != alice.ID {
		t.Fatalf("shared task after bob edit %+v", shared)
	}
	if got := shared["sharedWith"].([]any); len(got) != 1 || got[0] != bob.ID {
		t.Fatalf("sharedWith after bob edit %v", got)
	}
	// A tombstone from Bob (how the Web client deletes) is also ignored.
	tombstone := taskJSON("a2", "Shared chore, done by Bob", alice.ID, []string{bob.ID})
	parsedTombstone := map[string]any{}
	json.Unmarshal([]byte(tombstone), &parsedTombstone)
	parsedTombstone["done"] = true
	parsedTombstone["deleted"] = true
	tombstoneRaw, _ := json.Marshal(parsedTombstone)
	res = putStateGo(t, server.URL, bob.Token, revision, `{"tasks":[`+string(tombstoneRaw)+`,`+taskJSON("b1", "Bob private", bob.ID, nil)+`],"categories":[],"projects":[]}`)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("bob tombstone %d", res.StatusCode)
	}
	adminView, revision = getStateGo(t, server.URL, testToken)
	for _, task := range adminView["tasks"] {
		if task["id"] == "a2" {
			if deleted, _ := task["deleted"].(bool); deleted {
				t.Fatal("bob's tombstone deleted the shared task")
			}
		}
	}

	// Bob omitting the shared task keeps it (only the owner can delete a
	// shared task); omitting his own b1 in the same payload deletes b1.
	res = putStateGo(t, server.URL, bob.Token, revision, `{"tasks":[],"categories":[],"projects":[]}`)
	res.Body.Close()
	adminView, revision = getStateGo(t, server.URL, testToken)
	if got := taskIDs(adminView["tasks"]); len(got) != 3 || got[1] != "a2" {
		t.Fatalf("bob omission changed tasks %v", got)
	}
	// Alice omitting her own task deletes it.
	aliceView, _ = getStateGo(t, server.URL, alice.Token)
	remaining := []string{}
	for _, task := range aliceView["tasks"] {
		if task["id"] == "a2" {
			raw, _ := json.Marshal(task)
			remaining = append(remaining, string(raw))
		}
	}
	res = putStateGo(t, server.URL, alice.Token, revision, `{"tasks":[`+strings.Join(remaining, ",")+`],"categories":[],"projects":[]}`)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("alice delete put %d", res.StatusCode)
	}
	adminView, revision = getStateGo(t, server.URL, testToken)
	if got := taskIDs(adminView["tasks"]); len(got) != 2 || got[0] != "a2" || got[1] != "legacy" {
		t.Fatalf("after alice delete %v", got)
	}

	// Deleting Bob revokes his token and unshares a2 from him.
	del := doRequest(t, http.MethodDelete, server.URL+"/v1/users/"+bob.ID, testToken, "", nil)
	del.Body.Close()
	if del.StatusCode != 200 {
		t.Fatalf("delete bob %d", del.StatusCode)
	}
	unauthorized := doRequest(t, http.MethodGet, server.URL+"/v1/state", bob.Token, "", nil)
	unauthorized.Body.Close()
	if unauthorized.StatusCode != 401 {
		t.Fatalf("deleted user status %d", unauthorized.StatusCode)
	}
	adminView, _ = getStateGo(t, server.URL, testToken)
	for _, task := range adminView["tasks"] {
		if task["id"] == "a2" {
			if got := task["sharedWith"].([]any); len(got) != 0 {
				t.Fatalf("a2 sharedWith after bob deleted %v", got)
			}
		}
	}
	missing := doRequest(t, http.MethodDelete, server.URL+"/v1/users/"+bob.ID, testToken, "", nil)
	missing.Body.Close()
	if missing.StatusCode != 404 {
		t.Fatalf("second delete status %d", missing.StatusCode)
	}
	_ = revision
}

func TestProjectsRoundTripAndLegacyPayload(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	project := `{"id":"p1","name":"House","createdAt":"2026-09-28T00:00:00.000Z","updatedAt":"2026-09-28T00:00:00.000Z"}`
	put := func(revision, body string) *http.Response {
		req, _ := http.NewRequest(http.MethodPut, server.URL+"/v1/state", bytes.NewBufferString(body))
		auth(req)
		req.Header.Set("If-Match", revision)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	get := func() map[string]json.RawMessage {
		req, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/state", nil)
		auth(req)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var body map[string]json.RawMessage
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return body
	}

	if res := put(`"0"`, `{"tasks":[],"categories":[],"projects":[`+project+`]}`); res.StatusCode != 200 {
		t.Fatalf("write with projects status %d", res.StatusCode)
	}
	if got := string(get()["projects"]); got != "["+project+"]" {
		t.Fatalf("projects did not round-trip: %s", got)
	}
	// An older client PUTs without projects: accepted, projects preserved.
	if res := put(`"1"`, `{"tasks":[],"categories":[]}`); res.StatusCode != 200 {
		t.Fatalf("legacy write status %d", res.StatusCode)
	}
	if got := string(get()["projects"]); got != "["+project+"]" {
		t.Fatalf("legacy write wiped projects: %s", got)
	}
}

func TestProjectsDefaultEmpty(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	req, _ := http.NewRequest(http.MethodGet, server.URL+"/v1/state", nil)
	auth(req)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if got := string(body["projects"]); got != "[]" {
		t.Fatalf("fresh state projects = %s, want []", got)
	}
}

type restTask struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Notes       string          `json:"notes"`
	Date        *string         `json:"date"`
	Repeat      json.RawMessage `json:"repeat"`
	Done        bool            `json:"done"`
	CompletedAt *string         `json:"completedAt"`
	OwnerID     *string         `json:"ownerId"`
	SharedWith  []string        `json:"sharedWith"`
	Deleted     bool            `json:"deleted"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
}

func doRest(t *testing.T, method, url, token, body string) *http.Response {
	t.Helper()
	return doRequest(t, method, url, token, body, nil)
}

func decodeTask(t *testing.T, res *http.Response) restTask {
	t.Helper()
	defer res.Body.Close()
	var task restTask
	if err := json.NewDecoder(res.Body).Decode(&task); err != nil {
		t.Fatal(err)
	}
	return task
}

func listRestTasks(t *testing.T, base, token string) []restTask {
	t.Helper()
	res := doRest(t, http.MethodGet, base+"/v1/tasks", token, "")
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("list tasks status %d", res.StatusCode)
	}
	var body struct {
		Tasks []restTask `json:"tasks"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body.Tasks
}

func TestRestTasksAdminHappyPath(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	created := doRest(t, http.MethodPost, server.URL+"/v1/tasks", testToken, `{"title":"Water the plants","date":"2026-10-01","notes":"Balcony too"}`)
	if created.StatusCode != 201 {
		t.Fatalf("create status %d", created.StatusCode)
	}
	task := decodeTask(t, created)
	if task.ID == "" || task.Title != "Water the plants" || task.Notes != "Balcony too" || task.Date == nil || *task.Date != "2026-10-01" {
		t.Fatalf("created task %+v", task)
	}
	if string(task.Repeat) != `{"kind":"none"}` || task.Done || task.CompletedAt != nil || task.OwnerID != nil || len(task.SharedWith) != 0 || task.CreatedAt == "" || task.CreatedAt != task.UpdatedAt {
		t.Fatalf("created task defaults %+v repeat %s", task, task.Repeat)
	}
	if listed := listRestTasks(t, server.URL, testToken); len(listed) != 1 || listed[0].ID != task.ID {
		t.Fatalf("listed %+v", listed)
	}
	patched := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+task.ID, testToken, `{"done":true}`)
	if patched.StatusCode != 200 {
		t.Fatalf("patch status %d", patched.StatusCode)
	}
	doneTask := decodeTask(t, patched)
	if !doneTask.Done || doneTask.CompletedAt == nil {
		t.Fatalf("patched task %+v", doneTask)
	}
	reopened := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+task.ID, testToken, `{"done":false,"title":"Water the plants!"}`)
	reopenedTask := decodeTask(t, reopened)
	if reopenedTask.Done || reopenedTask.CompletedAt != nil || reopenedTask.Title != "Water the plants!" {
		t.Fatalf("reopened task %+v", reopenedTask)
	}
	deleted := doRest(t, http.MethodDelete, server.URL+"/v1/tasks/"+task.ID, testToken, "")
	if deleted.StatusCode != 200 {
		t.Fatalf("delete status %d", deleted.StatusCode)
	}
	if tombstone := decodeTask(t, deleted); !tombstone.Deleted {
		t.Fatalf("delete did not tombstone %+v", tombstone)
	}
	if listed := listRestTasks(t, server.URL, testToken); len(listed) != 0 {
		t.Fatalf("listed after delete %+v", listed)
	}
	stateView, _ := getStateGo(t, server.URL, testToken)
	if len(stateView["tasks"]) != 1 || stateView["tasks"][0]["deleted"] != true {
		t.Fatalf("tombstone missing from state %+v", stateView["tasks"])
	}
	if res := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+task.ID, testToken, `{"done":true}`); res.StatusCode != 404 {
		res.Body.Close()
		t.Fatalf("patch deleted status %d", res.StatusCode)
	}
	if res := doRest(t, http.MethodDelete, server.URL+"/v1/tasks/"+task.ID, testToken, ""); res.StatusCode != 404 {
		res.Body.Close()
		t.Fatalf("delete deleted status %d", res.StatusCode)
	}
}

func TestRestTasksAuthAndValidation(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	cases := []struct {
		method, path, token, body string
		want                      int
	}{
		{http.MethodGet, "/v1/tasks", "", "", 401},
		{http.MethodGet, "/v1/tasks", "wrong-token", "", 401},
		{http.MethodPost, "/v1/tasks", "", `{"title":"x"}`, 401},
		{http.MethodPost, "/v1/tasks", testToken, `{not json`, 400},
		{http.MethodPost, "/v1/tasks", testToken, `{}`, 400},
		{http.MethodPost, "/v1/tasks", testToken, `{"title":"   "}`, 400},
		{http.MethodPost, "/v1/tasks", testToken, `{"title":"x","date":"01/10/2026"}`, 400},
		{http.MethodPost, "/v1/tasks", testToken, `{"title":"x","repeat":{"kind":"hourly"}}`, 400},
		{http.MethodPatch, "/v1/tasks/does-not-exist", testToken, `{"done":true}`, 404},
		{http.MethodDelete, "/v1/tasks/does-not-exist", testToken, "", 404},
	}
	for _, tc := range cases {
		res := doRest(t, tc.method, server.URL+tc.path, tc.token, tc.body)
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatalf("%s %s status %d, want %d", tc.method, tc.path, res.StatusCode, tc.want)
		}
	}
	created := doRest(t, http.MethodPost, server.URL+"/v1/tasks", testToken, `{"title":"Real"}`)
	task := decodeTask(t, created)
	if res := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+task.ID, testToken, `{nope`); res.StatusCode != 400 {
		res.Body.Close()
		t.Fatalf("patch invalid json status %d", res.StatusCode)
	}
	if res := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+task.ID, testToken, `{"done":"yes"}`); res.StatusCode != 400 {
		res.Body.Close()
		t.Fatalf("patch bad done status %d", res.StatusCode)
	}
}

func TestRestTasksUserScopingAndSharing(t *testing.T) {
	server, _ := newTestServer(t)
	defer server.Close()
	alice := createUserGo(t, server.URL, "Alice")
	bob := createUserGo(t, server.URL, "Bob")

	created := doRest(t, http.MethodPost, server.URL+"/v1/tasks", alice.Token, `{"title":"Alice toduck"}`)
	if created.StatusCode != 201 {
		t.Fatalf("alice create status %d", created.StatusCode)
	}
	aliceTask := decodeTask(t, created)
	if aliceTask.OwnerID == nil || *aliceTask.OwnerID != alice.ID {
		t.Fatalf("alice task owner %+v", aliceTask.OwnerID)
	}
	bobCreated := doRest(t, http.MethodPost, server.URL+"/v1/tasks", bob.Token, `{"title":"Bob toduck"}`)
	bobTask := decodeTask(t, bobCreated)

	if listed := listRestTasks(t, server.URL, alice.Token); len(listed) != 1 || listed[0].ID != aliceTask.ID {
		t.Fatalf("alice list %+v", listed)
	}
	if listed := listRestTasks(t, server.URL, bob.Token); len(listed) != 1 || listed[0].ID != bobTask.ID {
		t.Fatalf("bob list %+v", listed)
	}
	if res := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+aliceTask.ID, bob.Token, `{"done":true}`); res.StatusCode != 404 {
		res.Body.Close()
		t.Fatalf("bob patch alice status %d", res.StatusCode)
	}
	if res := doRest(t, http.MethodDelete, server.URL+"/v1/tasks/"+aliceTask.ID, bob.Token, ""); res.StatusCode != 404 {
		res.Body.Close()
		t.Fatalf("bob delete alice status %d", res.StatusCode)
	}

	// Alice shares her task with Bob through scoped sync.
	_, revision := getStateGo(t, server.URL, alice.Token)
	sharedTask := taskJSON(aliceTask.ID, "Alice toduck", alice.ID, []string{bob.ID})
	res := putStateGo(t, server.URL, alice.Token, revision, `{"tasks":[`+sharedTask+`],"categories":[],"projects":[]}`)
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("share put status %d", res.StatusCode)
	}

	if listed := listRestTasks(t, server.URL, bob.Token); len(listed) != 2 {
		t.Fatalf("bob list after share %+v", listed)
	}
	patched := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+aliceTask.ID, bob.Token, `{"done":true}`)
	if patched.StatusCode != 200 {
		t.Fatalf("bob patch shared status %d", patched.StatusCode)
	}
	if doneTask := decodeTask(t, patched); !doneTask.Done {
		t.Fatalf("bob patch shared %+v", doneTask)
	}
	if res := doRest(t, http.MethodDelete, server.URL+"/v1/tasks/"+aliceTask.ID, bob.Token, ""); res.StatusCode != 403 {
		res.Body.Close()
		t.Fatalf("bob delete shared status %d", res.StatusCode)
	}
	forged := doRest(t, http.MethodPatch, server.URL+"/v1/tasks/"+aliceTask.ID, bob.Token, `{"title":"Still Alice's","ownerId":"`+bob.ID+`","sharedWith":[]}`)
	forgedTask := decodeTask(t, forged)
	if forgedTask.OwnerID == nil || *forgedTask.OwnerID != alice.ID || len(forgedTask.SharedWith) != 1 || forgedTask.SharedWith[0] != bob.ID {
		t.Fatalf("forged patch changed ownership %+v", forgedTask)
	}

	if listed := listRestTasks(t, server.URL, testToken); len(listed) != 2 {
		t.Fatalf("admin list %+v", listed)
	}
	if res := doRest(t, http.MethodDelete, server.URL+"/v1/tasks/"+aliceTask.ID, alice.Token, ""); res.StatusCode != 200 {
		res.Body.Close()
		t.Fatalf("alice delete own status %d", res.StatusCode)
	}
	if listed := listRestTasks(t, server.URL, bob.Token); len(listed) != 1 || listed[0].ID != bobTask.ID {
		t.Fatalf("bob list after alice delete %+v", listed)
	}
}
