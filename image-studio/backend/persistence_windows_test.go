//go:build windows

package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAppendUniquePathDeduplicatesCaseInsensitiveWindowsPaths(t *testing.T) {
	root := filepath.Join("C:", "Users", "alice", "AppData", "Roaming")
	paths := []string{}
	paths = appendUniquePath(paths, filepath.Join(root, "image-studio.exe"))
	paths = appendUniquePath(paths, filepath.Join(root, "IMAGE-STUDIO.EXE"))
	paths = appendUniquePath(paths, filepath.Join(root, "old-custom-name.exe"))

	if len(paths) != 2 {
		t.Fatalf("paths = %#v, want two unique entries", paths)
	}
	if paths[1] != filepath.Join(root, "old-custom-name.exe") {
		t.Fatalf("historical exe path was not preserved: %#v", paths)
	}
}

func TestWindowsLegacyWebviewUserDataPathsIncludesLocalAppDataProfile(t *testing.T) {
	localAppData := t.TempDir()
	roamingAppData := t.TempDir()
	t.Setenv("LOCALAPPDATA", localAppData)
	t.Setenv("APPDATA", roamingAppData)

	paths, err := WindowsLegacyWebviewUserDataPaths()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(localAppData, appConfigDirName, "WebView2")
	for _, path := range paths {
		if samePath(path, want) {
			return
		}
	}
	t.Fatalf("legacy paths %q do not include %q", paths, want)
}

func TestWindowsLegacyWebviewUserDataPathsDoesNotCreateCandidates(t *testing.T) {
	localAppData := t.TempDir()
	roamingAppData := t.TempDir()
	t.Setenv("LOCALAPPDATA", localAppData)
	t.Setenv("APPDATA", roamingAppData)

	paths, err := WindowsLegacyWebviewUserDataPaths()
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if _, err := os.Stat(path); err == nil || !os.IsNotExist(err) {
			t.Fatalf("candidate enumeration touched %q: %v", path, err)
		}
	}
}
