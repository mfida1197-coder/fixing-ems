import { useEffect, useState } from "react";
import { api } from "../lib/api";
import EmployeeLetters from "./EmployeeLetters";

type LetterEmployee = { id: number; employee_code: string; full_name: string; designation: string; joining_date: string; assigned_project: string | null };

export default function EmployeeLetterManagement() {
  const [employees, setEmployees] = useState<LetterEmployee[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<{ employees: LetterEmployee[] }>("/api/employees").then((result) => setEmployees(result.employees)).catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load employees")); }, []);
  const employee = employees.find((item) => item.id === selectedId) ?? null;
  return <section className="requests-panel"><div className="content-head"><div><h2>Employee Letters</h2><p className="page-sub">Select an employee to compose or download official letters.</p></div><select className="field-input request-employee-filter" value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value ? Number(event.target.value) : null)}><option value="">Select employee…</option>{employees.map((item) => <option key={item.id} value={item.id}>{item.employee_code} · {item.full_name}</option>)}</select></div>{error && <p className="error-text">{error}</p>}{employee ? <EmployeeLetters employee={employee} /> : <div className="empty-note">Choose an employee to manage official letters.</div>}</section>;
}
