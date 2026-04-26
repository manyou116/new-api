/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/

package setting

// AlipayAppId is the Alipay application ID (from merchant account).
var AlipayAppId = ""

// AlipayPrivateKey is the RSA private key for signing Alipay requests.
var AlipayPrivateKey = ""

// AlipayPublicKey is Alipay's RSA public key for verifying callbacks.
var AlipayPublicKey = ""

// AlipayProduction controls whether to use production or sandbox mode.
var AlipayProduction = false
