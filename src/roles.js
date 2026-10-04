export const roles = ["client", "staff", "admin", "accountant", "it_support"];
export function normalizeRole(value) {
  return roles.includes(value) ? value : null;
}
export function roleHome(role) {
  return role === "staff"
    ? "diary"
    : role === "accountant"
      ? "report"
      : ["admin", "it_support"].includes(role)
        ? "workspace"
        : "my-bookings";
}
export function canAccess(role, view) {
  if (["login", "recovery"].includes(view)) return true;
  if (view === "book") return !role || role === "client";
  if (view === "my-bookings") return role === "client";
  if (view === "diary") return ["staff", "admin", "it_support"].includes(role);
  if (view === "report")
    return ["admin", "accountant", "it_support"].includes(role);
  if (view === "workspace") return ["admin", "it_support"].includes(role);
  return false;
}
export const roleLabels = {
  client: "Client",
  staff: "Staff",
  admin: "Owner / Admin",
  accountant: "Accountant",
  it_support: "IT Support",
};
