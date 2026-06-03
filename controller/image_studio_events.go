package controller

import (
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
)

const imageStudioTaskEventHeartbeat = 25 * time.Second

func StreamImageStudioTaskEvents(c *gin.Context) {
	userID, ok := imageStudioEventUserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"message": "未登录或用户状态异常",
		})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	events := service.SubscribeImageStudioTaskEvents(userID)
	defer service.UnsubscribeImageStudioTaskEvents(userID, events)

	heartbeat := time.NewTicker(imageStudioTaskEventHeartbeat)
	defer heartbeat.Stop()

	c.SSEvent("connected", service.ImageStudioTaskEvent{Type: "connected", UpdatedAt: time.Now().Unix()})
	c.Writer.Flush()

	c.Stream(func(w io.Writer) bool {
		select {
		case event, ok := <-events:
			if !ok {
				return false
			}
			c.SSEvent("image_studio_task", event)
			return true
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			return true
		case <-c.Request.Context().Done():
			return false
		}
	})
}

func imageStudioEventUserID(c *gin.Context) (int, bool) {
	session := sessions.Default(c)
	id, ok := session.Get("id").(int)
	if !ok || id <= 0 {
		return 0, false
	}
	status, ok := session.Get("status").(int)
	if !ok || status == common.UserStatusDisabled {
		return 0, false
	}
	role, ok := session.Get("role").(int)
	if !ok || role < common.RoleCommonUser {
		return 0, false
	}
	return id, true
}
