import type { AttendanceMode } from "../types/attendance";

function normalise(value: string) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function StatusBadge({ value, label }: { value: string; label?: string }) {
  return <span className={`ui-badge ui-badge-${normalise(value)}`}>{label ?? value.replace(/_/g, " ")}</span>;
}

export function AttendanceModeBadge({ mode }: { mode: AttendanceMode | null | undefined }) {
  const resolved = mode ?? "remote";
  return (
    <span className={`ui-badge attendance-mode-badge attendance-mode-${resolved}`}>
      <span className="ui-badge-dot" aria-hidden="true" />
      {resolved === "gps" ? "GPS / Office" : "Remote"}
    </span>
  );
}
