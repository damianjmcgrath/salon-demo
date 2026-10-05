// Real PostgreSQL functions and RLS in PGlite, with a minimal Supabase Auth schema.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
const pg = new PGlite({ extensions: { btree_gist } });
const staffA = "10000000-0000-0000-0000-000000000001",
  staffB = "10000000-0000-0000-0000-000000000002",
  clientUser = "10000000-0000-0000-0000-000000000003",
  accountant = "10000000-0000-0000-0000-000000000004";
const date = "2080-01-08";
let clientId, treatmentId, booking;
async function as(uid, role = "authenticated") {
  await pg.exec("reset role");
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [
    uid || "",
  ]);
  await pg.exec(`set role ${role}`);
}
async function one(sql, args = []) {
  return (await pg.query(sql, args)).rows[0];
}
before(async () => {
  await pg.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  for (const [id, email, name] of [
    [staffA, "a@example.com", "Staff A"],
    [staffB, "b@example.com", "Staff B"],
    [clientUser, "client@example.com", "Client Test"],
    [accountant, "accounts@example.com", "Accountant"],
  ])
    await pg.query(
      "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
      [id, email, { full_name: name, mobile: "0800000000" }],
    );
  for (const file of [
    "001_schema.sql",
    "002_seed.sql",
    "003_roles.sql",
    "004_client_booking_flow.sql",
  ]) {
    await pg.exec(
      await readFile(new URL("../supabase/" + file, import.meta.url), "utf8"),
    );
  }
  await pg.query(
    "insert into public.staff_users(user_id,role) values($1,'staff'),($2,'staff'),($3,'accountant')",
    [staffA, staffB, accountant],
  );
  await pg.exec(
    await readFile(
      new URL("../supabase/005_staff_flow.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.query("update public.staff_users set staff_id=1 where user_id=$1", [
    staffA,
  ]);
  await pg.query("update public.staff_users set staff_id=2 where user_id=$1", [
    staffB,
  ]);
  await pg.exec(
    await readFile(
      new URL("../supabase/006_vouchers_clock_profiles.sql", import.meta.url),
      "utf8",
    ),
  );
  await pg.query(
    "update staff_users set role='admin',profile_key='aoife',active=true where user_id=$1",
    [staffA],
  );
  await pg.query(
    "update staff_users set profile_key='leah',active=true where user_id=$1",
    [staffB],
  );
  await pg.query(
    "update staff_users set profile_key='jacqui',active=true where user_id=$1",
    [accountant],
  );
  // PGlite does not ship pgcrypto: stub ONLY its hashing API in the test harness.
  await pg.exec(
    "create schema extensions;create function extensions.gen_salt(text,integer) returns text language sql as $$ select 'test-salt'; $$;create function extensions.crypt(text,text) returns text language sql as $$ select md5($1||'test-only'); $$;",
  );
  await pg.exec(
    (
      await readFile(
        new URL("../supabase/007_staff_administration.sql", import.meta.url),
        "utf8",
      )
    ).replace(
      "create extension if not exists pgcrypto with schema extensions;",
      "",
    ),
  );
  await pg.exec(
    await readFile(
      new URL(
        "../supabase/008_client_profiles_voucher_purchase.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.exec(await readFile(new URL("../supabase/009_admin_breaks.sql", import.meta.url), "utf8"));
  clientId = (
    await one("select id from clients where auth_user_id=$1", [clientUser])
  ).id;
  treatmentId = (
    await one("select id from treatments where duration=60 order by id limit 1")
  ).id;
});
after(async () => {
  await pg.close();
});
test("database: all migrations apply; staff searches are denied to clients and accountants", async () => {
  await as(staffA);
  assert.equal(
    (await pg.query("select * from search_clients('CLIENT','','')")).rows
      .length,
    1,
  );
  await as(clientUser);
  await assert.rejects(
    pg.query("select * from search_clients('Client','','')"),
    /Staff access/,
  );
  await as(accountant);
  await assert.rejects(
    pg.query("select * from search_clients('Client','','')"),
    /Staff access/,
  );
  await as(null, "anon");
  await assert.rejects(
    pg.query("select * from search_clients('Client','','')"),
    /permission denied/,
  );
});
test("database: staff booking is linked to the client and audited to the staff actor", async () => {
  await as(staffA);
  booking = await one(
    "select * from staff_book_appointment($1,$2,1,$3,600,$4,true)",
    [clientId, treatmentId, date, "saved_demo"],
  );
  assert.equal(booking.user_id, clientUser);
  assert.equal(booking.client_id, clientId);
  assert.equal(booking.guarantee_amount, "10.00");
  await as(staffB);
  const a = await one("select * from get_client_activity($1)", [clientId]);
  assert.equal(a.action, "staff_booking_created");
  assert.equal(a.actor_name, "Aoife");
  await as(clientUser);
  assert.equal(
    (await pg.query("select * from appointments where id=$1", [booking.id]))
      .rows.length,
    1,
  );
  await assert.rejects(
    pg.query("update appointments set start_minute=660 where id=$1", [
      booking.id,
    ]),
    /permission denied/,
  );
});
test("database: double booking and misaligned 60-minute slots are rejected", async () => {
  await as(staffA);
  await assert.rejects(
    pg.query("select * from staff_book_appointment($1,$2,1,$3,600,$4,true)", [
      clientId,
      treatmentId,
      date,
      "saved_demo",
    ]),
    /no longer available/,
  );
  await assert.rejects(
    pg.query("select * from staff_book_appointment($1,$2,1,$3,610,$4,true)", [
      clientId,
      treatmentId,
      date,
      "saved_demo",
    ]),
    /no longer available/,
  );
});
test("database: amendment preserves old treatment price, retains before/after and rejects stale updates", async () => {
  await as(null, "service_role");
  await pg.exec("reset role");
  await pg.query("update treatments set price=price+5 where id=$1", [
    treatmentId,
  ]);
  await as(staffA);
  booking = await one("select * from amend_appointment($1,$2,1,$3,660,0,$4)", [
    booking.id,
    treatmentId,
    date,
    "Client requested later",
  ]);
  assert.equal(booking.start_minute, 660);
  await assert.rejects(
    pg.query("select * from amend_appointment($1,$2,1,$3,720,0,$4)", [
      booking.id,
      treatmentId,
      date,
      "Stale change",
    ]),
    /changed/,
  );
  const events = (
    await pg.query("select * from get_client_activity($1)", [clientId])
  ).rows;
  const a = events.find((e) => e.action === "appointment_amended");
  assert.equal(a.details.before.start_minute, 600);
  assert.equal(a.details.after.start_minute, 660);
  assert.equal(a.details.before.price, a.details.after.price);
  await as(clientUser);
  await assert.rejects(
    pg.query("select * from get_booking_slots($1,$2,1,$3)", [
      treatmentId,
      date,
      booking.id,
    ]),
    /Staff amendment/,
  );
});
test("database: cancellation is retained in history and frees availability", async () => {
  await as(staffA);
  await pg.query(
    "select update_appointment_status($1,'cancelled',null,$2,'Client called')",
    [booking.id, booking.revision],
  );
  assert.equal(
    (await one("select * from appointments where id=$1", [booking.id])).status,
    "cancelled",
  );
  const slots = (
    await pg.query("select * from get_available_slots($1,$2,1)", [
      treatmentId,
      date,
    ])
  ).rows;
  assert(slots.some((s) => s.start_minute === 660));
});
test("database: own lunch editing changes slots; attempts to edit another staff break fail", async () => {
  await as(staffA);
  const lunch = await one(
    "select * from save_staff_break($1,840,870,'lunch')",
    [date],
  );
  const slots = (
    await pg.query("select * from get_available_slots($1,$2,1)", [
      treatmentId,
      date,
    ])
  ).rows;
  assert(slots.some((s) => s.start_minute === 780));
  assert(!slots.some((s) => s.start_minute === 840));
  await as(staffB);
  await assert.rejects(
    pg.query("select * from save_staff_break($1,850,880,'lunch',$2,$3)", [
      date,
      lunch.id,
      lunch.revision,
    ]),
    /own breaks/,
  );
  const defaults = (
    await pg.query("select * from get_diary_breaks($1)", [date])
  ).rows;
  assert.equal(defaults.find((b) => b.staff_id === 2).start_minute, 780);
  await as(staffA);
  const future = await one(
    "select * from staff_book_appointment($1,$2,1,$3,600,$4,true)",
    [clientId, treatmentId, date, "saved_demo"],
  );
  await assert.rejects(
    pg.query("select * from save_staff_break($1,615,645,'break')", [date]),
    /overlaps an appointment/,
  );
  await assert.rejects(
    pg.query(
      "select update_appointment_status($1,'no_show',null,0,'Missing')",
      [future.id],
    ),
    /future appointment/,
  );
});
test("database: new records and notes are staff-only; client edits are audited and optimistic", async () => {
  await as(staffA);
  const c = await one(
    "select * from create_client('New Demo','new@example.com','0800000005')",
  );
  await pg.query(
    "select * from add_client_note($1,'Prefers quiet appointments')",
    [c.id],
  );
  const updated = await one(
    "select * from update_client($1,'New Name','new@example.com','0800000006',0)",
    [c.id],
  );
  assert.equal(updated.revision, 1);
  await assert.rejects(
    pg.query(
      "select * from update_client($1,'Overwrite','new@example.com','0800000006',0)",
      [c.id],
    ),
    /changed/,
  );
  await as(clientUser);
  assert.equal(
    (await pg.query("select * from clients where id=$1", [c.id])).rows.length,
    0,
  );
  assert.equal((await pg.query("select * from client_notes")).rows.length, 0);
  await as(accountant);
  assert.equal((await pg.query("select * from clients")).rows.length, 0);
  assert.equal(
    (await pg.query("select * from staff_day_breaks")).rows.length,
    0,
  );
});
test("database: browser callers cannot provision accounts or link other identities", async () => {
  await as(staffA);
  await assert.rejects(
    pg.query("select link_client_account($1,$2)", [clientId, staffA]),
    /permission denied/,
  );
  await assert.rejects(
    pg.query("select reserve_client_account($1,$2)", [clientId, staffA]),
    /permission denied/,
  );
  await as(clientUser);
  await assert.rejects(
    pg.query("select * from staff_book_appointment($1,$2,1,$3,720,$4,true)", [
      clientId,
      treatmentId,
      date,
      "saved_demo",
    ]),
    /Staff access/,
  );
});
test("database: existing client self and proxy booking RPC still works with client records", async () => {
  await as(clientUser);
  const self = await one(
    "select * from book_appointment($1,2,$2,600,'Client Test','0800000000',true,true,'client@example.com','saved_demo')",
    [treatmentId, date],
  );
  assert.equal(self.client_id, clientId);
  const proxy = await one(
    "select * from book_appointment($1,2,$2,660,'Other Demo','0800000008',true,false,'other@example.com','new_demo')",
    [treatmentId, date],
  );
  assert.notEqual(proxy.client_id, clientId);
  assert.equal(proxy.user_id, clientUser);
  assert.equal(proxy.booked_for_self, false);
});

test("database: recorded no-show keeps history, actor and the guarantee uncharged", async () => {
  await as(null, "service_role");
  await pg.exec("reset role");
  const a = await one(
    "insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price) values($1,$2,1,$3,'2000-01-03',600,60,'Client Test','0800000000','Historic Demo',45) returning *",
    [clientId, clientUser, treatmentId],
  );
  await as(staffA);
  await pg.query(
    "select update_appointment_status($1,'no_show',null,0,'Did not attend')",
    [a.id],
  );
  assert.equal(
    (await one("select * from appointments where id=$1", [a.id])).status,
    "no_show",
  );
  const event = (
    await pg.query("select * from get_client_activity($1)", [clientId])
  ).rows.find((e) => e.details?.after === "no_show");
  assert.equal(event.details.guarantee_charged, false);
});
test("database: owner-disabled personal breaks and pending temporary passwords are enforced", async () => {
  await as(null, "service_role");
  await pg.exec("reset role");
  await pg.query(
    "update staff_users set can_manage_own_breaks=false where user_id=$1",
    [staffA],
  );
  await as(staffA);
  await assert.rejects(
    pg.query("select * from save_staff_break($1,900,915,'break')", [date]),
    /disabled/,
  );
  await pg.exec("reset role");
  await pg.query(
    "update staff_users set can_manage_own_breaks=true where user_id=$1",
    [staffA],
  );
  await pg.query("update auth.users set raw_app_meta_data=$2 where id=$1", [
    clientUser,
    { requires_password_change: true },
  ]);
  await as(clientUser);
  await assert.rejects(
    pg.query(
      "select * from book_appointment($1,2,$2,960,'Client Test','0800000000',true,true,'client@example.com','saved_demo')",
      [treatmentId, date],
    ),
    /temporary password/,
  );
});
test("database: provisioning reservations serialize login creation and link history atomically with an audit", async () => {
  await as(staffA);
  const c = await one(
    "select * from create_client('Login Demo','login@example.com','0800000010')",
  );
  await as(null, "service_role");
  const reservation = await one("select * from reserve_client_account($1,$2)", [
    c.id,
    staffA,
  ]);
  assert.equal(reservation.account_creation_actor, staffA);
  await assert.rejects(
    pg.query("select * from reserve_client_account($1,$2)", [c.id, staffB]),
    /cannot be provisioned/,
  );
  await pg.exec("reset role");
  const uid = "10000000-0000-0000-0000-000000000005";
  await pg.query(
    "insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3)",
    [uid, c.email, { requires_password_change: true }],
  );
  await as(null, "service_role");
  await pg.query("select link_client_account($1,$2)", [c.id, uid]);
  await pg.query("select release_client_account_reservation($1,$2)", [
    c.id,
    staffA,
  ]);
  await as(staffA);
  const linked = await one("select * from clients where id=$1", [c.id]);
  assert.equal(linked.auth_user_id, uid);
  assert.equal(linked.account_creation_actor, null);
  const event = (
    await pg.query("select * from get_client_activity($1)", [c.id])
  ).rows.find((e) => e.action === "client_account_created");
  assert.equal(event.actor_name, "Aoife");
});
test("database: clock records are per staff and require an open shift", async () => {
  await as(staffA);
  await assert.rejects(pg.query("select clock_out()"), /Clock in/i);
  const w = await one("select * from clock_in()");
  assert.equal(w.staff_name, "Aoife");
  await assert.rejects(pg.query("select clock_in()"), /already/i);
  await as(staffB);
  await assert.rejects(pg.query("select clock_out()"), /Clock in/i);
  const l = await one("select * from clock_in()");
  assert.equal(l.staff_name, "Leah");
  await pg.query("select clock_out()");
  await as(staffA);
  const closed = await one("select * from clock_out()");
  assert.equal(closed.id, w.id);
  assert(closed.clocked_out_at >= closed.clocked_in_at);
  await as(accountant);
  assert.equal((await pg.query("select * from work_sessions")).rows.length, 0);
  await assert.rejects(pg.query("select clock_in()"), /Staff access/);
});
test("database: vouchers retain value and audited transfers, rejecting stale and unauthorized changes", async () => {
  await as(staffB);
  const target = await one(
    "select * from create_client('Voucher Recipient','voucher@example.com','0800000099')",
  );
  await assert.rejects(pg.query("select create_voucher(-1,'2080-01-01',null)"));
  const v = await one("select * from create_voucher(50,'2080-01-01',$1)", [
    clientId,
  ]);
  assert(v.code.startsWith("SC-"));
  const changed = await one("select * from reassign_voucher($1,$2,$3)", [
    v.id,
    target.id,
    v.revision,
  ]);
  assert.equal(changed.assigned_client_name, "Voucher Recipient");
  assert.equal(Number(changed.original_amount), 50);
  await assert.rejects(
    pg.query("select reassign_voucher($1,$2,$3)", [v.id, clientId, v.revision]),
    /changed/i,
  );
  const found = await one("select * from search_vouchers($1,null)", [
    v.code.toLowerCase().replaceAll("-", ""),
  ]);
  assert.equal(Number(found.balance), 50);
  assert.equal(
    (
      await pg.query("select * from voucher_transactions where voucher_id=$1", [
        v.id,
      ])
    ).rows.length,
    2,
  );
  await as(accountant);
  assert.equal((await pg.query("select * from vouchers")).rows.length, 0);
  await assert.rejects(
    pg.query("select create_voucher(10,'2080-01-01',null)"),
    /Staff access/,
  );
});
let hrStaff;
test("database: staff creation stores private HR, one pay rate, hashed PIN and a public profile", async () => {
  await as(staffA);
  const details = {
    first_name: "Nora",
    last_name: "Test",
    address: "Private address",
    date_of_birth: "1990-01-01",
    phone: "0800000001",
    email: "nora@example.com",
    date_hired: "2020-01-01",
    employment_type: "hourly",
    hourly_rate: 20,
    salary: 999,
    commission_rate: 5,
    photo_url: null,
  };
  hrStaff = await one("select * from save_admin_staff(null,$1,$2,0)", [
    details,
    "2580",
  ]);
  hrStaff = hrStaff.save_admin_staff;
  assert.equal(hrStaff.name, "Nora Test");
  assert.equal(Number(hrStaff.hourly_rate), 20);
  assert.equal(hrStaff.salary, null);
  assert.equal(hrStaff.commission_rate, null);
  assert.equal(hrStaff.pin_hash, undefined);
  assert.equal(hrStaff.demo_pin, undefined);
  const hrList = (await one("select list_admin_staff()")).list_admin_staff;
  assert(
    hrList.some(
      (s) => s.staff_id === hrStaff.id && s.address === "Private address",
    ),
  );
  assert(hrList.every((s) => s.pin_hash === undefined));
  const profile = await one("select * from portal_profiles where staff_id=$1", [
    hrStaff.id,
  ]);
  assert(profile.profile_key);
  assert.equal(profile.role, "staff");
  await assert.rejects(
    pg.query("select save_admin_staff($1,$2,$3,0)", [
      hrStaff.id,
      details,
      "2580",
    ]),
    /changed/,
  );
  await as(staffB);
  assert.equal((await pg.query("select * from staff_details")).rows.length, 0);
  await assert.rejects(pg.query("select list_admin_staff()"), /Admin access/);
  await assert.rejects(
    pg.query("select save_staff_skills($1,$2)", [hrStaff.id, [treatmentId]]),
    /Admin access/,
  );
  await assert.rejects(
    pg.query("select verify_staff_pin('aoife','1234')"),
    /permission denied/,
  );
  await as(accountant);
  assert.equal((await pg.query("select * from staff_notes")).rows.length, 0);
  await assert.rejects(pg.query("select list_admin_staff()"), /Admin access/);
  await as(null, "anon");
  assert.equal(
    (
      await pg.query(
        "select display_name from portal_profiles where staff_id=$1",
        [hrStaff.id],
      )
    ).rows.length,
    1,
  );
  await assert.rejects(
    pg.query("select * from staff_details"),
    /permission denied/,
  );
});
test("database: date-specific shifts and skills determine slots, including Sunday and 8am starts", async () => {
  await as(staffA);
  await pg.query("select save_staff_skills($1,$2)", [
    hrStaff.id,
    [treatmentId],
  ]);
  const days = [
    {
      shift_date: "2080-01-07",
      start_minute: 480,
      end_minute: 660,
      revision: 0,
    },
    {
      shift_date: "2080-01-08",
      start_minute: null,
      end_minute: null,
      revision: 0,
    },
  ];
  await pg.query("select save_staff_shifts($1,$2)", [hrStaff.id, days]);
  await as(clientUser);
  const slots = (
    await pg.query("select * from get_available_slots($1,$2,$3)", [
      treatmentId,
      "2080-01-07",
      hrStaff.id,
    ])
  ).rows;
  assert(slots.some((x) => x.start_minute === 480));
  assert(slots.every((x) => x.start_minute + 60 <= 660));
  assert.equal(
    (
      await pg.query("select * from get_available_slots($1,$2,$3)", [
        treatmentId,
        "2080-01-08",
        hrStaff.id,
      ])
    ).rows.length,
    0,
  );
  await as(staffA);
  await assert.rejects(
    pg.query("select save_staff_shifts($1,$2)", [hrStaff.id, days]),
    /changed/,
  );
  await pg.query("select save_staff_skills($1,$2)", [hrStaff.id, []]);
  assert.equal(
    (
      await pg.query("select * from get_available_slots($1,$2,$3)", [
        treatmentId,
        "2080-01-07",
        hrStaff.id,
      ])
    ).rows.length,
    0,
  );
});
test("database: HR notes are soft removed and PIN verification locks repeated failures", async () => {
  await as(staffA);
  const n = await one("select * from add_staff_note($1,'Private HR note')", [
    hrStaff.id,
  ]);
  await pg.query("select remove_staff_note($1)", [n.id]);
  assert(
    (await one("select * from staff_notes where id=$1", [n.id])).removed_at,
  );
  const profile = await one(
    "select profile_key from portal_profiles where staff_id=$1",
    [hrStaff.id],
  );
  await as(null, "service_role");
  for (let i = 0; i < 5; i++) {
    const r = await one("select verify_staff_pin($1,$2)", [
      profile.profile_key,
      "0000",
    ]);
    assert.equal(r.verify_staff_pin.valid, false);
  }
  assert.equal(
    (await one("select verify_staff_pin($1,$2)", [profile.profile_key, "2580"]))
      .verify_staff_pin.valid,
    false,
  );
  await pg.exec("reset role");
  await pg.query(
    "update staff_pin_secrets set locked_until=now()-interval '1 minute' where staff_id=$1",
    [hrStaff.id],
  );
  await as(null, "service_role");
  assert.equal(
    (await one("select verify_staff_pin($1,$2)", [profile.profile_key, "2580"]))
      .verify_staff_pin.valid,
    true,
  );
});
test("database: admin clock corrections retain originals in audit and reject overlap or stale writes", async () => {
  await as(staffA);
  const w = await one(
    "select * from correct_staff_clock(2,null,now()-interval '2 days',now()-interval '2 days'+interval '2 hours','Forgot clock-in',0)",
  );
  assert.equal(w.staff_name, "Leah");
  const corrected = await one(
    "select * from correct_staff_clock(2,$1,now()-interval '2 days'+interval '10 minutes',now()-interval '2 days'+interval '2 hours','Correct start',1)",
    [w.id],
  );
  assert.equal(corrected.revision, 2);
  const audit = await one(
    "select details from audit_events where action='staff_clock_corrected' and details->'after'->>'id'=$1 order by id desc limit 1",
    [w.id],
  );
  assert.equal(
    new Date(audit.details.before.clocked_in_at).toISOString(),
    new Date(w.clocked_in_at).toISOString(),
  );
  assert.equal(audit.details.reason, "Correct start");
  await assert.rejects(
    pg.query(
      "select correct_staff_clock(2,$1,now()-interval '2 days',now()-interval '2 days'+interval '2 hours','Old version',1)",
      [w.id],
    ),
    /changed/,
  );
  await as(staffB);
  await assert.rejects(
    pg.query(
      "select correct_staff_clock(2,null,now()-interval '4 days',now()-interval '3 days','No',0)",
    ),
    /Admin access/,
  );
});
test("database: archiving retains private history but removes profile and availability", async () => {
  await as(staffA);
  await pg.query(
    "select archive_admin_staff($1,(now() at time zone 'Europe/Dublin')::date,'Left salon',$2)",
    [hrStaff.id, hrStaff.revision],
  );
  assert.equal(
    (await one("select active from staff where id=$1", [hrStaff.id])).active,
    false,
  );
  assert.equal(
    (
      await one("select staff_id from staff_details where staff_id=$1", [
        hrStaff.id,
      ])
    ).staff_id,
    hrStaff.id,
  );
  await as(null, "anon");
  assert.equal(
    (
      await pg.query("select * from portal_profiles where staff_id=$1", [
        hrStaff.id,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await pg.query("select * from get_available_slots($1,$2,$3)", [
        treatmentId,
        "2080-01-07",
        hrStaff.id,
      ])
    ).rows.length,
    0,
  );
});
let purchased;
test("database: client profile changes are scoped to the caller and marketing is opt-in", async () => {
  await pg.exec("reset role");
  await pg.query("update auth.users set raw_app_meta_data='{}' where id=$1", [
    clientUser,
  ]);
  await as(clientUser);
  const p = await one("select * from get_my_profile()");
  assert.equal(p.marketing_email, false);
  const changed = await one(
    "select * from update_my_profile($1,$2,true,false,true,$3)",
    ["Updated Client", "0800000077", p.revision],
  );
  assert.equal(changed.name, "Updated Client");
  assert.equal(changed.marketing_email, true);
  assert.equal(changed.marketing_sms, false);
  assert.equal(changed.marketing_whatsapp, true);
  await assert.rejects(
    pg.query("select update_my_profile($1,$2,false,false,false,$3)", [
      "Old",
      "0800000000",
      p.revision,
    ]),
    /changed/,
  );
  await as(staffB);
  await assert.rejects(pg.query("select get_my_profile()"), /Client sign-in/);
  await as(accountant);
  await assert.rejects(
    pg.query("select update_my_profile($1,$2,false,false,false,0)", [
      "Other",
      "0800000000",
    ]),
    /Client sign-in/,
  );
});
test("database: demo purchases use server prices and idempotency, with no raw card storage", async () => {
  await as(clientUser);
  const request = "30000000-0000-0000-0000-000000000001";
  const first = await one(
    "select purchase_demo_voucher($1,$2,true,$3,$4,$5,true,$6)",
    [
      "treatment",
      treatmentId,
      "Ignored",
      "ignored@example.com",
      "saved_demo",
      request,
    ],
  );
  purchased = first.purchase_demo_voucher;
  const t = await one("select price from treatments where id=$1", [
    treatmentId,
  ]);
  assert.equal(Number(purchased.original_amount), Number(t.price));
  assert.equal(purchased.recipient_email, "client@example.com");
  assert.equal(purchased.demo_purchase, true);
  const again = await one(
    "select purchase_demo_voucher($1,null,true,$2,$3,$4,true,$5)",
    ["25", "", "", "saved_demo", request],
  );
  assert.equal(again.purchase_demo_voucher.id, purchased.id);
  assert.equal(
    (
      await pg.query("select * from demo_voucher_orders where request_id=$1", [
        request,
      ])
    ).rows.length,
    1,
  );
  assert.equal(purchased.card_number, undefined);
  await assert.rejects(
    pg.query(
      "select purchase_demo_voucher('1000',null,true,'','','saved_demo',true,gen_random_uuid())",
    ),
    /amount/,
  );
  const mine = (await one("select get_my_vouchers()")).get_my_vouchers;
  assert(mine.some((v) => v.id === purchased.id));
  await as(accountant);
  await assert.rejects(
    pg.query(
      "select purchase_demo_voucher('25',null,true,'','','saved_demo',true,gen_random_uuid())",
    ),
    /Client sign-in/,
  );
  await assert.rejects(pg.query("select get_my_vouchers()"), /Client sign-in/);
});
test("database: gift vouchers are visible only to the assigned verified email and transfers update ownership", async () => {
  await as(clientUser);
  const r = await one(
    "select purchase_demo_voucher('50',null,false,'Gift Friend','friend@example.com','new_demo',true,gen_random_uuid())",
  );
  const gift = r.purchase_demo_voucher;
  assert(
    !(await one("select get_my_vouchers()")).get_my_vouchers.some(
      (v) => v.id === gift.id,
    ),
  );
  await pg.exec("reset role");
  const friend = "30000000-0000-0000-0000-000000000002";
  await pg.query(
    "insert into auth.users(id,email) values($1,'friend@example.com')",
    [friend],
  );
  await as(friend);
  assert(
    (await one("select get_my_vouchers()")).get_my_vouchers.some(
      (v) => v.id === gift.id,
    ),
  );
  await assert.rejects(
    pg.query("select simulate_voucher_email($1,$2)", [gift.id, "self"]),
    /not found/,
  );
  await as(clientUser);
  assert.equal(
    (await one("select simulate_voucher_email($1,$2)", [gift.id, "recipient"]))
      .simulate_voucher_email,
    "friend@example.com",
  );
  await as(staffA);
  await pg.query("select reassign_voucher($1,$2,$3)", [
    gift.id,
    clientId,
    gift.revision,
  ]);
  await as(friend);
  assert(
    !(await one("select get_my_vouchers()")).get_my_vouchers.some(
      (v) => v.id === gift.id,
    ),
  );
  await as(clientUser);
  assert(
    (await one("select get_my_vouchers()")).get_my_vouchers.some(
      (v) => v.id === gift.id,
    ),
  );
});
test("database: an unconfirmed email cannot claim recipient vouchers", async () => {
  await pg.exec("reset role");
  const uid = "30000000-0000-0000-0000-000000000003";
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'client@example.com',null)",
    [uid],
  );
  await as(uid);
  assert.deepEqual((await one("select get_my_vouchers()")).get_my_vouchers, []);
});

test("database: admin manages another staff break; staff and accountant are denied", async () => {
  await as(staffB);
  await assert.rejects(pg.query("select admin_save_staff_break(1,current_date+30,840,855,'break',null,0)"), /Admin access/);
  await as(accountant);
  await assert.rejects(pg.query("select admin_save_staff_break(1,current_date+30,840,855,'break',null,0)"), /Admin access/);
  await pg.exec("reset role");
  await pg.query("update staff_users set role='admin',active=true where user_id=$1", [staffA]);
  const dt = (await one("select (current_date+30 + ((8-extract(dow from current_date+30)::integer)%7))::text as date")).date;
  await pg.query("insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(2,$1,480,1200) on conflict(staff_id,shift_date) do update set start_minute=480,end_minute=1200", [dt]);
  await as(staffA);
  const b = await one("select * from admin_save_staff_break(2,$1,1080,1095,'break',null,0)", [dt]);
  assert.equal(b.staff_id, 2);
  const changed = await one("select * from admin_save_staff_break(2,$1,1095,1110,'break',$2,$3)", [dt,b.id,b.revision]);
  assert.equal(changed.start_minute, 1095);
  await assert.rejects(pg.query("select admin_save_staff_break(1,$1,1095,1110,'break',$2,$3)",[dt,b.id,changed.revision]), /selected staff/);
});

test("database: testing reset requires all three clients and preserves staff and audits", async () => {
  await pg.exec("reset role");
  const sql = await readFile(new URL("../supabase/reset_testing_data.sql", import.meta.url), "utf8");
  await assert.rejects(pg.exec(sql), /Create the three/);
  await pg.exec("rollback");
  for (const [i,email,name] of [[1,'jacqui@example.com','Jacqui Durnin'],[2,'aoife@example.com','Aoife Durnin'],[3,'damian@example.com','Damian McGrath']]) {
    const id=`90000000-0000-0000-0000-00000000000${i}`;
    await pg.query("insert into auth.users(id,email) values($1,$2)",[id,email]);
    await pg.query("insert into clients(auth_user_id,name,email,phone) values($1,$2,$3,'123')",[id,name,email]);
  }
  const before=(await one("select count(*)::integer as n from staff_users")).n;
  await pg.exec(sql);
  assert.equal((await one("select count(*)::integer as n from appointments")).n,0);
  assert.equal((await one("select count(*)::integer as n from staff_users")).n,before);
  assert.equal((await one("select count(*)::integer as n from audit_events where action='testing_data_reset'")).n,1);
});
