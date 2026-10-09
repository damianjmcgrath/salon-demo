import { before, after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React from 'react';
let dom,dir,Component,render,screen,fireEvent,waitFor,cleanup;
before(async()=>{
 dom=new JSDOM('<html><body></body></html>',{url:'https://salon.example/'});globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 ({render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react'));
 dir=await mkdtemp(new URL('../.voucher-ui-',import.meta.url));await build({entryPoints:['src/MyVouchers.tsx'],outfile:dir+'/component.mjs',bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});Component=(await import(pathToFileURL(dir+'/component.mjs'))).default;
});
afterEach(()=>cleanup());after(async()=>{dom.window.close();await rm(dir,{recursive:true,force:true});});
test('My Vouchers claims codes, lists transfers, and offers print and editable email for active vouchers',async()=>{
 const calls=[];let added=false;const voucher={id:'v',code:'SC-ABCD-EFGH-IJKL',original_amount:50,balance:20,expires_on:'2099-01-01',created_at:'2026-10-09T08:00:00Z',recipient_email:'owner@example.com'};
 const db={rpc:async(name,args)=>{calls.push([name,args]);if(name==='claim_my_voucher'){added=true;return {data:voucher};}return {data:{vouchers:added?[voucher]:[],uses:[],transfers:[{id:'t',code:'SC-OLD',original_amount:25,transferred_at:'2026-10-08T09:00:00Z',transferred_to:'New Client'}]}};},functions:{invoke:async(name,args)=>{calls.push([name,args]);return {data:{accepted:true}};}}};
 let prints=0;window.print=()=>prints++;
 render(React.createElement(Component,{db,live:true,data:{},onBuy:()=>{}}));await screen.findByText('No active vouchers.');assert.equal(screen.queryByRole('heading',{name:'Expired Vouchers'}),null);assert(screen.getByRole('heading',{name:'Transferred Vouchers'}));
 fireEvent.click(screen.getByRole('button',{name:'Add a Voucher'}));fireEvent.change(screen.getByLabelText('Voucher Code'),{target:{value:voucher.code}});fireEvent.click(screen.getByRole('button',{name:'Add Voucher',exact:true}));await waitFor(()=>assert.equal(calls.filter(c=>c[0]==='get_my_voucher_history').length,2));await screen.findByText('Voucher added to your account.');
 fireEvent.click(screen.getAllByRole('button',{name:'Email Voucher',exact:true})[0]);assert.equal(screen.getByLabelText('Email address').value,'owner@example.com');fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'gift@example.com'}});fireEvent.click(screen.getByRole('button',{name:'Send Email'}));await screen.findByText(/Voucher email accepted/);const email=calls.find(c=>c[0]==='send-voucher-email');assert.equal(email[1].body.email,'gift@example.com');assert.equal(email[1].body.client_purchase,true);
 fireEvent.click(screen.getAllByRole('button',{name:'Print Voucher'})[0]);await waitFor(()=>assert.equal(prints,1));assert(document.querySelector('.voucher-print-area').textContent.includes(voucher.code));
});

 test('client vouchers page displays active and used credit notes without staff creation controls',async()=>{
 const db={rpc:async(name)=>({data:name==='get_my_credit_notes'?{credit_notes:[{id:'n',amount:80,balance:40,staff_name:'Aoife',reason:'Test credit',created_at:'2026-10-09T10:00:00Z'}],uses:[{id:'r',amount:40,treatment_name:'Lash Lift (cancellation fee)',staff_name:'Leah',used_at:'2026-10-09T11:00:00Z'}]}:{vouchers:[],uses:[],transfers:[]}})};render(React.createElement(Component,{db,live:true,data:{},onBuy:()=>{}}));await screen.findByRole('heading',{name:'My Credit Notes'});assert(screen.getByRole('heading',{name:'Active Credit Notes'}));assert(screen.getByRole('heading',{name:'Used Credit Notes'}));assert(screen.getAllByText('Lash Lift (cancellation fee)').length>0);assert.equal(screen.queryByRole('button',{name:/Create New Credit Note|Add a Credit Note/}),null);
 });
