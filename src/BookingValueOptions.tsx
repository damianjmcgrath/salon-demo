import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
export type BookingValueChoice = { method: "voucher" | "credit"; id: string };
type Value = { id: string; code?: string; reason?: string; balance: number };
export default function BookingValueOptions({ db, treatmentId, requiresGuarantee, choice, onChange, onRouteChange, disabled }: {
  db: SupabaseClient; treatmentId: number; requiresGuarantee: boolean | null;
  onRouteChange?: (route: "checking" | "choose" | "later" | "value") => void;
  choice: BookingValueChoice | null; onChange: (choice: BookingValueChoice | null) => void; disabled: boolean;
}) {
  const [selection, setSelection] = useState("");
  const [options, setOptions] = useState<{ vouchers: Value[]; credit_notes: Value[] }>({ vouchers: [], credit_notes: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setOptions({ vouchers: [], credit_notes: [] }); onChange(null); setSelection(""); onRouteChange?.("checking");
    void db.rpc("get_booking_value_options", { p_treatment_id: treatmentId }).then(r => {
      if (!active) return; setLoading(false);
      if (r.error) {setError(r.error.message); onRouteChange?.("later");}
      else {setOptions(r.data); onRouteChange?.(r.data.vouchers.length || r.data.credit_notes.length ? "choose" : "later");}
    });
    return () => { active = false; };
  }, [db, treatmentId, onChange, onRouteChange]);
  const money = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
  if (loading) return <p className="small">Checking your vouchers and credit notes…</p>;
  if (error) return <p role="alert" className="auth-error">Unable to check voucher and credit note balances: {error}</p>;
  const vouchers = options.vouchers, credits = options.credit_notes;
  if (!vouchers.length && !credits.length) return null;
  return <section className="guarantee" aria-label="Pay upfront using your balance">
    <p>{vouchers.length && credits.length
      ? "You have a voucher that would cover the cost of this treatment. You also have a credit note that can be used. Please choose how you would like to book."
      : vouchers.length ? `You have a voucher worth ${money(Number(vouchers[0].balance))} that would cover the treatment cost. Do you want to use a voucher to book this treatment?`
      : "You have a credit note that would cover the cost of this treatment. Do you want to use it to book this treatment?"}</p>
    <p className="small">Only balances that cover the full treatment cost are listed. The treatment price will be deducted when you confirm your booking; any remaining balance stays available.</p>
    <label>Booking payment option<select disabled={disabled} value={selection} onChange={e => {const selected=e.target.value;setSelection(selected);onRouteChange?.(selected === "" ? "choose" : selected === "later" ? "later" : "value");onChange(selected === "later" || selected === "" ? null : { method: selected as "voucher" | "credit", id: "" });}}>
      <option value="">Choose an option</option>
      <option value="later">{requiresGuarantee ? "Provide a card guarantee and pay in-salon" : "Pay in-salon after the treatment"}</option>
      {!!vouchers.length && <option value="voucher">Use a voucher now</option>}
      {!!credits.length && <option value="credit">Use a credit note now</option>}
    </select></label>
    {choice && <label>{choice.method === "voucher" ? "Choose a valid voucher" : "Choose a credit note"}<select disabled={disabled} value={choice.id} onChange={e => onChange({ ...choice, id: e.target.value })}>
      <option value="">Select {choice.method === "voucher" ? "a voucher" : "a credit note"}</option>
      {(choice.method === "voucher" ? vouchers : credits).map(v => <option key={v.id} value={v.id}>{v.code ?? v.reason ?? "Credit note"} · {money(Number(v.balance))} remaining</option>)}
    </select></label>}
  </section>;
}
