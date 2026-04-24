require("dotenv").config();
const axios = require("axios");
const qs = require("qs");
const tokenManager = require("./kaipanyTokenManager");

const HANET_API_BASE_URL = process.env.HANET_API_BASE_URL;

const getAllPlace = async function () {
  let access_token;

  try {
    access_token = await tokenManager.getValidHanetToken();
  } catch (error) {
    console.error("Không thể lấy được token hợp lệ:", error.message);
    throw new Error(`Lỗi xác thực với HANET: ${error.message}`);
  }

  const apiUrl = `${HANET_API_BASE_URL}/place/getPlaces`;

  const requestData = qs.stringify({
    token: access_token,
  });

  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  };

  try {
    const response = await axios.post(apiUrl, requestData, config);
    console.log(response.data.data);

    return response.data.data;
  } catch (error) {
    console.error("Lỗi khi gọi API HANET:", error.message);
    throw new Error(`Lỗi API HANET: ${error.message}`);
  }
};

module.exports = {
  getAllPlace,
};
