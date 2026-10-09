import { useEffect, useState } from "react";
import { api } from "../lib/api";
import CompanyEmailAccounts from "../components/CompanyEmailAccounts";
import {
  getOrganizationAttendanceSettings,
  updateOrganizationAttendanceSettings,
} from "../lib/attendanceEmployeesApi";

export function PasswordForm({ title, endpoint, note }: { title: string; endpoint: string; note: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(""); setSuccess(false);
    if (!current || !next || !confirm) return setError("All fields are required");
    if (next.length < 10) return setError("New password must be at least 10 characters");
    if (next !== confirm) return setError("New passwords don't match");
    if (next === current) return setError("New password must differ from the current one");
    setBusy(true);
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next, confirmPassword: confirm }) });
      setCurrent(""); setNext(""); setConfirm(""); setSuccess(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Password could not be changed");
    } finally { setBusy(false); }
  }

  return (
    <div className="form-card">
      <div className="form-title">{title}</div>
      <p className="detail-label" style={{ marginBottom: 14 }}>{note}</p>
      <div style={{ maxWidth: 400 }}>
        <label className="field-label">Current password</label><input type="password" className="field-input" value={current} onChange={(event) => setCurrent(event.target.value)} />
        <label className="field-label">New password</label><input type="password" className="field-input" value={next} onChange={(event) => setNext(event.target.value)} />
        <label className="field-label">Confirm new password</label><input type="password" className="field-input" value={confirm} onChange={(event) => setConfirm(event.target.value)} onKeyDown={(event) => event.key === "Enter" && submit()} />
      </div>
      {error && <p className="error-text">{error}</p>}{success && <p style={{ color: "var(--fin-positive, #15803D)", fontSize: 14, marginTop: 4 }}>Password changed successfully.</p>}
      <button className="btn-primary" style={{ width: "auto", padding: "0 24px", marginTop: 4 }} onClick={submit} disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
    </div>
  );
}

function AttendanceLocationForm() {
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [radius, setRadius] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fetchingLocation, setFetchingLocation] = useState(false);
  const [fetchedAccuracy, setFetchedAccuracy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getOrganizationAttendanceSettings()
      .then((settings) => {
        setLatitude(settings.officeLatitude === null ? "" : String(settings.officeLatitude));
        setLongitude(settings.officeLongitude === null ? "" : String(settings.officeLongitude));
        setRadius(settings.allowedRadiusMeters === null ? "" : String(settings.allowedRadiusMeters));
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load GPS settings"))
      .finally(() => setLoading(false));
  }, []);

  function fetchCurrentLocation() {
    setError(""); setMessage(""); setFetchedAccuracy(null);
    if (!navigator.geolocation) {
      setError("This browser does not support location access. Enter the office coordinates manually.");
      return;
    }
    setFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude: fetchedLatitude, longitude: fetchedLongitude, accuracy } = position.coords;
        if (!Number.isFinite(fetchedLatitude) || fetchedLatitude < -90 || fetchedLatitude > 90
          || !Number.isFinite(fetchedLongitude) || fetchedLongitude < -180 || fetchedLongitude > 180) {
          setError("The browser returned invalid coordinates. Enter the office coordinates manually.");
          setFetchingLocation(false);
          return;
        }
        setLatitude(fetchedLatitude.toFixed(7));
        setLongitude(fetchedLongitude.toFixed(7));
        setFetchedAccuracy(Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null);
        setMessage("Location fetched. Review the coordinates and radius, then click Save attendance location.");
        setFetchingLocation(false);
      },
      (locationError) => {
        const messages: Record<number, string> = {
          1: "Location permission was denied. Allow access or enter the office coordinates manually.",
          2: "The current location is unavailable. Try again or enter the coordinates manually.",
          3: "The location request timed out. Try again or enter the coordinates manually.",
        };
        setError(messages[locationError.code] ?? "The current location could not be fetched. Enter the coordinates manually.");
        setFetchingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function save() {
    setError(""); setMessage("");
    const emptyCount = [latitude, longitude, radius].filter((value) => value.trim() === "").length;
    if (emptyCount !== 0 && emptyCount !== 3) return setError("Latitude, longitude, and radius must be configured together");
    const officeLatitude = emptyCount === 3 ? null : Number(latitude);
    const officeLongitude = emptyCount === 3 ? null : Number(longitude);
    const allowedRadiusMeters = emptyCount === 3 ? null : Number(radius);
    if (officeLatitude !== null && (!Number.isFinite(officeLatitude) || officeLatitude < -90 || officeLatitude > 90)) return setError("Latitude must be between -90 and 90");
    if (officeLongitude !== null && (!Number.isFinite(officeLongitude) || officeLongitude < -180 || officeLongitude > 180)) return setError("Longitude must be between -180 and 180");
    if (allowedRadiusMeters !== null && (!Number.isFinite(allowedRadiusMeters) || allowedRadiusMeters <= 0 || allowedRadiusMeters > 100000)) return setError("Allowed radius must be greater than 0 and no more than 100,000 metres");
    setBusy(true);
    try {
      const saved = await updateOrganizationAttendanceSettings({ officeLatitude, officeLongitude, allowedRadiusMeters });
      setLatitude(saved.officeLatitude === null ? "" : String(saved.officeLatitude));
      setLongitude(saved.officeLongitude === null ? "" : String(saved.officeLongitude));
      setRadius(saved.allowedRadiusMeters === null ? "" : String(saved.allowedRadiusMeters));
      setMessage(saved.officeLatitude === null ? "Office GPS configuration cleared." : "Office GPS configuration saved.");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save GPS settings"); }
    finally { setBusy(false); }
  }

  return (
    <div className="form-card attendance-location-form">
      <div className="form-title">Organization attendance location</div>
      <p className="detail-label">GPS / Office employees must be inside this server-validated radius when checking in. Coordinates are organization-wide and are not used for continuous tracking.</p>
      {loading ? <p className="attendance-empty">Loading attendance location…</p> : (
        <div className="attendance-location-grid">
          <label><span className="field-label">Office latitude</span><input className="field-input" type="number" min="-90" max="90" step="0.0000001" placeholder="e.g. 31.5204000" value={latitude} onChange={(event) => { setLatitude(event.target.value); setFetchedAccuracy(null); }} /></label>
          <label><span className="field-label">Office longitude</span><input className="field-input" type="number" min="-180" max="180" step="0.0000001" placeholder="e.g. 74.3587000" value={longitude} onChange={(event) => { setLongitude(event.target.value); setFetchedAccuracy(null); }} /></label>
          <label><span className="field-label">Allowed radius (metres)</span><input className="field-input" type="number" min="0.01" max="100000" step="0.01" placeholder="e.g. 100" value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
          <div className="attendance-location-fetch"><button className="btn-ghost" type="button" disabled={busy || fetchingLocation} onClick={fetchCurrentLocation}>{fetchingLocation ? "Fetching location…" : "Fetch Current Location"}</button><span>Fetching only fills latitude and longitude. It does not save or change the allowed radius.</span></div>
          {fetchedAccuracy !== null && <p className="attendance-location-accuracy">Location fetched successfully. Accuracy: approximately {Math.round(fetchedAccuracy)} metres.</p>}
          <div className="attendance-location-actions"><button className="btn-primary" disabled={busy || fetchingLocation} onClick={save}>{busy ? "Saving…" : "Save attendance location"}</button><button className="btn-sm" disabled={busy || fetchingLocation} onClick={() => { setLatitude(""); setLongitude(""); setRadius(""); setFetchedAccuracy(null); setMessage("Save the blank form to clear the configuration, or fill all three fields."); }}>Clear fields</button></div>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}{message && <p className="attendance-action-success">{message}</p>}
    </div>
  );
}

export default function Settings({ role }: { role: string }) {
  return (
    <div className="content">
      <h1 className="page-title" style={{ marginBottom: 20 }}>Settings</h1>
      <AttendanceLocationForm />
      {(role === "admin" || role === "super_admin") && <CompanyEmailAccounts />}
      <PasswordForm title="Change login password" endpoint="/api/settings/change-login-password" note="This is the password you use to sign in to the portal." />
      {role === "super_admin" && <PasswordForm title="Change Super Password" endpoint="/api/settings/change-super-password" note="This password protects sensitive operations and employee-to-Admin promotion. Verification authorizes protected actions for 10 minutes in the current session." />}
    </div>
  );
}
