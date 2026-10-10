import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React from 'react';

test('connected client selects ordered treatments, reserves one total slot and receives all appointments',async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://salon.example/'});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,localStorage:dom.window.localStorage,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const {render,screen,fireEvent,within,cleanup}=await import('@testing-library/react');
 const items=[{id:92001,name:'Visit A',duration:15,price:30},{id:92002,name:'Visit B',duration:30,price:40},{id:92003,name:'Visit C',duration:45,price:50}].map(t=>({...t,category:'Test',price_type:'Fixed',revision:0,patch_required:false,active:true}));
 const client={id:'client',name:'Client Test',email:'client@example.com',phone:'123456789',auth_user_id:'user',revision:0};
 let appointments=[];const calls=[];
 globalThis.__visitDb={
  auth:{getSession:async()=>({data:{session:{user:{id:'user',email:client.email,user_metadata:{full_name:client.name,mobile:client.phone},app_metadata:{}}}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
  from(table){const data=table==='treatments'?items:table==='staff'?[{id:1,name:'Aoife'},{id:2,name:'Leah'}]:table==='staff_treatments'?[{staff_id:1,treatment_id:92001},{staff_id:1,treatment_id:92002},{staff_id:1,treatment_id:92003},{staff_id:2,treatment_id:92001}]:table==='clients'?client:table==='staff_users'?null:[];return{select(){return this;},eq(){return this;},order(){return this;},maybeSingle(){return this;},then(fn){return Promise.resolve({data,error:null}).then(fn);}};},
  rpc:async(name,args)=>{calls.push([name,args]);let data=[];
   if(name==='get_self_booking_plan')data={treatment:items.find(t=>t.id===args.p_requested_treatment),patch_needed:false,requested_treatment_id:args.p_requested_treatment};
   if(['get_self_booking_slots','get_available_slots','get_visit_slots'].includes(name))data=[{start_minute:600,staff_id:1}];
   if(['booking_requires_guarantee','visit_requires_guarantee'].includes(name))data=false;
   if(['get_booking_value_options','get_visit_value_options'].includes(name))data={vouchers:[],credit_notes:[]};
   if(name==='get_my_appointments')data=appointments;
   if(name==='book_treatment_visit'){let start=args.p_start;appointments=items.map((t,i)=>{const a={id:'appointment-'+i,visit_id:'visit',visit_order:i+1,treatment_id:t.id,treatment_name:t.name,price:t.price,duration:t.duration,start_minute:start,staff_id:1,appointment_date:args.p_date,status:'booked',client_name:client.name,user_id:'user',client_id:client.id};start+=t.duration;return a;});data={appointments,visit_id:'visit'};}
   return {data,error:null};
  }
 };
 const dir=await mkdtemp(new URL('../.visit-test-',import.meta.url));
 try{
  await build({entryPoints:[new URL('../src/App.tsx',import.meta.url).pathname],outfile:dir+'/app.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',define:{'import.meta.env':'{"MODE":"production","VITE_SUPABASE_URL":"https://test.supabase.co","VITE_SUPABASE_PUBLISHABLE_KEY":"test","BASE_URL":"/"}'},plugins:[{name:'mock-db',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'mock',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient = () => globalThis.__visitDb;'}));}}]});
  const App=(await import(pathToFileURL(dir+'/app.mjs'))).default;
  render(React.createElement(App));fireEvent.click(await screen.findByRole('button',{name:'Yourself',exact:true}));
  for(let i=0;i<3;i++){
   fireEvent.click(await screen.findByRole('button',{name:new RegExp('Visit '+String.fromCharCode(65+i)+'.*Choose treatment')}));
   const dialog=await screen.findByRole('dialog',{name:'Add another treatment'});
   fireEvent.click(within(dialog).getByRole('button',{name:i===2?'Choose a Date/Time':'Add Another Treatment'}));
  }
  await screen.findByRole('heading',{name:'Find your perfect time'});
  const therapist=screen.getByLabelText('Who would you like to see?');assert(!within(therapist).queryByRole('option',{name:'Leah'}));
  fireEvent.click(screen.getByRole('button',{name:/Morning/}));fireEvent.click(await screen.findByRole('button',{name:/10:00/}));
  fireEvent.click(screen.getAllByRole('button',{name:/Continue/})[0]);
  await screen.findByText(/No card guarantee is required/);
  fireEvent.click(screen.getByRole('button',{name:/Confirm appointment/i}));
  await screen.findByRole('heading',{name:'See you soon, Client.'});assert.equal(appointments.length,3);
  const booking=calls.find(([name])=>name==='book_treatment_visit');assert.deepEqual(booking[1].p_treatments,[92001,92002,92003]);assert.equal(booking[1].p_start,600);
  assert(screen.getByText('Visit B',{selector:'strong'}));assert(calls.some(([name,args])=>name==='get_visit_slots'&&args.p_treatments.length===3));
 }finally{cleanup();dom.window.close();await rm(dir,{recursive:true,force:true});delete globalThis.__visitDb;}
});
