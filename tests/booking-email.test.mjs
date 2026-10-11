import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const r=await build({entryPoints:['supabase/functions/send-booking-confirmations/email.ts'],bundle:true,format:'esm',write:false});
const {confirmationPayload}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
test('confirmation always routes to Damian and formats/escapes booking details',()=>{
 const payload=confirmationPayload({id:'abc',client_name:'Jacqui <script>',treatment_name:'Glam & Package',appointment_date:'2026-10-06',start_minute:1020,staff_name:'Aoife',price:99,to:'another@example.com'},'Sculpted Testing <bookings@auth.benniescardgame.co.uk>');
 assert.deepEqual(payload.to,['damianjmcgrath@gmail.com']);
 assert(payload.subject.startsWith('[TEST]'));
 assert(payload.text.includes('Tuesday 06 October 2026, 05:00 pm'));
 assert(payload.text.includes('A92 HW30'));
 assert(payload.html.includes('Glam &amp; Package'));
 assert(!payload.html.includes('<script>'));
 assert(payload.text.includes('€99.00'));
});
test('email function syntax bundles without exposing secrets',async()=>{
 await build({entryPoints:['supabase/functions/send-booking-confirmations/index.ts'],bundle:true,format:'esm',write:false,external:['npm:*']});
});

test('card-exempt booking confirmations do not promise a ten euro guarantee',()=>{
 const payload=confirmationPayload({id:'exempt',client_name:'Friend',treatment_name:'Test',appointment_date:'2026-10-10',start_minute:600,staff_name:'Aoife',price:25,guarantee_required:false},'Test <test@example.com>');
 assert(payload.text.includes('No card guarantee is required'));assert(!payload.text.includes('€10'));assert(!payload.html.includes('€10'));
});

test('prepaid confirmations name the payment and do not request payment in salon',()=>{
 for(const method of ['voucher','credit']){
 const payload=confirmationPayload({id:'prepaid',client_name:'Client',treatment_name:'Test',appointment_date:'2026-10-10',start_minute:600,staff_name:'Aoife',price:50,guarantee_required:false,prepaid_method:method,prepaid_voucher_code:'SC-PREPAID'},'Test <test@example.com>');
 assert(payload.text.includes('No further payment is required'));assert(!payload.text.includes('Payment is made in the salon'));assert(payload.html.includes('Your payment'));if(method==='voucher')assert(payload.text.includes('SC-PREPAID'));
 }
});

test('confirmation email includes calendar links and a Unicode-safe ICS attachment', () => {
 const payload = confirmationPayload({id:'calendar',client_name:'Jacqui',treatment_name:'Lash Lift',appointment_date:'2026-10-15',start_minute:840,duration:45,staff_name:'Leah',price:49},'Test <test@example.com>');
 assert.match(payload.html,/Add to Google Calendar/);
 assert.match(payload.html,/Add to Apple \/ Outlook Calendar/);
 const ics = Buffer.from(payload.attachments[0].content,'base64').toString('utf8');
 assert.match(ics,/DTSTART:20261015T130000Z/);
 assert.match(ics,/DTEND:20261015T134500Z/);
});

test('amendment emails show original/new times and cancellation emails show refund without calendar attachment',()=>{
 const base={id:'changed',client_name:'Jacqui',treatment_name:'Lash <Lift>',appointment_date:'2026-10-15',start_minute:840,duration:45,staff_name:'Aoife',original_date:'2026-10-14',original_start:600};
 const amended=confirmationPayload({...base,event_kind:'amended'},'Test <test@example.com>');assert.match(amended.subject,/amended/);assert.match(amended.text,/Original appointment/);assert.match(amended.html,/Lash &lt;Lift&gt;/);assert.deepEqual(amended.to,['damianjmcgrath@gmail.com']);
 const cancelled=confirmationPayload({...base,event_kind:'cancelled',prepaid_method:'voucher',refund_amount:25,retained_fee:25},'Test <test@example.com>');assert.match(cancelled.subject,/cancelled/);assert.match(cancelled.text,/Cancellation fee retained: €25.00/);assert.equal(cancelled.attachments,undefined);
});

test('combined confirmation lists every treatment and patch test with separate calendar attachments',()=>{
 const base={client_name:'Jacqui',staff_name:'Aoife',duration:30,guarantee_required:true,guarantee_fee_cents:2500};
 const appointments=[{...base,id:'patch',treatment_name:'Patch Test for Lash <Lift>',appointment_date:'2026-10-13',start_minute:600,price:0,guarantee_required:false,duration:15},{...base,id:'one',treatment_name:'Lash <Lift>',appointment_date:'2026-10-15',start_minute:600,price:50},{...base,id:'two',treatment_name:'Brows',appointment_date:'2026-10-15',start_minute:630,price:40,guarantee_fee_cents:2000}];
 const payload=confirmationPayload({...appointments[0],appointments},'Test <test@example.com>');
 assert.deepEqual(payload.to,['damianjmcgrath@gmail.com']);assert.match(payload.html,/Lash &lt;Lift&gt;/);assert.match(payload.html,/Brows/);assert.match(payload.html,/Total: €90.00/);assert.match(payload.html,/€25.00/);assert.match(payload.html,/€20.00/);assert.equal(payload.attachments.length,3);
 for(let i=0;i<3;i++) assert.match(Buffer.from(payload.attachments[i].content,'base64').toString(),new RegExp('UID:'+appointments[i].id+'@'));
 const amended=confirmationPayload({...appointments[1],appointments,event_kind:'amended',original_date:'2026-10-14',original_start:600},'Test');assert.match(amended.subject,/amended/);assert.doesNotMatch(amended.html,/Brows/);
});
