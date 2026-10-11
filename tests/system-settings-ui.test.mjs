import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React from 'react';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://salon.example'});
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
const result=await build({entryPoints:['src/SystemSettingsForm.tsx'],bundle:true,format:'esm',platform:'node',packages:'external',write:false,jsx:'automatic'});
const temp=await mkdtemp('.system-settings-test-');await writeFile(temp+'/component.mjs',result.outputFiles[0].text);
const mod=await import(pathToFileURL(process.cwd()+'/'+temp+'/component.mjs'));await rm(temp,{recursive:true,force:true});
test('system settings load defaults and save timeout, currency, recipient switch and delivery preferences',async()=>{
 const initial={staff_timeout_seconds:300,currency:'EUR',allow_booking_for_others:true,confirmation_delivery:'email',amendment_delivery:'email',cancellation_delivery:'email',voucher_delivery:'email',revision:0};let saved;let changed=0;
 const db={rpc:async(name,args)=>name==='get_system_settings'?{data:initial,error:null}:(saved=args,{data:{...args.p_settings,revision:1},error:null})};
 try{render(React.createElement(mod.default,{db,onChanged:()=>changed++}));
 await waitFor(()=>assert.equal(screen.getByRole('button',{name:'Save System Settings'}).disabled,false));
 assert.equal(screen.getByLabelText('Staff Screen Timeout Length (seconds)').value,'300');
 fireEvent.change(screen.getByLabelText('Staff Screen Timeout Length (seconds)'),{target:{value:'600'}});
 fireEvent.change(screen.getByLabelText('Currency'),{target:{value:'GBP'}});
 fireEvent.change(screen.getByLabelText('Allow Clients to Book for Someone Else'),{target:{value:'false'}});
 fireEvent.change(screen.getByLabelText('Booking Confirmation Delivery Method'),{target:{value:'email_whatsapp'}});
 fireEvent.change(screen.getByLabelText('Voucher Delivery Method'),{target:{value:'whatsapp'}});
 fireEvent.click(screen.getByRole('button',{name:'Save System Settings'}));await screen.findByText(/System settings saved/);
 assert.equal(saved.p_revision,0);assert.equal(saved.p_settings.staff_timeout_seconds,600);assert.equal(saved.p_settings.currency,'GBP');assert.equal(saved.p_settings.allow_booking_for_others,false);assert.equal(saved.p_settings.voucher_delivery,'whatsapp');assert.equal(changed,1);
 }finally{cleanup();}
});
