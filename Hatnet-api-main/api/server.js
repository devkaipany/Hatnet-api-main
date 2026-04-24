// server.js
const express = require("express");
const cors = require("cors");
const path = require("path");

const { createTokenManager } = require("./tokenManagerFactory");
const { createHanetService } = require("./hanetServiceFactory");

// ─── Load tenant registry ────────────────────────────────────────────────────
const tenantsConfig = require("./tenants.json");

// Khởi tạo service cho từng tenant đang active
const tenantServices = {};

for (const tenant of tenantsConfig.tenants) {
  if (!tenant.active) {
    console.log(`[TENANT] Bỏ qua tenant "${tenant.id}" (active: false)`);
    continue;
  }

  // Đọc thẳng từ tenants.json — không cần env var
  const config = {
    tenantId:        tenant.id,
    tokenUrl:        tenant.tokenUrl        || "https://oauth.hanet.com/token",
    clientId:        tenant.clientId,
    clientSecret:    tenant.clientSecret,
    refreshToken:    tenant.refreshToken,
    hanetApiBaseUrl: tenant.hanetApiBaseUrl || "https://partner.hanet.ai",
  };

  const tokenManager = createTokenManager(config);
  const hanetService = createHanetService({
    tenantId: config.tenantId,
    hanetApiBaseUrl: config.hanetApiBaseUrl,
    tokenManager,
  });

  tenantServices[tenant.routePrefix] = { tenant, hanetService };
  console.log(`[TENANT] Đã khởi tạo "${tenant.id}" (route: /${tenant.routePrefix}) — ${config.clientId ? config.clientId.slice(0,8)+"..." : "⚠️ thiếu clientId"}`);
}


// ─── Express setup ───────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: [
      "https://client-i1vo1qjv7-fugboizzs-projects.vercel.app",
      "http://localhost:3000",
      "https://hatnet-frontend.vercel.app",
      "https://hatnet-frontend-iota.vercel.app",
    ],
  })
);
app.use(express.json());

// Middleware logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// ─── Health check ─────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  const activeRoutes = Object.keys(tenantServices)
    .map((prefix) => `/${prefix}`)
    .join(", ");
  res.send(`API Server is running! Available routes: ${activeRoutes}`);
});

// ─── Middleware validate tham số checkin ──────────────────────────────────────

function validateCheckinParams(req, res, next) {
  const { placeId, dateFrom, dateTo } = req.query;

  if (!placeId) {
    return res.status(400).json({ success: false, message: "Thiếu tham số bắt buộc: placeId" });
  }
  if (!dateFrom) {
    return res.status(400).json({ success: false, message: "Thiếu tham số bắt buộc: dateFrom" });
  }
  if (!dateTo) {
    return res.status(400).json({ success: false, message: "Thiếu tham số bắt buộc: dateTo" });
  }

  const fromTimestamp = parseInt(dateFrom, 10);
  const toTimestamp = parseInt(dateTo, 10);

  if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
    return res.status(400).json({
      success: false,
      message: "dateFrom và dateTo phải là millisecond timestamp hợp lệ.",
    });
  }
  if (fromTimestamp > toTimestamp) {
    return res.status(400).json({
      success: false,
      message: "Thời gian bắt đầu không được muộn hơn thời gian kết thúc.",
    });
  }

  req.validatedParams = {
    placeId,
    fromTimestamp,
    toTimestamp,
    devices: req.query.devices,
  };
  next();
}

// ─── Tự động đăng ký route cho từng tenant ────────────────────────────────────

for (const [routePrefix, { tenant, hanetService }] of Object.entries(tenantServices)) {
  const base = `/${routePrefix}`;

  // Health check tenant
  app.get(base, (req, res) => {
    res.send(`${tenant.id} API Server is running!`);
  });

  // Danh sách địa điểm
  app.get(`${base}/place`, async (req, res, next) => {
    try {
      const placeData = await hanetService.getPlaceList();
      res.status(200).json({ success: true, data: placeData });
    } catch (error) {
      next(error);
    }
  });

  // Danh sách thiết bị theo địa điểm
  app.get(`${base}/device`, async (req, res, next) => {
    try {
      const placeId = req.query.placeId;
      if (!placeId) {
        return res.status(400).json({ success: false, message: "Thiếu tham số bắt buộc: placeId" });
      }
      const deviceData = await hanetService.getDeviceList(placeId);
      res.status(200).json({ success: true, data: deviceData });
    } catch (error) {
      next(error);
    }
  });

  // Dữ liệu checkin theo khoảng thời gian
  app.get(`${base}/checkins`, validateCheckinParams, async (req, res, next) => {
    try {
      const { placeId, fromTimestamp, toTimestamp, devices } = req.validatedParams;

      console.log(
        `[${new Date().toISOString()}] ${routePrefix}: Lấy checkin placeId=${placeId}, từ=${fromTimestamp}, đến=${toTimestamp}, devices=${devices || "Tất cả"}`
      );

      const filteredCheckins = await hanetService.getPeopleListByMethod(
        placeId,
        fromTimestamp,
        toTimestamp,
        devices
      );

      console.log(
        `[${new Date().toISOString()}] ${routePrefix}: Trả về ${
          Array.isArray(filteredCheckins) ? filteredCheckins.length : "?"
        } checkin.`
      );

      res.status(200).json(filteredCheckins);
    } catch (err) {
      next(err);
    }
  });

  console.log(`[ROUTES] Đã đăng ký: GET ${base}, ${base}/place, ${base}/device, ${base}/checkins`);
}

// ─── Error handling ───────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error(`Lỗi trong route ${req.path}:`, err.message);
  console.error(err.stack);

  if (
    err.message &&
    (err.message.includes("Lỗi xác thực") || err.message.includes("HANET Error 401"))
  ) {
    return res.status(401).json({ success: false, message: "Lỗi xác thực với HANET API" });
  }

  if (err.message && err.message.includes("place not found")) {
    return res.status(404).json({ success: false, message: "Không tìm thấy địa điểm" });
  }

  if (err.message && err.message.includes("Lỗi từ HANET API")) {
    return res.status(502).json({
      success: false,
      message: "Lỗi từ HANET API khi lấy dữ liệu",
      error: process.env.NODE_ENV === "production" ? undefined : err.message,
    });
  }

  res.status(500).json({
    success: false,
    message: "Lỗi máy chủ nội bộ",
    error: process.env.NODE_ENV === "production" ? undefined : err.message,
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────

if (process.env.PORT !== "production") {
  app.listen(PORT, () => {
    console.log(`\nServer đang lắng nghe trên cổng ${PORT}`);
    console.log(`Truy cập tại: http://localhost:${PORT}`);
    console.log(`\nCác route đang hoạt động:`);
    for (const routePrefix of Object.keys(tenantServices)) {
      console.log(`  /${routePrefix}  |  /${routePrefix}/place  |  /${routePrefix}/device  |  /${routePrefix}/checkins`);
    }
    console.log();
  });
}

module.exports = app;
