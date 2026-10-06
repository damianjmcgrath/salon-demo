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
    text: lines.join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;background:#faf8f3;color:#292822"><h1>SCULPTED</h1>${lines.map((line) => `<p>${escape(line)}</p>`).join("")}<p><a href="https://damianjmcgrath.github.io/salon-demo/">View my appointments</a></p></div>`,
  };
}
