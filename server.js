/* =====================================================
   TACTIC MOCK BACKEND (SIMULATION ONLY)

   Purpose:
   This is NOT the real TACTIC backend. It's a tiny
   stand-in server that mirrors the two endpoints the
   firmware calls (device-bootstrap and tactic), so that
   firmware logic (timer restore, LED colors, OLED
   screens, button/key handling) can be tested inside
   Wokwi, where the real Netlify backend's TLS setup
   is not compatible with Wokwi's simulated network.

   Data is stored in memory only. Restarting the server
   wipes everything. There is no real security here -
   never point your real ESP32-C3 device at this server,
   and never reuse this for production.
===================================================== */

const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// In-memory "database"
const devices = {};
// devices[hardwareId] = {
//   deviceId, deviceToken, focusMinutes,
//   session: { startedAt, expiresAt } | null
// }

let deviceCounter = 1;

function newDeviceId() {
  const id = "MOCK-" + String(deviceCounter).padStart(6, "0");
  deviceCounter++;
  return id;
}

function newToken() {
  return "MOCKTOKEN-" + crypto.randomBytes(24).toString("hex");
}

function findDeviceByToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  return Object.values(devices).find(d => d.deviceToken === token) || null;
}

/* =====================================================
   POST /device-bootstrap
   body: { hardwareId }
===================================================== */
app.post("/device-bootstrap", (req, res) => {
  const hardwareId = req.body.hardwareId;

  if (!hardwareId) {
    return res.status(400).json({ error: "hardwareId required" });
  }

  let device = devices[hardwareId];

  if (!device) {
    device = {
      hardwareId,
      deviceId: newDeviceId(),
      deviceToken: newToken(),
      focusMinutes: 45,
      session: null
    };
    devices[hardwareId] = device;
    console.log("Bootstrapped new device:", device.deviceId);
  }

  return res.status(200).json({
    success: true,
    message: "DEVICE_BOOTSTRAPPED",
    device: {
      deviceId: device.deviceId,
      status: device.session ? "focus" : "active"
    },
    deviceToken: device.deviceToken
  });
});

/* =====================================================
   GET /tactic
   header: Authorization: Bearer <token>
===================================================== */
app.get("/tactic", (req, res) => {
  const device = findDeviceByToken(req.headers.authorization);

  if (!device) {
    return res.status(401).json({ error: "invalid token" });
  }

  let sessionView = null;

  if (device.session) {
    const now = Date.now();
    const expiresAtMs = new Date(device.session.expiresAt).getTime();
    const startedAtMs = new Date(device.session.startedAt).getTime();

    sessionView = {
      startedAt: device.session.startedAt,
      expiresAt: device.session.expiresAt,
      expired: expiresAtMs <= now,
      remainingSeconds: Math.max(0, Math.ceil((expiresAtMs - now) / 1000)),
      durationSeconds: Math.round((expiresAtMs - startedAtMs) / 1000)
    };
  }

  return res.status(200).json({
    success: true,
    deviceId: device.deviceId,
    focusMinutes: device.focusMinutes,
    session: sessionView
  });
});

/* =====================================================
   POST /tactic
   header: Authorization: Bearer <token>
   body: { action: "start" | "complete", durationMinutes? }
===================================================== */
app.post("/tactic", (req, res) => {
  const device = findDeviceByToken(req.headers.authorization);

  if (!device) {
    return res.status(401).json({ error: "invalid token" });
  }

  const action = req.body.action;

  if (action === "start") {
    const minutes = Number(req.body.durationMinutes) || device.focusMinutes || 45;

    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + minutes * 60 * 1000);

    device.session = {
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    console.log(`${device.deviceId}: focus started (${minutes} min)`);

    return res.status(200).json({
      success: true,
      action: "start",
      deviceId: device.deviceId,
      focusMinutes: minutes,
      durationSeconds: minutes * 60,
      expiresAt: expiresAt.toISOString()
    });
  }

  if (action === "complete") {
    device.session = null;

    console.log(`${device.deviceId}: focus completed`);

    return res.status(200).json({
      success: true,
      action: "complete",
      deviceId: device.deviceId
    });
  }

  if (action === "setDuration") {
    const minutes = Number(req.body.durationMinutes);

    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      return res.status(400).json({ error: "durationMinutes must be 1-240" });
    }

    device.focusMinutes = minutes;

    return res.status(200).json({
      success: true,
      action: "setDuration",
      deviceId: device.deviceId,
      focusMinutes: minutes
    });
  }

  return res.status(400).json({ error: "unknown action" });
});

/* =====================================================
   Health check
===================================================== */
app.get("/", (req, res) => {
  res.status(200).send("TACTIC mock backend is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("TACTIC mock backend listening on port " + PORT);
});
