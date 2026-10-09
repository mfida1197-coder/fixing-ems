import express from "express";
import { createServer } from "http";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./routes/auth";
import securityRoutes from "./routes/security";
import employeeRoutes from "./routes/employees";
import clientRoutes from "./routes/clients";
import projectRoutes from "./routes/projects";
import financeRoutes from "./routes/finance";
import dashboardRoutes from "./routes/dashboard";
import settingsRoutes from "./routes/settings";
import reportRoutes from "./routes/reports";
import attendanceRoutes from "./routes/attendance";
import leaveRoutes from "./routes/leaves";
import holidayRoutes from "./routes/holidays";
import passwordResetRoutes from "./routes/passwordResets";
import employeeLetterRoutes from "./routes/employeeLetters";
import applicationRoutes from "./routes/applications";
import clientPortalRoutes from "./routes/clientPortal";
import emailRoutes from "./routes/email";
import requestNotificationRoutes from "./routes/requestNotifications";
import { pool } from "./db";
import { finalizeAllPastAttendanceStatuses, finalizeAttendanceStatusRange } from "./attendance/finalization";
import { addDays } from "./attendance/calculations";
import { ATTENDANCE_TIME_ZONE } from "./attendance/types";
import { workDateForInstant } from "./attendance/time";

dotenv.config();

// Safety net — logs instead of crashing the process
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const app = express();
app.set("trust proxy", 1);

/**
 * CORS
 * CORS_ORIGIN is a comma-separated list, e.g.
 *   https://ashtechportal.com,https://www.ashtechportal.com,https://ashtech-ems.onrender.com
 * Trailing slashes are stripped so a typo in the env var doesn't break production.
 */
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn("[cors] CORS_ORIGIN is not set — all browser origins will be blocked.");
} else {
  console.log("[cors] Allowed origins:", allowedOrigins.join(", "));
}

app.use(
  cors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void
    ) => {
      // No Origin header: curl, Postman, server-to-server, health checks
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
  })
);

app.use(express.json({ limit: "1mb" }));

const httpServer = createServer(app);

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: "ashtech-ems" })
);

app.use("/api/security", securityRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/client-portal", clientPortalRoutes);
app.use("/api/password-resets", passwordResetRoutes);

app.use("/api/employees", employeeRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/employee-letters", employeeLetterRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/request-notifications", requestNotificationRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    // Surface CORS rejections clearly instead of burying them in a 500
    if (typeof err?.message === "string" && err.message.startsWith("Origin not allowed")) {
      console.warn("[cors] Blocked:", err.message);
      return res.status(403).json({ error: err.message });
    }
    console.error("Express error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
);

const port = Number(process.env.PORT || 4000);
httpServer.listen(port, () => console.log(`EMS backend running on :${port}`));

async function finalizeAttendanceDatesOnServer(): Promise<void> {
  const now = new Date();
  const yesterday = addDays(workDateForInstant(now, ATTENDANCE_TIME_ZONE), -1);
  await finalizeAttendanceStatusRange(pool, yesterday, yesterday, now);
}

void finalizeAllPastAttendanceStatuses(pool).catch((error) => {
  console.error("[attendance] Initial date-status finalization failed:", error);
});
setInterval(() => {
  void finalizeAttendanceDatesOnServer().catch((error) => {
    console.error("[attendance] Scheduled date-status finalization failed:", error);
  });
}, 60 * 60 * 1000);
