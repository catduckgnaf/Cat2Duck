package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultMaxBody = 1_500_000

// 'unsafe-inline' in script-src is required: the built Web UI's index.html
// carries first-party inline bootstrap scripts (TanStack Start hydration).
// Without it the served app renders blank. Keep in sync with server.mjs.
var securityHeaders = map[string]string{
	"Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://grok.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://grok.com",
	"Referrer-Policy":         "no-referrer",
	"X-Content-Type-Options":  "nosniff",
}

type config struct {
	token          string
	dataPath       string
	staticDir      string
	maxBody        int64
	allowedOrigins []string
}

type stateFile struct {
	Revision   int64           `json:"revision"`
	Tasks      json.RawMessage `json:"tasks"`
	Categories json.RawMessage `json:"categories"`
	Projects   json.RawMessage `json:"projects"`
	Users      []userRecord    `json:"users"`
	// projectsPresent records whether the source payload carried a projects
	// array at all; older clients omit it and must not wipe stored projects.
	projectsPresent bool
}

// userRecord is a registered user. Only the SHA-256 hash of the personal
// token is stored, never the raw token.
type userRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	TokenHash string `json:"tokenHash"`
}

type publicUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type server struct {
	config
	origins map[string]struct{}
	mu      sync.Mutex
	state   stateFile
}

func validateToken(raw string) (string, error) {
	if raw == "" || raw == "change-me" {
		return "", errors.New("CADENCE_TOKEN must be explicitly configured.")
	}
	if len(raw) < 32 {
		return "", errors.New("CADENCE_TOKEN must be at least 32 characters long.")
	}
	return raw, nil
}

func emptyState() stateFile {
	return stateFile{Tasks: json.RawMessage("[]"), Categories: json.RawMessage("[]"), Projects: json.RawMessage("[]"), Users: []userRecord{}, projectsPresent: true}
}

func normalizeState(raw []byte) (stateFile, error) {
	var value map[string]json.RawMessage
	if err := json.Unmarshal(raw, &value); err != nil {
		return stateFile{}, err
	}
	tasks, tasksOK := value["tasks"]
	categories, categoriesOK := value["categories"]
	if !tasksOK || !categoriesOK || !jsonArray(tasks) || !jsonArray(categories) {
		return stateFile{}, errors.New("State must include tasks and categories arrays.")
	}
	// Projects are optional: state files and clients from before projects
	// existed have no projects array, which reads as an empty one.
	projects, projectsPresent := value["projects"]
	if projectsPresent && !jsonArray(projects) {
		return stateFile{}, errors.New("State projects must be an array when present.")
	}
	if !projectsPresent {
		projects = json.RawMessage("[]")
	}
	// Users are optional for the same reason: older state files have none.
	users := []userRecord{}
	if rawUsers, ok := value["users"]; ok {
		if !jsonArray(rawUsers) {
			return stateFile{}, errors.New("State users must be an array of user records when present.")
		}
		if err := json.Unmarshal(rawUsers, &users); err != nil {
			return stateFile{}, errors.New("State users must be an array of user records when present.")
		}
		for _, user := range users {
			if user.ID == "" || user.Name == "" || user.TokenHash == "" {
				return stateFile{}, errors.New("State users must be an array of user records when present.")
			}
		}
		if users == nil {
			users = []userRecord{}
		}
	}
	var revision int64
	if rawRevision, ok := value["revision"]; ok {
		_ = json.Unmarshal(rawRevision, &revision)
		if revision < 0 {
			revision = 0
		}
	}
	return stateFile{
		Revision:        revision,
		Tasks:           append(json.RawMessage(nil), tasks...),
		Categories:      append(json.RawMessage(nil), categories...),
		Projects:        append(json.RawMessage(nil), projects...),
		Users:           users,
		projectsPresent: projectsPresent,
	}, nil
}

func jsonArray(raw json.RawMessage) bool {
	return len(raw) > 0 && raw[0] == '['
}

func loadState(dataPath string) (stateFile, error) {
	raw, err := os.ReadFile(dataPath)
	if errors.Is(err, os.ErrNotExist) {
		return emptyState(), nil
	}
	state, primaryErr := normalizeState(raw)
	if primaryErr == nil {
		return state, nil
	}
	backup, backupErr := os.ReadFile(dataPath + ".bak")
	if backupErr == nil {
		if recovered, err := normalizeState(backup); err == nil {
			_ = os.WriteFile(dataPath, backup, 0o644)
			log.Printf("Recovered invalid primary state from %s.bak: %v", dataPath, primaryErr)
			return recovered, nil
		}
	}
	return stateFile{}, fmt.Errorf("State file is invalid and no usable backup exists: %w", primaryErr)
}

func persistState(dataPath string, state stateFile) error {
	if err := os.MkdirAll(filepath.Dir(dataPath), 0o755); err != nil {
		return err
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	tmp := dataPath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	if _, err := os.Stat(dataPath); err == nil {
		if err := copyFile(dataPath, dataPath+".bak"); err != nil {
			return err
		}
	}
	if err := os.Rename(tmp, dataPath); err != nil {
		return err
	}
	if _, err := os.Stat(dataPath + ".bak"); errors.Is(err, os.ErrNotExist) {
		return copyFile(dataPath, dataPath+".bak")
	}
	return nil
}

func copyFile(from, to string) error {
	input, err := os.ReadFile(from)
	if err != nil {
		return err
	}
	return os.WriteFile(to, input, 0o644)
}

func tokenMatches(expected, authorization string) bool {
	supplied := regexp.MustCompile(`(?i)^Bearer\s+`).ReplaceAllString(authorization, "")
	expectedDigest := sha256.Sum256([]byte(expected))
	suppliedDigest := sha256.Sum256([]byte(supplied))
	return subtle.ConstantTimeCompare(expectedDigest[:], suppliedDigest[:]) == 1
}

func hashToken(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func bearerToken(authorization string) string {
	return regexp.MustCompile(`(?i)^Bearer\s+`).ReplaceAllString(authorization, "")
}

// authenticate resolves a request's credential: the CADENCE_TOKEN is the
// admin (full, legacy access); a registered user's personal token scopes
// state access to that user. Mirrors server.mjs.
func (s *server) authenticate(r *http.Request) (isAdmin bool, user *userRecord, ok bool) {
	authorization := r.Header.Get("Authorization")
	if tokenMatches(s.token, authorization) {
		return true, nil, true
	}
	suppliedHash := hashToken(bearerToken(authorization))
	s.mu.Lock()
	users := s.state.Users
	s.mu.Unlock()
	for index := range users {
		stored := users[index].TokenHash
		if len(stored) == len(suppliedHash) && subtle.ConstantTimeCompare([]byte(stored), []byte(suppliedHash)) == 1 {
			return false, &users[index], true
		}
	}
	return false, nil, false
}

type taskMeta struct {
	ID         string   `json:"id"`
	OwnerID    *string  `json:"ownerId"`
	SharedWith []string `json:"sharedWith"`
	Deleted    bool     `json:"deleted"`
}

func parseTaskMeta(raw json.RawMessage) taskMeta {
	var meta taskMeta
	_ = json.Unmarshal(raw, &meta)
	if meta.SharedWith == nil {
		meta.SharedWith = []string{}
	}
	return meta
}

func visibleToUser(meta taskMeta, userID string) bool {
	if meta.OwnerID != nil && *meta.OwnerID == userID {
		return true
	}
	for _, id := range meta.SharedWith {
		if id == userID {
			return true
		}
	}
	return false
}

// sanitizeSharedWith keeps only ids of registered users, de-duplicated.
func sanitizeSharedWith(ids []string, users []userRecord) []string {
	known := map[string]struct{}{}
	for _, user := range users {
		known[user.ID] = struct{}{}
	}
	out := []string{}
	seen := map[string]struct{}{}
	for _, id := range ids {
		if _, ok := known[id]; !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func splitTasks(raw json.RawMessage) []json.RawMessage {
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		return []json.RawMessage{}
	}
	return items
}

func joinTasks(items []json.RawMessage) json.RawMessage {
	if len(items) == 0 {
		return json.RawMessage("[]")
	}
	raw, err := json.Marshal(items)
	if err != nil {
		return json.RawMessage("[]")
	}
	return raw
}

// rewriteTask returns the task object with ownerId/sharedWith replaced.
func rewriteTask(raw json.RawMessage, ownerID *string, sharedWith []string) json.RawMessage {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil || obj == nil {
		return raw
	}
	if ownerID == nil {
		obj["ownerId"] = json.RawMessage("null")
	} else {
		encoded, _ := json.Marshal(*ownerID)
		obj["ownerId"] = encoded
	}
	if sharedWith == nil {
		sharedWith = []string{}
	}
	encoded, _ := json.Marshal(sharedWith)
	obj["sharedWith"] = encoded
	out, err := json.Marshal(obj)
	if err != nil {
		return raw
	}
	return out
}

func taskHasSharedWith(raw json.RawMessage) bool {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return false
	}
	_, ok := obj["sharedWith"]
	return ok
}

// mergeUserTasks merges a user token's PUT payload into the stored tasks,
// mirroring mergeUserState in server.mjs: tasks the requester cannot see
// are preserved exactly; their own omitted tasks are deleted; shared
// omitted tasks are untouched; ownerId can never be forged or moved;
// sharedWith changes only on tasks the requester owns.
func mergeUserTasks(storedRaw, incomingRaw json.RawMessage, users []userRecord, userID string) json.RawMessage {
	stored := splitTasks(storedRaw)
	incoming := splitTasks(incomingRaw)
	incomingByID := map[string]json.RawMessage{}
	for _, raw := range incoming {
		meta := parseTaskMeta(raw)
		if meta.ID != "" {
			if _, dup := incomingByID[meta.ID]; !dup {
				incomingByID[meta.ID] = raw
			}
		}
	}
	storedIDs := map[string]struct{}{}
	for _, raw := range stored {
		storedIDs[parseTaskMeta(raw).ID] = struct{}{}
	}
	handled := map[string]struct{}{}
	result := []json.RawMessage{}
	for _, raw := range stored {
		meta := parseTaskMeta(raw)
		inc, hasIncoming := incomingByID[meta.ID]
		if !visibleToUser(meta, userID) {
			if hasIncoming {
				handled[meta.ID] = struct{}{}
			}
			result = append(result, raw)
			continue
		}
		if !hasIncoming {
			if meta.OwnerID == nil || *meta.OwnerID != userID {
				result = append(result, raw)
			}
			continue
		}
		handled[meta.ID] = struct{}{}
		isOwner := meta.OwnerID != nil && *meta.OwnerID == userID
		// A shared user cannot delete the owner's task: a tombstone from
		// them is ignored (the Web client deletes by tombstone).
		if !isOwner && parseTaskMeta(inc).Deleted && !meta.Deleted {
			result = append(result, raw)
		} else if isOwner && taskHasSharedWith(inc) {
			result = append(result, rewriteTask(inc, meta.OwnerID, sanitizeSharedWith(parseTaskMeta(inc).SharedWith, users)))
		} else if isOwner {
			result = append(result, rewriteTask(inc, meta.OwnerID, meta.SharedWith))
		} else {
			result = append(result, rewriteTask(inc, meta.OwnerID, meta.SharedWith))
		}
	}
	for _, raw := range incoming {
		meta := parseTaskMeta(raw)
		if meta.ID == "" {
			continue
		}
		if _, done := handled[meta.ID]; done {
			continue
		}
		if _, exists := storedIDs[meta.ID]; exists {
			continue
		}
		handled[meta.ID] = struct{}{}
		owner := userID
		result = append(result, rewriteTask(raw, &owner, sanitizeSharedWith(meta.SharedWith, users)))
	}
	return joinTasks(result)
}

// --- REST task API helpers (mirror server.mjs) ---

var dateKeyPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return value
}

func taskField(raw json.RawMessage, key string) (json.RawMessage, bool) {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return nil, false
	}
	value, ok := obj[key]
	return value, ok
}

func setTaskField(raw json.RawMessage, key string, value json.RawMessage) json.RawMessage {
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil || obj == nil {
		obj = map[string]json.RawMessage{}
	}
	obj[key] = value
	out, err := json.Marshal(obj)
	if err != nil {
		return raw
	}
	return out
}

func marshalField(value any) json.RawMessage {
	raw, _ := json.Marshal(value)
	return raw
}

// stringBodyField reads a field of a JSON request body: present reports
// whether the key exists at all; ok=false when a present value has the
// wrong type (for nullable fields, JSON null reads as present + nil).
func stringBodyField(body map[string]json.RawMessage, key string) (value *string, present bool, ok bool) {
	raw, present := body[key]
	if !present {
		return nil, false, true
	}
	if string(raw) == "null" {
		return nil, true, true
	}
	var text string
	if json.Unmarshal(raw, &text) != nil {
		return nil, true, false
	}
	return &text, true, true
}

// normalizeRepeatInput mirrors normalizeRepeat in model.ts; ok=false when
// the value is not a repeat shape at all.
func normalizeRepeatInput(raw json.RawMessage) (json.RawMessage, bool) {
	var value struct {
		Kind  string `json:"kind"`
		Every int    `json:"every"`
		Unit  string `json:"unit"`
		Days  []int  `json:"days"`
	}
	if json.Unmarshal(raw, &value) != nil {
		return nil, false
	}
	switch value.Kind {
	case "none", "daily", "weekdays", "weekly", "monthly":
		return marshalField(map[string]string{"kind": value.Kind}), true
	case "interval":
		every := value.Every
		if every < 1 {
			every = 1
		}
		if every > 99 {
			every = 99
		}
		unit := value.Unit
		if unit != "week" && unit != "month" {
			unit = "day"
		}
		return marshalField(map[string]any{"kind": "interval", "every": every, "unit": unit}), true
	case "days":
		rawDays, present := map[string]json.RawMessage{}, false
		_ = json.Unmarshal(raw, &rawDays)
		_, present = rawDays["days"]
		if !present {
			return nil, false
		}
		seen := map[int]bool{}
		days := []int{}
		for _, day := range value.Days {
			if day < 0 || day > 6 || seen[day] {
				continue
			}
			seen[day] = true
			days = append(days, day)
		}
		for i := 0; i < len(days); i++ {
			for j := i + 1; j < len(days); j++ {
				if days[j] < days[i] {
					days[i], days[j] = days[j], days[i]
				}
			}
		}
		return marshalField(map[string]any{"kind": "days", "days": days}), true
	}
	return nil, false
}

// restTaskFromBody builds a stored task from a REST POST body, mirroring
// the Web client's addTask shape/defaults. Owner stamping is the caller's.
func restTaskFromBody(body map[string]json.RawMessage, ownerID *string) (json.RawMessage, string) {
	titleValue, titlePresent, titleOK := stringBodyField(body, "title")
	if !titlePresent || !titleOK || titleValue == nil {
		return nil, "A task title is required"
	}
	title := truncateRunes(strings.TrimSpace(*titleValue), 200)
	if title == "" {
		return nil, "A task title is required"
	}
	notes := ""
	if value, present, ok := stringBodyField(body, "notes"); present {
		if !ok || value == nil {
			return nil, "notes must be a string"
		}
		notes = truncateRunes(strings.TrimSpace(*value), 20_000)
	}
	date, dateOK := nullableDateField(body)
	if !dateOK {
		return nil, "date must be YYYY-MM-DD or null"
	}
	categoryID, categoryOK := nullableIDField(body, "categoryId")
	if !categoryOK {
		return nil, "categoryId must be a string or null"
	}
	projectID, projectOK := nullableIDField(body, "projectId")
	if !projectOK {
		return nil, "projectId must be a string or null"
	}
	repeat := json.RawMessage(`{"kind":"none"}`)
	if raw, present := body["repeat"]; present {
		normalized, ok := normalizeRepeatInput(raw)
		if !ok {
			return nil, "Invalid repeat"
		}
		repeat = normalized
	}
	now := nowISO()
	task := map[string]json.RawMessage{
		"id":          marshalField(newUserID()),
		"title":       marshalField(title),
		"notes":       marshalField(notes),
		"categoryId":  marshalField(categoryID),
		"projectId":   marshalField(projectID),
		"date":        marshalField(date),
		"repeat":      repeat,
		"done":        marshalField(false),
		"completedAt": json.RawMessage("null"),
		"createdAt":   marshalField(now),
		"updatedAt":   marshalField(now),
		"ownerId":     marshalField(ownerID),
		"sharedWith":  json.RawMessage("[]"),
	}
	raw, err := json.Marshal(task)
	if err != nil {
		return nil, "Invalid JSON"
	}
	return raw, ""
}

func nullableDateField(body map[string]json.RawMessage) (*string, bool) {
	value, present, ok := stringBodyField(body, "date")
	if !present {
		return nil, true
	}
	if !ok {
		return nil, false
	}
	if value == nil {
		return nil, true
	}
	if !dateKeyPattern.MatchString(*value) {
		return nil, false
	}
	return value, true
}

func nullableIDField(body map[string]json.RawMessage, key string) (*string, bool) {
	value, present, ok := stringBodyField(body, key)
	if !present || !ok {
		return value, ok
	}
	return value, true
}

// restPatchFromBody validates a REST PATCH body into raw field updates.
// Ownership/sharing fields are not patchable.
func restPatchFromBody(body map[string]json.RawMessage) (map[string]json.RawMessage, string) {
	patch := map[string]json.RawMessage{}
	if _, present := body["title"]; present {
		value, _, ok := stringBodyField(body, "title")
		if !ok || value == nil {
			return nil, "A task title is required"
		}
		title := truncateRunes(strings.TrimSpace(*value), 200)
		if title == "" {
			return nil, "A task title is required"
		}
		patch["title"] = marshalField(title)
	}
	if _, present := body["notes"]; present {
		value, _, ok := stringBodyField(body, "notes")
		if !ok || value == nil {
			return nil, "notes must be a string"
		}
		patch["notes"] = marshalField(truncateRunes(*value, 20_000))
	}
	if _, present := body["date"]; present {
		value, ok := nullableDateField(body)
		if !ok {
			return nil, "date must be YYYY-MM-DD or null"
		}
		patch["date"] = marshalField(value)
	}
	for _, key := range []string{"categoryId", "projectId"} {
		if _, present := body[key]; present {
			value, ok := nullableIDField(body, key)
			if !ok {
				return nil, key + " must be a string or null"
			}
			patch[key] = marshalField(value)
		}
	}
	if raw, present := body["done"]; present {
		var done bool
		if json.Unmarshal(raw, &done) != nil {
			return nil, "done must be a boolean"
		}
		patch["done"] = marshalField(done)
	}
	return patch, ""
}

func taskVisibleForRest(raw json.RawMessage, isAdmin bool, userID string) bool {
	meta := parseTaskMeta(raw)
	if meta.Deleted {
		return false
	}
	return isAdmin || visibleToUser(meta, userID)
}

func newServer(cfg config) http.Handler {
	token, err := validateToken(cfg.token)
	if err != nil {
		panic(err)
	}
	cfg.token = token
	if cfg.maxBody == 0 {
		cfg.maxBody = defaultMaxBody
	}
	state, err := loadState(cfg.dataPath)
	if err != nil {
		panic(err)
	}
	origins := map[string]struct{}{}
	for _, origin := range cfg.allowedOrigins {
		if origin != "" {
			origins[origin] = struct{}{}
		}
	}
	return &server{config: cfg, origins: origins, state: state}
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	for key, value := range securityHeaders {
		w.Header().Set(key, value)
	}
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case r.URL.Path == "/health" && r.Method == http.MethodOptions:
		s.options(w, r, "Authorization", "GET, OPTIONS")
	case r.URL.Path == "/health" && r.Method == http.MethodGet:
		s.health(w, r)
	case r.URL.Path == "/v1/state" && r.Method == http.MethodOptions:
		s.options(w, r, "Authorization, Content-Type, If-Match", "GET, PUT, OPTIONS")
	case r.URL.Path == "/v1/state" && (r.Method == http.MethodGet || r.Method == http.MethodPut):
		s.stateEndpoint(w, r)
	case (r.URL.Path == "/v1/users" || strings.HasPrefix(r.URL.Path, "/v1/users/") || r.URL.Path == "/v1/me") && r.Method == http.MethodOptions:
		s.options(w, r, "Authorization, Content-Type", "GET, POST, DELETE, OPTIONS")
	case (r.URL.Path == "/v1/tasks" || strings.HasPrefix(r.URL.Path, "/v1/tasks/")) && r.Method == http.MethodOptions:
		s.options(w, r, "Authorization, Content-Type", "GET, POST, PATCH, DELETE, OPTIONS")
	case r.URL.Path == "/v1/tasks" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		s.tasksEndpoint(w, r)
	case strings.HasPrefix(r.URL.Path, "/v1/tasks/") && (r.Method == http.MethodPatch || r.Method == http.MethodDelete):
		s.tasksEndpoint(w, r)
	case r.URL.Path == "/v1/me" && r.Method == http.MethodGet:
		s.meEndpoint(w, r)
	case r.URL.Path == "/v1/users" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		s.usersEndpoint(w, r)
	case strings.HasPrefix(r.URL.Path, "/v1/users/") && r.Method == http.MethodDelete:
		s.usersEndpoint(w, r)
	case r.Method == http.MethodGet || r.Method == http.MethodHead:
		if !s.serveStatic(w, r) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
		}
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Not found"})
	}
}

func (s *server) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	_, ok := s.origins[origin]
	return origin == "" || ok
}

func (s *server) cors(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if _, ok := s.origins[origin]; ok {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Expose-Headers", "ETag")
		w.Header().Set("Vary", "Origin")
	}
}

func (s *server) options(w http.ResponseWriter, r *http.Request, headers, methods string) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin not allowed"})
		return
	}
	s.cors(w, r)
	w.Header().Set("Access-Control-Allow-Headers", headers)
	w.Header().Set("Access-Control-Allow-Methods", methods)
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin not allowed"})
		return
	}
	s.cors(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": "cat2duck"})
}

func (s *server) meEndpoint(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin not allowed"})
		return
	}
	s.cors(w, r)
	isAdmin, user, ok := s.authenticate(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	if isAdmin {
		writeJSON(w, http.StatusOK, map[string]string{"kind": "admin"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"kind": "user", "id": user.ID, "name": user.Name})
}

func newUserID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16])
}

func (s *server) usersEndpoint(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin not allowed"})
		return
	}
	s.cors(w, r)
	isAdmin, _, ok := s.authenticate(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	switch {
	case r.Method == http.MethodGet:
		s.mu.Lock()
		users := s.state.Users
		s.mu.Unlock()
		directory := []publicUser{}
		for _, user := range users {
			directory = append(directory, publicUser{ID: user.ID, Name: user.Name})
		}
		writeJSON(w, http.StatusOK, directory)
	case r.Method == http.MethodPost:
		if !isAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Only the admin can create users"})
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.maxBody))
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Request body too large"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
			return
		}
		var payload struct {
			Name string `json:"name"`
		}
		if json.Unmarshal(body, &payload) != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
			return
		}
		name := strings.TrimSpace(payload.Name)
		if len(name) > 80 {
			name = string([]rune(name)[:80])
		}
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "A user name is required"})
			return
		}
		// The raw personal token is returned once, here; only its SHA-256
		// hash is ever stored.
		tokenBytes := make([]byte, 32)
		if _, err := rand.Read(tokenBytes); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist state"})
			return
		}
		personalToken := base64.RawURLEncoding.EncodeToString(tokenBytes)
		record := userRecord{ID: newUserID(), Name: name, TokenHash: hashToken(personalToken)}
		s.mu.Lock()
		defer s.mu.Unlock()
		next := s.state
		next.Users = append(append([]userRecord{}, s.state.Users...), record)
		if err := persistState(s.dataPath, next); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist state"})
			return
		}
		s.state = next
		writeJSON(w, http.StatusCreated, map[string]string{"id": record.ID, "name": record.Name, "token": personalToken})
	case r.Method == http.MethodDelete:
		if !isAdmin {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Only the admin can delete users"})
			return
		}
		targetID, err := url.PathUnescape(strings.TrimPrefix(r.URL.Path, "/v1/users/"))
		if err != nil || targetID == "" || strings.Contains(targetID, "/") {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		found := false
		remaining := []userRecord{}
		for _, user := range s.state.Users {
			if user.ID == targetID {
				found = true
			} else {
				remaining = append(remaining, user)
			}
		}
		if !found {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "User not found"})
			return
		}
		// Revoking a user also unshares everything shared with them.
		tasks := []json.RawMessage{}
		for _, raw := range splitTasks(s.state.Tasks) {
			meta := parseTaskMeta(raw)
			kept := []string{}
			contains := false
			for _, id := range meta.SharedWith {
				if id == targetID {
					contains = true
				} else {
					kept = append(kept, id)
				}
			}
			if contains {
				raw = rewriteTask(raw, meta.OwnerID, kept)
			}
			tasks = append(tasks, raw)
		}
		next := s.state
		next.Users = remaining
		next.Tasks = joinTasks(tasks)
		if err := persistState(s.dataPath, next); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist state"})
			return
		}
		s.state = next
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func writeRawJSON(w http.ResponseWriter, status int, raw json.RawMessage) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

// tasksEndpoint is the REST task API (Home Assistant integration and
// other automation). Scoping mirrors server.mjs / the sync API: the
// admin token sees everything; a personal token sees its own tasks plus
// tasks shared with it, and new tasks are stamped with that user as owner.
func (s *server) tasksEndpoint(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin not allowed"})
		return
	}
	s.cors(w, r)
	isAdmin, user, authOK := s.authenticate(r)
	if !authOK {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	userID := ""
	if user != nil {
		userID = user.ID
	}
	isCollection := r.URL.Path == "/v1/tasks"

	if isCollection && r.Method == http.MethodGet {
		s.mu.Lock()
		stored := s.state.Tasks
		s.mu.Unlock()
		tasks := []json.RawMessage{}
		for _, raw := range splitTasks(stored) {
			if taskVisibleForRest(raw, isAdmin, userID) {
				tasks = append(tasks, raw)
			}
		}
		writeJSON(w, http.StatusOK, map[string][]json.RawMessage{"tasks": tasks})
		return
	}

	readTaskBody := func() (map[string]json.RawMessage, bool) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.maxBody))
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Request body too large"})
				return nil, false
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
			return nil, false
		}
		var parsed map[string]json.RawMessage
		if json.Unmarshal(body, &parsed) != nil || parsed == nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid JSON"})
			return nil, false
		}
		return parsed, true
	}

	if isCollection && r.Method == http.MethodPost {
		body, ok := readTaskBody()
		if !ok {
			return
		}
		var ownerID *string
		if !isAdmin {
			ownerID = &userID
		}
		task, errMessage := restTaskFromBody(body, ownerID)
		if errMessage != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": errMessage})
			return
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		// New tasks go first, like the Web client's addTask.
		tasks := append([]json.RawMessage{task}, splitTasks(s.state.Tasks)...)
		next := s.state
		next.Revision = s.state.Revision + 1
		next.Tasks = joinTasks(tasks)
		next.projectsPresent = true
		if err := persistState(s.dataPath, next); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist state"})
			return
		}
		s.state = next
		writeRawJSON(w, http.StatusCreated, task)
		return
	}

	// Item endpoints: PATCH / DELETE /v1/tasks/:id
	targetID, err := url.PathUnescape(strings.TrimPrefix(r.URL.Path, "/v1/tasks/"))
	if err != nil || targetID == "" || strings.Contains(targetID, "/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Task not found"})
		return
	}
	var patch map[string]json.RawMessage
	if r.Method == http.MethodPatch {
		body, ok := readTaskBody()
		if !ok {
			return
		}
		var errMessage string
		patch, errMessage = restPatchFromBody(body)
		if errMessage != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": errMessage})
			return
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	tasks := splitTasks(s.state.Tasks)
	index := -1
	for i, raw := range tasks {
		if parseTaskMeta(raw).ID == targetID {
			index = i
			break
		}
	}
	if index < 0 || !taskVisibleForRest(tasks[index], isAdmin, userID) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Task not found"})
		return
	}
	stored := tasks[index]
	if r.Method == http.MethodDelete {
		// Only the owner or the admin may delete; a user the task is
		// shared with gets 403.
		meta := parseTaskMeta(stored)
		if !isAdmin && (meta.OwnerID == nil || *meta.OwnerID != userID) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "Only the owner can delete this task"})
			return
		}
		stored = setTaskField(stored, "deleted", marshalField(true))
		stored = setTaskField(stored, "updatedAt", marshalField(nowISO()))
	} else {
		now := nowISO()
		wasDone := false
		if raw, ok := taskField(stored, "done"); ok {
			_ = json.Unmarshal(raw, &wasDone)
		}
		for key, value := range patch {
			stored = setTaskField(stored, key, value)
		}
		if raw, patched := patch["done"]; patched {
			var done bool
			_ = json.Unmarshal(raw, &done)
			if done != wasDone {
				if done {
					stored = setTaskField(stored, "completedAt", marshalField(now))
				} else {
					stored = setTaskField(stored, "completedAt", json.RawMessage("null"))
				}
			}
		}
		stored = setTaskField(stored, "updatedAt", marshalField(now))
	}
	tasks[index] = stored
	next := s.state
	next.Revision = s.state.Revision + 1
	next.Tasks = joinTasks(tasks)
	next.projectsPresent = true
	if err := persistState(s.dataPath, next); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist state"})
		return
	}
	s.state = next
	writeRawJSON(w, http.StatusOK, stored)
}

func (s *server) stateEndpoint(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin not allowed"})
		return
	}
	s.cors(w, r)
	isAdmin, user, authOK := s.authenticate(r)
	if !authOK {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	if r.Method == http.MethodGet {
		s.mu.Lock()
		state := s.state
		s.mu.Unlock()
		// A personal token sees categories, projects, and only the tasks
		// they own or that are shared with them. Unowned legacy tasks are
		// the admin's and are not visible to user tokens.
		tasks := state.Tasks
		if !isAdmin {
			visible := []json.RawMessage{}
			for _, raw := range splitTasks(state.Tasks) {
				if visibleToUser(parseTaskMeta(raw), user.ID) {
					visible = append(visible, raw)
				}
			}
			tasks = joinTasks(visible)
		}
		w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(state.Revision, 10)))
		writeJSON(w, http.StatusOK, map[string]json.RawMessage{"tasks": tasks, "categories": state.Categories, "projects": state.Projects})
		return
	}
	match := regexp.MustCompile(`^"(\d+)"$`).FindStringSubmatch(r.Header.Get("If-Match"))
	if match == nil {
		writeJSON(w, http.StatusPreconditionRequired, map[string]string{"error": "If-Match revision required"})
		return
	}
	expected, _ := strconv.ParseInt(match[1], 10, 64)
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, s.maxBody))
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Request body too large"})
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request"})
		return
	}
	parsed, err := normalizeState(body)
	if err != nil {
		message := "Invalid JSON"
		if strings.Contains(err.Error(), "tasks and categories") {
			message = "Expected tasks and categories arrays"
		}
		if strings.Contains(err.Error(), "projects must be an array") {
			message = "Expected projects to be an array when present"
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
		return
	}
	if countArray(parsed.Tasks) > 5000 || countArray(parsed.Categories) > 200 || countArray(parsed.Projects) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Too many items"})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if expected != s.state.Revision {
		w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(s.state.Revision, 10)))
		writeJSON(w, http.StatusConflict, map[string]any{"error": "State changed", "revision": s.state.Revision})
		return
	}
	// A client that predates projects (e.g. the Android app) omits the
	// array; keep the stored projects instead of wiping them.
	projects := parsed.Projects
	if !parsed.projectsPresent {
		projects = s.state.Projects
	}
	// The admin token keeps whole-state semantics; a personal token's
	// payload is merged in scoped to that user (see mergeUserTasks).
	tasks := parsed.Tasks
	if !isAdmin {
		tasks = mergeUserTasks(s.state.Tasks, parsed.Tasks, s.state.Users, user.ID)
	}
	next := stateFile{Revision: s.state.Revision + 1, Tasks: tasks, Categories: parsed.Categories, Projects: projects, Users: s.state.Users, projectsPresent: true}
	if err := persistState(s.dataPath, next); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to persist state"})
		return
	}
	s.state = next
	w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(next.Revision, 10)))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "revision": next.Revision})
}

func countArray(raw json.RawMessage) int {
	var items []json.RawMessage
	if json.Unmarshal(raw, &items) != nil {
		return 0
	}
	return len(items)
}

func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) bool {
	requested := r.URL.Path
	if requested == "/" {
		requested = "/index.html"
	}
	filePath, ok := resolveStaticPath(s.staticDir, requested)
	if ok {
		if info, err := os.Stat(filePath); err == nil && info.Mode().IsRegular() {
			cache := "no-cache"
			if strings.HasPrefix(r.URL.Path, "/assets/") || strings.HasPrefix(r.URL.Path, "/__grok/") {
				cache = "public, max-age=31536000, immutable"
			}
			w.Header().Set("Cache-Control", cache)
			w.Header().Set("Content-Type", contentTypeFor(filePath))
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusOK)
				return true
			}
			http.ServeFile(w, r, filePath)
			return true
		}
	}
	fallback := filepath.Join(s.staticDir, "index.html")
	if _, err := os.Stat(fallback); err != nil {
		return false
	}
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return true
	}
	http.ServeFile(w, r, fallback)
	return true
}

func resolveStaticPath(root, requested string) (string, bool) {
	decoded, err := url.PathUnescape(requested)
	if err != nil || strings.Contains(decoded, "..") {
		return "", false
	}
	decoded = path.Clean("/" + decoded)
	if strings.Contains(decoded, "..") {
		return "", false
	}
	full := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(decoded, "/")))
	rel, err := filepath.Rel(root, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", false
	}
	return full, true
}

func contentTypeFor(filePath string) string {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js", ".mjs":
		return "application/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".ico":
		return "image/x-icon"
	case ".webp":
		return "image/webp"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	default:
		if kind := mime.TypeByExtension(filepath.Ext(filePath)); kind != "" {
			return kind
		}
		return "application/octet-stream"
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--healthcheck" {
		response, err := http.Get(os.Args[2])
		if err != nil || response.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		os.Exit(0)
	}
	origins := []string{}
	for _, origin := range strings.Split(os.Getenv("CADENCE_ALLOWED_ORIGINS"), ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	dataPath := os.Getenv("DATA_PATH")
	if dataPath == "" {
		dataPath = "/data/state.json"
	}
	staticDir := os.Getenv("STATIC_DIR")
	if staticDir == "" {
		staticDir = "/app/static"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8787"
	}
	handler := newServer(config{token: os.Getenv("CADENCE_TOKEN"), dataPath: dataPath, staticDir: staticDir, allowedOrigins: origins})
	log.Printf("Cat2Duck server listening on %s", port)
	log.Fatal(http.ListenAndServe("0.0.0.0:"+port, handler))
}
