// hanetServiceFactory.js
// Tạo một HanetService hoàn chỉnh cho từng tenant.
// Toàn bộ logic checkin/place/device được dùng chung, chỉ khác credentials.

const axios = require("axios");
const qs = require("qs");

// ── Múi giờ Việt Nam (UTC+7) ─────────────────────────────────────────────────
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Trả về đầu ngày (00:00:00.000) theo giờ VN dưới dạng UTC timestamp */
function vnStartOfDay(utcTs) {
  const vnMs = utcTs + VN_OFFSET_MS;
  return Math.floor(vnMs / 86400000) * 86400000 - VN_OFFSET_MS;
}

/** Trả về cuối ngày (23:59:59.999) theo giờ VN dưới dạng UTC timestamp */
function vnEndOfDay(utcTs) {
  return vnStartOfDay(utcTs) + 86400000 - 1;
}

/** Trả về timestamp đầu tháng theo giờ VN */
function vnStartOfMonth(utcTs) {
  const d = new Date(utcTs + VN_OFFSET_MS);
  // Ngày 1 của tháng theo UTC "ảo" rồi trừ offset
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - VN_OFFSET_MS;
}

/** Trả về timestamp cuối tháng (23:59:59.999) theo giờ VN */
function vnEndOfMonth(utcTs) {
  const d = new Date(utcTs + VN_OFFSET_MS);
  // Ngày 0 của tháng tiếp = ngày cuối của tháng hiện tại
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) - VN_OFFSET_MS + 86400000 - 1;
}

/** Cộng thêm N tháng (theo giờ VN) vào UTC timestamp, trả về timestamp đầu tháng mới */
function vnAddMonths(utcTs, n) {
  const d = new Date(utcTs + VN_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) - VN_OFFSET_MS;
}

/** Đặt ngày trong tháng (theo giờ VN) */
function vnSetDate(utcTs, dayOfMonth) {
  const d = new Date(utcTs + VN_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dayOfMonth) - VN_OFFSET_MS;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Nhóm danh sách checkin raw theo ngày, giữ lại:
 * - checkinTime sớm nhất (lần vào đầu tiên)
 * - checkoutTime muộn nhất (lần ra cuối cùng)
 */
function filterCheckinsByDay(data) {
  try {
    if (!data || !data.data || !Array.isArray(data.data)) {
      console.error("Dữ liệu đầu vào không hợp lệ!");
      return [];
    }

    const validCheckins = data.data.filter(
      (item) =>
        item.personID &&
        item.personID !== "" &&
        item.personName &&
        item.personName !== ""
    );

    const personCheckins = {};

    validCheckins.forEach((checkin) => {
      const date = checkin.date;
      const personKey = `${date}_${checkin.personID}`;
      const checkinTime = parseInt(checkin.checkinTime);

      if (!personCheckins[personKey]) {
        personCheckins[personKey] = {
          personName: checkin.personName ?? "",
          personID: checkin.personID,
          aliasID: checkin.aliasID ?? "",
          placeID: checkin.placeID ?? null,
          title:
            checkin.title
              ? typeof checkin.title === "string"
                ? checkin.title.trim()
                : "N/A"
              : "Khách hàng",
          type: checkin.type ?? null,
          deviceID: checkin.deviceID ?? "",
          deviceName: checkin.deviceName ?? "",
          date: checkin.date,
          checkinTime,
          checkoutTime: checkinTime,
          formattedCheckinTime: formatTimestamp(checkinTime),
          formattedCheckoutTime: formatTimestamp(checkinTime),
        };
      } else {
        if (checkinTime < personCheckins[personKey].checkinTime) {
          personCheckins[personKey].checkinTime = checkinTime;
          personCheckins[personKey].formattedCheckinTime =
            formatTimestamp(checkinTime);
        }
        if (checkinTime > personCheckins[personKey].checkoutTime) {
          personCheckins[personKey].checkoutTime = checkinTime;
          personCheckins[personKey].formattedCheckoutTime =
            formatTimestamp(checkinTime);
        }
      }
    });

    return Object.values(personCheckins).sort(
      (a, b) => a.checkinTime - b.checkinTime
    );
  } catch (error) {
    console.error("Lỗi khi xử lý dữ liệu:", error);
    return [];
  }
}

// ─── Core fetch (1 khoảng thời gian, phân trang) ────────────────────────────

async function fetchCheckinDataForTimeRange(
  label,
  apiBaseUrl,
  placeId,
  dateFrom,
  dateTo,
  devices,
  accessToken
) {
  const apiUrl = `${apiBaseUrl}/person/getCheckinByPlaceIdInTimestamp`;
  const MAX_PAGES = 500;         // giảm từ 50000 → tránh vòng lặp vô tận
  const MAX_EMPTY_PAGES = 3;
  let emptyPagesCount = 0;
  let rawCheckinData = [];

  const fromTimestamp = parseInt(dateFrom);
  const toTimestamp   = parseInt(dateTo);
  if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
    throw new Error("Timestamp không hợp lệ");
  }

  // Chuẩn hóa về đầu ngày / cuối ngày theo giờ Việt Nam (UTC+7)
  const adjustedFrom = vnStartOfDay(fromTimestamp);
  const adjustedTo   = vnEndOfDay(toTimestamp);

  for (let index = 1; index <= MAX_PAGES; index++) {
    const requestData = {
      token: accessToken,
      placeID: placeId,
      from: adjustedFrom,
      to: adjustedTo,
      ...(devices && { devices }),
      size: 1000,
      page: index,
    };
    const config = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    };

    try {
      const response = await axios.post(apiUrl, qs.stringify(requestData), config);

      if (response.data && typeof response.data.returnCode !== "undefined") {
        if (response.data.returnCode === 1 || response.data.returnCode === 0) {
          if (Array.isArray(response.data.data)) {
            if (response.data.data.length === 0) {
              emptyPagesCount++;
              if (emptyPagesCount >= MAX_EMPTY_PAGES) {
                console.log(`${label} Đủ ${MAX_EMPTY_PAGES} trang trống, dừng.`);
                break;
              }
              continue;
            }
            emptyPagesCount = 0;
            rawCheckinData = [...rawCheckinData, ...response.data.data];
          } else {
            break;
          }
        } else {
          console.error(`${label} Lỗi logic HANET: mã ${response.data.returnCode}`);
          break;
        }
      } else {
        break;
      }
    } catch (error) {
      // ─── 401 = token hết hạn → throw ngay, không tiếp tục ───────────────
      if (error.response && error.response.status === 401) {
        throw new Error(`Lỗi xác thực với HANET API (401) — token đã hết hạn`);
      }
      // 5xx / timeout → thử lại tối đa 2 lần rồi bỏ qua trang này
      if (
        error.code === "ECONNABORTED" ||
        (error.response && error.response.status >= 500)
      ) {
        let retried = false;
        for (let r = 1; r <= 2 && !retried; r++) {
          await new Promise((res) => setTimeout(res, r * 1500));
          try {
            const retryRes = await axios.post(apiUrl, qs.stringify(requestData), config);
            if (retryRes.data && Array.isArray(retryRes.data.data)) {
              rawCheckinData = [...rawCheckinData, ...retryRes.data.data];
              retried = true;
            }
          } catch (_) {}
        }
        if (!retried) continue;
      } else {
        console.error(`${label} Lỗi trang ${index}:`, error.message);
        break;  // lỗi không xác định → dừng, không vòng lặp mãi
      }
    }
  }

  return rawCheckinData;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Tạo một HanetService đầy đủ cho tenant.
 *
 * @param {object} tenantConfig
 * @param {string} tenantConfig.tenantId        - ID tenant (vd: "kaipany")
 * @param {string} tenantConfig.hanetApiBaseUrl - Base URL HANET API
 * @param {{ getValidHanetToken: () => Promise<string> }} tenantConfig.tokenManager
 * @returns {{ getPeopleListByMethod, getPlaceList, getDeviceList }}
 */
function createHanetService(tenantConfig) {
  const { tenantId, hanetApiBaseUrl, tokenManager } = tenantConfig;
  const label = `[${tenantId.toUpperCase()}]`;

  if (!hanetApiBaseUrl) {
    console.error(`${label} CẢNH BÁO: hanetApiBaseUrl chưa được thiết lập!`);
  }

  // ── getPlaceList ──────────────────────────────────────────────────────────
  async function getPlaceList() {
    let accessToken;
    try {
      console.log(`${label} Bắt đầu lấy token...`);
      accessToken = await tokenManager.getValidHanetToken();
      console.log(`${label} Lấy token thành công: ${accessToken ? accessToken.substring(0, 10) + "..." : "null"}`);
    } catch (err) {
      throw new Error(`${label} Lỗi xác thực HANET: ${err.message}`);
    }

    if (!accessToken) throw new Error(`${label} Không lấy được Access Token.`);

    const apiUrl = `${hanetApiBaseUrl}/place/getPlaces`;
    const config = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    };

    try {
      console.log(`${label} Gọi API lấy danh sách địa điểm: ${apiUrl}`);
      const response = await axios.post(
        apiUrl,
        qs.stringify({ token: accessToken }),
        config
      );
      if (response.data && response.data.returnCode === 1) {
        console.log(`${label} Lấy danh sách địa điểm thành công.`);
        return response.data.data || [];
      } else {
        throw new Error(
          `${label} Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
        );
      }
    } catch (error) {
      console.error(`${label} Lỗi khi lấy danh sách địa điểm:`, error.message);
      throw new Error(`${label} Không thể lấy danh sách địa điểm: ${error.message}`);
    }
  }

  // ── getDeviceList ─────────────────────────────────────────────────────────
  async function getDeviceList(placeId) {
    let accessToken;
    try {
      accessToken = await tokenManager.getValidHanetToken();
    } catch (err) {
      throw new Error(`${label} Lỗi xác thực HANET: ${err.message}`);
    }
    if (!accessToken) throw new Error(`${label} Không lấy được Access Token.`);

    const apiUrl = `${hanetApiBaseUrl}/device/getListDeviceByPlace`;
    const config = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000,
    };

    try {
      console.log(`${label} Gọi API lấy thiết bị cho placeID=${placeId}...`);
      const response = await axios.post(
        apiUrl,
        qs.stringify({ token: accessToken, placeID: placeId }),
        config
      );
      if (response.data && response.data.returnCode === 1) {
        return response.data.data || [];
      } else {
        throw new Error(
          `${label} Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
        );
      }
    } catch (error) {
      throw new Error(`${label} Không thể lấy danh sách thiết bị: ${error.message}`);
    }
  }

  // ── getPeopleListByMethod ─────────────────────────────────────────────────
  async function getPeopleListByMethod(placeId, dateFrom, dateTo, devices) {
    if (!placeId) throw new Error("Thiếu tham số placeId");
    if (!dateFrom || !dateTo) throw new Error("Thiếu tham số dateFrom hoặc dateTo");

    const startTime = Date.now();
    console.log(
      `${label} Bắt đầu truy vấn placeId=${placeId} từ ${new Date(parseInt(dateFrom)).toLocaleDateString()} đến ${new Date(parseInt(dateTo)).toLocaleDateString()}`
    );

    let accessToken;
    try {
      accessToken = await tokenManager.getValidHanetToken();
    } catch (err) {
      throw new Error(`${label} Lỗi xác thực HANET: ${err.message}`);
    }
    if (!accessToken) throw new Error(`${label} Không lấy được Access Token.`);

    const ONE_DAY = 24 * 60 * 60 * 1000;
    const CHUNK_SIZE = 3 * ONE_DAY;

    // Mở rộng thêm 1 ngày trước để đảm bảo có dữ liệu đầu tháng
    const fromTime = parseInt(dateFrom) - ONE_DAY;
    const toTime = parseInt(dateTo);
    const totalDays = Math.ceil((toTime - fromTime) / ONE_DAY);

    // Tạo danh sách chunk thời gian
    const chunkList = [];

    // Chunk 3-ngày cơ bản
    let tmpStart = fromTime;
    while (tmpStart < toTime) {
      chunkList.push({ start: tmpStart, end: Math.min(tmpStart + CHUNK_SIZE, toTime) });
      tmpStart = Math.min(tmpStart + CHUNK_SIZE, toTime);
    }

    // Thêm chunk theo tháng để đảm bảo không bỏ sót tháng nào
    // Dùng múi giờ Việt Nam (UTC+7) để tính đầu/cuối tháng
    let monthCursorTs = vnStartOfMonth(fromTime);

    while (monthCursorTs < toTime) {
      const monthStartTs = monthCursorTs;
      const monthEndTs   = vnEndOfMonth(monthCursorTs);

      const actualStart = Math.max(monthStartTs, fromTime);
      const actualEnd   = Math.min(monthEndTs, toTime);

      if (actualStart < actualEnd) {
        chunkList.push({ start: actualStart, end: actualEnd, isMonthChunk: true });

        // Tuần đầu tháng
        chunkList.push({
          start: actualStart,
          end: Math.min(actualStart + 7 * ONE_DAY, actualEnd),
          isWeekChunk: true,
        });

        // Giữa tháng
        if (actualEnd - actualStart > 14 * ONE_DAY) {
          const midStart = vnStartOfDay(vnSetDate(monthStartTs, 10));
          const midEnd   = vnEndOfDay(midStart + 7 * ONE_DAY);
          chunkList.push({
            start: Math.max(midStart, actualStart),
            end: Math.min(midEnd, actualEnd),
            isMiddleChunk: true,
          });
        }

        // Tuần cuối tháng
        if (actualEnd - actualStart > 7 * ONE_DAY) {
          const endWeekStart = vnStartOfDay(monthEndTs - 6 * ONE_DAY);
          chunkList.push({
            start: Math.max(endWeekStart, actualStart),
            end: actualEnd,
            isEndChunk: true,
          });
        }
      }

      monthCursorTs = vnAddMonths(monthCursorTs, 1);
    }

    console.log(`${label} Truy vấn ${totalDays} ngày, sử dụng ${chunkList.length} chunk.`);

    let rawCheckinData = [];
    let chunkIndex = 0;

    for (const chunk of chunkList) {
      chunkIndex++;
      const chunkType = chunk.isMonthChunk
        ? "tháng"
        : chunk.isWeekChunk
        ? "tuần đầu"
        : chunk.isMiddleChunk
        ? "giữa tháng"
        : chunk.isEndChunk
        ? "cuối tháng"
        : "chuẩn";

      if (isNaN(chunk.start) || isNaN(chunk.end)) {
        console.error(`${label} Timestamp không hợp lệ chunk #${chunkIndex} (${chunkType}).`);
        continue;
      }

      console.log(
        `${label} Chunk #${chunkIndex}/${chunkList.length} (${chunkType}): ${new Date(chunk.start).toLocaleDateString()} - ${new Date(chunk.end).toLocaleDateString()}`
      );

      try {
        const chunkData = await fetchCheckinDataForTimeRange(
          label,
          hanetApiBaseUrl,
          placeId,
          chunk.start,
          chunk.end,
          devices,
          accessToken
        );
        rawCheckinData = [...rawCheckinData, ...chunkData];
        console.log(`${label} Chunk #${chunkIndex}: +${chunkData.length} bản ghi.`);
      } catch (err) {
        console.error(`${label} Lỗi chunk #${chunkIndex}:`, err.message);
      }
    }

    console.log(`${label} Tổng raw: ${rawCheckinData.length} bản ghi.`);

    // Loại bỏ trùng lặp
    const checkinMap = new Map();
    for (const checkin of rawCheckinData) {
      if (!checkin.checkinTime || !checkin.personID) continue;
      const key = `${checkin.personID}_${checkin.checkinTime}`;
      if (!checkinMap.has(key)) checkinMap.set(key, checkin);
    }
    const uniqueCheckins = Array.from(checkinMap.values());
    console.log(`${label} Sau khi loại trùng: ${uniqueCheckins.length} bản ghi.`);

    // Lọc về đúng khoảng thời gian ban đầu
    const originalFrom = parseInt(dateFrom);
    const filtered = uniqueCheckins.filter((c) => {
      const t = parseInt(c.checkinTime);
      return !isNaN(t) && t >= originalFrom && t <= toTime;
    });
    console.log(`${label} Sau khi lọc khoảng thời gian: ${filtered.length} bản ghi.`);

    const result = filterCheckinsByDay({ data: filtered });

    // Thống kê coverage
    const uniqueDates = new Set(result.map((r) => r.date).filter(Boolean));
    const expectedDays = Math.ceil((toTime - originalFrom) / ONE_DAY);
    const coveragePercent = ((uniqueDates.size / expectedDays) * 100).toFixed(2);
    console.log(
      `${label} Coverage: ${uniqueDates.size}/${expectedDays} ngày (${coveragePercent}%).`
    );
    if (uniqueDates.size < expectedDays * 0.5) {
      console.warn(
        `${label} CẢNH BÁO: Chỉ có ${uniqueDates.size}/${expectedDays} ngày có dữ liệu!`
      );
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`${label} Hoàn thành trong ${elapsed}s, trả về ${result.length} kết quả.`);

    return result;
  }

  return { getPlaceList, getDeviceList, getPeopleListByMethod };
}

module.exports = { createHanetService };
