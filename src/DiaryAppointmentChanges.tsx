import {useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Appointment} from './domain';
type Treatment={id:number;name:string;price:number;duration:number;active?:boolean};
import {requestErrorMessage} from './requestErrors';
export default function DiaryAppointmentChanges({appointment:a,treatments,db,onChanged,enabled}:{appointment:Appointment;treatments:Treatment[];db:SupabaseClient|null;onChanged:(a:Appointment)=>Promise<void>;enabled:boolean}){
 const [mode,setMode]=useState<'treatment'|'time'|null>(null),[id,setId]=useState(a.treatment_id),[date,setDate]=useState(a.appointment_date),[start,setStart]=useState(a.start_minute),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const t=treatments.find(t=>t.id===id);const clock=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
 function open(m:'treatment'|'time'){setMode(m);setId(a.treatment_id);setDate(a.appointment_date);setStart(a.start_minute);setConfirm(false);setError('');}
 async function save(keep:boolean){if(busy)return;if(mode==='time'&&start%15!==0){setError('Choose a time on the quarter hour.');return;}setBusy(true);setError('');try{let next:Appointment;
 if(db){const r=await db.rpc('diary_change_appointment',{p_id:a.id,p_treatment_id:mode==='treatment'?id:a.treatment_id,p_staff_id:a.staff_id,p_date:date,p_start:start,p_revision:a.revision,p_reason:mode==='treatment'?'Treatment changed from diary':'Date/time changed from diary',p_keep_duration:keep});if(r.error)throw r.error;next=r.data;}
 else next={...a,treatment_id:mode==='treatment'?id:a.treatment_id,treatment_name:mode==='treatment'?t!.name:a.treatment_name,price:mode==='treatment'&&id!==a.treatment_id?t!.price:a.price,duration:keep?a.duration:t!.duration,appointment_date:date,start_minute:start,revision:(a.revision||0)+1};
 await onChanged(next);setMode(null);setConfirm(false);
 }catch(e){setError(requestErrorMessage(e));}finally{setBusy(false);}}
 return <><h3>{a.treatment_name} {enabled&&<button className="back" onClick={()=>open('treatment')}>Change</button>}</h3><p>{new Date(a.appointment_date+'T12:00:00Z').toLocaleDateString('en-GB')} · {clock(a.start_minute)}–{clock(a.start_minute+a.duration)} {enabled&&<button className="back" onClick={()=>open('time')}>Change</button>}</p>
 {mode&&<section aria-label={mode==='treatment'?'Change treatment':'Change date and time'}>
 {mode==='treatment'?<label>Treatment<select value={id} disabled={busy||confirm} onChange={e=>setId(Number(e.target.value))}>{treatments.filter(t=>t.active!==false||t.id===a.treatment_id).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>:<><label>Appointment date<input type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label><label>Appointment time<select value={start} disabled={busy} onChange={e=>setStart(Number(e.target.value))}>{Array.from({length:45},(_,i)=>540+i*15).map(minute=><option key={minute} value={minute}>{clock(minute)}</option>)}</select></label></>}
 {confirm?<><p>The new treatment is {t?.duration} minutes instead of {a.duration} minutes, do you want to apply this new time in the diary?</p><div className="actions"><button className="primary" disabled={busy} onClick={()=>void save(false)}>Yes</button><button className="secondary" disabled={busy} onClick={()=>void save(true)}>No</button></div></>:<button className="primary" disabled={busy||!date||!Number.isFinite(start)||!t} onClick={()=>{if(mode==='treatment'&&t?.duration!==a.duration)setConfirm(true);else void save(true);}}>Save</button>}
 <button className="secondary" disabled={busy} onClick={()=>{setMode(null);setConfirm(false);}}>Cancel</button>{error&&<p role="alert" className="auth-error">{error}</p>}</section>}</>;
}
