package main

import (
	"crypto/sha256"
	"crypto/subtle"
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
)

const defaultMaxBody = 1_500_000

var securityHeaders = map[string]string{
	"Content-Security-Policy": "default-src 'self'; script-src 'self' https://grok.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' https://grok.com",
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
	return stateFile{Tasks: json.RawMessage("[]"), Categories: json.RawMessage("[]")}
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
	var revision int64
	if rawRevision, ok := value["revision"]; ok {
		_ = json.Unmarshal(rawRevision, &revision)
		if revision < 0 {
			revision = 0
		}
	}
	return stateFile{Revision: revision, Tasks: append(json.RawMessage(nil), tasks...), Categories: append(json.RawMessage(nil), categories...)}, nil
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

func (s *server) stateEndpoint(w http.ResponseWriter, r *http.Request) {
	if !s.originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Origin not allowed"})
		return
	}
	s.cors(w, r)
	if !tokenMatches(s.token, r.Header.Get("Authorization")) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	if r.Method == http.MethodGet {
		s.mu.Lock()
		state := s.state
		s.mu.Unlock()
		w.Header().Set("ETag", strconv.Quote(strconv.FormatInt(state.Revision, 10)))
		writeJSON(w, http.StatusOK, map[string]json.RawMessage{"tasks": state.Tasks, "categories": state.Categories})
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
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": message})
		return
	}
	if countArray(parsed.Tasks) > 5000 || countArray(parsed.Categories) > 200 {
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
	next := stateFile{Revision: s.state.Revision + 1, Tasks: parsed.Tasks, Categories: parsed.Categories}
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
