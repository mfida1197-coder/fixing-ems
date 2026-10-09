import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const KEY = Buffer.from(process.env.ENCRYPTION_KEY as string, "hex"); // 32 bytes = AES-256

export function encrypt(plainText: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]); // iv(12) + tag(16) + ciphertext
}

export function decrypt(data: Buffer): string {
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskCnic(last4: string | null): string {
  return last4 ? `*****-*******-${last4.slice(-1)}` : "—";
}

export function maskBank(last4: string | null): string {
  return last4 ? `****${last4}` : "—";
}