// hanetService.js

// ... (hàm filterUniqueCheckinsPerPersonDay giữ nguyên) ...
function filterUniqueCheckinsPerPersonDay(data) {
  const uniqueCheckins = [];
  const seenCombinations = new Set();
  if (!Array.isArray(data)) {
    console.error("Dữ liệu đầu vào của filter không phải là mảng!");
    return [];
  }
  for (const checkin of data) {
    if (!checkin.personID || checkin.personID === "") {
      continue;
    }
    const combinationKey = `${checkin.personID}_${checkin.date}`;
    if (!seenCombinations.has(combinationKey)) {
      seenCombinations.add(combinationKey);
      const selectedData = {
        personName: checkin.personName !== undefined ? checkin.personName : "",
        personID: checkin.personID,
        aliasID: checkin.aliasID !== undefined ? checkin.aliasID : "",
        placeID: checkin.placeID !== undefined ? checkin.placeID : null,
        title: checkin.title
          ? typeof checkin.title === "string"
            ? checkin.title.trim()
            : "N/A"
          : "Khách hàng",
        type: checkin.type !== undefined ? checkin.type : null,
        deviceID: checkin.deviceID !== undefined ? checkin.deviceID : "",
        deviceName: checkin.deviceName !== undefined ? checkin.deviceName : "",
        checkinTime:
          checkin.checkinTime !== undefined ? checkin.checkinTime : null,
      };
      uniqueCheckins.push(selectedData);
    }
  }
  return uniqueCheckins;
}

require("dotenv").config();
const axios = require("axios");
const qs = require("qs");
const tokenManager = require("./kaipanyTokenManager");
const { getAllPlace } = require("./getPlaceId");
const HANET_API_BASE_URL = process.env.HANET_API_BASE_URL;

if (!HANET_API_BASE_URL) {
  console.error("Lỗi: Biến môi trường HANET_API_BASE_URL chưa được thiết lập.");
}

async function getPeopleListByPlace() {
  let places = [];
  try {
    places = await getAllPlace();
    if (!Array.isArray(places)) {
      throw new Error("getAllPlace không trả về mảng hợp lệ.");
    }
    console.log(`Đã lấy được ${places.length} địa điểm.`);
  } catch (e) {
    console.error("Lỗi khi lấy danh sách địa điểm:", e.message);
    throw e;
  }

  if (places.length === 0) return [];

  const allRawResults = [];

  let accessToken;
  try {
    accessToken = await tokenManager.getValidHanetToken();
  } catch (refreshError) {
    console.error("Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Lỗi xác thực với HANET: ${refreshError.message}`);
  }
  if (!accessToken) {
    throw new Error("Không lấy được Access Token hợp lệ.");
  }

  const ngayHienTai = new Date();
  const nam = ngayHienTai.getFullYear();
  const thang = ngayHienTai.getMonth();
  const ngay = ngayHienTai.getDate();
  const dauNgay = new Date(nam, thang, ngay, 0, 0, 0, 0);
  const dateFrom = dauNgay.getTime();
  const cuoiNgayMucTieu = new Date(nam, thang, ngay, 23, 0, 0, 0);
  const dateTo = cuoiNgayMucTieu.getTime();

  for (const place of places) {
    if (!place || typeof place.id === "undefined") {
      console.warn("Bỏ qua địa điểm không có ID:", place);
      continue;
    }
    const currentPlaceId = place.id;

    const apiUrl = `${HANET_API_BASE_URL}/person/getCheckinByPlaceIdInTimestamp`;
    const requestData = {
      token: accessToken,
      placeID: currentPlaceId,
      from: dateFrom,
      to: dateTo,
    };
    const config = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    };
    console.log(`Đang gọi HANET API: ${apiUrl} với placeID=${currentPlaceId}`);
    try {
      const response = await axios.post(
        apiUrl,
        qs.stringify(requestData),
        config
      );

      if (response.data && typeof response.data.returnCode !== "undefined") {
        if (response.data.returnCode === 1 || response.data.returnCode === 0) {
          console.log(`Gọi HANET API thành công cho placeID=${currentPlaceId}`);
          if (Array.isArray(response.data.data)) {
            allRawResults.push(...response.data.data);
          } else {
            console.warn(
              `Dữ liệu trả về cho placeID ${currentPlaceId} không phải mảng.`
            );
          }
        } else {
          console.error(
            `Lỗi logic từ HANET cho placeID=${currentPlaceId}:`,
            response.data
          );
          console.warn(
            `Bỏ qua địa điểm ${currentPlaceId} do lỗi API: ${response.data.returnCode}`
          );
        }
      } else {
        console.error(
          `Response không hợp lệ từ HANET cho placeID=${currentPlaceId}:`,
          response.data
        );
        console.warn(
          `Bỏ qua địa điểm ${currentPlaceId} do response không hợp lệ.`
        );
      }
    } catch (error) {
      console.error(
        `Lỗi khi gọi ${apiUrl} cho placeID=${currentPlaceId}:`,
        error.response?.data || error.message
      );

      console.warn(`Bỏ qua địa điểm ${currentPlaceId} do lỗi request.`);
    }
  }

  console.log(`Tổng số bản ghi thô từ API: ${allRawResults.length}`);

  const filteredData = filterUniqueCheckinsPerPersonDay(allRawResults);
  console.log(`Số bản ghi sau khi lọc: ${filteredData.length}`);

  return filteredData;
}

module.exports = {
  getPeopleListByPlace,
};
