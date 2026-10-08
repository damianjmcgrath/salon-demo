import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const result = await build({ entryPoints:['supabase/functions/send-booking-confirmations/calendar.ts'], bundle:true, format:'esm', write:false });
const { bookingCalendar } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const base = { id:'appointment-123', appointment_date:'2026-10-15', start_minute:840, duration:60, treatment_name:'Lashes, brows; lift', staff_name:'Leah' };
test('summer Ireland time and duration match Google and calendar file', () => {
 const c = bookingCalendar(base);
 assert.equal(new URL(c.google).searchParams.get('dates'), '20261015T130000Z/20261015T140000Z');
 assert.match(c.ics, /DTSTART:20261015T130000Z/);
 assert.match(c.ics, /DTEND:20261015T140000Z/);
 assert.match(c.ics, /Lashes\\, brows\\; lift/);
 assert.equal(Buffer.from(c.base64,'base64').toString(), c.ics);
});
test('winter Ireland time has no summer offset and supports midnight rollover', () => {
 const c = bookingCalendar({...base,appointment_date:'2026-12-15',start_minute:1410});
 assert.match(c.ics,/DTSTART:20261215T233000Z/);
 assert.match(c.ics,/DTEND:20261216T003000Z/);
});
test('unicode calendar lines are folded to 75 bytes and contain stable appointment identity', () => {
 const c = bookingCalendar({...base,treatment_name:'é'.repeat(100)});
 assert.ok(c.ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
 assert.match(c.ics,/UID:appointment-123@sculpted-salon/);
});
