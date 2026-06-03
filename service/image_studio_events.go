package service

import (
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
)

const imageStudioTaskEventBufferSize = 16

type ImageStudioTaskEvent struct {
	Type      string           `json:"type"`
	TaskID    string           `json:"task_id,omitempty"`
	Status    model.TaskStatus `json:"status,omitempty"`
	Progress  string           `json:"progress,omitempty"`
	UpdatedAt int64            `json:"updated_at,omitempty"`
}

type imageStudioTaskEventHub struct {
	mu      sync.RWMutex
	clients map[int]map[chan ImageStudioTaskEvent]struct{}
}

var imageStudioEvents = &imageStudioTaskEventHub{
	clients: make(map[int]map[chan ImageStudioTaskEvent]struct{}),
}

func SubscribeImageStudioTaskEvents(userID int) chan ImageStudioTaskEvent {
	return imageStudioEvents.subscribe(userID)
}

func UnsubscribeImageStudioTaskEvents(userID int, ch chan ImageStudioTaskEvent) {
	imageStudioEvents.unsubscribe(userID, ch)
}

func PublishImageStudioTaskEvent(task *model.Task) {
	if task == nil {
		return
	}
	updatedAt := task.UpdatedAt
	if updatedAt == 0 {
		updatedAt = time.Now().Unix()
	}
	imageStudioEvents.publish(task.UserId, ImageStudioTaskEvent{
		Type:      "image_studio_task_update",
		TaskID:    task.TaskID,
		Status:    task.Status,
		Progress:  task.Progress,
		UpdatedAt: updatedAt,
	})
}

func (h *imageStudioTaskEventHub) subscribe(userID int) chan ImageStudioTaskEvent {
	ch := make(chan ImageStudioTaskEvent, imageStudioTaskEventBufferSize)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[userID] == nil {
		h.clients[userID] = make(map[chan ImageStudioTaskEvent]struct{})
	}
	h.clients[userID][ch] = struct{}{}
	return ch
}

func (h *imageStudioTaskEventHub) unsubscribe(userID int, ch chan ImageStudioTaskEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	clients := h.clients[userID]
	if clients == nil {
		return
	}
	delete(clients, ch)
	if len(clients) == 0 {
		delete(h.clients, userID)
	}
	close(ch)
}

func (h *imageStudioTaskEventHub) publish(userID int, event ImageStudioTaskEvent) {
	if userID <= 0 {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients[userID] {
		select {
		case ch <- event:
		default:
		}
	}
}
