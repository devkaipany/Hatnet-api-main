// tokenManager.js
const axios = require("axios");
const qs = require("qs");
const path = require('path');

// Đảm bảo đọc file .env đúng cách
require("dotenv").config({ path: path.resolve(__dirname, '../.env') });

// Lấy biến môi trường sau khi đã đọc file .env
const HANET_TOKEN_URL = process.env.HANET_TOKEN_URL || "https://oauth.hanet.com/token";
const HANET_CLIENT_ID = process.env.HANET_CLIENT_ID;
const HANET_CLIENT_SECRET = process.env.HANET_CLIENT_SECRET;
const HANET_REFRESH_TOKEN = process.env.HANET_REFRESH_TOKEN;
let currentAccessToken = null;
let tokenExpiresAt = null;
async function refreshAccessToken() {
  console.log("Đang yêu cầu làm mới Access Token từ HANET...");
  if (
    !HANET_REFRESH_TOKEN ||
    !HANET_CLIENT_ID ||
    !HANET_CLIENT_SECRET ||
    !HANET_TOKEN_URL
  ) {
    throw new Error(
      "Thiếu thông tin cấu hình để làm mới token (kiểm tra .env)"
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
      console.log("Làm mới Access Token thành công.");
      const expiresIn = response.data.expires_in || 3600;
      currentAccessToken = response.data.access_token;
      tokenExpiresAt = Date.now() + expiresIn * 1000 - 60 * 1000;
      if (
        response.data.refresh_token &&
        response.data.refresh_token !== HANET_REFRESH_TOKEN
      ) {
        console.warn("Nhận được Refresh Token mới từ HANET!");
      }

      return currentAccessToken;
    } else {
      console.error(
        "Lỗi khi làm mới token, response không chứa access_token:",
        response.data
      );
      throw new Error(
        `Lỗi làm mới token từ HANET: ${
          response.data?.returnMessage || "Phản hồi không hợp lệ"
        }`
      );
    }
  } catch (error) {
    console.error(
      "Lỗi nghiêm trọng khi gọi API làm mới token:",
      error.response?.data || error.message
    );
    currentAccessToken = null;
    tokenExpiresAt = null;
    throw new Error(
      `Không thể làm mới Access Token: ${
        error.response?.data?.returnMessage || error.message
      }`
    );
  }
}
async function getValidHanetToken() {
  const now = Date.now();
  if (currentAccessToken && tokenExpiresAt && now < tokenExpiresAt - 10000) {
    console.log("Sử dụng Access Token từ bộ nhớ.");
    return currentAccessToken;
  }
  console.log(
    "Access Token trong bộ nhớ không hợp lệ hoặc hết hạn, đang làm mới..."
  );
  return await refreshAccessToken();
}

module.exports = {
  getValidHanetToken,
};
