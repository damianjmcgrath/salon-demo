// An authorisation is not a completed payment. Unknown outcomes need review.
export function feeState(order: {
  state?: string;
  payments?: { state?: string }[];
}) {
  if (order.state === "completed") return "completed";
  const payments = order.payments || [];
  if (
    ["cancelled", "failed"].includes(order.state || "") ||
    (payments.length &&
      payments.every((p) =>
        ["declined", "failed", "cancelled"].includes(p.state || ""),
      ))
  )
    return "failed";
  return "processing";
}
