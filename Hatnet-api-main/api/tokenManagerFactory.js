// tokenManagerFactory.js
// Tạo một TokenManager riêng biệt cho từng tenant,
// mỗi manager tự cache access_token độc lập.

const axios = require("axios");
const qs = require("qs");

// Hàm giải mã JWT để lấy email (dùng cho debug)
function decodeJWT(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      Buffer.from(base64, "base64")
        .toString()
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(jsonPayload);
    return payload.email || "Email not found";
  } catch {
    return "Error decoding token";
  }
}

/**
 * Tạo một TokenManager cho tenant dựa vào config.
 * Config chứa các giá trị credential đã được resolve từ env vars.
 *
 * @param {object} config
 * @param {string} config.tenantId     - ID của tenant (vd: "kaipany")
 * @param {string} config.tokenUrl     - URL lấy token OAuth
 * @param {string} config.clientId     - Client ID
 * @param {string} config.clientSecret - Client Secret
 * @param {string} config.refreshToken - Refresh Token ban đầu
 * @returns {{ getValidHanetToken: () => Promise<string> }}
 */
function createTokenManager(config) {
  const { tenantId, tokenUrl, clientId, clientSecret, refreshToken } = config;
  const label = `[${tenantId.toUpperCase()}]`;

  // In config ra để debug khi khởi động (che bớt giá trị nhạy cảm)
  console.log(`${label} TokenManager khởi tạo:`, {
    tokenUrl,
    clientId: clientId ? clientId.substring(0, 5) + "..." : undefined,
    clientSecret: clientSecret ? clientSecret.substring(0, 5) + "..." : undefined,
    refreshToken: refreshToken ? refreshToken.substring(0, 10) + "..." : undefined,
    emailInToken: refreshToken ? decodeJWT(refreshToken) : "Không thể giải mã",
  });

  // Cache token riêng cho tenant này
  let currentAccessToken = null;
  let tokenExpiresAt = null;

  async function refreshAccessToken() {
    console.log(`${label} Đang làm mới Access Token từ HANET...`);

    if (!refreshToken || !clientId || !clientSecret || !tokenUrl) {
      throw new Error(
        `${label} Thiếu thông tin cấu hình để làm mới token. Kiểm tra lại env vars.`
      );
    }

    const requestData = {
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    };
    const axiosConfig = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    };

    try {
      const response = await axios.post(
        tokenUrl,
        qs.stringify(requestData),
        axiosConfig
      );

      if (response.data && response.data.access_token) {
        console.log(`${label} Làm mới Access Token thành công.`);
        const expiresIn = response.data.expires_in || 3600;
        currentAccessToken = response.data.access_token;
        // Trừ 60s để đảm bảo token vẫn còn hạn khi dùng
        tokenExpiresAt = Date.now() + expiresIn * 1000 - 60 * 1000;

        if (
          response.data.refresh_token &&
          response.data.refresh_token !== refreshToken
        ) {
          console.warn(
            `${label} HANET trả về Refresh Token mới! Cần cập nhật env var.`
          );
        }

        return currentAccessToken;
      } else {
        throw new Error(
          `${label} Phản hồi không chứa access_token: ${
            response.data?.returnMessage || "Lỗi không xác định"
          }`
        );
      }
    } catch (error) {
      currentAccessToken = null;
      tokenExpiresAt = null;
      console.error(
        `${label} Lỗi khi làm mới token:`,
        error.response?.data || error.message
      );
      throw new Error(
        `${label} Không thể làm mới Access Token: ${
          error.response?.data?.returnMessage || error.message
        }`
      );
    }
  }

  async function getValidHanetToken() {
    const now = Date.now();
    // Còn hạn và còn ít nhất 10s nữa mới hết → dùng cache
    if (currentAccessToken && tokenExpiresAt && now < tokenExpiresAt - 10000) {
      console.log(`${label} Sử dụng Access Token từ bộ nhớ cache.`);
      return currentAccessToken;
    }
    console.log(`${label} Access Token hết hạn hoặc chưa có, đang làm mới...`);
    return await refreshAccessToken();
  }

  return { getValidHanetToken };
}

module.exports = { createTokenManager };
