package common

import (
	"crypto/tls"
	"fmt"
	"mime"
	"net/smtp"
	"slices"
	"strings"
	"time"
)

func generateMessageID() (string, error) {
	split := strings.Split(SMTPFrom, "@")
	if len(split) < 2 {
		return "", fmt.Errorf("invalid SMTP account")
	}
	domain := strings.Split(SMTPFrom, "@")[1]
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), GetRandomString(12), domain), nil
}

func shouldUseSMTPLoginAuth() bool {
	if SMTPForceAuthLogin {
		return true
	}
	return isOutlookServer(SMTPAccount) || slices.Contains(EmailLoginAuthServerList, SMTPServer)
}

func getSMTPAuth() smtp.Auth {
	if shouldUseSMTPLoginAuth() {
		return LoginAuth(SMTPAccount, SMTPToken)
	}
	return smtp.PlainAuth("", SMTPAccount, SMTPToken, SMTPServer)
}

func smtpMailWithoutSMTPUTF8(client *smtp.Client, from string) error {
	if strings.ContainsAny(from, "\r\n") {
		return fmt.Errorf("invalid SMTP sender")
	}
	body := ""
	if ok, _ := client.Extension("8BITMIME"); ok {
		body = " BODY=8BITMIME"
	}
	commandID, err := client.Text.Cmd("MAIL FROM:<%s>%s", from, body)
	if err != nil {
		return err
	}
	client.Text.StartResponse(commandID)
	defer client.Text.EndResponse(commandID)
	_, _, err = client.Text.ReadResponse(250)
	return err
}

func sendSMTPMessage(client *smtp.Client, auth smtp.Auth, from string, receivers []string, message []byte) error {
	var err error
	if err = client.Auth(auth); err != nil {
		return err
	}
	if err = smtpMailWithoutSMTPUTF8(client, from); err != nil {
		return err
	}
	for _, receiver := range receivers {
		if err = client.Rcpt(receiver); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	if _, err = w.Write(message); err != nil {
		return err
	}
	if err = w.Close(); err != nil {
		return err
	}
	return nil
}

func SendEmail(subject string, receiver string, content string) error {
	if SMTPFrom == "" { // for compatibility
		SMTPFrom = SMTPAccount
	}
	id, err2 := generateMessageID()
	if err2 != nil {
		return err2
	}
	if SMTPServer == "" && SMTPAccount == "" {
		return fmt.Errorf("SMTP 服务器未配置")
	}
	encodedSubject := mime.BEncoding.Encode("UTF-8", subject)
	encodedSystemName := mime.BEncoding.Encode("UTF-8", SystemName)
	mail := []byte(fmt.Sprintf("To: %s\r\n"+
		"From: %s <%s>\r\n"+
		"Subject: %s\r\n"+
		"Date: %s\r\n"+
		"Message-ID: %s\r\n"+ // 添加 Message-ID 头
		"Content-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n",
		receiver, encodedSystemName, SMTPFrom, encodedSubject, time.Now().Format(time.RFC1123Z), id, content))
	auth := getSMTPAuth()
	addr := fmt.Sprintf("%s:%d", SMTPServer, SMTPPort)
	to := strings.Split(receiver, ";")
	var err error
	var client *smtp.Client
	if SMTPPort == 465 || SMTPSSLEnabled {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: true,
			ServerName:         SMTPServer,
		}
		conn, err := tls.Dial("tcp", fmt.Sprintf("%s:%d", SMTPServer, SMTPPort), tlsConfig)
		if err != nil {
			return err
		}
		client, err = smtp.NewClient(conn, SMTPServer)
		if err != nil {
			_ = conn.Close()
			return err
		}
	} else {
		client, err = smtp.Dial(addr)
		if err != nil {
			return err
		}
		if ok, _ := client.Extension("STARTTLS"); ok {
			if err = client.StartTLS(&tls.Config{ServerName: SMTPServer}); err != nil {
				_ = client.Close()
				return err
			}
		}
	}
	defer client.Close()
	err = sendSMTPMessage(client, auth, SMTPFrom, to, mail)
	if err != nil {
		SysError(fmt.Sprintf("failed to send email to %s: %v", receiver, err))
	}
	return err
}
