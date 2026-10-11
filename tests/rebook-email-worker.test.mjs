import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
let handler,calls,updates,fetches,providerStatus,enabled;
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
before(async()=>{
 const source=(await readFile('supabase/functions/send-rebook-reminders/index.ts','utf8')).replace(/import \{ createClient \} from "npm:[^"]+";/,'const createClient = globalThis.__rebookCreateClient;');
 globalThis.__rebookCreateClient=()=>({rpc:async name=>{calls.push(name);return {data:name==='claim_rebook_emails'?[{id:'job',claim_token:'lease',snapshot:{client_name:'<script>',treatment_name:'Lash Lift',treatment_id:123,attended_at:'2026-01-01T09:00:00Z'}}]:1,error:null};},from:()=>({update:value=>{updates.push(value);const chain={eq:()=>chain,select:async()=>({data:[{id:'job'}],error:null}),then:r=>Promise.resolve({error:null}).then(r)};return chain;}})});
 globalThis.Deno={serve:h=>{handler=h;},env:{get:k=>({SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'private',SALON_EMAIL_WORKER_SECRET:'worker',RESEND_API_KEY:'resend',SALON_EMAIL_ENABLED:enabled?'true':'false'})[k]}};
 const r=await build({stdin:{contents:source,resolveDir:process.cwd()+'/supabase/functions/send-rebook-reminders',loader:'ts'},bundle:true,format:'esm',write:false});
 await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
});
after(()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__rebookCreateClient;});
function reset(){calls=[];updates=[];fetches=[];enabled=true;providerStatus=200;globalThis.fetch=async(url,options)=>{fetches.push([url,options]);return new Response(JSON.stringify(providerStatus===200?{id:'provider-id'}:{name:'provider_error'}),{status:providerStatus});};}
const request=(secret='worker')=>new Request('https://example.test',{method:'POST',headers:{'x-salon-email-secret':secret},body:JSON.stringify({to:'attacker@example.com',treatment_name:'ATTACKER'})});
test('worker rejects unauthorized requests and disabled sends before database access',async()=>{reset();assert.equal((await handler(request('wrong'))).status,401);assert.deepEqual(calls,[]);enabled=false;assert.equal((await handler(request())).status,503);assert.deepEqual(calls,[]);});
test('worker scans, claims, freezes server payload, uses test recipient and logs provider acceptance',async()=>{reset();const r=await handler(request());assert.equal(r.status,200);assert.equal((await r.json()).accepted,1);assert.deepEqual(calls,['scan_rebook_reminders','claim_rebook_emails']);const payload=JSON.parse(fetches[0][1].body);assert.deepEqual(payload.to,['damianjmcgrath@gmail.com']);assert(payload.text.includes('Lash Lift'));assert(payload.html.includes('&lt;script&gt;'));assert(!payload.html.includes('<script>'));assert(payload.html.includes('?rebook=123'));assert.equal(fetches[0][1].headers['Idempotency-Key'],'salon-rebook/job');assert.equal(updates[1].status,'accepted');assert.equal(updates[1].resend_id,'provider-id');});
test('transient failures retry but invalid provider requests fail without claiming acceptance',async()=>{reset();providerStatus=500;assert.equal((await (await handler(request())).json()).accepted,0);assert.equal(updates[1].status,'pending');reset();providerStatus=422;await handler(request());assert.equal(updates[1].status,'failed');});
