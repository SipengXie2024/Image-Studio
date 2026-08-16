//go:build windows

package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateWindowsWebviewDataDirCopiesLegacyProfile(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "image-studio.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	dbFile := filepath.Join(legacy, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("image-studio historyFull gptcodex.profiles history-db"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDir(dst, legacy); err != nil {
		t.Fatal(err)
	}

	migrated := filepath.Join(dst, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log")
	data, err := os.ReadFile(migrated)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "image-studio historyFull gptcodex.profiles history-db" {
		t.Fatalf("migrated data = %q", data)
	}
	legacyData, err := os.ReadFile(dbFile)
	if err != nil {
		t.Fatalf("legacy profile was removed: %v", err)
	}
	if string(legacyData) != string(data) {
		t.Fatalf("legacy data changed: %q", legacyData)
	}
}

func TestMigrateWindowsWebviewDataDirCopiesNestedWailsProfile(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "LocalAppData", "image-studio", "WebView2")
	dst := filepath.Join(root, "Documents", "Image Studio", "webview")
	dbFile := filepath.Join(legacy, "EBWebView", "Default", "IndexedDB", "http_wails.localhost_0.indexeddb.leveldb", "000003.log")
	blobFile := filepath.Join(legacy, "EBWebView", "Default", "IndexedDB", "http_wails.localhost_0.indexeddb.blob", "1", "00", "2")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("image-studio prompt createdAt"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(blobFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(blobFile, []byte("image-bytes"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{legacy}); err != nil {
		t.Fatal(err)
	}

	for path, want := range map[string]string{
		filepath.Join(dst, "EBWebView", "Default", "IndexedDB", "http_wails.localhost_0.indexeddb.leveldb", "000003.log"): "image-studio prompt createdAt",
		filepath.Join(dst, "EBWebView", "Default", "IndexedDB", "http_wails.localhost_0.indexeddb.blob", "1", "00", "2"):  "image-bytes",
	} {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(data) != want {
			t.Fatalf("migrated data at %q = %q, want %q", path, data, want)
		}
	}
	if data, err := os.ReadFile(dbFile); err != nil || string(data) != "image-studio prompt createdAt" {
		t.Fatalf("legacy nested profile changed: data=%q err=%v", data, err)
	}
}

func TestMigrateWindowsWebviewDataDirKeepsExistingDestination(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "image-studio.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	if err := os.MkdirAll(legacy, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, secureDirMode); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(dst, "sentinel")
	if err := os.WriteFile(sentinel, []byte("keep"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDir(dst, legacy); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "keep" {
		t.Fatalf("destination was overwritten: %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirSkipsNonProfileDirectory(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "renamed.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	if err := os.MkdirAll(legacy, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "notes.txt"), []byte("not-webview"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDir(dst, legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("expected destination to stay absent, stat err = %v", err)
	}
}

func TestMigrateWindowsWebviewDataDirsPrefersProfileWithStoredData(t *testing.T) {
	root := t.TempDir()
	emptyProfile := filepath.Join(root, "renamed.exe")
	populatedProfile := filepath.Join(root, "image-studio.exe")
	dst := filepath.Join(root, "Image Studio", "webview")

	if err := os.MkdirAll(filepath.Join(emptyProfile, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	dbFile := filepath.Join(populatedProfile, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("gptcodex.profiles real-history"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{emptyProfile, populatedProfile}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "gptcodex.profiles real-history" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirsPrefersHighestScoringProfile(t *testing.T) {
	root := t.TempDir()
	smallProfile := filepath.Join(root, "small.exe")
	largeProfile := filepath.Join(root, "large.exe")
	dst := filepath.Join(root, "Image Studio", "webview")

	for path, data := range map[string]string{
		filepath.Join(smallProfile, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log"): "image-studio small",
		filepath.Join(largeProfile, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log"): "image-studio larger profile with more stored history",
	} {
		if err := os.MkdirAll(filepath.Dir(path), secureDirMode); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), secureFileMode); err != nil {
			t.Fatal(err)
		}
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{smallProfile, largeProfile}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "image-studio larger profile with more stored history" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestWebviewMigrationCandidatesKeepInputOrderForEqualScores(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "first.exe")
	second := filepath.Join(root, "second.exe")
	dst := filepath.Join(root, "Image Studio", "webview")

	for _, profile := range []string{first, second} {
		path := filepath.Join(profile, "IndexedDB", "image-studio.indexeddb.leveldb", "000003.log")
		if err := os.MkdirAll(filepath.Dir(path), secureDirMode); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("image-studio equal"), secureFileMode); err != nil {
			t.Fatal(err)
		}
	}

	candidates := webviewMigrationCandidates(dst, []string{first, second})
	if len(candidates) != 2 {
		t.Fatalf("candidates = %#v", candidates)
	}
	if !samePath(candidates[0].path, first) || !samePath(candidates[1].path, second) {
		t.Fatalf("equal-score order changed: %#v", candidates)
	}
}

func TestMigrateWindowsWebviewDataDirsFindsHistoricalExeName(t *testing.T) {
	root := t.TempDir()
	defaultProfile := filepath.Join(root, "image-studio.exe")
	currentProfile := filepath.Join(root, "current-name.exe")
	historicalProfile := filepath.Join(root, "old-custom-name.exe")
	dst := filepath.Join(root, "Image Studio", "webview")

	if err := os.MkdirAll(filepath.Join(defaultProfile, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(currentProfile, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	dbFile := filepath.Join(historicalProfile, "IndexedDB", "wails.localhost_0.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("historyFull gptcodex.promptHistory old-data"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{defaultProfile, currentProfile, historicalProfile}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "IndexedDB", "wails.localhost_0.indexeddb.leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "historyFull gptcodex.promptHistory old-data" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirsReplacesEmptyDestination(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "old-custom-name.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	if err := os.MkdirAll(filepath.Join(dst, "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	dbFile := filepath.Join(legacy, "Local Storage", "leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("gptcodex.outputFormat"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{legacy}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "Local Storage", "leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "gptcodex.outputFormat" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirsReplacesEmptyNestedWailsDestination(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "LocalAppData", "image-studio", "WebView2")
	dst := filepath.Join(root, "Documents", "Image Studio", "webview")
	if err := os.MkdirAll(filepath.Join(dst, "EBWebView", "Default", "Network"), secureDirMode); err != nil {
		t.Fatal(err)
	}
	dbFile := filepath.Join(legacy, "EBWebView", "Default", "IndexedDB", "http_wails.localhost_0.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("image-studio historyFull old-local-app-data"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{legacy}); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(filepath.Join(dst, "EBWebView", "Default", "IndexedDB", "http_wails.localhost_0.indexeddb.leveldb", "000003.log"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "image-studio historyFull old-local-app-data" {
		t.Fatalf("migrated data = %q", data)
	}
}

func TestMigrateWindowsWebviewDataDirsRejectsUnmarkedProfile(t *testing.T) {
	root := t.TempDir()
	foreignProfile := filepath.Join(root, "other-app.exe")
	dst := filepath.Join(root, "Image Studio", "webview")
	dbFile := filepath.Join(foreignProfile, "IndexedDB", "foreign.indexeddb.leveldb", "000003.log")
	if err := os.MkdirAll(filepath.Dir(dbFile), secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dbFile, []byte("unrelated webview data"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := MigrateWindowsWebviewDataDirs(dst, []string{foreignProfile}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dst); !os.IsNotExist(err) {
		t.Fatalf("expected destination to stay absent, stat err = %v", err)
	}
}

func TestCopyDirToNewDestinationDoesNotLeavePartialTarget(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "source")
	dst := filepath.Join(root, "destination")
	if err := os.MkdirAll(src, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "history.log"), []byte("image-studio historyFull"), secureFileMode); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dst, secureDirMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "sentinel"), []byte("keep"), secureFileMode); err != nil {
		t.Fatal(err)
	}

	if err := copyDirToNewDestination(src, dst); err == nil {
		t.Fatal("expected an existing destination to reject the atomic commit")
	}
	if data, err := os.ReadFile(filepath.Join(dst, "sentinel")); err != nil || string(data) != "keep" {
		t.Fatalf("existing destination changed: data=%q err=%v", data, err)
	}
	matches, err := filepath.Glob(filepath.Join(root, ".destination.migrating-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary migration directories were not cleaned: %q", matches)
	}
}
