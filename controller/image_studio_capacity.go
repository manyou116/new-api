package controller

import (
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	imageStudioDefaultConcurrency = constant.ImageStudioDefaultBatchConcurrency
	imageStudioMaxBatchBodySize   = 64 * 1024 * 1024
	imageStudioGlobalConcurrency  = constant.ImageStudioMaxBatchConcurrency
	imageStudioMaxQueuedTasks     = 64
	imageStudioMemoryBudget       = 256 * 1024 * 1024
	imageStudioWorkerMemory       = 2 * 1024 * 1024
	imageStudioReservationKey     = "image_studio_memory_reservation"
)

var imageStudioExecutionSlots = make(chan struct{}, imageStudioGlobalConcurrency)
var imageStudioQueueSlots = make(chan struct{}, imageStudioMaxQueuedTasks)

var imageStudioMemory = struct {
	sync.Mutex
	used int64
}{}

type imageStudioMemoryReservation struct {
	bytes    int64
	detached bool
	released bool
}

func imageStudioMaxResponseBytes() int64 {
	return ((service.ImageStudioMaxAssetBytes() + 2) / 3 * 4) + 1024*1024
}

func imageStudioBatchConcurrency() int {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ImageStudioBatchConcurrency"]
	common.OptionMapRWMutex.RUnlock()
	concurrency, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		concurrency = imageStudioDefaultConcurrency
	}
	if concurrency < 1 {
		return 1
	}
	if concurrency > imageStudioGlobalConcurrency {
		return imageStudioGlobalConcurrency
	}
	return concurrency
}

func imageStudioBatchWorkerCount(taskCount int) int {
	if taskCount <= 0 {
		return 0
	}
	return min(taskCount, imageStudioBatchConcurrency())
}

// ImageStudioRequestBudget runs before the distributor reads the body. It
// bounds both the transient parse/rebuild buffers and the bodies retained by
// queued background tasks, including requests without Content-Length.
func ImageStudioRequestBudget() gin.HandlerFunc {
	return func(c *gin.Context) {
		contentLength := c.Request.ContentLength
		if contentLength > imageStudioMaxBatchBodySize {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"error": gin.H{"message": "批量图片请求体过大，请减少图片数量或上传文件大小", "type": "invalid_request_error"}})
			return
		}
		estimatedBodyBytes := contentLength
		if estimatedBodyBytes <= 0 || strings.TrimSpace(c.GetHeader("Content-Encoding")) != "" {
			estimatedBodyBytes = imageStudioMaxBatchBodySize
		}
		reservation, ok := reserveImageStudioMemory(estimatedBodyBytes*2 + imageStudioWorkerMemory)
		if !ok {
			c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"message": "AI 画室内存队列已满，请稍后重试", "type": "server_error"}})
			return
		}
		c.Set(imageStudioReservationKey, reservation)
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, imageStudioMaxBatchBodySize)
		c.Next()
		reservation.releaseUnlessDetached()
	}
}

func reserveImageStudioMemory(bytes int64) (*imageStudioMemoryReservation, bool) {
	budget := int64(imageStudioMemoryBudget)
	if bytes <= 0 || bytes > budget {
		return nil, false
	}
	imageStudioMemory.Lock()
	defer imageStudioMemory.Unlock()
	if imageStudioMemory.used+bytes > budget {
		return nil, false
	}
	imageStudioMemory.used += bytes
	return &imageStudioMemoryReservation{bytes: bytes}, true
}

func (reservation *imageStudioMemoryReservation) resize(bytes int64) bool {
	budget := int64(imageStudioMemoryBudget)
	if reservation == nil || bytes <= 0 || bytes > budget {
		return false
	}
	imageStudioMemory.Lock()
	defer imageStudioMemory.Unlock()
	if reservation.released {
		return false
	}
	delta := bytes - reservation.bytes
	if delta > 0 && imageStudioMemory.used+delta > budget {
		return false
	}
	imageStudioMemory.used += delta
	reservation.bytes = bytes
	return true
}

func (reservation *imageStudioMemoryReservation) detach() {
	if reservation == nil {
		return
	}
	imageStudioMemory.Lock()
	reservation.detached = true
	imageStudioMemory.Unlock()
}

func (reservation *imageStudioMemoryReservation) releaseUnlessDetached() {
	if reservation == nil {
		return
	}
	imageStudioMemory.Lock()
	defer imageStudioMemory.Unlock()
	if !reservation.detached {
		releaseImageStudioMemoryLocked(reservation)
	}
}

func (reservation *imageStudioMemoryReservation) release() {
	if reservation == nil {
		return
	}
	imageStudioMemory.Lock()
	defer imageStudioMemory.Unlock()
	releaseImageStudioMemoryLocked(reservation)
}

func releaseImageStudioMemoryLocked(reservation *imageStudioMemoryReservation) {
	if reservation.released {
		return
	}
	imageStudioMemory.used -= reservation.bytes
	reservation.released = true
}
