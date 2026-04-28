// kaipanyHanetService.js
require("dotenv").config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require("axios");
const qs = require("qs");
const tokenManager = require("./kaipanyTokenManager");
const HANET_API_BASE_URL = process.env.KAIPANY_HANET_API_BASE_URL;

if (!HANET_API_BASE_URL) {
  console.error("Lỗi: Biến môi trường KAIPANY_HANET_API_BASE_URL chưa được thiết lập.");
  console.log("Sử dụng URL mặc định https://partner.hanet.ai");
}

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
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - VN_OFFSET_MS;
}

/** Trả về timestamp cuối tháng (23:59:59.999) theo giờ VN */
function vnEndOfMonth(utcTs) {
  const d = new Date(utcTs + VN_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) - VN_OFFSET_MS + 86400000 - 1;
}

/** Cộng thêm N tháng (theo giờ VN), trả về timestamp đầu tháng mới */
function vnAddMonths(utcTs, n) {
  const d = new Date(utcTs + VN_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1) - VN_OFFSET_MS;
}

/** Đặt ngày trong tháng (theo giờ VN) */
function vnSetDate(utcTs, dayOfMonth) {
  const d = new Date(utcTs + VN_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dayOfMonth) - VN_OFFSET_MS;
}

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

    // Tạo một đối tượng tạm để theo dõi lần check-in đầu tiên và checkout cuối cùng của mỗi người theo ngày
    const personCheckins = {};

    validCheckins.forEach((checkin) => {
      const date = checkin.date;
      const personKey = `${date}_${checkin.personID}`;
      const checkinTime = parseInt(checkin.checkinTime);

      // Nếu chưa có thông tin cho person này, tạo mới
      if (!personCheckins[personKey]) {
        personCheckins[personKey] = {
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
          date: checkin.date,
          checkinTime: checkinTime,  // Timestamp cho check-in sớm nhất
          checkoutTime: checkinTime,  // Ban đầu checkout = checkin
          formattedCheckinTime: formatTimestamp(checkinTime),
          formattedCheckoutTime: formatTimestamp(checkinTime),
        };
      } else {
        // Cập nhật thời gian check-in sớm nhất và check-out muộn nhất
        if (checkinTime < personCheckins[personKey].checkinTime) {
          personCheckins[personKey].checkinTime = checkinTime;
          personCheckins[personKey].formattedCheckinTime = formatTimestamp(checkinTime);
        }
        
        if (checkinTime > personCheckins[personKey].checkoutTime) {
          personCheckins[personKey].checkoutTime = checkinTime;
          personCheckins[personKey].formattedCheckoutTime = formatTimestamp(checkinTime);
        }
      }
    });

    // Sắp xếp kết quả theo thời gian check-in
    const result = Object.values(personCheckins).sort(
      (a, b) => a.checkinTime - b.checkinTime
    );

    return result;
  } catch (error) {
    console.error("Lỗi khi xử lý dữ liệu:", error);
    return [];
  }
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

async function getPeopleListByMethod(placeId, dateFrom, dateTo, devices) {
  if (!placeId) {
    throw new Error("Thiếu tham số placeId");
  }

  if (!dateFrom || !dateTo) {
    throw new Error("Thiếu tham số dateFrom hoặc dateTo");
  }

  // Ghi nhận thởi điểm bắt đầu truy vấn để theo dõi thời gian xử lý
  const startTime = Date.now();
  console.log(`Kaipany: Bắt đầu truy vấn cho placeId=${placeId} từ ${new Date(parseInt(dateFrom)).toLocaleDateString()} đến ${new Date(parseInt(dateTo)).toLocaleDateString()}`);

  let accessToken;
  try {
    accessToken = await tokenManager.getValidHanetToken();
  } catch (refreshError) {
    console.error("Kaipany: Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Kaipany: Lỗi xác thực với HANET: ${refreshError.message}`);
  }
  if (!accessToken) {
    throw new Error("Kaipany: Không lấy được Access Token hợp lệ.");
  }

  // Chuyển đổi dateFrom, dateTo từ string sang số
  // Điều chỉnh lấy thêm 1 ngày trước để đảm bảo có dữ liệu đầu tháng
  const fromTime = parseInt(dateFrom) - (24 * 60 * 60 * 1000); // trừ 1 ngày để đảm bảo lấy dữ liệu đầu tháng
  const toTime = parseInt(dateTo);
  
  // Tối ưu hóa khoảng thời gian cho môi trường Serverless
  const ONE_DAY = 24 * 60 * 60 * 1000; // 1 ngày = 86,400,000 ms
  
  // Tính toán khoảng thời gian tối ưu dựa vào độ dài của khoảng thời gian
  // Nếu truy vấn cho một năm (365 ngày), chúng ta sẽ chia thành các đoạn lớn hơn
  const timeRange = toTime - fromTime;
  const totalDays = Math.ceil(timeRange / ONE_DAY);
  
  // Tạo danh sách các đoạn - trước tiên theo chu kỳ 3 ngày
  const CHUNK_SIZE = 3 * ONE_DAY;
  const chunkList = [];

  let tmpStart = fromTime;
  while (tmpStart < toTime) {
    const tmpEnd = Math.min(tmpStart + CHUNK_SIZE, toTime);
    chunkList.push({ start: tmpStart, end: tmpEnd });
    tmpStart = tmpEnd;
  }

  // Sau đó, thêm các đoạn cho từng tháng từ fromTime đến toTime
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
      chunkList.push({ start: actualStart, end: Math.min(actualStart + 7 * ONE_DAY, actualEnd), isWeekChunk: true });

      // Giữa tháng
      if (actualEnd - actualStart > 14 * ONE_DAY) {
        const midStart = vnStartOfDay(vnSetDate(monthStartTs, 10));
        const midEnd   = vnEndOfDay(midStart + 7 * ONE_DAY);
        chunkList.push({
          start: Math.max(midStart, actualStart),
          end: Math.min(midEnd, actualEnd),
          isMiddleChunk: true
        });
      }

      // Tuần cuối tháng
      if (actualEnd - actualStart > 7 * ONE_DAY) {
        const endWeekStart = vnStartOfDay(monthEndTs - 6 * ONE_DAY);
        chunkList.push({
          start: Math.max(endWeekStart, actualStart),
          end: actualEnd,
          isEndChunk: true
        });
      }
    }

    // Chuyển sang tháng tiếp theo
    monthCursorTs = vnAddMonths(monthCursorTs, 1);
  }
  
  // Đảm bảo không có lỗ hổng giữa các đoạn
  const OVERLAP_HOURS = 48; // 2 ngày đầy đủ để chồng lấp - tăng lên để đảm bảo không bỏ sót
  
  console.log(`Kaipany: Truy vấn cho ${totalDays} ngày, sử dụng ${chunkList.length} đoạn thời gian`);
  console.log(`Kaipany: Bao gồm ${chunkList.filter(c => c.isMonthChunk).length} đoạn theo tháng, ${chunkList.filter(c => !c.isMonthChunk && !c.isWeekChunk && !c.isMiddleChunk && !c.isEndChunk).length} đoạn 7 ngày, và các đoạn đặc biệt khác`);
  
  let rawCheckinData = [];
  let chunks = 0;
  let totalResults = 0;
  
  // Thực hiện truy vấn cho từng đoạn thời gian trong danh sách
  for (const chunk of chunkList) {
    chunks++;
    const currentStart = chunk.start;
    const currentEnd = chunk.end;
    const chunkType = chunk.isMonthChunk ? "tháng" : (chunk.isWeekChunk ? "tuần đầu" : (chunk.isMiddleChunk ? "giữa tháng" : (chunk.isEndChunk ? "cuối tháng" : "chuẩn")));
    
    // Kiểm tra tính hợp lệ của timestamp trước khi gọi API
    if (isNaN(currentStart) || isNaN(currentEnd)) {
      console.error(`Kaipany: Timestamp không hợp lệ cho đoạn #${chunks}/${chunkList.length} (${chunkType}): currentStart=${currentStart}, currentEnd=${currentEnd}`);
      continue;
    }
    
    // Kiểm tra trùng lập với các đoạn đã lấy
    const startDate = new Date(currentStart).toLocaleDateString();
    const endDate = new Date(currentEnd).toLocaleDateString();
    
    console.log(`Kaipany: Đang lấy dữ liệu đoạn #${chunks}/${chunkList.length} (${chunkType}): ${startDate} - ${endDate}`);
    
    try {
      // Lấy dữ liệu cho đoạn hiện tại
      const chunkData = await fetchCheckinDataForTimeRange(placeId, currentStart, currentEnd, devices, accessToken);
      
      // Thêm dữ liệu vào kết quả
      totalResults += chunkData.length;
      rawCheckinData = [...rawCheckinData, ...chunkData];
      
      console.log(`Kaipany: Đã lấy ${chunkData.length} bản ghi cho đoạn #${chunks} (${chunkType}): ${startDate} - ${endDate}`);
    } catch (error) {
      console.error(`Kaipany: Lỗi khi lấy dữ liệu cho đoạn #${chunks} (${chunkType}):`, error.message);
    }
  }
  
  console.log(`Kaipany: Đã lấy dữ liệu từ tất cả ${chunks}/${chunkList.length} đoạn, tổng cộng ${rawCheckinData.length} bản ghi trước khi loại trùng`); 
  
  // Loại bỏ bản ghi trùng lập (vì chúng ta có thể lấy dữ liệu trùng khi thực hiện các đoạn chồng lấp)
  const uniqueCheckins = [];
  const checkinMap = new Map();
  
  for (const checkin of rawCheckinData) {
    if (!checkin.checkinTime || !checkin.personID) continue;
    
    const key = `${checkin.personID}_${checkin.checkinTime}`;
    if (!checkinMap.has(key)) {
      checkinMap.set(key, true);
      uniqueCheckins.push(checkin);
    }
  }
  
  console.log(`Kaipany: Sau khi loại trùng, còn ${uniqueCheckins.length}/${rawCheckinData.length} bản ghi duy nhất`);
  
  // Cập nhật lại dữ liệu sau khi loại trùng
  rawCheckinData = uniqueCheckins;
  
  // Xử lý và lọc dữ liệu check-in theo ngày
  // Vì chúng ta đã mở rộng phạm vi thêm 1 ngày trước, chúng ta cần lọc lại để chỉ lấy dữ liệu trong khoảng ban đầu
  const originalFromTime = parseInt(dateFrom); // Lưu lại thời gian ban đầu để lọc
  
  // Lọc ra các bản ghi nằm trong khoảng thời gian ban đầu
  const filteredRawData = rawCheckinData.filter(checkin => {
    if (!checkin.checkinTime) return false;
    const checkinTimeInt = parseInt(checkin.checkinTime);
    return !isNaN(checkinTimeInt) && checkinTimeInt >= originalFromTime && checkinTimeInt <= toTime;
  });
  
  console.log(`Kaipany: Sau khi lọc, còn ${filteredRawData.length}/${rawCheckinData.length} bản ghi trong khoảng thời gian ban đầu`);
  
  // Xử lý và lọc dữ liệu check-in theo ngày
  const result = filterCheckinsByDay({ data: filteredRawData });
  
  // Kiểm tra và ghi log cảnh báo nếu dữ liệu trả về ít hơn dự kiến
  const uniqueDates = new Set();
  result.forEach(item => {
    if (item.date) uniqueDates.add(item.date);
  });
  
  const expectedDays = Math.ceil((toTime - fromTime) / ONE_DAY);
  const actualDays = uniqueDates.size;
  const coveragePercent = (actualDays / expectedDays * 100).toFixed(2);
  
  console.log(`Kaipany: Phạm vi dữ liệu: ${actualDays}/${expectedDays} ngày (${coveragePercent}%)`);
  console.log(`Kaipany: Các ngày có dữ liệu: ${Array.from(uniqueDates).sort().join(', ')}`);
  
  if (actualDays < expectedDays * 0.5) {
    console.warn(`Kaipany: Cảnh báo! Chỉ lấy được dữ liệu cho ${actualDays}/${expectedDays} ngày (${coveragePercent}%). Nhiều dữ liệu có thể đã bị mất.`);
  }
  
  // Ghi nhận thời gian hoàn thành và thông báo
  const processingTime = (Date.now() - startTime) / 1000;
  console.log(`Kaipany: Hoàn thành xử lý trong ${processingTime.toFixed(2)} giây, trả về ${result.length} kết quả đã lọc`);
  
  return result;
}

async function fetchCheckinDataForTimeRange(placeId, dateFrom, dateTo, devices, accessToken) {
  let rawCheckinData = [];
  
  // Tăng số trang tối đa để đảm bảo lấy hết kết quả, nhưng giới hạn ở một mức hợp lý
  // Giới hạn MAX_PAGES để tránh truy vấn quá nhiều trang không cần thiết
  const MAX_PAGES = 50000;
  let emptyPagesCount = 0;
  
  for (let index = 1; index <= MAX_PAGES; index++) {
    const apiUrl = `${HANET_API_BASE_URL}/person/getCheckinByPlaceIdInTimestamp`;
    // Đảm bảo timestamp là số nguyên
    const fromTimestamp = parseInt(dateFrom);
    const toTimestamp = parseInt(dateTo);
  
    // Kiểm tra tính hợp lệ của timestamp trước khi gọi API
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
      console.error(`Kaipany: Timestamp không hợp lệ: from=${dateFrom}, to=${dateTo}`);
      throw new Error('Timestamp không hợp lệ');
    }
    
    // Đảm bảo fromTimestamp là đầu ngày (00:00:00) và toTimestamp là cuối ngày (23:59:59)
    // Điều này giúp tránh vấn đề múi giờ và đảm bảo lấy đủ dữ liệu trong ngày
    // Chỉnh fromDate về đầu ngày theo giờ Việt Nam
    const adjustedFromTimestamp = vnStartOfDay(fromTimestamp);
    // Chỉnh toDate về cuối ngày theo giờ Việt Nam
    const adjustedToTimestamp = vnEndOfDay(toTimestamp);
  
    // Log ra giá trị thởi gian đã chuyển đổi và chuẩn hóa để debug
    console.log(`Kaipany: Timestamp đã chuẩn hóa: from=${adjustedFromTimestamp} (${new Date(adjustedFromTimestamp).toISOString()}), to=${adjustedToTimestamp} (${new Date(adjustedToTimestamp).toISOString()})`);
  
    const requestData = {
      token: accessToken,
      placeID: placeId,
      from: adjustedFromTimestamp, // Sử dụng timestamp đã chuẩn hóa
      to: adjustedToTimestamp,     // Sử dụng timestamp đã chuẩn hóa
      ...(devices && { devices: devices }),
      size: 1000, // Tăng kích thước trang lên 1000 để lấy nhiều kết quả hơn mỗi trang
      page: index,
    };
    const config = {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    };

    try {
      console.log(`Kaipany: Đang gọi HANET API cho placeID=${placeId}, trang ${index}...`);
      const response = await axios.post(
        apiUrl,
        qs.stringify(requestData),
        config
      );
      if (response.data && typeof response.data.returnCode !== "undefined") {
        if (response.data.returnCode === 1 || response.data.returnCode === 0) {
          console.log(`Kaipany: Gọi HANET API thành công cho placeID=${placeId}.`);
          if (Array.isArray(response.data.data)) {
            if (response.data.data.length === 0) {
              // Nếu trang không có dữ liệu, tăng bộ đếm trang trống
              emptyPagesCount++;
              console.log(`Kaipany: Không có dữ liệu ở trang ${index}, đã gặp ${emptyPagesCount} trang trống.`);
              
              // Chỉ dừng nếu gặp nhiều trang trống liên tiếp
              // Tăng số lượng trang trống cần gặp trước khi dừng lên 5 để đảm bảo không bỏ sót
              // Đôi khi dữ liệu có thể phân bố không đều giữa các trang
              if (emptyPagesCount >= 5) {
                console.log(`Kaipany: Đã gặp ${emptyPagesCount} trang trống liên tiếp, dừng truy vấn.`);
                break;
              }
              
              // Tiếp tục vòng lặp để kiểm tra các trang tiếp theo
              continue;
            }
            
            // Reset bộ đếm trang trống nếu có dữ liệu
            emptyPagesCount = 0;
            rawCheckinData = [...rawCheckinData, ...response.data.data];
            console.log(
              `Kaipany: Đã nhận tổng cộng ${rawCheckinData.length} bản ghi check-in.`
            );
          } else {
            console.warn(
              `Kaipany: Dữ liệu trả về cho placeID ${placeId} không phải mảng hoặc không có.`
            );
            break;
          }
        } else {
          console.error(
            `Kaipany: Lỗi logic từ HANET cho placeID=${placeId}: Mã lỗi ${
              response.data.returnCode
            }, Thông điệp: ${response.data.returnMessage || "N/A"}`
          );
        }
      } else {
        console.error(
          `Kaipany: Response không hợp lệ từ HANET cho placeID=${placeId}:`,
          response.data
        );
      }
    } catch (error) {
      // Cải thiện xử lý lỗi - không dừng truy vấn ngay khi gặp lỗi
      // Thử lại vài lần trước khi bỏ qua
      const maxRetries = 3;
      let retryCount = 0;
      let retrySuccess = false;
      
      if (error.code === "ECONNABORTED") {
        console.error(`Kaipany: Lỗi timeout khi gọi API cho placeID=${placeId}, trang ${index}. Thử lại...`);
      } else if (error.response) {
        console.error(
          `Kaipany: HTTP Error khi gọi API cho placeID=${placeId}, trang ${index}: ${error.response.status} - ${error.response.statusText}. Thử lại...`
        );
      } else {
        console.error(
          `Kaipany: Lỗi không xác định khi gọi API cho placeID=${placeId}, trang ${index}:`,
          error.message,
          '. Thử lại...'
        );
      }
      
      // Chỉ thử lại nếu là lỗi mạng hoặc timeout
      if (error.code === "ECONNABORTED" || (error.response && (error.response.status >= 500 || error.response.status === 429))) {
        while (retryCount < maxRetries && !retrySuccess) {
          try {
            retryCount++;
            console.log(`Kaipany: Đang thử lại lần ${retryCount}/${maxRetries} cho placeID=${placeId}, trang ${index}...`);
            
            // Chờ một khoảng thời gian trước khi thử lại (backoff tăng dần)
            await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
            
            const retryResponse = await axios.post(
              apiUrl,
              qs.stringify(requestData),
              config
            );
            
            if (retryResponse.data && 
                (retryResponse.data.returnCode === 1 || retryResponse.data.returnCode === 0) &&
                Array.isArray(retryResponse.data.data)) {
              
              rawCheckinData = [...rawCheckinData, ...retryResponse.data.data];
              console.log(`Kaipany: Thử lại thành công, đã nhận ${retryResponse.data.data.length} bản ghi.`);
              retrySuccess = true;
            }
          } catch (retryError) {
            console.error(`Kaipany: Thử lại lần ${retryCount} thất bại:`, retryError.message);
          }
        }
      }
      
      // Nếu đã thử lại nhưng vẫn thất bại, chỉ bỏ qua trang này, không dừng toàn bộ quá trình truy vấn
      console.warn(`Kaipany: Bỏ qua trang ${index} do lỗi. Tiếp tục với trang tiếp theo...`);
      continue;
    }
  }

  return rawCheckinData;
}

async function getPlaceList() {
  let accessToken;
  try {
    console.log("Kaipany: Bắt đầu lấy token từ tokenManager...");
    accessToken = await tokenManager.getValidHanetToken();
    console.log("Kaipany: Lấy token thành công, token:", accessToken ? accessToken.substring(0, 10) + '...' : 'null');
  } catch (refreshError) {
    console.error("Kaipany: Không thể lấy được token hợp lệ:", refreshError.message);
    console.error("Kaipany: Chi tiết lỗi:", refreshError.stack);
    throw new Error(`Kaipany: Lỗi xác thực với HANET: ${refreshError.message}`);
  }

  if (!accessToken) {
    console.error("Kaipany: Token trả về từ tokenManager là null hoặc rỗng");
    throw new Error("Kaipany: Không lấy được Access Token hợp lệ.");
  }

  const apiUrl = `${HANET_API_BASE_URL}/place/getPlaces`;
  const requestData = {
    token: accessToken,
  };
  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  };

  try {
    console.log("Kaipany: Đang gọi HANET API để lấy danh sách địa điểm...");
    console.log("Kaipany: URL API:", apiUrl);
    console.log("Kaipany: Request data:", { token: accessToken ? accessToken.substring(0, 10) + '...' : 'null' });
    
    const response = await axios.post(apiUrl, qs.stringify(requestData), config);
    
    console.log("Kaipany: API response status:", response.status);
    console.log("Kaipany: API response returnCode:", response.data?.returnCode);
    
    if (response.data && response.data.returnCode === 1) {
      console.log("Kaipany: Lấy danh sách địa điểm thành công.");
      console.log("Kaipany: Số lượng địa điểm:", Array.isArray(response.data.data) ? response.data.data.length : 'unknown');
      return response.data.data || [];
    } else {
      console.error(
        "Kaipany: Lỗi khi lấy danh sách địa điểm từ HANET:",
        JSON.stringify(response.data)
      );
      throw new Error(
        `Kaipany: Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
      );
    }
  } catch (error) {
    console.error("Kaipany: Lỗi khi gọi API lấy danh sách địa điểm:");
    
    if (error.response) {
      // Lỗi từ phản hồi của server
      console.error("Kaipany: Lỗi từ phản hồi của server:");
      console.error("Kaipany: Status:", error.response.status);
      console.error("Kaipany: Data:", JSON.stringify(error.response.data));
      console.error("Kaipany: Headers:", JSON.stringify(error.response.headers));
    } else if (error.request) {
      // Lỗi không nhận được phản hồi
      console.error("Kaipany: Không nhận được phản hồi từ server:", error.request);
    } else {
      // Lỗi khác
      console.error("Kaipany: Lỗi chung:", error.message);
    }
    console.error("Kaipany: Stack trace:", error.stack);
    
    throw new Error(`Kaipany: Không thể lấy danh sách địa điểm: ${error.message}`);
  }
}

async function getDeviceList(placeId) {
  let accessToken;
  try {
    accessToken = await tokenManager.getValidHanetToken();
  } catch (refreshError) {
    console.error("Kaipany: Không thể lấy được token hợp lệ:", refreshError.message);
    throw new Error(`Kaipany: Lỗi xác thực với HANET: ${refreshError.message}`);
  }

  if (!accessToken) {
    throw new Error("Kaipany: Không lấy được Access Token hợp lệ.");
  }

  const apiUrl = `${HANET_API_BASE_URL}/device/getListDeviceByPlace`;
  const requestData = {
    token: accessToken,
    placeID: placeId,
  };
  const config = {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 10000,
  };

  try {
    console.log(`Kaipany: Đang gọi HANET API để lấy danh sách thiết bị cho placeID=${placeId}...`);
    const response = await axios.post(apiUrl, qs.stringify(requestData), config);
    
    if (response.data && response.data.returnCode === 1) {
      console.log(`Kaipany: Lấy danh sách thiết bị cho placeID=${placeId} thành công.`);
      return response.data.data || [];
    } else {
      console.error(
        `Kaipany: Lỗi khi lấy danh sách thiết bị từ HANET cho placeID=${placeId}:`,
        response.data
      );
      throw new Error(
        `Kaipany: Lỗi từ HANET API: ${response.data?.returnMessage || "Lỗi không xác định"}`
      );
    }
  } catch (error) {
    console.error(
      `Kaipany: Lỗi khi gọi API lấy danh sách thiết bị cho placeID=${placeId}:`,
      error.response?.data || error.message
    );
    throw new Error(`Kaipany: Không thể lấy danh sách thiết bị: ${error.message}`);
  }
}

module.exports = {
  getPeopleListByMethod,
  getPlaceList,
  getDeviceList
};
