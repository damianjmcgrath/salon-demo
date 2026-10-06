import { useEffect, useRef, useState } from "react";
import RevolutCheckout from "@revolut/checkout";
import type { SupabaseClient } from "@supabase/supabase-js";
export default function RevolutSandbox({db,onBack}:{db:SupabaseClient|null;onBack:()=>void}) {
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [testId,setTestId]=useState(""),[ready,setReady]=useState(false),[saved,setSaved]=useState(false),[attempted,setAttempted]=useState(false);
 const [cardholderName,setCardholderName]=useState("Damian McGrath");
 const target=useRef<HTMLDivElement>(null);
 const card=useRef<ReturnType<Awaited<ReturnType<typeof RevolutCheckout>>["createCardField"]>|null>(null);
 useEffect(()=>()=>{card.current?.destroy();},[]);
 async function call(action:string,extra:Record<string,unknown>={}) {
  if(!db) throw new Error("Supabase connection required.");
  const {data,error}=await db.functions.invoke("revolut-sandbox-test",{body:{action,test_id:testId,...extra}});
  if(error) { const detail=await error.context?.json?.().catch(()=>null); throw new Error(detail?.error || error.message); }
  if(data.error) throw new Error(data.error);
  return data;
 }
 async function run(task:()=>Promise<void>) {if(busy)return;setBusy(true);setMessage("");try{await task();}catch(e){setMessage(e instanceof Error?e.message:"Test failed.");}finally{setBusy(false);}}
 async function check() {await run(async()=>{const data=await call("status");setSaved(!!data.saved_card);setAttempted(data.charge_attempted);setMessage(`Setup: ${data.setup_state}. ${data.saved_card?"Merchant-enabled saved card found.":"No reusable card found yet."}${data.charge_state?" Charge: "+data.charge_state:""}`);});}
 async function start() {await run(async()=>{
  const data=await call("create",{consent});setTestId(data.test_id);
  const instance=await RevolutCheckout(data.token,"sandbox");
  if(!target.current) throw new Error("Card field unavailable.");
  card.current?.destroy();
  card.current=instance.createCardField({target:target.current,onSuccess(){setMessage("Checkout finished. Click Check Saved Card to verify the result with Revolut.");setBusy(false);},onError(error){setMessage(String(error));setBusy(false);},onCancel(){setBusy(false);setMessage("Card setup cancelled.");}});
  setReady(true);
 });}
 return <section className="panel reporting-page"><button className="back" onClick={onBack}>← Reporting</button><h1>Revolut Sandbox Test</h1>
 <p>Use official Revolut test cards only. This page creates no appointments and cannot connect to live payments.</p>
 <p><a href="https://developer.revolut.com/docs/guides/merchant/test-and-go-live/testing/test-cards" target="_blank" rel="noreferrer">Open official Sandbox test cards</a></p>
 <label><input type="checkbox" checked={consent} disabled={ready||busy} onChange={e=>setConsent(e.target.checked)}/> I agree to save this test card for a subsequent €10 Sandbox charge.</label>
 <p><button className="primary" disabled={!consent||busy||ready} onClick={()=>void start()}>1. Start €0 Card Setup</button></p>
 {ready&&<label>Cardholder full name<input value={cardholderName} disabled={busy} autoComplete="cc-name" onChange={e=>setCardholderName(e.target.value)}/></label>}
 <div ref={target} style={{minHeight:100}}/>
 {ready&&<button className="primary" disabled={busy} onClick={()=>{if(cardholderName.trim().split(/\s+/).length<2){setMessage("Enter the cardholder’s first and last name.");return;}setBusy(true);try{card.current?.submit({name:cardholderName.trim(),email:"sandbox-card-setup@example.com",savePaymentMethodFor:"merchant"});}catch(e){setMessage(String(e));setBusy(false);}}}>Save Test Card</button>}
 {testId&&<p><button disabled={busy} onClick={()=>void check()}>Check Saved Card / Payment Status</button></p>}
 <button className="primary" disabled={!saved||busy||attempted} onClick={()=>void run(async()=>{setAttempted(true);const data=await call("charge");setMessage("Sandbox payment result: "+data.payment_state+". Check payment status to confirm.");})}>2. Test €10 Charge</button>
 <p role="status">{busy?"Contacting Revolut Sandbox…":message}</p>
 {attempted&&<p>Only one charge attempt is allowed per test. Refresh this page to start a separate test.</p>}
 </section>;
}
