import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import type { RequestHandler } from "express";
import { pool } from "../db";
import type { AuthedRequest } from "../middleware/auth";

const directory = path.resolve(process.cwd(), "uploads", "transactions");
const types: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 16000 }, fileFilter: (_req, file, cb) => {
  if (types[path.extname(file.originalname).toLowerCase()] !== file.mimetype) return cb(new Error("Unsupported attachment"));
  cb(null, true);
} }).single("attachment");
export const parseRequirementAttachment: RequestHandler = (req, res, next) => upload(req, res, (error) => {
  if (error) return res.status(400).json({ error: "Use PDF, JPG, PNG or WEBP, maximum 10 MB." });
  next();
});
export function storeRequirementAttachment(file?: Express.Multer.File) {
  if (!file) return null;
  const b = file.buffer;
  const valid = file.mimetype === "application/pdf" ? b.subarray(0, 5).toString() === "%PDF-"
    : file.mimetype === "image/jpeg" ? b[0] === 255 && b[1] === 216 && b[2] === 255
    : file.mimetype === "image/png" ? b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP";
  if (!valid) throw new Error("Attachment content does not match its type");
  fs.mkdirSync(directory, { recursive: true });
  const filename = `requirement-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
  fs.writeFileSync(path.join(directory, filename), b, { flag: "wx" });
  return { filename, name: path.basename(file.originalname).slice(0, 255), mime: file.mimetype, size: file.size };
}
export function removeRequirementAttachment(filename: string) { fs.rmSync(path.join(directory, path.basename(filename)), { force: true }); }
export const streamRequirementAttachment: RequestHandler = async (request, res, next) => {
  const req = request as AuthedRequest;
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid requirement" });
  const user = req.user!;
  let access: string;
  let identity: number;
  if (user.role === "client") { access = "p.client_id = ? AND pr.client_id = p.client_id"; identity = user.client_id || 0; }
  else if (user.mode === "employee") { access = "p.status <> 'handed_over' AND p.handover_date IS NULL AND EXISTS (SELECT 1 FROM project_assignments pa JOIN employees e ON e.id = pa.employee_id WHERE pa.project_id = p.id AND pa.removed_at IS NULL AND e.id = (SELECT employee_id FROM users WHERE id = ?))"; identity = user.id; }
  else if (user.role === "admin" || user.role === "super_admin") { access = "? > 0"; identity = user.id; }
  else return res.status(403).json({ error: "Forbidden" });
  try {
    const [rows] = await pool.execute(`SELECT pr.attachment_path, pr.attachment_name FROM project_requirements pr JOIN projects p ON p.id = pr.project_id WHERE pr.id = ? AND ${access} LIMIT 1`, [id, identity]);
    const item = (rows as Array<{ attachment_path: string | null; attachment_name: string | null }>)[0];
    if (!item?.attachment_path) return res.status(404).json({ error: "Attachment not found" });
    const filename = path.basename(item.attachment_path);
    const fullPath = path.join(directory, filename);
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.download(fullPath, item.attachment_name || filename, (error) => { if (error && !res.headersSent) next(error); });
  } catch (error) { next(error); }
};
