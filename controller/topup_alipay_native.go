/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/

package controller

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/smartwalle/alipay/v3"
	"github.com/thanhpk/randstr"
)

// GetAlipayClient creates a fresh Alipay client from current settings.
// Returns nil when any required setting is missing (same pattern as GetEpayClient).
func GetAlipayClient() *alipay.Client {
	if setting.AlipayAppId == "" || setting.AlipayPrivateKey == "" || setting.AlipayPublicKey == "" {
		return nil
	}
	ctx := context.Background()
	client, err := alipay.New(setting.AlipayAppId, setting.AlipayPrivateKey, setting.AlipayProduction)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("初始化支付宝客户端失败: %v", err))
		return nil
	}
	if err = client.LoadAliPayPublicKey(setting.AlipayPublicKey); err != nil {
		logger.LogError(ctx, fmt.Sprintf("加载支付宝公钥失败: %v", err))
		return nil
	}
	return client
}

// RequestAlipayNative 生成网页支付跳转 URL
func RequestAlipayNative(c *gin.Context) {
	client := GetAlipayClient()
	if client == nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "服务器尚未配置支付宝参数，请联系管理员"})
		return
	}

	userId := c.GetInt("id")
	amountStr := c.PostForm("amount")
	amount, err := strconv.ParseFloat(amountStr, 64)
	if err != nil || amount <= 0 {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值金额无效"})
		return
	}
	requestAmount := int64(amount)
	if requestAmount < getMinTopup() {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": fmt.Sprintf("充值数量不能小于 %d", getMinTopup())})
		return
	}

	group, err := model.GetUserGroup(userId, true)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "获取用户分组失败"})
		return
	}
	payMoney := getPayMoney(requestAmount, group)
	if payMoney < 0.01 {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "充值金额过低"})
		return
	}

	creditedAmount := requestAmount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount := decimal.NewFromInt(creditedAmount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		creditedAmount = dAmount.Div(dQuotaPerUnit).IntPart()
	}

	tradeNo := fmt.Sprintf("ALIPAY%s%s", time.Now().Format("20060102150405"), randstr.String(6))

	topUp := &model.TopUp{
		UserId:        userId,
		Amount:        creditedAmount,
		Money:         payMoney,
		TradeNo:       tradeNo,
		PaymentMethod: "alipay_native",
		CreateTime:    common.GetTimestamp(),
		Status:        common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": "创建订单失败"})
		return
	}

	var p alipay.TradePagePay
	serverAddress := strings.TrimRight(system_setting.ServerAddress, "/")
	p.NotifyURL = serverAddress + "/api/user/alipay/notify"
	p.ReturnURL = serverAddress + "/console/topup?show_history=true"
	p.Subject = "API平台算力额度充值"
	p.OutTradeNo = tradeNo
	p.TotalAmount = fmt.Sprintf("%.2f", payMoney)
	p.ProductCode = "FAST_INSTANT_TRADE_PAY"

	payURL, err := client.TradePagePay(p)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"success": true,
		"data":    payURL.String(),
	})
}

// AlipayNativeNotify 支付宝异步回调
func AlipayNativeNotify(c *gin.Context) {
	req := c.Request
	if err := req.ParseForm(); err != nil {
		c.String(http.StatusBadRequest, "fail")
		return
	}
	ctx := req.Context()

	client := GetAlipayClient()
	if client == nil {
		c.String(http.StatusBadRequest, "fail")
		return
	}

	noti, err := client.DecodeNotification(ctx, req.Form)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("支付宝回调验签失败: %v", err))
		c.String(http.StatusBadRequest, "fail")
		return
	}

	if noti.TradeStatus == "TRADE_SUCCESS" || noti.TradeStatus == "TRADE_FINISHED" {
		tradeNo := noti.OutTradeNo
		topUp := model.GetTopUpByTradeNo(tradeNo)
		if topUp == nil || topUp.Status != "pending" {
			c.String(http.StatusOK, "success")
			return
		}
		notifyAmount, parseErr := strconv.ParseFloat(noti.TotalAmount, 64)
		if parseErr != nil || fmt.Sprintf("%.2f", notifyAmount) != fmt.Sprintf("%.2f", topUp.Money) {
			logger.LogError(ctx, fmt.Sprintf("支付宝回调金额不匹配: 订单号 %s, notify=%s, expected=%.2f", tradeNo, noti.TotalAmount, topUp.Money))
			c.String(http.StatusBadRequest, "fail")
			return
		}
		if err = model.ManualCompleteTopUp(tradeNo, c.ClientIP()); err != nil {
			logger.LogError(ctx, fmt.Sprintf("支付宝单号 %s 加账失败: %v", tradeNo, err))
			c.String(http.StatusInternalServerError, "fail")
			return
		}
		logger.LogInfo(ctx, fmt.Sprintf("支付宝充值成功到账: 订单号 %s", tradeNo))
	}

	c.String(http.StatusOK, "success")
}
