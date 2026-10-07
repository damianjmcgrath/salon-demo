import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastBookedLabel } from '../src/bookingRecency.js';
const today='2026-10-07';
function booking(days, extra={}) { const date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-days);return {status:'completed',treatment_id:1,appointment_date:date.toISOString().slice(0,10),...extra}; }
test('last-booked labels follow each requested boundary',()=>{
 const cases=[[0,'Today'],[1,'1 day ago'],[5,'5 days ago'],[6,'1 week ago'],[8,'1 week ago'],[9,'9 days ago'],[12,'12 days ago'],[13,'2 weeks ago'],[15,'2 weeks ago'],[16,'16 days ago'],[19,'19 days ago'],[20,'3 weeks ago'],[22,'3 weeks ago'],[23,'23 days ago'],[26,'26 days ago'],[27,'1 month ago'],[33,'1 month ago'],[34,'5 weeks ago'],[39,'5 weeks ago'],[40,'6 weeks ago'],[47,'6 weeks ago'],[48,'7 weeks ago'],[53,'7 weeks ago'],[54,'2 months ago'],[75,'2 months ago'],[76,'3 months ago'],[105,'3 months ago'],[106,'Longer than 3 months ago']];
 for(const [days,label] of cases)assert.equal(lastBookedLabel([booking(days)],1,today),'Last Booked: '+label);
});
test('last booking selects latest attended self appointment, excluding other people, future and cancelled bookings',()=>{
 assert.equal(lastBookedLabel([booking(50),booking(21),booking(2,{booked_for_self:false}),booking(1,{status:'cancelled'}),booking(-1),booking(0,{treatment_id:2})],1,today),'Last Booked: 3 weeks ago');
 assert.equal(lastBookedLabel([booking(1,{status:'no_show'})],1,today),null);
});
