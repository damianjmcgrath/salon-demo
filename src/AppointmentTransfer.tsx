import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Appointment } from "./domain";
import { requestErrorMessage } from "./requestErrors";
export default function AppointmentTransfer({db, appointment, onTransferred}: {db: SupabaseClient|null; appointment: Appointment; onTransferred: (appointment: Appointment)=>Promise<void>}) {
 const [options,setOptions]=useState<{id:number;name:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{let active=true;setOptions([]);setError("");if(!db||!['booked','checked_in'].includes(appointment.status))return;
 db.rpc('get_appointment_transfer_options',{p_id:appointment.id}).then(({data,error})=>{if(!active)return;if(error)setError(requestErrorMessage(error));else setOptions(data||[]);});
 return()=>{active=false;};},[db,appointment.id,appointment.revision,appointment.status]);
 async function move(id:number){if(!db||busy)return;setBusy(true);setError("");try{
 const result=await db.rpc('transfer_appointment',{p_id:appointment.id,p_staff_id:id,p_revision:appointment.revision});if(result.error)throw result.error;
 setOptions([]);await onTransferred(result.data);
 }catch(e){setError(requestErrorMessage(e));}finally{setBusy(false);}}
 return <>{options.map(s=><button key={s.id} type="button" className="back appointment-transfer" disabled={busy} onClick={()=>move(s.id)}>{busy?'Moving…':`Move to ${s.name}`}</button>)}{error&&<span role="alert" className="auth-error">{error}</span>}</>;
}
