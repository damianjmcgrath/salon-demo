import { useState, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
export default function AppointmentReminder({ db, appointmentId, initialEmail, disabled }: { db: SupabaseClient | null; appointmentId: string; initialEmail: string; disabled: boolean }) {
 const [open,setOpen]=useState(false),[email,setEmail]=useState(initialEmail),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const request=useRef(crypto.randomUUID());
 async function send(e: React.FormEvent) {
  e.preventDefault();if(!db||busy)return;setBusy(true);setError("");setMessage("");
  try {
   const result=await db.functions.invoke("send-appointment-reminder",{body:{appointment_id:appointmentId,email:email.trim(),request_id:request.current}});
   if(result.error){let detail=result.error.message;try{const body=await result.error.context?.json();detail=body?.error||detail;}catch{}throw new Error(detail);}
   if(!result.data?.accepted)throw new Error("The email was not accepted. Please retry.");
   setMessage("Reminder accepted for sending to damianjmcgrath@gmail.com. Recorded in Communication History.");setOpen(false);request.current=crypto.randomUUID();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <>
  <button className="secondary appointment-action" disabled={disabled||busy||!db} onClick={()=>{setOpen(!open);setMessage("");setError("");}}>Send Reminder</button>
  {open&&<form className="guarantee" onSubmit={send}><label>Client email address<input type="email" required maxLength={254} value={email} disabled={busy} onChange={e=>{setEmail(e.target.value);request.current=crypto.randomUUID();}} autoFocus/></label><p className="small">During testing, emails are sent to damianjmcgrath@gmail.com.</p><div className="record-actions"><button className="primary" disabled={busy}>{busy?"Sending…":"Send"}</button><button type="button" className="secondary" disabled={busy} onClick={()=>{setOpen(false);setError("");setMessage("");setEmail(initialEmail);}}>Cancel</button></div></form>}
  {error&&<p role="alert" className="auth-error">{error}</p>}{message&&<p role="status">{message}</p>}
 </>;
}
