// Test recipient is deliberately fixed server-side. No client-supplied recipients.
export const testRecipient = "damianjmcgrath@gmail.com";
export function confirmationPayload(
  snapshot: Record<string, any>,
  from: string,
) {
  const s = snapshot;
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
  const date = new Date(s.appointment_date + "T12:00:00Z")
    .toLocaleDateString("en-GB", {
      timeZone: "Europe/Dublin",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    })
    .replace(",", "");
  const minute = Number(s.start_minute);
  const time = `${String(Math.floor(minute / 60) % 12 || 12).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")} ${minute < 720 ? "am" : "pm"}`;
  const lines = [
    "TEST EMAIL — routed to Damian during salon testing.",
    `See you soon, ${String(s.client_name).trim().split(/\s+/)[0]}.`,
    "Salon Address: Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30",
    `Treatment Booked: ${s.treatment_name}`,
    `Date and Time: ${date}, ${time}`,
    `With: ${s.staff_name}`,
    `Price: €${Number(s.price).toFixed(2)}`,
    `Booking Reference: ${s.id}`,
    "No payment is taken now. Payment is made in the salon after treatment. The booking guarantee is €10 for no-shows or late cancellations.",
  ];
  return {
    from,
    to: [testRecipient],
    subject: "[TEST] Sculpted — Appointment confirmation",
    text: [...lines, "View my appointments: https://damianjmcgrath.github.io/salon-demo/"].join("\n\n"),
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Appointment confirmed</title></head>
<body style="margin:0;padding:0;background-color:#f3f1eb;color:#292822;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your ${escape(s.treatment_name)} appointment is confirmed for ${escape(date)} at ${escape(time)}.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f3f1eb;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#fffdf8;border:1px solid #e4e0d6;">
<tr><td align="center" style="padding:28px 24px;background-color:#ffffff;border-bottom:1px solid #e4e0d6;">
<img src="https://damianjmcgrath.github.io/salon-demo/images/salon-logo.png" width="300" alt="Sculpted by Aoife Claire" style="display:block;width:100%;max-width:300px;height:auto;border:0;color:#292822;font-family:Georgia,'Times New Roman',serif;font-size:24px;">
</td></tr>
<tr><td style="padding:32px 24px 24px;">
<p style="margin:0 0 14px;font-size:11px;font-weight:bold;letter-spacing:2px;color:#63705b;">APPOINTMENT CONFIRMED</p>
<h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:normal;line-height:1.25;">See you soon, ${escape(String(s.client_name).trim().split(/\s+/)[0])}.</h1>
<p style="margin:0;font-size:15px;line-height:1.7;color:#66645e;">Your time with us is booked. We look forward to welcoming you to the salon.</p>
</td></tr>
<tr><td style="padding:0 24px 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f2f0e8;border:1px solid #e4e0d6;">
${[
  ["Treatment booked", s.treatment_name],
  ["Date", date],
  ["Time", time + " (Ireland local time)"],
  ["With", s.staff_name],
  ["Treatment price", "€" + Number(s.price).toFixed(2)],
].map(([label, value]) => `<tr><td style="padding:14px 18px;border-bottom:1px solid #e4e0d6;"><p style="margin:0 0 5px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#73766b;">${escape(label)}</p><p style="margin:0;font-size:16px;line-height:1.5;color:#292822;">${escape(value)}</p></td></tr>`).join("")}
</table></td></tr>
<tr><td style="padding:0 24px 26px;">
<p style="margin:0 0 8px;font-size:11px;font-weight:bold;letter-spacing:1px;color:#63705b;">SALON ADDRESS</p>
<p style="margin:0;font-size:14px;line-height:1.7;">Williams St., Mulladrillen, Ardee,<br>Co. Louth A92 HW30</p>
</td></tr>
<tr><td align="center" style="padding:0 24px 28px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#303b30" style="border-radius:4px;"><a href="https://damianjmcgrath.github.io/salon-demo/" style="display:inline-block;padding:16px 28px;border:1px solid #303b30;border-radius:4px;font-size:14px;font-weight:bold;text-decoration:none;color:#ffffff;">View my appointments</a></td></tr></table>
<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#77756f;">Sign in to view your bookings.</p>
</td></tr>
<tr><td style="padding:22px 24px;background-color:#f2f0e8;">
<p style="margin:0 0 8px;font-size:12px;font-weight:bold;">Your booking guarantee</p>
<p style="margin:0;font-size:12px;line-height:1.8;color:#66645e;">No payment is taken now. Payment is made in the salon after your treatment. The booking guarantee is €10 for no-shows or late cancellations.</p>
</td></tr>
<tr><td align="center" style="padding:22px 24px;">
<p style="margin:0;font-size:10px;line-height:1.7;color:#858279;word-break:break-all;">Booking reference: ${escape(s.id)}</p>
<p style="margin:16px 0 0;font-size:11px;line-height:1.7;color:#858279;">TEST EMAIL · Sent to Damian during salon testing.</p>
</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}
