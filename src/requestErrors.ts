/** Translate browser/transport failures without hiding useful validation errors. */
export function isConnectionError(error: unknown): boolean {
  const e = error as {message?: string; name?: string; context?: {message?: string; name?: string}} | null;
  const text = [typeof error === "string" ? error : e?.message, e?.name, e?.context?.message, e?.context?.name].filter(Boolean).join(" ");
  return /load failed|failed to fetch|fetch failed|networkerror|network error|failed to send a request to the edge function|functionsfetcherror|timeout|timed out|aborterror/i.test(text);
}
export function requestErrorMessage(error: unknown, context = "We couldn’t connect to the salon system."): string {
  if (isConnectionError(error)) return `${context} Please check your connection and try again.`;
  return typeof error === "string" ? error : (error as {message?: string})?.message || "Something went wrong. Please try again.";
}
