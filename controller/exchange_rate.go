package controller

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

const (
	exchangeRateSource  = "https://open.er-api.com/v6/latest/USD"
	exchangeRateTTL     = 6 * time.Hour
	exchangeRateTimeout = 5 * time.Second
)

type exchangeRateCacheEntry struct {
	Rate      float64
	UpdatedAt time.Time
}

var exchangeRateCache = struct {
	sync.RWMutex
	entry exchangeRateCacheEntry
}{}

type exchangeRateResponse struct {
	Result          string             `json:"result"`
	Rates           map[string]float64 `json:"rates"`
	TimeLastUnix    int64              `json:"time_last_update_unix"`
	TimeNextUnix    int64              `json:"time_next_update_unix"`
	TimeLastUpdated string             `json:"time_last_update_utc"`
	TimeNextUpdated string             `json:"time_next_update_utc"`
}

func currentConfiguredUSDRate() float64 {
	if operation_setting.USDExchangeRate > 1 {
		return operation_setting.USDExchangeRate
	}
	return 7.3
}

func getCachedExchangeRate() (exchangeRateCacheEntry, bool) {
	exchangeRateCache.RLock()
	defer exchangeRateCache.RUnlock()

	entry := exchangeRateCache.entry
	if entry.Rate <= 1 || entry.UpdatedAt.IsZero() {
		return exchangeRateCacheEntry{}, false
	}
	return entry, time.Since(entry.UpdatedAt) < exchangeRateTTL
}

func setCachedExchangeRate(rate float64, updatedAt time.Time) {
	exchangeRateCache.Lock()
	defer exchangeRateCache.Unlock()

	exchangeRateCache.entry = exchangeRateCacheEntry{
		Rate:      rate,
		UpdatedAt: updatedAt,
	}
}

func fetchUSDCNYRate(ctx context.Context) (float64, time.Time, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, exchangeRateSource, nil)
	if err != nil {
		return 0, time.Time{}, err
	}

	client := &http.Client{Timeout: exchangeRateTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return 0, time.Time{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, time.Time{}, errors.New("exchange rate source returned non-200 status")
	}

	var body exchangeRateResponse
	if err := common.DecodeJson(resp.Body, &body); err != nil {
		return 0, time.Time{}, err
	}

	rate := body.Rates["CNY"]
	if rate <= 1 {
		return 0, time.Time{}, errors.New("exchange rate source returned invalid CNY rate")
	}

	updatedAt := time.Now()
	if body.TimeLastUnix > 0 {
		updatedAt = time.Unix(body.TimeLastUnix, 0)
	}

	return rate, updatedAt, nil
}

func GetExchangeRate(c *gin.Context) {
	if entry, ok := getCachedExchangeRate(); ok {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "",
			"data": gin.H{
				"base":       "USD",
				"target":     "CNY",
				"rate":       entry.Rate,
				"source":     exchangeRateSource,
				"updated_at": entry.UpdatedAt.Unix(),
				"cached":     true,
			},
		})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), exchangeRateTimeout)
	defer cancel()

	rate, updatedAt, err := fetchUSDCNYRate(ctx)
	if err != nil {
		fallbackRate := currentConfiguredUSDRate()
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "exchange rate source unavailable, using configured rate",
			"data": gin.H{
				"base":       "USD",
				"target":     "CNY",
				"rate":       fallbackRate,
				"source":     "configured",
				"updated_at": time.Now().Unix(),
				"cached":     false,
			},
		})
		return
	}

	setCachedExchangeRate(rate, updatedAt)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"base":       "USD",
			"target":     "CNY",
			"rate":       rate,
			"source":     exchangeRateSource,
			"updated_at": updatedAt.Unix(),
			"cached":     false,
		},
	})
}
