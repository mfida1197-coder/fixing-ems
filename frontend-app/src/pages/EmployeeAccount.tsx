import { PasswordForm } from "./Settings";

export default function EmployeeAccount() {
  return <main className="content"><div className="content-head"><div><h1 className="page-title">My Account</h1><p className="page-sub">Update your authenticated EMS login password.</p></div></div><PasswordForm title="Change login password" endpoint="/api/settings/change-login-password" note="Enter your current password to securely choose a new one." /></main>;
}
