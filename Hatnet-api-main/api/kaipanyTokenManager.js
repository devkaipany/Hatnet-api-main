// kaipanyTokenManager.js
const axios = require("axios");
const qs = require("qs");
const path = require('path');
require("dotenv").config({ path: path.resolve(__dirname, '../.env') });

// Sử dụng biến môi trường cụ thể cho Kaipany
const HANET_TOKEN_URL = process.env.KAIPANY_HANET_TOKEN_URL || "https://oauth.hanet.com/token";
const HANET_CLIENT_ID = process.env.KAIPANY_HANET_CLIENT_ID;
const HANET_CLIENT_SECRET = process.env.KAIPANY_HANET_CLIENT_SECRET;
const HANET_REFRESH_TOKEN = process.env.KAIPANY_HANET_REFRESH_TOKEN;

// Hiển thị cấu hình đang được sử dụng cho debug
console.log("KAIPANY CONFIG:", {
  TOKEN_URL: HANET_TOKEN_URL,
  CLIENT_ID: HANET_CLIENT_ID ? HANET_CLIENT_ID.substring(0, 5) + '...' : undefined,
  CLIENT_SECRET: HANET_CLIENT_SECRET ? HANET_CLIENT_SECRET.substring(0, 5) + '...' : undefined,
  REFRESH_TOKEN: HANET_REFRESH_TOKEN ? HANET_REFRESH_TOKEN.substring(0, 10) + '...' : undefined,
  EMAIL_IN_TOKEN: HANET_REFRESH_TOKEN ? decodeJWT(HANET_REFRESH_TOKEN) : 'Cannot decode token'
});

// Hàm giải mã JWT để hiển thị email từ token
function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(Buffer.from(base64, 'base64').toString().split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    const payload = JSON.parse(jsonPayload);
    return payload.email || 'Email not found';
  } catch (error) {
    return 'Error decoding token';
  }
}

let currentAccessToken = null;
let tokenExpiresAt = null;

async function refreshAccessToken() {
  console.log("Kaipany: Đang yêu cầu làm mới Access Token từ HANET...");
  if (
    !HANET_REFRESH_TOKEN ||
    !HANET_CLIENT_ID ||
    !HANET_CLIENT_SECRET ||
    !HANET_TOKEN_URL
  ) {
    throw new Error(
      "Kaipany: Thiếu thông tin cấu hình để làm mới token (kiểm tra .env)"
    );
  }

  const apiUrl = HANET_TOKEN_URL;
  const requestData = {
    grant_type: "refresh_token",
    client_id: HANET_CLIENT_ID,
    client_secret: HANET_CLIENT_SECRET,
    refresh_token: HANET_REFRESH_TOKEN,
  };
  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  };

  try {
    const response = await axios.post(
      apiUrl,
      qs.stringify(requestData),
      config
    );
    if (response.data && response.data.access_token) {
      console.log("Kaipany: Làm mới Access Token thành công.");
      const expiresIn = response.data.expires_in || 3600;
      currentAccessToken = response.data.access_token;
      tokenExpiresAt = Date.now() + expiresIn * 1000 - 60 * 1000;
      if (
        response.data.refresh_token &&
        response.data.refresh_token !== HANET_REFRESH_TOKEN
      ) {
        console.warn("Kaipany: Nhận được Refresh Token mới từ HANET!");
      }

      return currentAccessToken;
    } else {
      console.error(
        "Kaipany: Lỗi khi làm mới token, response không chứa access_token:",
        response.data
      );
      throw new Error(
        `Kaipany: Lỗi làm mới token từ HANET: ${
          response.data?.returnMessage || "Phản hồi không hợp lệ"
        }`
      );
    }
  } catch (error) {
    console.error(
      "Kaipany: Lỗi nghiêm trọng khi gọi API làm mới token:",
      error.response?.data || error.message
    );
    currentAccessToken = null;
    tokenExpiresAt = null;
    throw new Error(
      `Kaipany: Không thể làm mới Access Token: ${
        error.response?.data?.returnMessage || error.message
      }`
    );
  }
}

async function getValidHanetToken() {
  const now = Date.now();
  if (currentAccessToken && tokenExpiresAt && now < tokenExpiresAt - 10000) {
    console.log("Kaipany: Sử dụng Access Token từ bộ nhớ.");
    return currentAccessToken;
  }
  console.log(
    "Kaipany: Access Token trong bộ nhớ không hợp lệ hoặc hết hạn, đang làm mới..."
  );
  return await refreshAccessToken();
}

module.exports = {
  getValidHanetToken,
};
