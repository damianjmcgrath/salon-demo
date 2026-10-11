import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('group consolidation keeps one pending job, ordered snapshots and lifecycle jobs unchanged',async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create table public.staff(id integer,name text);create table public.appointments(id uuid,staff_id integer,treatment_name text);create table public.booking_email_queue(id uuid,appointment_id uuid,event_kind text,status text,payload jsonb,snapshot jsonb,last_error text);insert into staff values(1,'Aoife');`);
 const sql=await readFile('supabase/051_grouped_booking_confirmations.sql','utf8');await db.exec(sql.slice(sql.indexOf('create function'),sql.indexOf('do $$')));
 const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002'];
 for(const id of ids) await db.query(`insert into appointments values($1,1,$2);`,[id,'Treatment '+id.slice(-1)]);
 for(const [i,id] of ids.entries()) await db.query(`insert into booking_email_queue values($1,$1,'booked','pending',null,'{}',null)`,[id]);
 await db.query(`insert into booking_email_queue values('00000000-0000-0000-0000-000000000003',$1,'amended','pending',null,'{}',null)`,[ids[0]]);
 await db.query('select public.group_booking_confirmations($1::uuid[])',[ids]);
 const rows=(await db.query('select * from booking_email_queue order by id')).rows;
 assert.equal(rows[0].status,'pending');assert.deepEqual(rows[0].snapshot.appointments.map(a=>a.id),ids);assert.equal(rows[0].snapshot.appointments[1].staff_name,'Aoife');assert.equal(rows[1].status,'cancelled');assert.equal(rows[2].status,'pending');
 await db.query('select public.group_booking_confirmations($1::uuid[])',[ids]);assert.equal((await db.query("select count(*)::integer n from booking_email_queue where event_kind='booked' and status='pending'")).rows[0].n,1);await db.close();
});
