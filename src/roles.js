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
export function canAccess(role, view) {
  if (["login", "recovery"].includes(view)) return true;
  if (view === "book") return ["client", "staff", "admin"].includes(role);
  if (["staff-workspace", "diary"].includes(view))
    return ["staff", "admin"].includes(role);
  if (view === "my-bookings") return role === "client";
  if (["report", "reporting-home", "reporting-placeholder"].includes(view))
    return ["admin", "accountant"].includes(role);
  if (view === "staff-admin") return role === "admin";
  return false;
}
export const roleLabels = {
  client: "Client",
  staff: "Staff",
  admin: "Admin",
  accountant: "Accountant",
};
