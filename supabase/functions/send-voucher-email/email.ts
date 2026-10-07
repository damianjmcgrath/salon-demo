export function voucherPayload(s: Record<string, any>, from: string) {
  const escape = (v: unknown) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const money = (v: unknown) =>
    new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: "EUR",
    }).format(Number(v));
  const expiry = String(s.expires_on).split("-").reverse().join("/");
  const lines = [
    "Your Sculpted by Aoife Clare Gift Voucher",
    `Voucher ID: ${s.code}`,
    `Voucher Amount: ${money(s.original_amount)}`,
    `Remaining Value: ${money(s.balance)}`,
    `For: ${s.assigned_client_name || "Unassigned"}`,
    `Valid Through: ${expiry}`,
  ];
  return {
    from,
    to: ["damianjmcgrath@gmail.com"],
    subject: "Your Sculpted Gift Voucher",
    text: lines.join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f7f4ef;font-family:Arial,sans-serif;color:#292924"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" style="max-width:100%;background:white;border:1px solid #dfd8cb"><tr><td style="padding:36px;text-align:center"><p style="letter-spacing:3px;font-size:12px">SCULPTED BY AOIFE CLARE</p><h1 style="font-family:Georgia,serif;font-weight:normal">Gift Voucher</h1><h2>${escape(money(s.original_amount))}</h2><p style="font-size:22px;font-weight:bold">${escape(s.code)}</p><p>For: ${escape(s.assigned_client_name || "Unassigned")}</p><p>Remaining value: ${escape(money(s.balance))}</p><p>Valid through: ${escape(expiry)}</p><p style="margin-top:32px">Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30</p><p style="font-size:12px;color:#777">Please bring this voucher code to the salon.</p></td></tr></table></td></tr></table></body></html>`,
  };
}
