import { bookingCalendar } from "./calendar.ts";
// Test recipient is deliberately fixed server-side. No client-supplied recipients.
export const testRecipient = "damianjmcgrath@gmail.com";
export function confirmationPayload(
  snapshot: Record<string, any>,
  from: string,
) {
  if (snapshot.event_kind === "amended" || snapshot.event_kind === "cancelled")
    return changePayload(snapshot, from);
  const s = snapshot;
  const calendar = Number(s.duration) > 0 ? bookingCalendar(s as any) : null;
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
  const guaranteeText =
    s.prepaid_method === "voucher"
      ? `Payment has already been made online by Voucher ID: ${s.prepaid_voucher_code}. No further payment is required.`
      : s.prepaid_method === "credit"
        ? "Payment has already been made online by Credit Note. No further payment is required."
        : s.guarantee_required === false
          ? "No payment is taken now. No card guarantee is required for this booking. Payment is made in the salon after treatment."
          : `No payment is taken now. Payment is made in the salon after treatment. The booking guarantee is €${(Number(s.guarantee_fee_cents ?? 1000) / 100).toFixed(2)} for no-shows or late cancellations.`;
  const lines = [
    "TEST EMAIL — routed to Damian during salon testing.",
    `See you soon, ${String(s.client_name).trim().split(/\s+/)[0]}.`,
    "Salon Address: Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30",
    `Treatment Booked: ${s.treatment_name}`,
    `Date and Time: ${date}, ${time}`,
    `With: ${s.staff_name}`,
    `Price: €${Number(s.price).toFixed(2)}`,
    `Booking Reference: ${s.id}`,
    guaranteeText,
  ];
  return {
    ...(calendar
      ? {
          attachments: [
            {
              filename: "sculpted-appointment.ics",
              content: calendar.base64,
              content_type: "text/calendar",
            },
          ],
        }
      : {}),
    from,
    to: [testRecipient],
    subject: "[TEST] Sculpted — Appointment confirmation",
    text: [
      ...lines,
      ...(calendar
        ? [
            `Add to Google Calendar: ${calendar.google}`,
            `Add to Apple / Outlook Calendar: ${calendar.download}`,
          ]
        : []),
      "View my appointments: https://damianjmcgrath.github.io/salon-demo/",
    ].join("\n\n"),
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
]
  .map(
    ([label, value]) =>
      `<tr><td style="padding:14px 18px;border-bottom:1px solid #e4e0d6;"><p style="margin:0 0 5px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;color:#73766b;">${escape(label)}</p><p style="margin:0;font-size:16px;line-height:1.5;color:#292822;">${escape(value)}</p></td></tr>`,
  )
  .join("")}
</table></td></tr>
<tr><td style="padding:0 24px 26px;">
<p style="margin:0 0 8px;font-size:11px;font-weight:bold;letter-spacing:1px;color:#63705b;">SALON ADDRESS</p>
<p style="margin:0;font-size:14px;line-height:1.7;">Williams St., Mulladrillen, Ardee,<br>Co. Louth A92 HW30</p>
</td></tr>
<tr><td align="center" style="padding:0 24px 28px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#303b30" style="border-radius:4px;"><a href="https://damianjmcgrath.github.io/salon-demo/" style="display:inline-block;padding:16px 28px;border:1px solid #303b30;border-radius:4px;font-size:14px;font-weight:bold;text-decoration:none;color:#ffffff;">View my appointments</a></td></tr></table>
${calendar ? `<p style="margin:20px 0;line-height:2;"><a href="${escape(calendar.google)}" style="color:#303b30;">Add to Google Calendar</a><br><a href="${escape(calendar.download)}" style="color:#303b30;">Add to Apple / Outlook Calendar</a></p>` : ""}
<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#77756f;">Sign in to view your bookings.</p>
</td></tr>
<tr><td style="padding:22px 24px;background-color:#f2f0e8;">
<p style="margin:0 0 8px;font-size:12px;font-weight:bold;">${s.prepaid_method ? "Your payment" : "Your booking guarantee"}</p>
<p style="margin:0;font-size:12px;line-height:1.8;color:#66645e;">${escape(guaranteeText)}</p>
</td></tr>
<tr><td align="center" style="padding:22px 24px;">
<p style="margin:0;font-size:10px;line-height:1.7;color:#858279;word-break:break-all;">Booking reference: ${escape(s.id)}</p>
<p style="margin:16px 0 0;font-size:11px;line-height:1.7;color:#858279;">TEST EMAIL · Sent to Damian during salon testing.</p>
</td></tr>
</table></td></tr></table>
</body></html>`,
  };
}

function changePayload(s: Record<string, any>, from: string) {
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
  const cancelled = s.event_kind === "cancelled";
  const title = cancelled ? "Appointment cancelled" : "Appointment amended";
  const when = (date: string, minute: number) =>
    new Date(date + "T12:00:00Z").toLocaleDateString("en-GB", {
      timeZone: "Europe/Dublin",
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }) +
    ", " +
    String(Math.floor(minute / 60)).padStart(2, "0") +
    ":" +
    String(minute % 60).padStart(2, "0");
  const details = [
    ["Treatment", s.treatment_name],
    ["With", s.staff_name],
    ["Appointment", when(s.appointment_date, Number(s.start_minute))],
    ["Booking Reference", s.id],
  ];
  if (!cancelled)
    details.push([
      "Original appointment",
      when(s.original_date, Number(s.original_start)),
    ]);
  if (cancelled && s.prepaid_method)
    details.push(
      [
        "Returned to " +
          (s.prepaid_method === "voucher" ? "voucher" : "credit note"),
        "€" + Number(s.refund_amount || 0).toFixed(2),
      ],
      [
        "Cancellation fee retained",
        "€" + Number(s.retained_fee || 0).toFixed(2),
      ],
    );
  const message = cancelled
    ? "Your appointment has been cancelled. Please contact the salon if you have any questions."
    : "Your appointment has been updated. We look forward to seeing you at your new appointment time.";
  const calendar =
    !cancelled && Number(s.duration) > 0 ? bookingCalendar(s as any) : null;
  return {
    from,
    to: [testRecipient],
    subject: "[TEST] Sculpted — " + title,
    text: [
      title,
      message,
      ...details.map(([label, value]) => label + ": " + value),
      "Salon Address: Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30",
      "Phone: 087 1815137",
      "Email: sculptedbyac@gmail.com",
      "View my appointments: https://damianjmcgrath.github.io/salon-demo/",
    ].join("\n\n"),
    ...(calendar
      ? {
          attachments: [
            {
              filename: "sculpted-appointment.ics",
              content: calendar.base64,
              content_type: "text/calendar",
            },
          ],
        }
      : {}),
    html: `<!doctype html><html lang="en"><body style="margin:0;background:#f3f1eb;color:#292822;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%"><tr><td style="padding:24px 12px" align="center"><table role="presentation" style="max-width:600px;width:100%;background:#fffdf8;border:1px solid #e4e0d6"><tr><td style="padding:28px;text-align:center;background:white"><img src="https://damianjmcgrath.github.io/salon-demo/images/salon-logo.png" width="300" alt="Sculpted by Aoife Clare" style="width:100%;max-width:300px;height:auto"></td></tr><tr><td style="padding:28px"><h1 style="font-family:Georgia,serif;font-weight:normal">${title}</h1><p>${message}</p><table role="presentation" style="width:100%;background:#f2f0e8">${details.map(([label, value]) => `<tr><td style="padding:12px"><strong>${escape(label)}</strong></td><td style="padding:12px">${escape(value)}</td></tr>`).join("")}</table><p>Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30</p><p><a href="tel:0871815137">087 1815137</a> · <a href="mailto:sculptedbyac@gmail.com">sculptedbyac@gmail.com</a></p><p><a href="https://damianjmcgrath.github.io/salon-demo/" style="display:inline-block;padding:16px;background:#292822;color:white;text-decoration:none">View my appointments</a></p></td></tr></table></td></tr></table></body></html>`,
  };
}
