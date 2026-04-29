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
	"github.com/QuantumNous/new-api/service"
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

	callbackAddress := strings.TrimRight(service.GetCallbackAddress(), "/")
	notifyURL := callbackAddress + "/api/user/alipay/notify"
	returnURL := callbackAddress + "/api/user/alipay/return"

	// 客户端类型判断：优先取请求字段 client_type（pc / wap / qr）；缺省时按 User-Agent 自动识别
	clientType := strings.ToLower(strings.TrimSpace(c.PostForm("client_type")))
	if clientType == "" {
		ua := strings.ToLower(c.Request.UserAgent())
		if strings.Contains(ua, "mobi") || strings.Contains(ua, "android") ||
			strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad") ||
			strings.Contains(ua, "ipod") || strings.Contains(ua, "windows phone") ||
			strings.Contains(ua, "micromessenger") {
			clientType = "wap"
		} else {
			clientType = "pc"
		}
	}

	// 当面付预下单（扫码场景）：返回 qr_code 字符串，前端自行渲染二维码
	if clientType == "qr" {
		var p alipay.TradePreCreate
		p.NotifyURL = notifyURL
		p.Subject = "API平台算力额度充值"
		p.OutTradeNo = tradeNo
		p.TotalAmount = fmt.Sprintf("%.2f", payMoney)
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("支付宝充值订单创建[QR] user_id=%d trade_no=%s amount=%d money=%.2f notify_url=%q production=%t", userId, tradeNo, requestAmount, payMoney, p.NotifyURL, setting.AlipayProduction))
		rsp, err := client.TradePreCreate(c.Request.Context(), p)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
			return
		}
		if rsp.IsFailure() {
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": fmt.Sprintf("%s: %s", rsp.Msg, rsp.SubMsg)})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":   "success",
			"success":   true,
			"data":      rsp.QRCode,
			"mode":      "qr",
			"trade_no":  tradeNo,
			"total_fee": fmt.Sprintf("%.2f", payMoney),
		})
		return
	}

	var payURL fmt.Stringer
	if clientType == "wap" {
		var p alipay.TradeWapPay
		p.NotifyURL = notifyURL
		p.ReturnURL = returnURL
		p.Subject = "API平台算力额度充值"
		p.OutTradeNo = tradeNo
		p.TotalAmount = fmt.Sprintf("%.2f", payMoney)
		p.ProductCode = "QUICK_WAP_WAY"
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("支付宝充值订单创建[WAP] user_id=%d trade_no=%s amount=%d money=%.2f notify_url=%q return_url=%q production=%t", userId, tradeNo, requestAmount, payMoney, p.NotifyURL, p.ReturnURL, setting.AlipayProduction))
		u, err := client.TradeWapPay(p)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
			return
		}
		payURL = u
	} else {
		var p alipay.TradePagePay
		p.NotifyURL = notifyURL
		p.ReturnURL = returnURL
		p.Subject = "API平台算力额度充值"
		p.OutTradeNo = tradeNo
		p.TotalAmount = fmt.Sprintf("%.2f", payMoney)
		p.ProductCode = "FAST_INSTANT_TRADE_PAY"
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("支付宝充值订单创建[PC] user_id=%d trade_no=%s amount=%d money=%.2f notify_url=%q return_url=%q production=%t", userId, tradeNo, requestAmount, payMoney, p.NotifyURL, p.ReturnURL, setting.AlipayProduction))
		u, err := client.TradePagePay(p)
		if err != nil {
			c.JSON(http.StatusOK, gin.H{"message": "error", "data": err.Error()})
			return
		}
		payURL = u
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "success",
		"success": true,
		"data":    payURL.String(),
	})
}

func completeAlipayTopUp(ctx context.Context, tradeNo string, totalAmount string, clientIp string) error {
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		return model.ErrTopUpNotFound
	}
	if topUp.Status == common.TopUpStatusSuccess {
		return nil
	}
	if topUp.Status != common.TopUpStatusPending {
		return model.ErrTopUpStatusInvalid
	}
	if topUp.PaymentMethod != model.PaymentMethodAlipayNative {
		return model.ErrPaymentMethodMismatch
	}
	notifyAmount, parseErr := strconv.ParseFloat(totalAmount, 64)
	if parseErr != nil || fmt.Sprintf("%.2f", notifyAmount) != fmt.Sprintf("%.2f", topUp.Money) {
		logger.LogError(ctx, fmt.Sprintf("支付宝回调金额不匹配: 订单号 %s, notify=%s, expected=%.2f", tradeNo, totalAmount, topUp.Money))
		return fmt.Errorf("支付宝回调金额不匹配")
	}
	return model.CompleteTopUpPayment(tradeNo, model.PaymentMethodAlipayNative, model.PaymentMethodAlipayNative, clientIp)
}

// AlipayNativeReturn handles the browser return URL and falls back to active trade query.
func AlipayNativeReturn(c *gin.Context) {
	req := c.Request
	if err := req.ParseForm(); err != nil {
		logger.LogError(req.Context(), fmt.Sprintf("支付宝同步回跳表单解析失败 path=%q client_ip=%s error=%q", req.RequestURI, c.ClientIP(), err.Error()))
		c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=fail&show_history=true")
		return
	}
	ctx := req.Context()
	client := GetAlipayClient()
	if client == nil {
		logger.LogError(ctx, fmt.Sprintf("支付宝同步回跳 client 未初始化 path=%q client_ip=%s", req.RequestURI, c.ClientIP()))
		c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=fail&show_history=true")
		return
	}
	if err := client.VerifySign(ctx, req.Form); err != nil {
		logger.LogError(ctx, fmt.Sprintf("支付宝同步回跳验签失败 path=%q client_ip=%s error=%q app_id=%s auth_app_id=%s out_trade_no=%s trade_no=%s, 请检查支付宝公钥配置是否为支付宝开放平台提供的支付宝公钥，沙箱环境需使用沙箱支付宝公钥，不能使用应用公钥", req.RequestURI, c.ClientIP(), err.Error(), req.Form.Get("app_id"), req.Form.Get("auth_app_id"), req.Form.Get("out_trade_no"), req.Form.Get("trade_no")))
		c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=fail&show_history=true")
		return
	}

	tradeNo := req.Form.Get("out_trade_no")
	alipayTradeNo := req.Form.Get("trade_no")
	totalAmount := req.Form.Get("total_amount")
	logger.LogInfo(ctx, fmt.Sprintf("支付宝同步回跳验签成功 trade_no=%s alipay_trade_no=%s total_amount=%s", tradeNo, alipayTradeNo, totalAmount))

	queryRsp, err := client.TradeQuery(ctx, alipay.TradeQuery{OutTradeNo: tradeNo})
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("支付宝同步回跳交易查询失败 trade_no=%s error=%q", tradeNo, err.Error()))
		c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=pending&show_history=true")
		return
	}
	if queryRsp.IsFailure() {
		logger.LogError(ctx, fmt.Sprintf("支付宝同步回跳交易查询失败 trade_no=%s code=%s msg=%s sub_msg=%s", tradeNo, queryRsp.Code, queryRsp.Msg, queryRsp.SubMsg))
		c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=pending&show_history=true")
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("支付宝同步回跳交易查询成功 trade_no=%s alipay_trade_no=%s trade_status=%s total_amount=%s", queryRsp.OutTradeNo, queryRsp.TradeNo, queryRsp.TradeStatus, queryRsp.TotalAmount))

	if queryRsp.TradeStatus == alipay.TradeStatusSuccess || queryRsp.TradeStatus == alipay.TradeStatusFinished {
		if err := completeAlipayTopUp(ctx, tradeNo, queryRsp.TotalAmount, c.ClientIP()); err != nil {
			logger.LogError(ctx, fmt.Sprintf("支付宝同步回跳加账失败 trade_no=%s error=%q", tradeNo, err.Error()))
			c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=fail&show_history=true")
			return
		}
		logger.LogInfo(ctx, fmt.Sprintf("支付宝同步回跳确认到账 trade_no=%s", tradeNo))
		c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=success&show_history=true")
		return
	}

	c.Redirect(http.StatusFound, strings.TrimRight(system_setting.ServerAddress, "/")+"/console/topup?pay=pending&show_history=true")
}

// AlipayNativeNotify 支付宝异步回调
func AlipayNativeNotify(c *gin.Context) {
	req := c.Request
	if err := req.ParseForm(); err != nil {
		logger.LogError(req.Context(), fmt.Sprintf("支付宝回调表单解析失败 path=%q client_ip=%s error=%q", req.RequestURI, c.ClientIP(), err.Error()))
		c.String(http.StatusBadRequest, "fail")
		return
	}
	ctx := req.Context()
	formKeys := make([]string, 0, len(req.Form))
	for key := range req.Form {
		formKeys = append(formKeys, key)
	}
	logger.LogInfo(ctx, fmt.Sprintf("支付宝回调收到请求 path=%q client_ip=%s form_keys=%v", req.RequestURI, c.ClientIP(), formKeys))

	client := GetAlipayClient()
	if client == nil {
		logger.LogError(ctx, fmt.Sprintf("支付宝回调 client 未初始化 path=%q client_ip=%s", req.RequestURI, c.ClientIP()))
		c.String(http.StatusBadRequest, "fail")
		return
	}

	noti, err := client.DecodeNotification(ctx, req.Form)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("支付宝回调验签失败: %v, app_id=%s, auth_app_id=%s, out_trade_no=%s, trade_no=%s, 请检查支付宝公钥配置是否为支付宝开放平台提供的支付宝公钥，沙箱环境需使用沙箱支付宝公钥，不能使用应用公钥", err, req.Form.Get("app_id"), req.Form.Get("auth_app_id"), req.Form.Get("out_trade_no"), req.Form.Get("trade_no")))
		c.String(http.StatusBadRequest, "fail")
		return
	}
	logger.LogInfo(ctx, fmt.Sprintf("支付宝回调验签成功 trade_no=%s alipay_trade_no=%s trade_status=%s total_amount=%s", noti.OutTradeNo, noti.TradeNo, noti.TradeStatus, noti.TotalAmount))

	if noti.TradeStatus == "TRADE_SUCCESS" || noti.TradeStatus == "TRADE_FINISHED" {
		tradeNo := noti.OutTradeNo
		if err = completeAlipayTopUp(ctx, tradeNo, noti.TotalAmount, c.ClientIP()); err != nil {
			logger.LogError(ctx, fmt.Sprintf("支付宝单号 %s 加账失败: %v", tradeNo, err))
			c.String(http.StatusInternalServerError, "fail")
			return
		}
		logger.LogInfo(ctx, fmt.Sprintf("支付宝充值成功到账: 订单号 %s", tradeNo))
	} else {
		logger.LogInfo(ctx, fmt.Sprintf("支付宝回调忽略事件 trade_no=%s trade_status=%s", noti.OutTradeNo, noti.TradeStatus))
	}

	c.String(http.StatusOK, "success")
}
