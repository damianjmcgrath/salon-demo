import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
let handler,permitted,signedIn,accepted,fetches,finished,prepared;
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
before(async()=>{
 const source=(await readFile('supabase/functions/send-voucher-email/index.ts','utf8')).replace(/import \{ createClient \} from "npm:[^"]+";/,'const createClient = globalThis.__voucherCreateClient;');
 globalThis.__voucherCreateClient=()=>({auth:{getUser:async()=>({data:{user:signedIn?{id:'staff'}:null},error:null})},rpc:async(name,args)=>{
 if(name==='has_permission')return {data:permitted,error:null};
 if(name==='prepare_staff_voucher_email'||name==='prepare_client_voucher_email'){prepared=args;return {data:{id:'request-id',status:accepted?'accepted':'pending',snapshot:{code:'SERVER-CODE',original_amount:75,balance:50,assigned_client_name:'<script>',expires_on:'2030-01-01'}},error:null};}
 finished=args;return {error:null};}});
 globalThis.Deno={serve:h=>{handler=h;},env:{get:k=>({SUPABASE_URL:'https://example.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'secret',RESEND_API_KEY:'resend',SALON_EMAIL_ENABLED:'true',SALON_EMAIL_FROM:'Salon <sender@example.com>'})[k]}};
 const r=await build({stdin:{contents:source,resolveDir:process.cwd()+'/supabase/functions/send-voucher-email',loader:'ts'},bundle:true,format:'esm',write:false});
 await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
});
after(()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__voucherCreateClient;});
function reset(){permitted=true;signedIn=true;accepted=false;fetches=[];finished=null;prepared=null;globalThis.fetch=async(url,options)=>{fetches.push([url,options]);return new Response(JSON.stringify({id:'resend-id'}),{status:200});};}
const request=()=>new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify({voucher_id:'v',email:'intended@example.com',request_id:'request-id',snapshot:{code:'ATTACKER'},to:'attacker@example.com'})});
test('voucher sender authenticates before lookup and prevents unauthorized provider requests',async()=>{reset();signedIn=false;assert.equal((await handler(request())).status,401);assert.equal(fetches.length,0);reset();permitted=false;assert.equal((await handler(request())).status,403);assert.equal(prepared,null);assert.equal(fetches.length,0);});
test('voucher sender uses database snapshot, fixed test recipient and stable provider idempotency',async()=>{reset();const r=await handler(request());assert.equal(r.status,200);assert.equal((await r.json()).accepted,true);const payload=JSON.parse(fetches[0][1].body);assert.deepEqual(payload.to,['damianjmcgrath@gmail.com']);assert(payload.text.includes('SERVER-CODE'));assert(!payload.text.includes('ATTACKER'));assert(payload.html.includes('&lt;script&gt;'));assert(!payload.html.includes('<script>'));assert.equal(fetches[0][1].headers['Idempotency-Key'],'salon-voucher/request-id');assert.equal(finished.p_resend_id,'resend-id');assert.equal(prepared.p_email,'intended@example.com');reset();accepted=true;assert.equal((await handler(request())).status,200);assert.equal(fetches.length,0);});
test('provider failure is reported rather than claiming a successful email',async()=>{reset();globalThis.fetch=async()=>new Response(JSON.stringify({error:'bad'}),{status:500});assert.equal((await handler(request())).status,502);assert.equal(finished.p_status,'failed');});

test('client voucher purchase email uses the ownership-checked RPC and fixed test recipient',async()=>{
 reset();permitted=false;
 const req=new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify({voucher_id:'v',email:'recipient@example.com',request_id:'request-id',client_purchase:true})});
 const result=await handler(req);assert.equal(result.status,200);assert.equal(prepared.p_email,'recipient@example.com');assert.deepEqual(JSON.parse(fetches[0][1].body).to,['damianjmcgrath@gmail.com']);
});
