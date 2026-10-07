export const viewPermissions = [
  ["view.appointments", "Appointment Management"],
  ["view.clients", "Client Management"],
  ["view.diary", "Staff Diary"],
  ["view.vouchers", "Voucher Management"],
  ["view.staff", "Staff Management"],
  ["view.reporting", "Reporting"],
  ["view.permissions", "Permission Management"],
  ["view.treatments", "Treatment Management"],
] as const;
export const actionPermissions = [
  ["perform.own_breaks", "Can Create Own Breaks"],
  ["perform.discounts", "Can Offer Discounts"],
  ["perform.waive_fees", "Can Waive No Show Fees"],
  ["perform.credit_notes", "Can Add Credit Notes"],
] as const;
export type Permissions = Record<string, boolean>;
export function defaultPermissions(role: string): Permissions {
  return Object.fromEntries(
    [...viewPermissions, ...actionPermissions].map(([key]) => [
      key,
      role === "admin" ||
        (role === "accountant"
          ? key === "view.reporting"
          : role === "staff" &&
            [
              "view.appointments",
              "view.clients",
              "view.diary",
              "view.vouchers",
              "perform.own_breaks",
              "perform.waive_fees",
              "perform.credit_notes",
            ].includes(key)),
    ]),
  );
}
