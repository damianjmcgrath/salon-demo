import type { LocalStaffData, Client, Voucher } from "./domain";
export function localClient(data: LocalStaffData): Client {
  return (
    data.clients.find((c) => c.auth_user_id === "local-client") || {
      id: "demo-self",
      auth_user_id: "local-client",
      name: "Demo Client",
      email: "client@example.com",
      phone: "0800000000",
      revision: 0,
      marketing_email: false,
      marketing_sms: false,
      marketing_whatsapp: false,
    }
  );
}
export function assignedVouchers(data: LocalStaffData, email: string) {
  return (data.vouchers || []).filter(
    (v) =>
      (
        v.recipient_email ||
        data.clients.find((c) => c.id === v.client_id)?.email ||
        ""
      ).toLowerCase() === email.toLowerCase(),
  );
}
export const euro = (n: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(
    n,
  );
export function expiryDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return d.toISOString().slice(0, 10);
}
export function voucherCode(vouchers: Voucher[]) {
  let code = "";
  do {
    code =
      "SC-" +
      crypto
        .randomUUID()
        .replaceAll("-", "")
        .slice(0, 12)
        .toUpperCase()
        .match(/.{4}/g)!
        .join("-");
  } while (vouchers.some((v) => v.code === code));
  return code;
}
