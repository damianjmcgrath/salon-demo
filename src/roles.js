export const roles = ["client", "staff", "admin", "accountant"];
export function normalizeRole(value) {
  return roles.includes(value) ? value : null;
}
export function roleHome(role) {
  return ["staff", "admin"].includes(role)
    ? "staff-workspace"
    : role === "accountant"
      ? "reporting-home"
      : "book";
}
export function canAccess(role, view, permissions) {
  if (permissions && ["staff", "admin", "accountant"].includes(role)) {
    const key = {
      diary: "view.diary",
      book: "view.appointments",
      "staff-admin": "view.staff",
      "treatment-management": "view.treatments",
      "permission-management": "view.permissions",
      report: "view.reporting",
      "reporting-home": "view.reporting",
      "reporting-placeholder": "view.reporting",
    }[view];
    if (key) return !!permissions[key];
  }
  if (view === "email-management") return role === "admin";
  if (["login", "recovery"].includes(view)) return true;
  if (view === "book") return ["client", "staff", "admin"].includes(role);
  if (["staff-workspace", "diary"].includes(view))
    return ["staff", "admin"].includes(role);
  if (
    [
      "my-bookings",
      "my-profile",
      "my-vouchers",
      "voucher-purchase",
      "multiple-bookings",
    ].includes(view)
  )
    return role === "client";
  if (["report", "reporting-home", "reporting-placeholder"].includes(view))
    return ["admin", "accountant"].includes(role);
  if (
    ["staff-admin", "treatment-management", "permission-management"].includes(
      view,
    )
  )
    return role === "admin";
  return false;
}
export const roleLabels = {
  client: "Client",
  staff: "Staff",
  admin: "Admin",
  accountant: "Accountant",
};
