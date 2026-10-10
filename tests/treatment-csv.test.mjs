import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treatmentHeaders, exportTreatmentCsv, validateTreatmentCsv, readCsv } from '../src/treatment-csv.mjs';
const treatment = {id:1,category:'Brows',name:'Brows, "Deluxe"',description:'First line\nSecond line',duration:30,price:25.5,revision:4,rebook_window:null,guarantee_required:true,patch_required:true};
test('Excel CSV round trip preserves commas, quotes, multiline text, IDs and booleans',()=>{
 const csv=exportTreatmentCsv([treatment]);const result=validateTreatmentCsv(csv,[treatment]);
 assert.deepEqual(result.errors,[]);assert.equal(result.updates[0].id,1);assert.equal(result.updates[0].description,treatment.description);assert.deepEqual(result.changes,[]);
});
test('blank yes/no fields preserve settings; empty rebook clears it and rename remains same ID',()=>{
 const csv=treatmentHeaders.join(',')+'\n1,Brows,New name,,45,30.99,,,\n';
 const r=validateTreatmentCsv(csv,[{...treatment,rebook_window:'4 weeks'}]);
 assert.deepEqual(r.errors,[]);assert.equal(r.updates[0].revision,4);assert.equal(r.updates[0].patch_required,true);assert.equal(r.updates[0].guarantee_required,true);assert.equal(r.updates[0].rebook_window,null);assert(r.changes.some(x=>x.field==='Treatment Name'));
});
test('rejects wrong headers, semicolon files, duplicate/missing/unknown IDs and invalid field values',()=>{
 const header=treatmentHeaders.join(',')+'\n', good='1,Brows,Name,,30,20,4 weeks,Yes,No';
 for(const csv of [header.replace('Treatment ID','ID')+good,treatmentHeaders.join(';')+'\n'+good,
  header+good+'\n'+good,header+good.replace(/^1,/,','),header+good.replace(/^1,/, '2,'),
  header+good.replace(',30,',',0,'),header+good.replace(',20,',',20.001,'),header+good.replace(',20,',',€20,'),header+good.replace('4 weeks','5 days'),header+good.replace('Yes','Maybe')]) {
  assert(validateTreatmentCsv(csv,[treatment]).errors.length,csv);
 }
 assert.throws(()=>readCsv('"unclosed'),/unclosed/);assert.throws(()=>readCsv('"closed"x'),/quoting/);
});
