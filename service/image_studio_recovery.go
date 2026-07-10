package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/bytedance/gopkg/util/gopool"
)

const imageStudioRecoveryInterval = time.Minute

var imageStudioRecoveryOnce sync.Once

// StartImageStudioRecoveryTask is deliberately independent of UPDATE_TASK.
// Studio work is local and memory-backed, so stale work and incomplete refunds
// must still be reconciled when provider task polling is disabled.
func StartImageStudioRecoveryTask() {
	imageStudioRecoveryOnce.Do(func() {
		gopool.Go(func() {
			RunImageStudioRecoveryOnce(context.Background())
			ticker := time.NewTicker(imageStudioRecoveryInterval)
			defer ticker.Stop()
			for range ticker.C {
				RunImageStudioRecoveryOnce(context.Background())
			}
		})
	})
}

func RunImageStudioRecoveryOnce(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	timeoutMinutes := ImageStudioTaskTimeoutMinutes()
	cutoff := time.Now().Add(-time.Duration(timeoutMinutes) * time.Minute).Unix()
	now := time.Now().Unix()
	for _, task := range model.GetTimedOutImageStudioTasks(cutoff, 100) {
		fromStatus := task.Status
		task.Status = model.TaskStatusFailure
		task.Progress = "100%"
		task.FailReason = fmt.Sprintf("AI 画室任务超时（%d分钟），可能因服务重启或上游无响应中断", timeoutMinutes)
		task.FinishTime = now
		task.UpdatedAt = now
		won, err := task.UpdateWithStatus(fromStatus)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("image studio recovery timeout task %s failed: %s", task.TaskID, err.Error()))
			continue
		}
		if !won {
			continue
		}
		backfillAndRefundImageStudioTask(ctx, task)
	}

	// This second pass closes a crash window after a task reached FAILURE but
	// before its idempotent refund transaction completed.
	for _, task := range model.GetUnrefundedFailedImageStudioTasks(100) {
		backfillAndRefundImageStudioTask(ctx, task)
	}
}

func ImageStudioTaskTimeoutMinutes() int {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ImageStudioTaskTimeoutMinutes"]
	common.OptionMapRWMutex.RUnlock()
	timeoutMinutes, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || timeoutMinutes < constant.ImageStudioMinTimeoutMinutes || timeoutMinutes > constant.ImageStudioMaxTimeoutMinutes {
		return constant.ImageStudioDefaultTimeoutMinutes
	}
	return timeoutMinutes
}

func backfillAndRefundImageStudioTask(ctx context.Context, task *model.Task) {
	if task == nil {
		return
	}
	if task.Quota <= 0 && task.PrivateData.RequestId != "" {
		if BackfillTaskBillingFromConsumeLog(ctx, task, task.PrivateData.RequestId) {
			task.UpdatedAt = time.Now().Unix()
			if _, err := task.UpdateBillingSnapshot(model.TaskStatusFailure); err != nil {
				logger.LogWarn(ctx, fmt.Sprintf("persist image studio recovery billing task %s failed: %s", task.TaskID, err.Error()))
			}
		}
	}
	// The durable target can move back to zero after a late settlement. Calling
	// the idempotent ledger for zero is therefore meaningful: it charges back a
	// prior timeout estimate without selecting unrelated zero-quota failures.
	_, _ = RefundImageStudioTaskQuotaOnce(ctx, task, task.FailReason)
}
