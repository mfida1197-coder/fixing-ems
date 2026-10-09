import { ATTENDANCE_TIME_ZONE } from "./types";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function workDateForInstant(
  instant: Date,
  timeZone: string = ATTENDANCE_TIME_ZONE,
): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("A valid instant is required");
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function toUtcSqlDateTime(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("A valid instant is required");
  }
  return instant.toISOString().replace("T", " ").replace("Z", "");
}
