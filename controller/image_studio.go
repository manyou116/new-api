package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

const (
	imageStudioTaskPlatform = constant.TaskPlatformImageStudio
	imageStudioMaxTaskCount = constant.ImageStudioMaxBatchConcurrency
)

type imageStudioTaskPayload struct {
	Request  imageStudioRequestMeta `json:"request,omitempty"`
	Response any                    `json:"response,omitempty"`
	Usage    *dto.Usage             `json:"usage,omitempty"`
}

type imageStudioRequestMeta struct {
	Model      string `json:"model,omitempty"`
	Prompt     string `json:"prompt,omitempty"`
	Size       string `json:"size,omitempty"`
	Quality    string `json:"quality,omitempty"`
	N          uint   `json:"n,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Group      string `json:"group,omitempty"`
	RequestID  string `json:"request_id,omitempty"`
	BatchID    string `json:"batch_id,omitempty"`
	BatchIndex int    `json:"batch_index,omitempty"`
	BatchSize  int    `json:"batch_size,omitempty"`
}

type imageStudioEstimateResponse struct {
	EstimatedQuota int    `json:"estimated_quota"`
	PerImageQuota  int    `json:"per_image_quota"`
	Count          int    `json:"count"`
	ResolvedGroup  string `json:"resolved_group"`
}

func estimateImageStudioBatchQuota(perImageQuota int, count uint) int {
	return common.QuotaFromFloat(float64(perImageQuota) * float64(count))
}

// EstimateImageStudioCost follows the same pricing path used immediately
// before relay pre-consumption, but does not reserve quota or create a task.
// Studio batches execute as n=1 child requests, so the per-image rounded quota
// is multiplied by the requested batch count to match the real billing shape.
func EstimateImageStudioCost(c *gin.Context) {
	if !common.DrawingEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{"message": "image generation is disabled", "type": "invalid_request_error"}})
		return
	}

	request, err := helper.GetAndValidateRequest(c, types.RelayFormatOpenAIImage)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	imageRequest, ok := request.(*dto.ImageRequest)
	if !ok {
		common.ApiErrorMsg(c, "invalid image request")
		return
	}

	count := uint(1)
	if imageRequest.N != nil && *imageRequest.N > 0 {
		count = *imageRequest.N
	}
	if count > imageStudioMaxTaskCount {
		common.ApiErrorMsg(c, fmt.Sprintf("生成数量不能超过 %d", imageStudioMaxTaskCount))
		return
	}
	one := uint(1)
	imageRequest.N = &one

	if strings.EqualFold(c.Query("mode"), "edit") {
		c.Set("relay_mode", relayconstant.RelayModeImagesEdits)
	} else {
		c.Set("relay_mode", relayconstant.RelayModeImagesGenerations)
	}
	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, imageRequest, nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	relayInfo.InitChannelMeta(c)
	billingInput, err := helper.BuildBillingExprRequestInputFromRequest(imageRequest, relayInfo.RequestHeaders)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	relayInfo.BillingRequestInput = &billingInput
	meta := imageRequest.GetTokenCountMeta()
	tokens, err := service.EstimateRequestToken(c, meta, relayInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	relayInfo.SetEstimatePromptTokens(tokens)
	priceData, err := helper.ModelPriceHelper(c, relayInfo, tokens, meta)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	perImageQuota := priceData.QuotaToPreConsume
	estimatedQuota := estimateImageStudioBatchQuota(perImageQuota, count)
	resolvedGroup := relayInfo.UsingGroup
	if autoGroup := c.GetString("auto_group"); autoGroup != "" {
		resolvedGroup = autoGroup
	}
	common.ApiSuccess(c, imageStudioEstimateResponse{
		EstimatedQuota: estimatedQuota,
		PerImageQuota:  perImageQuota,
		Count:          int(count),
		ResolvedGroup:  resolvedGroup,
	})
}

func CreateImageStudioTask(c *gin.Context) {
	if !common.DrawingEnabled {
		c.JSON(http.StatusForbidden, gin.H{"error": gin.H{"message": "image generation is disabled", "type": "invalid_request_error"}})
		return
	}
	if c.GetBool("use_access_token") {
		common.ApiErrorMsg(c, "暂不支持使用 access token")
		return
	}

	request, err := helper.GetAndValidateRequest(c, types.RelayFormatOpenAIImage)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	imageRequest, ok := request.(*dto.ImageRequest)
	if !ok {
		common.ApiErrorMsg(c, "invalid image request")
		return
	}
	if imageRequest.Stream != nil && *imageRequest.Stream {
		common.ApiErrorMsg(c, "AI 画室暂不支持流式图片响应")
		return
	}

	userID := c.GetInt("id")
	userCache, err := model.GetUserCache(userID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userCache.WriteContext(c)

	relayInfo, err := relaycommon.GenRelayInfo(c, types.RelayFormatOpenAIImage, request, nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	temporaryToken := &model.Token{
		UserId: userID,
		Name:   fmt.Sprintf("image-studio-%s", relayInfo.UsingGroup),
		Group:  relayInfo.UsingGroup,
	}
	if err := middleware.SetupContextForToken(c, temporaryToken); err != nil {
		common.ApiError(c, err)
		return
	}
	relayInfo.InitChannelMeta(c)

	bodyStorage, err := common.GetBodyStorage(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	body, err := bodyStorage.Bytes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	contentType := c.Request.Header.Get("Content-Type")
	requestID := c.GetString(common.RequestIdKey)

	imageCount := uint(1)
	if imageRequest.N != nil && *imageRequest.N > 0 {
		imageCount = *imageRequest.N
	}
	if imageCount > imageStudioMaxTaskCount {
		common.ApiErrorMsg(c, fmt.Sprintf("生成数量不能超过 %d", imageStudioMaxTaskCount))
		return
	}
	if len(body) > imageStudioMaxBatchBodySize {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": gin.H{"message": "批量图片请求体过大，请减少图片数量或上传文件大小", "type": "invalid_request_error"}})
		return
	}
	taskBodies, err := buildImageStudioTaskBodies(c, contentType, body, int(imageCount))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	reservation, _ := c.Get(imageStudioReservationKey)
	memoryReservation, _ := reservation.(*imageStudioMemoryReservation)
	ownedReservation := false
	baseRetainedBytes := int64(len(body))
	if len(taskBodies) > 0 {
		baseRetainedBytes += int64(len(taskBodies[0].Body))
	}
	if baseRetainedBytes <= 0 {
		baseRetainedBytes = 1
	}
	workerCount := imageStudioBatchWorkerCount(len(taskBodies))
	for workerCount > 0 {
		retainedBytes := baseRetainedBytes + int64(workerCount)*imageStudioWorkerMemory
		if memoryReservation == nil {
			memoryReservation, _ = reserveImageStudioMemory(retainedBytes)
			ownedReservation = memoryReservation != nil
			if ownedReservation {
				break
			}
		} else if memoryReservation.resize(retainedBytes) {
			break
		}
		workerCount--
	}
	if workerCount == 0 || memoryReservation == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"message": "AI 画室内存队列已满，请稍后重试", "type": "server_error"}})
		return
	}
	memoryTransferred := false
	defer func() {
		if ownedReservation && !memoryTransferred {
			memoryReservation.release()
		}
	}()
	if !reserveImageStudioQueueSlots(len(taskBodies)) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": gin.H{"message": "AI 画室任务队列已满，请稍后重试", "type": "server_error"}})
		return
	}
	dispatched := false
	defer func() {
		if !dispatched {
			releaseImageStudioQueueSlots(len(taskBodies))
		}
	}()

	batchID := ""
	if imageCount > 1 {
		batchID = "batch_" + common.GetUUID()
	}
	now := time.Now().Unix()
	taskAction := constant.TaskActionImageGeneration
	requestMode := "generation"
	if relayInfo.RelayMode == relayconstant.RelayModeImagesEdits {
		taskAction = constant.TaskActionImageEdit
		requestMode = "edit"
	}
	taskDTOs := make([]*dto.TaskDto, 0, len(taskBodies))
	snapshots := make([]imageStudioContext, 0, len(taskBodies))
	inserted := make([]*model.Task, 0, len(taskBodies))
	for index, taskBody := range taskBodies {
		childRequestID := imageStudioChildRequestID(requestID, index, len(taskBodies))
		task := model.InitTask(imageStudioTaskPlatform, relayInfo)
		task.CreatedAt = now
		task.UpdatedAt = now
		task.SubmitTime = now
		task.Status = model.TaskStatusQueued
		task.Progress = "0%"
		task.Action = taskAction
		task.Properties.Input = imageRequest.Prompt
		// Local Image Studio tasks never poll the provider, so persisting a
		// provider key in task private data would be unnecessary secret storage.
		task.PrivateData.Key = ""
		task.PrivateData.RequestId = childRequestID
		task.SetData(imageStudioTaskPayload{Request: imageStudioRequestMeta{
			Model:      imageRequest.Model,
			Prompt:     imageRequest.Prompt,
			Size:       imageRequest.Size,
			Quality:    imageRequest.Quality,
			N:          1,
			Mode:       requestMode,
			Group:      relayInfo.UsingGroup,
			RequestID:  childRequestID,
			BatchID:    batchID,
			BatchIndex: index + 1,
			BatchSize:  int(imageCount),
		}})
		if err := task.Insert(); err != nil {
			for _, insertedTask := range inserted {
				failImageStudioTask(insertedTask, "批量任务提交未完成: "+err.Error())
			}
			common.ApiError(c, err)
			return
		}
		inserted = append(inserted, task)
		taskDTOs = append(taskDTOs, relay.TaskModel2Dto(task))
		snapshots = append(snapshots, captureImageStudioContext(c, task.TaskID, childRequestID, taskBody.ContentType, taskBody.Body))
	}

	if len(taskDTOs) == 1 {
		common.ApiSuccess(c, taskDTOs[0])
	} else {
		common.ApiSuccess(c, gin.H{"batch_id": batchID, "tasks": taskDTOs})
	}
	memoryReservation.detach()
	memoryTransferred = true
	dispatchImageStudioTasks(snapshots, workerCount, memoryReservation)
	dispatched = true
}

func reserveImageStudioQueueSlots(count int) bool {
	reserved := 0
	for reserved < count {
		select {
		case imageStudioQueueSlots <- struct{}{}:
			reserved++
		default:
			releaseImageStudioQueueSlots(reserved)
			return false
		}
	}
	return true
}

func releaseImageStudioQueueSlots(count int) {
	for index := 0; index < count; index++ {
		<-imageStudioQueueSlots
	}
}

func imageStudioChildRequestID(parent string, index int, total int) string {
	if total <= 1 {
		if parent != "" {
			return parent
		}
		return common.NewRequestId()
	}
	if parent == "" {
		parent = common.NewRequestId()
	}
	return fmt.Sprintf("%s-%02d", parent, index+1)
}

type imageStudioContext struct {
	TaskID      string
	RequestID   string
	Method      string
	Path        string
	RawQuery    string
	Header      http.Header
	Body        []byte
	ContentType string
	ClientIP    string
	Keys        map[string]any
}

func captureImageStudioContext(c *gin.Context, taskID string, requestID string, contentType string, body []byte) imageStudioContext {
	keys := make(map[string]any, len(c.Keys))
	for key, value := range c.Keys {
		// These values describe the original request body. A Studio task owns a
		// rebuilt body and Content-Type, so carrying either value into its fresh
		// Gin context can make multipart parsing reuse the original boundary.
		if key == common.KeyBodyStorage || key == "_original_multipart_ct" {
			continue
		}
		keys[key] = value
	}
	return imageStudioContext{
		TaskID:      taskID,
		RequestID:   requestID,
		Method:      c.Request.Method,
		Path:        strings.Replace(c.Request.URL.Path, "/pg/image-studio/", "/pg/images/", 1),
		RawQuery:    c.Request.URL.RawQuery,
		Header:      c.Request.Header.Clone(),
		Body:        body,
		ContentType: contentType,
		ClientIP:    c.ClientIP(),
		Keys:        keys,
	}
}

func (snapshot imageStudioContext) ginContext(task *model.Task) (*gin.Context, *imageStudioResponseWriter, error) {
	target := snapshot.Path
	if snapshot.RawQuery != "" {
		target += "?" + snapshot.RawQuery
	}
	request, err := http.NewRequestWithContext(context.Background(), snapshot.Method, target, bytes.NewReader(snapshot.Body))
	if err != nil {
		return nil, nil, err
	}
	request.Header = snapshot.Header.Clone()
	if snapshot.ContentType != "" {
		request.Header.Set("Content-Type", snapshot.ContentType)
	}
	if snapshot.ClientIP != "" && request.Header.Get("X-Real-IP") == "" {
		request.Header.Set("X-Real-IP", snapshot.ClientIP)
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	responseWriter, err := newImageStudioResponseWriter(c.Writer, task)
	if err != nil {
		return nil, nil, err
	}
	c.Writer = responseWriter
	c.Request = request
	c.Keys = make(map[string]any, len(snapshot.Keys)+2)
	for key, value := range snapshot.Keys {
		c.Keys[key] = value
	}
	c.Set(common.RequestIdKey, snapshot.RequestID)
	storage, err := common.CreateBodyStorage(snapshot.Body)
	if err != nil {
		responseWriter.Close()
		return nil, nil, err
	}
	c.Set(common.KeyBodyStorage, storage)
	return c, responseWriter, nil
}

func dispatchImageStudioTasks(snapshots []imageStudioContext, workerCount int, memoryReservation *imageStudioMemoryReservation) {
	if len(snapshots) == 0 {
		memoryReservation.release()
		return
	}
	gopool.Go(func() {
		defer memoryReservation.release()
		runImageStudioTaskBatch(snapshots, workerCount, runImageStudioTask)
	})
}

func runImageStudioTaskBatch(snapshots []imageStudioContext, workerCount int, runner func(imageStudioContext)) {
	workerCount = min(len(snapshots), max(1, workerCount))
	queue := make(chan imageStudioContext)
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for index := 0; index < workerCount; index++ {
		gopool.Go(func() {
			defer workers.Done()
			for snapshot := range queue {
				imageStudioExecutionSlots <- struct{}{}
				func() {
					defer releaseImageStudioQueueSlots(1)
					defer func() { <-imageStudioExecutionSlots }()
					runner(snapshot)
				}()
			}
		})
	}
	for _, snapshot := range snapshots {
		queue <- snapshot
	}
	close(queue)
	workers.Wait()
}

func runImageStudioTask(snapshot imageStudioContext) {
	defer func() {
		if recovered := recover(); recovered != nil {
			reason := fmt.Sprintf("后台任务异常: %v", recovered)
			logger.LogError(context.Background(), fmt.Sprintf("image studio task %s panic: %s\n%s", snapshot.TaskID, reason, string(debug.Stack())))
			if task, exists, err := model.GetByOnlyTaskId(snapshot.TaskID); err == nil && exists {
				service.BackfillTaskBillingFromConsumeLog(context.Background(), task, snapshot.RequestID)
				if failImageStudioTask(task, reason) && task.Quota > 0 {
					_, _ = service.RefundImageStudioTaskQuotaOnce(context.Background(), task, reason)
				}
			}
		}
	}()

	task, exists, err := model.GetByOnlyTaskId(snapshot.TaskID)
	if err != nil || !exists {
		if err != nil {
			logger.LogError(context.Background(), fmt.Sprintf("image studio get task %s failed: %s", snapshot.TaskID, err.Error()))
		}
		return
	}
	c, responseWriter, err := snapshot.ginContext(task)
	if err != nil {
		failImageStudioTask(task, "初始化任务上下文失败: "+err.Error())
		return
	}
	defer common.CleanupBodyStorage(c)
	defer responseWriter.Close()

	task.Status = model.TaskStatusInProgress
	task.Progress = "10%"
	task.StartTime = time.Now().Unix()
	if won, err := task.UpdateWithStatus(model.TaskStatusQueued); err != nil || !won {
		if err != nil {
			logger.LogError(context.Background(), fmt.Sprintf("image studio start task %s failed: %s", task.TaskID, err.Error()))
		}
		return
	}
	service.SetBillingSettlementObserver(c, func(info *relaycommon.RelayInfo, actualQuota int) {
		persistImageStudioBillingSnapshot(task, info, actualQuota)
	})
	service.SetDurableAsyncBilling(c)
	c.Set(string(constant.ContextKeyImageStudioStrictB64), true)
	timeoutMinutes := service.ImageStudioTaskTimeoutMinutes()
	taskContext, cancelTask := context.WithTimeout(c.Request.Context(), time.Duration(timeoutMinutes)*time.Minute)
	defer cancelTask()
	c.Request = c.Request.WithContext(taskContext)

	payload, usage, quota, relayErr := executeImageStudioRelay(c, responseWriter, task)
	if relayErr != nil || payload == nil {
		cleanupImageStudioTaskAssets(context.Background(), task)
		reason := "上游未返回图片"
		if relayErr != nil {
			reason = relayErr.Error()
		}
		if errors.Is(c.Request.Context().Err(), context.DeadlineExceeded) {
			reason = fmt.Sprintf("AI 画室任务超时（%d分钟），上游在限制时间内未完成", timeoutMinutes)
		}
		service.BackfillTaskBillingFromConsumeLog(context.Background(), task, snapshot.RequestID)
		if failImageStudioTask(task, reason) && task.Quota > 0 {
			_, _ = service.RefundImageStudioTaskQuotaOnce(context.Background(), task, reason)
		}
		return
	}

	task.Status = model.TaskStatusSuccess
	task.Progress = "100%"
	task.Quota = quota
	task.FinishTime = time.Now().Unix()
	task.UpdatedAt = task.FinishTime
	task.FailReason = ""
	var previous imageStudioTaskPayload
	_ = common.Unmarshal(task.Data, &previous)
	task.SetData(imageStudioTaskPayload{Request: previous.Request, Response: payload, Usage: usage})
	if won, err := model.FinalizeImageStudioTask(task); err != nil {
		cleanupImageStudioPayloadAssets(context.Background(), task, payload)
		logger.LogError(context.Background(), fmt.Sprintf("image studio finish task %s failed: %s", task.TaskID, err.Error()))
	} else if !won {
		cleanupImageStudioPayloadAssets(context.Background(), task, payload)
		refundImageStudioChargeAfterLostFinalUpdate(task, snapshot.RequestID)
	}
}

func executeImageStudioRelay(c *gin.Context, responseWriter *imageStudioResponseWriter, task *model.Task) (any, *dto.Usage, int, error) {
	Relay(c, types.RelayFormatOpenAIImage)
	if responseWriter.exceeded {
		return nil, nil, 0, errors.New("上游图片响应超过 AI 画室大小限制")
	}
	status := responseWriter.Status()
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		response, err := responseWriter.readSmallResponse()
		if err != nil {
			return nil, nil, 0, err
		}
		return nil, nil, 0, parseImageStudioRelayError(status, response)
	}
	payload, usage, err := responseWriter.Process()
	if err != nil {
		return nil, nil, 0, err
	}
	return payload, usage, task.Quota, nil
}

func parseImageStudioRelayError(status int, data []byte) error {
	var response struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if len(data) > 0 && common.Unmarshal(data, &response) == nil {
		if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
			return fmt.Errorf("图片生成失败（HTTP %d）: %s", status, strings.TrimSpace(response.Error.Message))
		}
		if strings.TrimSpace(response.Message) != "" {
			return fmt.Errorf("图片生成失败（HTTP %d）: %s", status, strings.TrimSpace(response.Message))
		}
	}
	return fmt.Errorf("图片生成失败（HTTP %d）", status)
}

func persistImageStudioBillingSnapshot(task *model.Task, info *relaycommon.RelayInfo, actualQuota int) {
	if task == nil || info == nil {
		return
	}
	task.Quota = actualQuota
	task.Group = info.UsingGroup
	task.Properties.OriginModelName = info.OriginModelName
	// The pre-consume observer runs before the relay handler initializes
	// ChannelMeta. Keep the channel snapshot captured when the task was created
	// until the settlement callback has authoritative channel metadata.
	if info.ChannelMeta != nil {
		task.ChannelId = info.ChannelMeta.ChannelId
		task.Properties.UpstreamModelName = info.ChannelMeta.UpstreamModelName
	}
	task.PrivateData.BillingSource = info.BillingSource
	task.PrivateData.SubscriptionId = info.SubscriptionId
	// Browser Studio uses a session-backed virtual token; it must never mutate
	// or persist a real API token quota.
	task.PrivateData.TokenId = 0
	task.PrivateData.NodeName = common.NodeName
	task.PrivateData.BillingContext = &model.TaskBillingContext{
		ModelPrice:      info.PriceData.ModelPrice,
		GroupRatio:      info.PriceData.GroupRatioInfo.GroupRatio,
		ModelRatio:      info.PriceData.ModelRatio,
		OtherRatios:     info.PriceData.OtherRatios(),
		OriginModelName: info.OriginModelName,
		PerCallBilling:  common.StringsContains(constant.TaskPricePatches, info.OriginModelName) || info.PriceData.UsePrice,
	}
	task.UpdatedAt = time.Now().Unix()
	won, err := task.UpdateBillingSnapshot(model.TaskStatusInProgress)
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("persist image studio billing task %s failed: %s", task.TaskID, err.Error()))
		return
	}
	if !won {
		if _, err := task.UpdateBillingSnapshot(model.TaskStatusFailure); err != nil {
			logger.LogError(context.Background(), fmt.Sprintf("persist failed image studio billing task %s failed: %s", task.TaskID, err.Error()))
		}
		_, _ = service.RefundImageStudioTaskQuotaOnce(context.Background(), task, "AI 画室任务结算时已进入失败终态")
	}
}

func failImageStudioTask(task *model.Task, reason string) bool {
	if task == nil || task.Status == model.TaskStatusFailure || task.Status == model.TaskStatusSuccess {
		return false
	}
	fromStatus := task.Status
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "生成失败，后台任务未返回错误详情"
	}
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.FailReason = reason
	task.FinishTime = time.Now().Unix()
	task.UpdatedAt = task.FinishTime
	won, err := task.UpdateWithStatus(fromStatus)
	if err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio fail task %s update failed: %s", task.TaskID, err.Error()))
		return false
	}
	return won
}

func refundImageStudioChargeAfterLostFinalUpdate(settledTask *model.Task, requestID string) {
	if settledTask == nil || settledTask.Quota < 0 {
		return
	}
	task, exists, err := model.GetByOnlyTaskId(settledTask.TaskID)
	if err != nil || !exists || task.Status != model.TaskStatusFailure {
		return
	}
	task.Quota = settledTask.Quota
	task.ChannelId = settledTask.ChannelId
	task.Group = settledTask.Group
	task.Properties = settledTask.Properties
	task.PrivateData = settledTask.PrivateData
	if task.PrivateData.BillingSource == "" {
		service.BackfillTaskBillingFromConsumeLog(context.Background(), task, requestID)
	}
	task.UpdatedAt = time.Now().Unix()
	if _, err := task.UpdateBillingSnapshot(model.TaskStatusFailure); err != nil {
		logger.LogError(context.Background(), fmt.Sprintf("image studio persist late billing %s failed: %s", task.TaskID, err.Error()))
	}
	_, _ = service.RefundImageStudioTaskQuotaOnce(context.Background(), task, "AI 画室任务已进入失败终态，取消迟到的生图扣费")
}
