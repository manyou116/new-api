package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

func TestBuildImageStudioJSONBodiesSplitsNToSingleImageRequests(t *testing.T) {
	body := []byte(`{"model":"gpt-image-2","prompt":"draw","n":3,"size":"1024x1024"}`)

	bodies, err := buildImageStudioTaskBodies(nil, "application/json", body, 3)
	if err != nil {
		t.Fatalf("build bodies failed: %v", err)
	}
	if len(bodies) != 3 {
		t.Fatalf("expected 3 bodies, got %d", len(bodies))
	}

	for _, item := range bodies {
		var payload map[string]any
		if err := common.Unmarshal(item.Body, &payload); err != nil {
			t.Fatalf("unmarshal split body failed: %v", err)
		}
		if payload["n"] != float64(1) {
			t.Fatalf("expected n=1, got %#v", payload["n"])
		}
		if payload["prompt"] != "draw" {
			t.Fatalf("prompt changed: %#v", payload["prompt"])
		}
	}
}

func TestBuildImageStudioFormBodiesSplitsNToSingleImageRequests(t *testing.T) {
	form := url.Values{}
	form.Set("model", "gpt-image-2")
	form.Set("prompt", "draw")
	form.Set("n", "4")

	bodies, err := buildImageStudioTaskBodies(nil, "application/x-www-form-urlencoded", []byte(form.Encode()), 4)
	if err != nil {
		t.Fatalf("build bodies failed: %v", err)
	}
	if len(bodies) != 4 {
		t.Fatalf("expected 4 bodies, got %d", len(bodies))
	}

	for _, item := range bodies {
		values, err := url.ParseQuery(string(item.Body))
		if err != nil {
			t.Fatalf("parse split body failed: %v", err)
		}
		if got := values.Get("n"); got != "1" {
			t.Fatalf("expected n=1, got %q", got)
		}
		if got := values.Get("prompt"); got != "draw" {
			t.Fatalf("prompt changed: %q", got)
		}
	}
}

func TestBuildImageStudioMultipartBodiesSplitsNAndKeepsFiles(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	_ = writer.WriteField("model", "gpt-image-2")
	_ = writer.WriteField("prompt", "draw")
	_ = writer.WriteField("n", "2")
	part, err := writer.CreateFormFile("image", "ref.png")
	if err != nil {
		t.Fatalf("create form file failed: %v", err)
	}
	if _, err := part.Write([]byte("image-bytes")); err != nil {
		t.Fatalf("write form file failed: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close writer failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/pg/image-studio/edits", bytes.NewReader(buf.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = req

	storage, err := common.CreateBodyStorage(buf.Bytes())
	if err != nil {
		t.Fatalf("create body storage failed: %v", err)
	}
	c.Set(common.KeyBodyStorage, storage)

	bodies, err := buildImageStudioTaskBodies(c, writer.FormDataContentType(), buf.Bytes(), 2)
	if err != nil {
		t.Fatalf("build bodies failed: %v", err)
	}
	if len(bodies) != 2 {
		t.Fatalf("expected 2 bodies, got %d", len(bodies))
	}

	for _, item := range bodies {
		if !strings.Contains(item.ContentType, "multipart/form-data") {
			t.Fatalf("expected multipart content type, got %q", item.ContentType)
		}
		req := httptest.NewRequest(http.MethodPost, "/split", bytes.NewReader(item.Body))
		req.Header.Set("Content-Type", item.ContentType)
		if err := req.ParseMultipartForm(32 << 20); err != nil {
			t.Fatalf("parse split multipart failed: %v", err)
		}
		if got := req.MultipartForm.Value["n"]; len(got) != 1 || got[0] != "1" {
			t.Fatalf("expected n=1, got %#v", got)
		}
		files := req.MultipartForm.File["image"]
		if len(files) != 1 {
			t.Fatalf("expected one image file, got %d", len(files))
		}
		file, err := files[0].Open()
		if err != nil {
			t.Fatalf("open split file failed: %v", err)
		}
		out := new(bytes.Buffer)
		if _, err := out.ReadFrom(file); err != nil {
			_ = file.Close()
			t.Fatalf("read split file failed: %v", err)
		}
		_ = file.Close()
		if out.String() != "image-bytes" {
			t.Fatalf("file content changed: %q", out.String())
		}
	}
}
