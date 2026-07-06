package handlers

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// DownloadJob represents a ZIP download job
type DownloadJob struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"` // "processing", "ready", "failed"
	Progress  int       `json:"progress"`
	Total     int       `json:"total"`
	Filename  string    `json:"filename,omitempty"`
	Error     string    `json:"error,omitempty"`
	FilePath  string    `json:"-"`
	CreatedAt time.Time `json:"-"`
	// ShareKey binds the job to the share that created it. Only requests
	// authenticated with the same share key can look up status or
	// download the resulting ZIP. This is defense-in-depth: the jobID is
	// already a 128-bit random value, but binding to the share key blocks
	// any cross-share information leak even if a job ID were to leak
	// (e.g. via logs).
	ShareKey string `json:"-"`
}

// DownloadJobManager manages download jobs
type DownloadJobManager struct {
	jobs  map[string]*DownloadJob
	mutex sync.RWMutex
}

// Global job manager
var downloadJobManager = &DownloadJobManager{
	jobs: make(map[string]*DownloadJob),
}

// activeJobCount returns the number of jobs that are currently processing.
// Ready/failed jobs do not count towards the concurrency limit — they live
// only until their temp files are cleaned up.
func (m *DownloadJobManager) activeJobCount() int {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	n := 0
	for _, j := range m.jobs {
		if j.Status == "processing" {
			n++
		}
	}
	return n
}

func (m *DownloadJobManager) Create(total int, filename, shareKey string) *DownloadJob {
	id := generateJobID()
	job := &DownloadJob{
		ID:        id,
		Status:    "processing",
		Progress:  0,
		Total:     total,
		Filename:  filename,
		CreatedAt: time.Now(),
		ShareKey:  shareKey,
	}
	m.mutex.Lock()
	m.jobs[id] = job
	m.mutex.Unlock()
	return job
}

func (m *DownloadJobManager) Get(id string) *DownloadJob {
	m.mutex.RLock()
	defer m.mutex.RUnlock()
	return m.jobs[id]
}

func (m *DownloadJobManager) Delete(id string) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		if job.FilePath != "" {
			os.Remove(job.FilePath)
		}
		delete(m.jobs, id)
	}
	m.mutex.Unlock()
}

func (m *DownloadJobManager) UpdateProgress(id string, progress int) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		job.Progress = progress
	}
	m.mutex.Unlock()
}

func (m *DownloadJobManager) SetReady(id string, filePath string) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		job.Status = "ready"
		job.FilePath = filePath
		job.Progress = job.Total
	}
	m.mutex.Unlock()
}

func (m *DownloadJobManager) SetFailed(id string, err string) {
	m.mutex.Lock()
	if job, ok := m.jobs[id]; ok {
		job.Status = "failed"
		job.Error = err
	}
	m.mutex.Unlock()
}

// Cleanup old jobs (call periodically)
func (m *DownloadJobManager) Cleanup(maxAge time.Duration) {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	now := time.Now()
	for id, job := range m.jobs {
		if now.Sub(job.CreatedAt) > maxAge {
			if job.FilePath != "" {
				os.Remove(job.FilePath)
			}
			delete(m.jobs, id)
		}
	}
}

func generateJobID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// jobBelongsToShare is a constant-time comparison of the current share key
// to the one that created the job. We intentionally use subtle.ConstantTimeCompare
// to avoid any timing-oracle that might help an attacker confirm whether
// a specific job ID exists for a different share.
func jobBelongsToShare(job *DownloadJob, shareKey string) bool {
	if job == nil || shareKey == "" {
		return false
	}
	a := []byte(job.ShareKey)
	b := []byte(shareKey)
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare(a, b) == 1
}

// isValidJobID checks that a job ID is exactly 32 lowercase hex characters,
// the format produced by generateJobID. This prevents path-traversal shaped
// job IDs from ever reaching the map and gives a cheap front-line filter
// against fuzzing.
func isValidJobID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// sanitizeFilename removes unsafe characters from a filename
func sanitizeFilename(name string) string {
	unsafe := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|", "\n", "\r"}
	result := name
	for _, char := range unsafe {
		result = strings.ReplaceAll(result, char, "_")
	}
	result = strings.Trim(result, " .")
	if len(result) > 100 {
		result = result[:100]
	}
	return result
}

// getUniqueFilename ensures filenames are unique in the ZIP
func getUniqueFilename(filename string, used map[string]int) string {
	if count, exists := used[filename]; exists {
		ext := filepath.Ext(filename)
		base := strings.TrimSuffix(filename, ext)
		filename = fmt.Sprintf("%s_%d%s", base, count+1, ext)
		used[filename] = count + 1
	} else {
		used[filename] = 1
	}
	return filename
}

// filenameFromContentDisposition extracts the filename from a
// Content-Disposition header, returning "" when absent or unparsable.
// The result is sanitized before use as a ZIP entry name.
func filenameFromContentDisposition(header string) string {
	if header == "" {
		return ""
	}
	_, params, err := mime.ParseMediaType(header)
	if err != nil {
		return ""
	}
	return sanitizeFilename(params["filename"])
}

// getExtensionForMimeType returns a file extension for a MIME type
func getExtensionForMimeType(mimeType string) string {
	extensions := map[string]string{
		"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
		"image/webp": ".webp", "image/heic": ".heic", "video/mp4": ".mp4",
		"video/quicktime": ".mov", "video/webm": ".webm",
	}
	if ext, ok := extensions[mimeType]; ok {
		return ext
	}
	return ""
}
