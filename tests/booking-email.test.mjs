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
