const axios = require("axios");
const qs = require("qs");
const tokenManager = require("./kaipanyTokenManager");

const HANET_API_BASE_URL = process.env.HANET_API_BASE_URL;
async function getDeviceById(placeId) {
  let access_token;
  try {
    access_token = await tokenManager.getValidHanetToken();
  } catch (error) {
    console.error("Loi khi goi token trong device id", error.message);
    throw new Error("Loi khong xac dinh khi goi token", error.message);
  }
  const apiUrl = `${HANET_API_BASE_URL}/device/getListDeviceByPlace`;
  const requestData = qs.stringify({
    token: access_token,
    placeID: placeId,
  });
  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  };

  try {
    const response = await axios.post(apiUrl, requestData, config);
    return response.data.data;
  } catch (error) {
    console.error("Loi khi goi api trong device id", error.message);
    throw new Error("Loi khong xac dinh khi goi token", error.message);
  }
}

module.exports = {
  getDeviceById,
};
