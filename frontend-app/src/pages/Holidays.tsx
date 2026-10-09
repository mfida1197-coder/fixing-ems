import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createHoliday, deleteHoliday, getHolidays, updateHoliday } from "../lib/leaveApi";
import { ApiError } from "../lib/api";
import type { Holiday } from "../types/leave";

type HolidayFilter = "all" | "upcoming" | "past";

function todayKey(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "HOLIDAY_DATE_EXISTS") return "A holiday is already configured for that date.";
    if (error.code === "HOLIDAY_NOT_FOUND") return "That holiday no longer exists. The list has been refreshed.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Holiday management request failed.";
}

export default function Holidays() {
  const today = todayKey();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [filter, setFilter] = useState<HolidayFilter>("all");
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [holidayDate, setHolidayDate] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const response = await getHolidays();
    setHolidays(response.holidays);
  }, []);

  useEffect(() => {
    load().catch((loadError: unknown) => setError(errorMessage(loadError))).finally(() => setLoading(false));
  }, [load]);

  const filtered = useMemo(() => holidays.filter((holiday) => {
    if (filter === "upcoming") return holiday.holidayDate >= today;
    if (filter === "past") return holiday.holidayDate < today;
    return true;
  }), [filter, holidays, today]);

  function resetForm() {
    setEditing(null);
    setHolidayDate("");
    setName("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (!holidayDate || !name.trim()) return setError("Holiday date and name are required.");
    if (!editing && holidayDate < todayKey()) return setError("New holidays cannot be created before today.");
    setSubmitting(true);
    try {
      if (editing) {
        await updateHoliday(editing.id, { holidayDate, name: name.trim() });
        setSuccess("Holiday updated. Employee calendars will reflect the new details when refreshed.");
      } else {
        await createHoliday({ holidayDate, name: name.trim() });
        setSuccess("Holiday added. Employee calendars will reflect it when refreshed.");
      }
      resetForm();
      await load();
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  function beginEdit(holiday: Holiday) {
    setEditing(holiday);
    setHolidayDate(holiday.holidayDate);
    setName(holiday.name);
    setError("");
    setSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function remove(holiday: Holiday) {
    if (!window.confirm(`Delete “${holiday.name}” on ${displayDate(holiday.holidayDate)}? The date will return to a normal working day.`)) return;
    setDeletingId(holiday.id);
    setError("");
    setSuccess("");
    try {
      await deleteHoliday(holiday.id);
      if (editing?.id === holiday.id) resetForm();
      await load();
      setSuccess("Holiday deleted. The date is no longer treated as a holiday.");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
      await load().catch(() => undefined);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="content leave-page holiday-page">
      <div className="leave-page-head">
        <div>
          <h1 className="page-title">Holiday Management</h1>
          <p className="page-sub">Every day, including weekends, remains a working day unless explicitly configured here.</p>
        </div>
      </div>

      <section className="leave-form-card holiday-form-card">
        <div className="leave-section-heading">
          <p className="attendance-kicker">{editing ? "Edit holiday" : "Add holiday"}</p>
          <h2>{editing ? "Update configured holiday" : "Declare a company holiday"}</h2>
          <p>Only the date and holiday name are stored by the approved schema.</p>
        </div>
        <form className="holiday-form" onSubmit={submit}>
          <label>Date<input className="field-input" type="date" min={editing ? undefined : todayKey()} value={holidayDate} onChange={(event) => setHolidayDate(event.target.value)} required /></label>
          <label>Holiday name<input className="field-input" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Company Foundation Day" required /></label>
          <div className="holiday-form-actions">
            {editing && <button className="btn-ghost" type="button" onClick={resetForm}>Cancel</button>}
            <button className="btn-primary" type="submit" disabled={submitting}>{submitting ? "Saving…" : editing ? "Save changes" : "Add holiday"}</button>
          </div>
        </form>
        {error && <p className="attendance-action-error">{error}</p>}
        {success && <p className="attendance-success">{success}</p>}
      </section>

      <section className="leave-list-section">
        <div className="holiday-list-head">
          <div className="leave-section-heading">
            <p className="attendance-kicker">Configured holidays</p>
            <h2>{holidays.length} declared date{holidays.length === 1 ? "" : "s"}</h2>
          </div>
          <div className="holiday-filter-pills">
            {(["all", "upcoming", "past"] as HolidayFilter[]).map((value) => (
              <button type="button" key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
                {value[0].toUpperCase()}{value.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? <p className="attendance-loading">Loading holidays…</p> : filtered.length === 0 ? (
          <div className="leave-empty"><strong>No holidays found</strong><span>No day receives automatic holiday status.</span></div>
        ) : (
          <div className="holiday-list">
            {filtered.map((holiday) => {
              const timing = holiday.holidayDate === today ? "Today" : holiday.holidayDate > today ? "Upcoming" : "Past";
              return (
                <article className="holiday-row" key={holiday.id}>
                  <div className="holiday-date-tile"><strong>{holiday.holidayDate.slice(-2)}</strong><span>{displayDate(holiday.holidayDate).split(" ")[1]}</span></div>
                  <div className="holiday-row-copy"><strong>{holiday.name}</strong><span>{displayDate(holiday.holidayDate)} · {timing}</span></div>
                  <div className="holiday-row-actions">
                    <button className="btn-sm" type="button" onClick={() => beginEdit(holiday)}>Edit</button>
                    <button className="btn-ghost holiday-delete-btn" type="button" disabled={deletingId === holiday.id} onClick={() => remove(holiday)}>
                      {deletingId === holiday.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
