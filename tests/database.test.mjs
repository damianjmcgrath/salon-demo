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
  await pg.exec(await readFile(new URL("../supabase/010_booking_confirmation_emails.sql", import.meta.url), "utf8"));
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

test("database: confirmations queue once, stay private and serialize retry claims", async () => {
  await pg.exec("reset role");
  const id='91000000-0000-0000-0000-000000000001';
  await pg.query("insert into appointments(id,user_id,client_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price) values($1,$2,$4,1,$3,'2088-01-05',600,60,'Jacqui Durnin','123','Glam Package',99)",[id,clientUser,treatmentId,clientId]);
  assert.equal((await one("select count(*)::integer as n from booking_email_queue where appointment_id=$1",[id])).n,1);
  await pg.query("update appointments set client_name='Changed' where id=$1",[id]);
  assert.equal((await one("select snapshot from booking_email_queue where appointment_id=$1",[id])).snapshot.client_name,'Jacqui Durnin');
  await as(clientUser);
  await assert.rejects(pg.query("select * from booking_email_queue"),/permission denied/);
  await assert.rejects(pg.query("select claim_booking_emails()"),/permission denied/);
  await as(null,'service_role');
  const claimed=(await pg.query("select * from claim_booking_emails()")).rows;
  assert.equal(claimed.length,1);
  assert.equal(claimed[0].attempts,1);
  assert.equal((await pg.query("select * from claim_booking_emails()")).rows.length,0);
  await pg.query("update booking_email_queue set locked_until=now()-interval '1 minute' where appointment_id=$1",[id]);
  const retry=(await pg.query("select * from claim_booking_emails()")).rows[0];
  assert.equal(retry.id,claimed[0].id);
  assert.notEqual(retry.claim_token,claimed[0].claim_token);
  await pg.query("update booking_email_queue set locked_until=now()-interval '1 minute',first_attempt_at=now()-interval '24 hours' where appointment_id=$1",[id]);
  assert.equal((await pg.query("select * from claim_booking_emails()")).rows.length,0);
  assert.equal((await one("select status from booking_email_queue where appointment_id=$1",[id])).status,'review');
  await pg.exec("reset role");
  await pg.query("delete from appointments where id=$1",[id]);
  assert.equal((await one("select count(*)::integer as n from booking_email_queue where appointment_id=$1",[id])).n,0);
});

test('database: proxy bookings reuse email identity and are visible to creator and attendee only', async()=>{
 await pg.exec('reset role');
 const recipient='90000000-0000-0000-0000-000000000003';
 const original=await one("select * from clients where auth_user_id=$1",[recipient]);
 // Two historical unlinked duplicate attendees, as the old trigger created.
 for(let i=0;i<2;i++) {
  const dup=await one("insert into clients(name,email,phone) values('Damian McGrath','damian@example.com','07891039749') returning id");
  await pg.query("insert into appointments(user_id,client_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,booked_for_self,attendee_email) values($1,$2,1,$3,'2089-01-02',$4,15,'Damian McGrath','07891039749','Test',25,false,'damian@example.com')",[clientUser,dup.id,treatmentId,600+i*60]);
 }
 await pg.exec(await readFile(new URL('../supabase/011_client_email_matching.sql',import.meta.url),'utf8'));
 const repair=await readFile(new URL('../supabase/repair_damian_duplicate_clients.sql',import.meta.url),'utf8');
 await pg.exec(repair);await pg.exec(repair);
 assert.equal((await one('select count(*)::int n from appointments where client_id=$1',[original.id])).n,2);
 assert.equal((await one("select count(*)::int n from clients where merged_into=$1",[original.id])).n,2);
 await pg.exec('reset role');
 const a=await one("insert into appointments(user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,booked_for_self,attendee_email) values($1,1,$2,'2089-01-02',780,15,'Damian McGrath','07891 039749','Test',25,false,' DAMIAN@EXAMPLE.COM ') returning *",[clientUser,treatmentId]);
 assert.equal(a.client_id,original.id);
 assert.equal((await one('select phone from clients where id=$1',[original.id])).phone,original.phone);
 await as(recipient);
 assert.equal((await pg.query('select * from get_my_appointments()')).rows.length,3);
 assert.equal((await pg.query('select * from appointments where id=$1',[a.id])).rows.length,1);
 await as(clientUser);
 assert.equal((await pg.query('select * from get_my_appointments()')).rows.length,3);
 await as('90000000-0000-0000-0000-000000000001');
 assert.equal((await pg.query('select * from get_my_appointments()')).rows.length,0);
 assert.equal((await pg.query('select * from appointments where id=$1',[a.id])).rows.length,0);
 await as(staffA);
 assert.equal((await pg.query("select * from search_clients('Damian','','')")).rows.length,1);
 await assert.rejects(pg.query("select create_client('Duplicate','DAMIAN@EXAMPLE.COM','07891039749')"), /already exists/);
});

test('activity reports include empty periods, aggregate recorded methods and protect financial access', async () => {
 await pg.exec('reset role');
 await pg.exec(await readFile(new URL('../supabase/012_activity_reports.sql',import.meta.url),'utf8'));
 const c=await one("select id from clients where auth_user_id=$1",[clientUser]);
 for(const [day,minute,status,method,price] of [
  ['2090-01-01',600,'completed','card',99],['2090-01-01',660,'completed','cash',40],['2090-01-01',720,'completed','voucher',25],['2090-01-01',780,'completed','credit',10],['2090-01-01',840,'booked',null,50],['2090-01-01',900,'cancelled',null,50],['2090-01-01',960,'no_show',null,50],['2090-02-01',600,'completed','card',100]
 ]) await pg.query("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status,payment_method,completed_at) values($1,$2,1,$3,$4,$5,15,'Activity test','123','Test',$6,$7,$8,case when $7='completed' then ($4::date::text || ' 12:00:00+00')::timestamptz else null end)",[c.id,clientUser,treatmentId,day,minute,price,status,method]);
 await as(staffA);
 const daily=(await pg.query("select * from get_activity_report('2090-01-01','2090-01-06','day')")).rows;
 assert.equal(daily.length,6);assert.equal(Number(daily[0].appointments_scheduled),6);assert.equal(Number(daily[0].appointments_completed),4);
 assert.equal(Number(daily[0].card_terminal_fee),1.49);assert.equal(Number(daily[0].retained_card_payments),97.51);assert.equal(Number(daily[0].total_payments),172.51);assert.equal(Number(daily[5].total_payments),0);
 const months=(await pg.query("select * from get_activity_report('2090-01-01','2090-03-31','month')")).rows;
 assert.equal(months.length,3);assert.equal(Number(months[1].card_terminal_fee),1.5);assert.equal(Number(months[2].appointments_completed),0);
 await assert.rejects(pg.query("select * from get_activity_report('2090-01-06','2090-01-01','day')"),/valid date range/);
 await as(accountant);assert.equal((await pg.query("select * from get_activity_report('2090-01-01','2090-01-06','day')")).rows.length,6);
 for(const uid of [staffB,clientUser]) {await as(uid);await assert.rejects(pg.query("select * from get_activity_report('2090-01-01','2090-01-06','day')"),/Reporting access required/);}
});

test('staff reports use first arrival, final departure, sum multiple sessions and strictly filter HR exceptions',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/013_staff_reports.sql',import.meta.url),'utf8'));
 await pg.query("update staff_details set employment_type='hourly',hourly_rate=12,salary=null,commission_rate=null where staff_id=1");
 for(const day of ['2027-01-04','2027-01-05','2027-01-06','2027-01-07']) await pg.query("insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(1,$1,540,1020) on conflict(staff_id,shift_date) do update set start_minute=540,end_minute=1020",[day]);
 for(const [start,end] of [['2027-01-04T09:20:00Z','2027-01-04T13:00:00Z'],['2027-01-04T13:30:00Z','2027-01-04T17:00:00Z'],['2027-01-05T09:15:00Z','2027-01-05T16:45:00Z'],['2027-01-07T09:00:00Z','2027-01-07T13:00:00Z']]) await pg.query("insert into work_sessions(user_id,staff_id,staff_name,clocked_in_at,clocked_out_at) values($1,1,'Aoife',$2,$3)",[staffA,start,end]);
 // Re-open after lunch: final departure must not be mistaken for the lunch clock-out.
 await pg.query("update work_sessions set clocked_out_at=clocked_in_at where staff_id=1 and clocked_out_at is null");
 await pg.query("insert into work_sessions(user_id,staff_id,staff_name,clocked_in_at) values($1,1,'Aoife','2027-01-07T13:30:00Z')",[staffA]);
 await pg.query("insert into staff_notes(staff_id,body,created_at,created_by) values(1,'Report note without clocks','2027-01-06T12:00:00Z',$1)",[staffA]);
 await as(staffA);
 let r=await one("select get_staff_report('clock',1,'2027-01-04','2027-01-07') data");
 assert.equal(r.data.length,4);assert.equal(Number(r.data[0].worked_minutes),430);assert.equal(Number(r.data[0].start_difference),20);assert.equal(Number(r.data[0].end_difference),0);assert.equal(new Date(r.data[0].first_clock_in).toISOString(),"2027-01-04T09:20:00.000Z");assert.equal(new Date(r.data[0].last_clock_out).toISOString(),"2027-01-04T17:00:00.000Z");assert.equal(r.data[3].last_clock_out,null);assert.equal(Number(r.data[3].open_sessions),1);
 r=await one("select get_staff_report('payroll',null,'2027-01-04','2027-01-05') data");const aoife=r.data.find(s=>s.id===1);assert.equal(Number(aoife.actual_minutes),880);assert.equal(Number(aoife.expected_minutes),960);assert.equal(Number(aoife.total_pay),176);
 r=await one("select get_staff_report('hr',1) data");assert(r.data.some(d=>d.day==='2027-01-04'));assert(!r.data.some(d=>d.day==='2027-01-05'));assert(r.data.some(d=>d.day==='2027-01-06'&&d.notes.includes('Report note')));
 await assert.rejects(pg.query("select * from staff_report_days(1,'2027-01-04','2027-01-05')"),/permission denied/);
 await as(accountant);assert((await one("select get_staff_report('payroll',null,'2027-01-04','2027-01-05') data")).data.length>=2);
 for(const uid of [clientUser,staffB]){await as(uid);await assert.rejects(pg.query("select get_staff_report('hr',1)"),/Reporting access required/);await assert.rejects(pg.query("select * from report_staff_options()"),/Reporting access required/);}
});

test('patch tests preserve snapshots, deduplicate treatment selections and restrict history to salon staff',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/014_client_patch_tests.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 await as(staffA);
 const r=await one('select * from record_client_patch_test($1,1,array[$2,$2]::integer[])',[c.id,treatmentId]);
 assert.equal(r.treatments_covered.length,1);assert.equal(r.client_id,c.id);assert.equal(r.recorded_by,staffA);assert(r.recorded_at);assert(r.staff_name);
 assert((await pg.query('select * from get_client_activity($1)',[c.id])).rows.some(a=>a.action==='patch_test_recorded'));
 await assert.rejects(pg.query('select record_client_patch_test($1,1,array[$2,999999]::integer[])',[c.id,treatmentId]),/valid treatments/);
 await assert.rejects(pg.query('select record_client_patch_test($1,1,array[]::integer[])',[c.id]),/valid treatments/);
 await assert.rejects(pg.query('select record_client_patch_test($1,999999,array[$2]::integer[])',[c.id,treatmentId]),/active staff member/);
 await assert.rejects(pg.query('delete from client_patch_tests where id=$1',[r.id]),/permission denied/);
 await as(staffB);assert.equal((await pg.query('select * from client_patch_tests where client_id=$1',[c.id])).rows.length,1);
 for(const uid of [clientUser,accountant]){await as(uid);assert.equal((await pg.query('select * from client_patch_tests where client_id=$1',[c.id])).rows.length,0);await assert.rejects(pg.query('select record_client_patch_test($1,1,array[$2]::integer[])',[c.id,treatmentId]),/Staff access required/);}
});

test('verified signup claims proxy attendee history; credit notes and client values remain staff only',async()=>{
 await pg.exec('reset role');
 const lily='b0000000-0000-0000-0000-000000000001';
 await pg.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'lily@example.com','{\"full_name\":\"Lily McGrath\"}')",[lily]);
 const attendee=await one("insert into clients(name,email,phone) values('Lily McGrath','LILY@example.com','07891000000') returning *");
 const original=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const booking=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,booked_for_self,attendee_email) values($1,$2,1,$3,'2095-01-02',600,15,'Lily McGrath','123','Test',25,false,'lily@example.com') returning *",[original.id,clientUser,treatmentId]);
 // Historical creator/attendee mix-up is repaired without altering booking ownership.
 await pg.exec(await readFile(new URL('../supabase/015_client_account_values.sql',import.meta.url),'utf8'));
 let fixed=await one('select * from appointments where id=$1',[booking.id]);assert.equal(fixed.client_id,attendee.id);assert.equal(fixed.user_id,clientUser);
 await as(lily);const own=await one('select ensure_own_client() id');assert.equal(own.id,attendee.id);assert.equal((await pg.query('select * from get_my_appointments()')).rows.length,1);
 await as(clientUser);assert((await pg.query('select * from get_my_appointments()')).rows.some(a=>a.id===booking.id));
 await as(staffA);const note=await one("select * from create_client_credit_note($1,35.50,'Goodwill adjustment')",[attendee.id]);assert.equal(Number(note.amount),35.5);assert.equal(note.created_by,staffA);
 await assert.rejects(pg.query("select create_client_credit_note($1,-1,'Invalid')",[attendee.id]),/positive euro/);
 await assert.rejects(pg.query("select create_client_credit_note($1,10,' ')",[attendee.id]),/reason/);
 const gift=await one("select * from create_voucher(25,'2100-01-01',$1)",[attendee.id]);
 const values=await one('select get_client_values($1) data',[attendee.id]);assert.equal(values.data.credit_notes.length,1);assert.equal(Number(values.data.credit_notes[0].balance),35.5);assert(values.data.vouchers.some(v=>v.id===gift.id));assert.equal(values.data.redemptions.length,0);
 for(const uid of [lily,accountant]){await as(uid);await assert.rejects(pg.query('select get_client_values($1)',[attendee.id]),/Staff access required/);await assert.rejects(pg.query("select create_client_credit_note($1,10,'No')",[attendee.id]),/Staff access required/);}
 // Unconfirmed email cannot claim an existing person's record.
 await pg.exec('reset role');const unverified='b0000000-0000-0000-0000-000000000002';await pg.query("insert into auth.users(id,email,email_confirmed_at) values($1,'unverified-guest@example.com',null)",[unverified]);const guest=await one("insert into clients(name,email,phone) values('Guest','unverified-guest@example.com','123') returning *");await as(unverified);const unconfirmed=await one('select ensure_own_client() id');assert.notEqual(unconfirmed.id,guest.id);
 await pg.exec('reset role');await pg.query('update auth.users set email_confirmed_at=now() where id=$1',[unverified]);await as(unverified);const confirmed=await one('select ensure_own_client() id');assert.equal(confirmed.id,unconfirmed.id);await pg.exec('reset role');assert.equal((await one('select merged_into from clients where id=$1',[guest.id])).merged_into,confirmed.id);
});

test('booking guarantees enforce card ownership and atomically audit no-show decisions',async()=>{
 await pg.exec('reset role');
 await pg.exec(await readFile(new URL('../supabase/017_booking_guarantees.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const other=await one("insert into clients(name,email,phone) values('Card owner','card-owner@example.com','12345') returning id");
 const card=await one("insert into booking_guarantee_cards(client_id,created_by,setup_order_id,customer_id,payment_method_id,verified_at) values($1,$2,'test-setup','customer-1','method-1',now()) returning id",[c.id,clientUser]);
 const wrong=await one("insert into booking_guarantee_cards(client_id,created_by,setup_order_id,verified_at) values($1,$2,'other-setup',now()) returning id",[other.id,clientUser]);
 const unverified=await one("insert into booking_guarantee_cards(client_id,created_by,setup_order_id) values($1,$2,'unfinished-setup') returning id",[c.id,clientUser]);
 await as(clientUser);
 await assert.rejects(pg.query('select * from booking_guarantee_cards'),/permission denied/);
 await assert.rejects(pg.query("select book_appointment($1,1,'2080-01-09',600,'Client','123',true,true,'client@example.com','saved_demo')",[treatmentId]),/permission denied/);
 const sql="select * from book_guaranteed_appointment($1,1,'2080-01-09',600,'Guest','12345',false,'proxy-guest@example.com',$2,true,null)";
 for(const id of [wrong.id,unverified.id])await assert.rejects(pg.query(sql,[treatmentId,id]),/verified card/);
 await assert.rejects(pg.query("select book_guaranteed_appointment($1,1,'2080-01-09',600,'Guest','12345',false,'proxy-guest@example.com',$2,true,$3)",[treatmentId,card.id,other.id]),/another card owner/);
 const slot=await one("select * from get_available_slots($1,'2080-01-09',1) limit 1",[treatmentId]);assert(slot);
 const a=await one("select * from book_guaranteed_appointment($1,1,'2080-01-09',$2,'Guest','12345',false,'proxy-guest@example.com',$3,true,null)",[treatmentId,slot.start_minute,card.id]);
 assert.equal(a.guarantee_card_id,card.id);assert.equal(a.user_id,clientUser);assert.notEqual(a.client_id,c.id);assert.equal(a.demo_card,null);
 await assert.rejects(pg.query("select record_no_show_decision($1,0,true,'Charge fee')",[a.id]),/Staff access/);
 await as(staffA);
 await assert.rejects(pg.query("select record_no_show_decision($1,0,true,'Charge fee')",[a.id]),/future appointment/);
 await pg.exec('reset role');
 const past=[];
 for(const minute of [600,720,840])past.push(await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status,guarantee_card_id) values($1,$2,1,$3,'2020-01-06',$4,15,'Client','123','Test',40,'booked',$5) returning *",[c.id,clientUser,treatmentId,minute,card.id]));
 await as(staffB);
 await assert.rejects(pg.query("select record_no_show_decision($1,0,false,' ')",[past[0].id]),/comments/);
 await pg.query("select record_no_show_decision($1,0,false,'Waived for illness')",[past[0].id]);
 await assert.rejects(pg.query("select record_no_show_decision($1,1,true,'Second attempt')",[past[0].id]),/already been recorded/);
 await pg.query("select record_no_show_decision($1,0,true,'No contact from client')",[past[1].id]);
 // Recording a terminal payment has no relationship to the online fee worker.
 await pg.query("select update_appointment_status($1,'checked_in',null,0,null)",[past[2].id]);
 await pg.query("select update_appointment_status($1,'completed','card',1,null)",[past[2].id]);
 await pg.exec('reset role');
 assert.equal((await one('select state from no_show_fees where appointment_id=$1',[past[0].id])).state,'waived');
 assert.equal((await one('select state from no_show_fees where appointment_id=$1',[past[1].id])).state,'pending');
 assert.equal((await one('select status from appointments where id=$1',[past[1].id])).status,'no_show');
 assert.equal((await pg.query('select * from no_show_fees where appointment_id=$1',[past[2].id])).rows.length,0);
 assert.equal((await one('select payment_method from appointments where id=$1',[past[2].id])).payment_method,'card');
 await pg.query("update no_show_fees set state='completed' where appointment_id=$1",[past[1].id]);
 await as(staffA);
 assert((await pg.query('select * from get_client_activity($1)',[c.id])).rows.some(e=>e.action==='no_show_fee_status'&&e.details.after==='completed'));
 await as(accountant);await assert.rejects(pg.query("select record_no_show_decision($1,0,true,'No')",[past[2].id]),/Staff access/);
 await assert.rejects(pg.query('select * from no_show_fees'),/permission denied/);
});


test('guarantee worker has only the required client and appointment read permissions',async()=>{
 await pg.exec('reset role');
 await pg.exec(await readFile(new URL('../supabase/018_booking_guarantee_permissions.sql',import.meta.url),'utf8'));
 await as(null,'service_role');
 assert((await pg.query('select id,name,email from clients limit 1')).rows.length);
 assert((await pg.query('select id,status,guarantee_card_id from appointments limit 1')).rows.length);
 await assert.rejects(pg.query('select phone from clients limit 1'),/permission denied/);
 await assert.rejects(pg.query("update clients set name='Unauthorised'"),/permission denied/);
 await assert.rejects(pg.query("update appointments set status='no_show'"),/permission denied/);
 await as(clientUser);
 await assert.rejects(pg.query('select * from booking_guarantee_cards'),/permission denied/);
 await assert.rejects(pg.query('select * from no_show_fees'),/permission denied/);
});

test('Sandbox testing permits future no-shows and disabling the switch restores the date rule',async()=>{
 await pg.exec('reset role');
 await pg.exec(await readFile(new URL('../supabase/019_sandbox_no_show_testing.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const future=[];
 for(const minute of [600,720])future.push(await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,1,$3,'2095-01-06',$4,15,'Future test','123','Test',40,'booked') returning *",[c.id,clientUser,treatmentId,minute]));
 await as(staffB);assert.equal((await one('select sandbox_no_show_testing_enabled() enabled')).enabled,true);
 await pg.query("select record_no_show_decision($1,0,false,'Sandbox future appointment test')",[future[0].id]);
 const activity=(await pg.query('select * from get_client_activity($1)',[c.id])).rows;
 assert(activity.some(e=>e.action==='status_changed'&&e.details.sandbox_future_no_show===true));
 await assert.rejects(pg.query('update sandbox_testing_settings set allow_future_no_shows=false'),/permission denied/);
 await pg.exec('reset role');await pg.exec('update sandbox_testing_settings set allow_future_no_shows=false');
 await as(staffA);assert.equal((await one('select sandbox_no_show_testing_enabled() enabled')).enabled,false);
 await assert.rejects(pg.query("select record_no_show_decision($1,0,false,'Testing disabled')",[future[1].id]),/future appointment/);
 await as(clientUser);assert.equal((await one('select sandbox_no_show_testing_enabled() enabled')).enabled,false);
 await assert.rejects(pg.query('select * from sandbox_testing_settings'),/permission denied/);
});

test('split checkout redeems balances atomically, rejects duplicates and reports each tender separately', async()=>{
 await pg.exec('reset role');
 await pg.exec(await readFile(new URL('../supabase/020_split_checkout.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 let minute=480;
 async function ap(price=80,status='checked_in'){
  await pg.exec('reset role');minute+=20;
  return one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,2,$3,'2021-04-01',$4,15,'Checkout client','123','Checkout treatment',$5,$6) returning *",[c.id,clientUser,treatmentId,minute,price,status]);
 }
 const sql='select * from checkout_appointment($1,$2,$3,$4,$5,$6,$7)';
 const a=await ap();await as(staffA);
 const voucher=await one("select * from create_voucher(100,'2100-01-01',$1)",[c.id]);
 await assert.rejects(pg.query("select update_appointment_status($1,'completed','card',0,null)",[a.id]),/Check Client Out/);
 await pg.query(sql,[a.id,0,'voucher',voucher.code,null,null,80]);
 await assert.rejects(pg.query(sql,[a.id,0,'voucher',voucher.code,null,null,80]),/appointment changed/);
 let values=(await one('select get_client_values($1) data',[c.id])).data;
 assert.equal(Number(values.vouchers.find(v=>v.id===voucher.id).balance),20);
 const redemption=values.redemptions.find(r=>r.appointment_id===a.id);assert.equal(Number(redemption.amount),80);assert.equal(redemption.voucher_id,voucher.id);assert.equal(redemption.staff_name,'Leah');
 assert.equal(Number((await one('select * from search_vouchers($1,null)',[voucher.code])).balance),20);
 await as(clientUser);assert.equal(Number((await one('select get_my_vouchers() data')).data.find(v=>v.id===voucher.id).balance),20);
 const b=await ap();await as(staffB);
 // Failed split checkout leaves the appointment and value balance intact.
 await assert.rejects(pg.query(sql,[b.id,0,'voucher',voucher.code,null,null,20]),/remaining balance/);
 await assert.rejects(pg.query(sql,[b.id,0,'voucher',voucher.code,null,'card',80]),/balance changed/);
 assert.equal((await one('select status from appointments where id=$1',[b.id])).status,'checked_in');
 assert.equal(Number((await one('select * from search_vouchers($1,null)',[voucher.code])).balance),20);
 await pg.query(sql,[b.id,0,'voucher',voucher.code,null,'card',20]);
 assert.equal((await one('select payment_method from appointments where id=$1',[b.id])).payment_method,'split');
 assert.deepEqual((await pg.query('select method,amount::float8 amount from appointment_payments where appointment_id=$1 order by method',[b.id])).rows,[{method:'card',amount:60},{method:'voucher',amount:20}]);
 await assert.rejects(pg.query('select reassign_voucher($1,$2,2)',[voucher.id,c.id]),/already assigned|remaining value/);
 const d=await ap(80);await as(staffA);
 const note=await one("select * from create_client_credit_note($1,100,'Checkout test')",[c.id]);
 await pg.query(sql,[d.id,0,'credit',null,note.id,null,80]);
 values=(await one('select get_client_values($1) data',[c.id])).data;
 assert.equal(Number(values.credit_notes.find(n=>n.id===note.id).balance),20);
 const e=await ap(80);await as(staffA);
 await pg.query(sql,[e.id,0,'credit',null,note.id,'cash',20]);
 const f=await ap(25);await as(staffA);await pg.query(sql,[f.id,0,'card',null,null,null,null]);
 const g=await ap(10);await as(staffA);await pg.query(sql,[g.id,0,'cash',null,null,null,null]);
 const zero=await ap(0);await as(staffA);await pg.query(sql,[zero.id,0,'cash',null,null,null,null]);
 const bad=await ap(25);await as(staffA);
 await assert.rejects(pg.query(sql,[bad.id,0,'voucher',voucher.code,null,'cash',0]),/remaining value/);
 const expired=await one("select * from create_voucher(30,'2100-01-01',$1)",[c.id]);await pg.exec('reset role');await pg.query("update vouchers set expires_on='2000-01-01' where id=$1",[expired.id]);await as(staffA);
 await assert.rejects(pg.query(sql,[bad.id,0,'voucher',expired.code,null,null,25]),/expired/);
 const other=await one("select * from create_client('Other checkout','other-checkout@example.com','12345')");
 const otherNote=await one("select * from create_client_credit_note($1,30,'Other person')",[other.id]);
 await assert.rejects(pg.query(sql,[bad.id,0,'credit',null,otherNote.id,null,25]),/assigned to this client/);
 // Exact-code vouchers can be used as physical gift vouchers, even when assigned elsewhere.
 const gift=await one("select * from create_voucher(30,'2100-01-01',$1)",[other.id]);
 const found=(await one('select get_checkout_options($1,$2) data',[bad.id,gift.code.toLowerCase()])).data.found_voucher;assert.equal(found.id,gift.id);
 await pg.query(sql,[bad.id,0,'voucher',gift.code,null,null,25]);
 for(const uid of [clientUser,accountant]){await as(uid);await assert.rejects(pg.query(sql,[bad.id,1,'cash',null,null,null,null]),/Staff access/);await assert.rejects(pg.query('select get_checkout_options($1)',[bad.id]),/Staff access/);assert.equal((await pg.query('select * from appointment_payments')).rows.length,0);}
 await as(staffA);await assert.rejects(pg.query("insert into appointment_payments(appointment_id,method,amount,recorded_by) values($1,'card',5,$2)",[bad.id,staffA]),/permission denied/);
 await pg.exec('reset role');await pg.exec("update appointments set completed_at='2021-04-01 12:00:00Z' where appointment_date='2021-04-01' and status='completed'");
 await as(accountant);
 const report=await one("select * from get_activity_report('2021-04-01','2021-04-01','day')");
 assert.equal(Number(report.card_payments),85);assert.equal(Number(report.cash_payments),70);assert.equal(Number(report.vouchers_used),125);assert.equal(Number(report.credit_notes_used),100);assert.equal(Number(report.appointments_completed),8);
 assert.equal(Number(report.total_payments),378.72); // 380 gross less rounded 1.5% fee on 85.
 const monthly=await one("select * from get_activity_report('2021-04-01','2021-04-30','month')");assert.equal(Number(monthly.card_payments),85);
 await pg.exec('reset role');assert.equal((await pg.query('select * from no_show_fees where appointment_id=$1',[b.id])).rows.length,0);
 // History identifies voucher use and its original code; audit stores both split amounts.
 await as(staffA);assert((await pg.query('select * from get_client_activity($1)',[c.id])).rows.some(e=>e.action==='appointment_checked_out'&&e.details.payment_method==='split'));
});

test('management permissions enforce delegated views/actions and client guarantee exemptions on the server', async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/021_management_permissions_deposits.sql',import.meta.url),'utf8'));
 await as(staffA);let rows=(await one('select list_staff_permissions() data')).data;
 const aoife=rows.find(s=>s.id===1),leah=rows.find(s=>s.id===2);assert(aoife&&leah);
 assert.equal(aoife.permissions['view.permissions'],true);assert.equal(leah.permissions['view.treatments'],false);
 await assert.rejects(pg.query('select save_staff_permissions(1,$1,0)',[{...aoife.permissions,'view.permissions':false}]),/cannot be disabled/);
 await as(staffB);await assert.rejects(pg.query('select list_staff_permissions()'),/Permission denied/);
 await assert.rejects(pg.query("select save_treatment($1,'Unauthorized','',30,10,false,0)",[treatmentId]),/Permission denied/);
 await as(staffA);const grants={...leah.permissions,'view.treatments':true,'view.staff':true,'view.reporting':true,'perform.own_breaks':false,'perform.credit_notes':false,'perform.waive_fees':false};
 await pg.query('select save_staff_permissions(2,$1,0)',[grants]);await assert.rejects(pg.query('select save_staff_permissions(2,$1,0)',[grants]),/Permissions changed/);
 await as(staffB);assert.equal((await one("select has_permission('view.staff') allowed")).allowed,true);assert((await one('select list_admin_staff() data')).data.length);
 const old=await one('select * from treatments where id=$1',[treatmentId]);
 const edited=await one("select * from save_treatment($1,'Managed treatment','New treatment description',60,75.50,false,$2)",[treatmentId,old.revision]);assert.equal(Number(edited.price),75.5);assert.equal(edited.description,'New treatment description');
 await assert.rejects(pg.query("select save_treatment($1,'Stale','',60,1,false,$2)",[treatmentId,old.revision]),/Treatment changed/);
 await assert.rejects(pg.query("select save_treatment($1,'Bad','',0,1,false,$2)",[treatmentId,edited.revision]),/valid length/);
 assert((await pg.query("select * from get_activity_report('2021-04-01','2021-04-01')")).rows.length);
 assert((await pg.query('select * from report_staff_options()')).rows.length);
 assert((await pg.query("select get_staff_report('payroll',null,'2021-04-01','2021-04-01')")).rows.length);
 const c=await one('select * from clients where auth_user_id=$1',[clientUser]);
 await assert.rejects(pg.query("select create_client_credit_note($1,10,'No permission')",[c.id]),/Permission denied/);
 await assert.rejects(pg.query("select save_staff_break('2080-01-09',810,825,'break',null,0)"),/own breaks/);
 await as(staffA);const changed=await one('select * from update_client_details($1,$2,$3,$4,$5,false)',[c.id,c.name,c.email,c.phone,c.revision]);assert.equal(changed.requires_deposit,false);
 await as(clientUser);assert.equal((await one('select booking_requires_guarantee() required')).required,false);
 await assert.rejects(pg.query('select update_client_details($1,$2,$3,$4,$5,false)',[c.id,c.name,c.email,c.phone,changed.revision]),/Permission denied/);
 const slot=await one("select * from get_available_slots($1,'2080-01-09',1) limit 1",[treatmentId]);assert(slot);
 const booked=await one("select * from book_guaranteed_appointment($1,1,'2080-01-09',$2,$3,$4,true,$5,null,false,null)",[treatmentId,slot.start_minute,c.name,c.phone,c.email]);assert.equal(booked.guarantee_required,false);assert.equal(booked.guarantee_card_id,null);await pg.exec('reset role');assert.equal((await one('select snapshot from booking_email_queue where appointment_id=$1',[booked.id])).snapshot.guarantee_required,false);await as(clientUser);assert.equal(Number(booked.price),75.5);assert.equal(booked.treatment_name,'Managed treatment');
 // Exempt payer cannot bypass a different attendee's requirement.
 assert.equal((await one("select booking_requires_guarantee('unknown-attendee@example.com',null) required")).required,true);
 await assert.rejects(pg.query("select book_guaranteed_appointment($1,1,'2080-01-09',1020,'Unknown','12345',false,'unknown-attendee@example.com',null,false,null)",[treatmentId]),/Agree to the booking guarantee/);
 await pg.exec('reset role');await pg.exec('update sandbox_testing_settings set allow_future_no_shows=true');
 const required=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price) values($1,$2,1,$3,'2022-01-01',600,15,'Required','123','Test',25) returning *",[c.id,clientUser,treatmentId]);
 await as(staffB);await assert.rejects(pg.query("select record_no_show_decision($1,0,false,'Waive')",[required.id]),/permission to waive/);
 await assert.rejects(pg.query("select update_appointment_status($1,'no_show',null,0,'Bypass')",[required.id]),/fee decision/);
 await assert.rejects(pg.query("select record_no_show_decision($1,0,true,'Fee')",[booked.id]),/exempt/);
 await pg.query("select record_no_show_decision($1,0,false,'Exempt client did not attend')",[booked.id]);
 await pg.query("select record_no_show_decision($1,0,true,'Required fee')",[required.id]);
 // Removing a page blocks direct RPC use and its private HR reads, not just the tile.
 await as(staffA);await pg.query('select save_staff_permissions(2,$1,1)',[{...grants,'view.staff':false,'view.treatments':false,'view.reporting':false,'view.clients':false,'view.diary':false,'view.appointments':false,'view.vouchers':false}]);
 await as(staffB);await assert.rejects(pg.query('select list_admin_staff()'),/Permission denied/);assert.equal((await pg.query('select * from staff_details')).rows.length,0);assert.equal((await pg.query('select * from appointments')).rows.length,0);
 await assert.rejects(pg.query('select get_client_activity($1)',[c.id]),/Permission denied/);
 await assert.rejects(pg.query("select get_activity_report('2021-01-01','2021-01-01')"),/Permission denied/);
 await assert.rejects(pg.query("select search_clients('','','')"),/Permission denied/);
 await assert.rejects(pg.query("select * from checkout_appointment($1,1,'cash')",[required.id]),/Permission denied/);
 await as(accountant);assert((await pg.query("select * from get_activity_report('2021-04-01','2021-04-01')")).rows.length);await assert.rejects(pg.query('select list_staff_permissions()'),/Permission denied/);
});

test('self booking routes missing patch clearance to a named patch appointment and enforces a full 24 hours after recording',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/022_self_patch_test_booking.sql',import.meta.url),'utf8'));
 const patient='d0000000-0000-0000-0000-000000000005';await pg.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'patch-client@example.com','{\"full_name\":\"Patch Client\",\"mobile\":\"123456789\"}')",[patient]);
 await pg.exec("insert into treatments(id,name,category,price,price_type,duration,patch_required) values(8001,'Sensitive Treatment','Brows',80,'Fixed',60,true)");
 const patchService=await one('select treatment_id id from patch_booking_settings');
 await pg.query('insert into staff_treatments(staff_id,treatment_id) values(1,8001),(2,8001),(1,$1),(2,$1) on conflict do nothing',[patchService.id]);
 await as(patient);const cid=(await one('select ensure_own_client() id')).id;
 let plan=(await one('select get_self_booking_plan(8001) data')).data;assert.equal(plan.patch_needed,true);assert.equal(plan.treatment.id,patchService.id);assert.equal(plan.treatment.name,'Patch Test for Sensitive Treatment');assert.equal(plan.guarantee_required,false);assert.equal(Number(plan.treatment.price),0);
 const slot=await one("select * from get_self_booking_slots(8001,'2080-01-09',1) limit 1");assert(slot);
 const ap=await one("select * from book_guaranteed_appointment($1,1,'2080-01-09',$2,'Patch Client','123456789',true,'patch-client@example.com',null,false,null,8001)",[patchService.id,slot.start_minute]);
 assert.equal(ap.patch_for_treatment_id,8001);assert.equal(ap.patch_for_treatment_name,'Sensitive Treatment');assert.equal(ap.treatment_name,'Patch Test for Sensitive Treatment');assert.equal(ap.guarantee_required,false);assert.equal(ap.guarantee_card_id,null);assert.equal(Number(ap.price),0);
 assert.equal((await one('select get_self_booking_plan(8001) data')).data.patch_needed,true); // Scheduling is not a performed patch test.
 assert((await pg.query('select * from get_my_appointments()')).rows.some(a=>a.id===ap.id&&a.treatment_name==='Patch Test for Sensitive Treatment'));
 await pg.exec('reset role');let snapshot=(await one('select snapshot from booking_email_queue where appointment_id=$1',[ap.id])).snapshot;assert.equal(snapshot.treatment_name,ap.treatment_name);assert.equal(snapshot.guarantee_required,false);
 const card=await one("insert into booking_guarantee_cards(client_id,created_by,setup_order_id,customer_id,payment_method_id,verified_at) values($1,$2,'patch-owner-setup','patch-customer','patch-method',now()) returning id",[cid,patient]);
 await as(patient);await assert.rejects(pg.query("select book_guaranteed_appointment(8001,1,'2080-01-10',600,'Patch Client','123456789',true,'patch-client@example.com',$1,true,null)",[card.id]),/recorded patch test/);
 await assert.rejects(pg.query("select book_guaranteed_appointment($1,1,'2080-01-10',600,'Other','123456789',false,'other@example.com',null,false,null,8001)",[patchService.id]),/only available for client self/);
 // Staff can amend a patch appointment without losing its intended treatment label.
 await as(staffA);const edited=await one("select * from amend_appointment($1,$2,1,'2080-01-09',$3,0,'Client requested change')",[ap.id,patchService.id,ap.start_minute]);assert.equal(edited.treatment_name,ap.treatment_name);assert.equal(edited.patch_for_treatment_id,8001);
 // Completing/checking out the scheduled patch does not manufacture clinical clearance.
 await pg.exec('reset role');await pg.query("update appointments set status='completed' where id=$1",[ap.id]);await as(patient);assert.equal((await one('select get_self_booking_plan(8001) data')).data.patch_needed,true);
 await as(staffA);const record=await one('select * from record_client_patch_test($1,1,array[8001])',[cid]);
 await pg.exec('reset role');await pg.query("update client_patch_tests set recorded_at='2080-01-09 09:00:00Z' where id=$1",[record.id]);
 await as(patient);plan=(await one('select get_self_booking_plan(8001) data')).data;assert.equal(plan.patch_needed,false);assert.equal(plan.treatment.id,8001);assert.equal(plan.guarantee_required,true);assert.equal(new Date(plan.earliest_treatment_at).toISOString(),'2080-01-10T09:00:00.000Z');
 assert.equal((await pg.query("select * from get_self_booking_slots(8001,'2080-01-09',1)")).rows.length,0);
 const next=(await pg.query("select * from get_self_booking_slots(8001,'2080-01-10',1)")).rows;assert(next.length);assert(next.every(s=>s.start_minute>=540));
 await assert.rejects(pg.query("select book_guaranteed_appointment(8001,1,'2080-01-10',539,'Patch Client','123456789',true,'patch-client@example.com',$1,true,null)",[card.id]),/24 hours/);
 await assert.rejects(pg.query("select book_guaranteed_appointment($1,1,'2080-01-10',600,'Patch Client','123456789',true,'patch-client@example.com',null,false,null,8001)",[patchService.id]),/requirements changed/);
 // Staff can now book the intended treatment at the 24-hour boundary with the client's normal guarantee.
 await as(staffA);const treatment=await one("select * from book_guaranteed_appointment(8001,1,'2080-01-10',$1,'Patch Client','123456789',true,'patch-client@example.com',$2,true,$3)",[next[0].start_minute,card.id,cid]);assert.equal(treatment.treatment_name,'Sensitive Treatment');assert.equal(Number(treatment.price),80);assert.equal(treatment.patch_for_treatment_id,null);assert.equal(treatment.guarantee_card_id,card.id);
 // A different treatment still has no coverage, and non-patch services continue normally.
 await pg.exec('reset role');await pg.exec("insert into treatments(id,name,category,price,price_type,duration,patch_required) values(8002,'Other Sensitive Treatment','Brows',20,'Fixed',30,true)");await as(patient);assert.equal((await one('select get_self_booking_plan(8002) data')).data.patch_needed,true);
 const normal=(await one('select get_self_booking_plan($1) data',[treatmentId])).data;assert.equal(normal.patch_needed,false);assert.equal(normal.treatment.id,treatmentId);
 await as(staffA);const patch=await one('select * from treatments where id=$1',[patchService.id]);await assert.rejects(pg.query("select save_treatment($1,'PATCH TEST','',5,0,true,$2,false)",[patch.id,patch.revision]),/cannot itself require/);
 const saved=await one("select * from save_treatment($1,'PATCH TEST','',5,0,false,$2,true)",[patch.id,patch.revision]);assert.equal(saved.guarantee_required,true);await as(patient);assert.equal((await one('select get_self_booking_plan(8002) data')).data.guarantee_required,true);
 await as(accountant);await assert.rejects(pg.query('select get_self_booking_plan(8001)'),/Client sign-in/);
 await as(null,'anon');await assert.rejects(pg.query('select get_self_booking_plan(8001)'),/permission denied/);
});

test('proxy patch bookings match normalized attendee email, retain payer ownership and require exact-treatment clearance',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/023_proxy_patch_test_booking.sql',import.meta.url),'utf8'));
 const service=(await one('select treatment_id id from patch_booking_settings')).id;
 await pg.query('update treatments set guarantee_required=false where id=$1',[service]);
 await pg.exec('insert into staff_treatments(staff_id,treatment_id) values(1,8002),(2,8002) on conflict do nothing');
 const patient=(await one("select * from clients where email='patch-client@example.com'"));
 const booker=await one('select * from clients where auth_user_id=$1',[clientUser]);
 const card=await one("insert into booking_guarantee_cards(client_id,created_by,setup_order_id,customer_id,payment_method_id,verified_at) values($1,$2,'proxy-payer-setup','proxy-payer','proxy-card',now()) returning id",[booker.id,clientUser]);
 await as(clientUser);
 // Existing attendee has clearance for 8001, but not 8002. No client identity or history is returned.
 let plan=(await one("select get_proxy_booking_plan(8001,' PATCH-CLIENT@EXAMPLE.COM ') data")).data;
 assert.equal(plan.patch_needed,false);assert.equal(plan.treatment.id,8001);assert.equal(plan.guarantee_required,true);assert.equal(plan.client_id,undefined);assert.equal(plan.email,undefined);
 assert.equal((await pg.query("select * from get_proxy_booking_slots(8001,'patch-client@example.com','2080-01-09',1)")).rows.length,0);
 await assert.rejects(pg.query("select book_guaranteed_appointment(8001,1,'2080-01-10',539,'Patch Client','123456789',false,'patch-client@example.com',$1,true,null)",[card.id]),/24 hours/);
 const slot=await one("select * from get_proxy_booking_slots(8001,' PATCH-CLIENT@EXAMPLE.COM ','2080-01-11',1) limit 1");assert(slot);
 const normal=await one("select * from book_guaranteed_appointment(8001,1,'2080-01-11',$1,'Patch Client','07891039749',false,' PATCH-CLIENT@EXAMPLE.COM ',$2,true,null)",[slot.start_minute,card.id]);
 assert.equal(normal.client_id,patient.id);assert.equal(normal.user_id,clientUser);assert.equal(normal.guarantee_card_id,card.id);assert.equal(normal.treatment_name,'Sensitive Treatment');
 plan=(await one("select get_proxy_booking_plan(8002,'patch-client@example.com') data")).data;assert.equal(plan.patch_needed,true);
 const ps=await one("select * from get_proxy_booking_slots(8002,'patch-client@example.com','2080-01-11',1) limit 1");assert(ps);
 const patch=await one("select * from book_guaranteed_appointment($1,1,'2080-01-11',$2,'Patch Client','123456789',false,'patch-client@example.com',null,false,null,8002)",[service,ps.start_minute]);
 assert.equal(patch.client_id,patient.id);assert.equal(patch.treatment_name,'Patch Test for Other Sensitive Treatment');assert.equal(patch.guarantee_required,false);assert.equal(patch.patch_for_treatment_id,8002);
 await assert.rejects(pg.query("select book_guaranteed_appointment(8002,1,'2080-01-12',600,'Patch Client','123456789',false,'patch-client@example.com',$1,true,null)",[card.id]),/recorded patch test/);
 // Unknown attendee: plan does not create a record. Actual patch booking creates just one email-matched record.
 const unknown='new-patch-guest@example.com';
 plan=(await one('select get_proxy_booking_plan(8002,$1) data',[unknown])).data;assert.equal(plan.patch_needed,true);assert.equal(plan.guarantee_required,false);
 const nslot=await one("select * from get_proxy_booking_slots(8002,$1,'2080-01-12',1) limit 1",[unknown]);assert(nslot);
 const guest=await one("select * from book_guaranteed_appointment($1,1,'2080-01-12',$2,'New Guest','123456789',false,$3,null,false,null,8002)",[service,nslot.start_minute,unknown]);assert.notEqual(guest.client_id,booker.id);assert.equal(guest.treatment_name,'Patch Test for Other Sensitive Treatment');
 const nslot2=await one("select * from get_proxy_booking_slots(8002,$1,'2080-01-12',1) limit 1",[unknown]);
 const guest2=await one("select * from book_guaranteed_appointment($1,1,'2080-01-12',$2,'New Guest','123456789',false,$3,null,false,null,8002)",[service,nslot2.start_minute,unknown.toUpperCase()]);assert.equal(guest2.client_id,guest.client_id);
 const nonpatch=(await one('select get_proxy_booking_plan($1,$2) data',[treatmentId,unknown])).data;assert.equal(nonpatch.patch_needed,false);assert.equal(nonpatch.treatment.id,treatmentId);
 const plainSlot=await one("select * from get_proxy_booking_slots($1,$2,'2080-01-12',1) limit 1",[treatmentId,unknown]);assert(plainSlot);
 const plain=await one("select * from book_guaranteed_appointment($1,1,'2080-01-12',$2,'New Guest','123456789',false,$3,$4,true,null)",[treatmentId,plainSlot.start_minute,unknown,card.id]);assert.equal(plain.client_id,guest.client_id);assert.equal(plain.patch_for_treatment_id,null);assert.equal(plain.guarantee_card_id,card.id);
 assert.equal((await one('select get_proxy_booking_plan($1,$2) data',[treatmentId,patient.email])).data.patch_needed,false);

 await assert.rejects(pg.query("select get_proxy_booking_plan(8001,'bad email')"),/valid email/);
 // Attendee's saved card cannot be borrowed by the booking creator.
 await pg.exec('reset role');const patientCard=await one('select id from booking_guarantee_cards where client_id=$1 limit 1',[patient.id]);await as(clientUser);
 await assert.rejects(pg.query("select book_guaranteed_appointment(8001,1,'2080-01-12',660,'Patch Client','123456789',false,'patch-client@example.com',$1,true,null)",[patientCard.id]),/belonging to the booking payer/);
 const mine=(await pg.query('select * from get_my_appointments()')).rows;assert(mine.some(a=>a.id===guest.id&&a.booked_for_self===false));
 await pg.exec('reset role');assert.equal((await one('select count(*) n from clients where lower(email)=$1',[unknown])).n,1);
 const snapshot=(await one('select snapshot from booking_email_queue where appointment_id=$1',[guest.id])).snapshot;assert.equal(snapshot.treatment_name,guest.treatment_name);assert.equal(snapshot.guarantee_required,false);
 await as(accountant);await assert.rejects(pg.query("select get_proxy_booking_plan(8002,'patch-client@example.com')"),/Client sign-in/);
 await as(null,'anon');await assert.rejects(pg.query("select get_proxy_booking_plan(8002,'patch-client@example.com')"),/permission denied/);
});

test('free checkout completes without any tender, retains audit and rejects paid/stale/unauthorized requests',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/024_free_appointment_checkout.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const a=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status,patch_for_treatment_id) values($1,$2,1,69,'1990-01-01',600,5,'Patch Client','123','Patch Test for Sensitive Treatment',0,'checked_in',8001) returning *",[c.id,clientUser]);
 await as(staffA);await assert.rejects(pg.query("select checkout_appointment($1,0,'card')",[a.id]),/No payment method/);
 const done=await one('select * from checkout_appointment($1,0,null)',[a.id]);assert.equal(done.status,'completed');assert.equal(done.payment_method,null);assert.equal(done.revision,1);assert(done.completed_at);assert.equal(done.patch_for_treatment_id,8001);
 await assert.rejects(pg.query('select checkout_appointment($1,0,null)',[a.id]),/changed/);
 await pg.exec('reset role');assert.equal((await one('select count(*) n from appointment_payments where appointment_id=$1',[a.id])).n,0);assert.equal((await one("select details from audit_events where appointment_id=$1 and action='appointment_checked_out'",[a.id])).details.free_appointment,true);
 const paid=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,1,8001,'1990-01-02',600,60,'Client','123','Paid',80,'checked_in') returning *",[c.id,clientUser]);
 await as(staffA);await assert.rejects(pg.query('select checkout_appointment($1,0,null)',[paid.id]),/Choose a payment method/);
 for(const uid of [clientUser,accountant,staffB]){await as(uid);await assert.rejects(pg.query('select checkout_appointment($1,1,null)',[a.id]),/Staff access|Permission denied/);}
});

test('voucher status report includes each voucher once with partial/full usage, buyer and all appointments, and enforces reporting access',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/025_voucher_status_report.sql',import.meta.url),'utf8'));
 const c=await one('select * from clients where auth_user_id=$1',[clientUser]);
 const part=await one("insert into vouchers(code,original_amount,expires_on,client_id,assigned_client_name,purchased_by,created_by) values('REPORT-PART',100,'2030-01-01',$1,'Gift Recipient',$2,$2) returning *",[c.id,clientUser]);
 const full=await one("insert into vouchers(code,original_amount,expires_on,client_id,assigned_client_name,created_by) values('REPORT-FULL',50,'2030-01-01',$1,'Recipient',$2) returning *",[c.id,staffA]);
 await pg.query("insert into voucher_transactions(voucher_id,kind,amount,user_id) values($1,'issued',100,$3),($2,'issued',50,$3)",[part.id,full.id,staffA]);
 for(const [i,v,amount] of [[0,part,20],[1,part,10],[2,full,50]]){
 const a=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,1,8001,'1990-01-05',$3,15,'Client','123',$4,$5,'completed') returning *",[c.id,clientUser,600+i*60,'Report Treatment '+i,amount]);
 await pg.query("insert into client_value_redemptions(client_id,voucher_id,appointment_id,amount,treatment_name,staff_name,recorded_by,used_at) values($1,$2,$3,$4,$5,'Aoife',$6,$7)",[c.id,v.id,a.id,amount,a.treatment_name,staffA,'2026-01-0'+(i+1)+'T10:00:00Z']);
 }
 await as(accountant);const rows=(await one('select get_voucher_status_report() data')).data;
 const p=rows.filter(v=>v.code==='REPORT-PART');assert.equal(p.length,1);assert.equal(Number(p[0].original_amount),100);assert.equal(Number(p[0].redeemed_amount),30);assert.equal(Number(p[0].balance),70);assert.equal(p[0].uses.length,2);assert.equal(p[0].purchased_by,c.name);assert.equal(p[0].purchased_for,'Gift Recipient');assert.equal(p[0].uses[0].treatment_name,'Report Treatment 0');assert.equal(p[0].uses[1].start_minute,660);
 const f=rows.find(v=>v.code==='REPORT-FULL');assert.equal(Number(f.balance),0);assert.equal(Number(f.redeemed_amount),50);assert.equal(f.purchased_by,'Not recorded');assert.equal(new Set(rows.map(v=>v.id)).size,rows.length);
 await as(staffA);assert((await one('select get_voucher_status_report() data')).data.length);
 for(const uid of [clientUser,staffB]){await as(uid);await assert.rejects(pg.query('select get_voucher_status_report()'),/Permission denied/);}
 await as(null,'anon');await assert.rejects(pg.query('select get_voucher_status_report()'),/permission denied/);
});

test('managed voucher lookup supports non-client purchasers and email requests are scoped, immutable and service-finished',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/026_voucher_find_email.sql',import.meta.url),'utf8'));
 await as(staffA);const v=await one("select * from create_voucher(75,'2100-01-01',null,'Outside Buyer',' Outside@Example.com ')");assert.equal(v.purchaser_name,'Outside Buyer');assert.equal(v.purchaser_email,'outside@example.com');assert.equal(v.client_id,null);
 let found=(await one("select search_managed_vouchers('',null,'buyer','OUTSIDE@') data")).data;assert(found.some(x=>x.id===v.id&&Number(x.balance)===75));assert.equal(found.find(x=>x.id===v.id).recipient_email,null);
 assert.equal((await one('select search_managed_vouchers($1) data',[v.code.toLowerCase()])).data[0].id,v.id);
 await assert.rejects(pg.query('select search_managed_vouchers()'),/Enter a voucher ID/);
 const report=(await one('select get_voucher_status_report() data')).data.find(x=>x.id===v.id);assert.equal(report.purchased_by,'Outside Buyer');
 const c=await one('select * from clients where auth_user_id=$1',[clientUser]);const assigned=await one('select * from reassign_voucher($1,$2,0)',[v.id,c.id]);const details=(await one('select managed_voucher_details($1) data',[v.id])).data;assert.equal(details.recipient_email,c.email);assert.equal(details.purchaser_name,'Outside Buyer');
 assert((await one('select search_managed_vouchers(\'\',$1) data',[c.id])).data.some(x=>x.id===v.id));
 const request='b0000000-0000-0000-0000-000000000001';const job=(await one('select prepare_staff_voucher_email($1,$2,$3) data',[v.id,'recipient@example.com',request])).data;assert.equal(job.snapshot.code,v.code);assert.equal(job.requested_email,'recipient@example.com');
 assert.equal((await one('select prepare_staff_voucher_email($1,$2,$3) data',[v.id,'recipient@example.com',request])).data.id,request);
 await assert.rejects(pg.query('select prepare_staff_voucher_email($1,$2,$3)',[v.id,'changed@example.com',request]),/request changed/);
 await assert.rejects(pg.query("select finish_staff_voucher_email($1,'accepted','fake',null)",[request]),/permission denied/);
 await assert.rejects(pg.query('select * from voucher_email_requests'),/permission denied/);
 await as(null,'service_role');await pg.query("select finish_staff_voucher_email($1,'accepted','resend-test',null)",[request]);await pg.query("select finish_staff_voucher_email($1,'accepted','resend-test',null)",[request]);
 await pg.exec('reset role');assert.equal((await one("select count(*) n from audit_events where action='voucher_email_accepted' and details->>'request_id'=$1",[request])).n,1);
 await as(staffA);assert.equal((await one('select prepare_staff_voucher_email($1,$2,$3) data',[v.id,'recipient@example.com',request])).data.status,'accepted');
 for(const uid of [clientUser,accountant,staffB]){await as(uid);await assert.rejects(pg.query('select managed_voucher_details($1)',[v.id]),/Permission denied/);await assert.rejects(pg.query('select prepare_staff_voucher_email($1,$2,$3)',[v.id,'recipient@example.com',request]),/Permission denied/);}
 await as(null,'anon');await assert.rejects(pg.query('select search_managed_vouchers($1)',[v.code]),/permission denied/);
});

test('client communications capture authenticated staff, audit and enforce client-management access',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/027_client_communications.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 await as(staffA);
 const entry=await one("select * from record_client_communication($1,'Phone Call',' Called about appointment. ')",[c.id]);
 assert.equal(entry.note,'Called about appointment.');assert.equal(entry.recorded_by,staffA);assert.equal(entry.staff_name,(await one('select name from staff where id=1')).name);assert(entry.recorded_at);
 assert.equal((await one('select count(*) n from client_communications where client_id=$1',[c.id])).n,1);
 await assert.rejects(pg.query("select record_client_communication($1,'SMS','Hello')",[c.id]),/valid communication type/);
 await assert.rejects(pg.query("select record_client_communication($1,'Email','   ')",[c.id]),/communication notes/);
 await assert.rejects(pg.query("insert into client_communications(client_id,communication_type,note,staff_name,recorded_by) values($1,'Email','Spoof','SYSTEM',$2)",[c.id,staffA]),/permission denied/);
 for(const uid of [clientUser,accountant,staffB]){await as(uid);assert.equal((await one('select count(*) n from client_communications')).n,0);await assert.rejects(pg.query("select record_client_communication($1,'Email','Hello')",[c.id]),/Permission denied/);}
 await pg.exec('reset role');assert.equal((await one("select count(*) n from audit_events where action='client_communication_recorded' and client_id=$1",[c.id])).n,1);
 await as(null,'anon');await assert.rejects(pg.query('select * from client_communications'),/permission denied/);
});

test('appointment reminders snapshot active appointments and record one SYSTEM email only after provider acceptance',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/028_appointment_reminders.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const a=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,1,8001,'2080-01-20',630,60,'Client','123','Reminder Treatment',80,'booked') returning *",[c.id,clientUser]);
 const id='c0000000-0000-0000-0000-000000000001';await as(staffA);
 const job=(await one('select prepare_appointment_reminder($1,$2,$3) data',[a.id,' Other@Example.com ',id])).data;assert.equal(job.snapshot.treatment_name,'Reminder Treatment');assert.equal(job.requested_email,'other@example.com');
 await assert.rejects(pg.query('select prepare_appointment_reminder($1,$2,$3)',[a.id,'changed@example.com',id]),/request changed/);
 await assert.rejects(pg.query("select finish_appointment_reminder($1,'accepted','fake')",[id]),/permission denied/);
 await as(null,'service_role');await pg.query("select finish_appointment_reminder($1,'failed',null,'failed')",[id]);
 await pg.exec('reset role');assert.equal((await one("select count(*) n from client_communications where note like 'Appointment reminder sent%' and client_id=$1",[c.id])).n,0);
 await as(null,'service_role');await pg.query("select finish_appointment_reminder($1,'accepted','resend-ref')",[id]);await pg.query("select finish_appointment_reminder($1,'accepted','resend-ref')",[id]);
 await pg.exec('reset role');const logs=(await pg.query("select * from client_communications where note like 'Appointment reminder sent%' and client_id=$1",[c.id])).rows;assert.equal(logs.length,1);assert.equal(logs[0].staff_name,'SYSTEM');assert.equal(logs[0].communication_type,'Email');assert(logs[0].note.includes('10:30'));assert(logs[0].note.includes('other@example.com'));assert.equal(logs[0].recorded_by,staffA);
 await pg.query("update appointments set status='completed' where id=$1",[a.id]);await as(staffA);assert.equal((await one('select prepare_appointment_reminder($1,$2,$3) data',[a.id,'other@example.com',id])).data.status,'accepted');await assert.rejects(pg.query('select prepare_appointment_reminder($1,$2,$3)',[a.id,'other@example.com','c0000000-0000-0000-0000-000000000002']),/Only active/);
 for(const uid of [clientUser,accountant,staffB]){await as(uid);await assert.rejects(pg.query('select prepare_appointment_reminder($1,$2,$3)',[a.id,'other@example.com',id]),/Permission denied/);}
});

test('daily activity lists completed payment parts and collected no-show fees with reporting-only access',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/029_daily_activity_report.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 async function appointment(status,start){return one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,1,8001,'1991-01-01',$3,15,'Client','123','Activity Test',80,$4) returning *",[c.id,clientUser,start,status]);}
 const done=await appointment('completed',600),noShow=await appointment('no_show',660),pending=await appointment('booked',720),cancelled=await appointment('cancelled',780),waived=await appointment('no_show',840);
 await pg.query("insert into appointment_payments(appointment_id,method,amount,recorded_by) values($1,'card',60,$3),($1,'cash',20,$3),($2,'cash',80,$3)",[done.id,pending.id,staffA]);
 await pg.query("insert into no_show_fees(appointment_id,actor_id,apply_fee,comments,state,order_id) values($1,$3,true,'Test','completed','revolut-order-test'),($2,$3,false,'Waived','waived',null)",[noShow.id,waived.id,staffA]);
 await as(accountant);let rows=(await one("select get_daily_activity_report('1991-01-01','1991-01-01') data")).data;assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.appointment_id===done.id).length,2);assert(!rows.some(r=>[pending.id,cancelled.id,waived.id].includes(r.appointment_id)));const fee=rows.find(r=>r.appointment_id===noShow.id);assert.equal(Number(fee.amount),10);assert.equal(fee.revolut_id,'revolut-order-test');assert.equal(fee.treatment_name,'Activity Test (NO SHOW)');assert.equal(rows.find(r=>r.appointment_id===done.id).revolut_id,'');
 rows=(await one("select get_daily_activity_report('1991-01-01','1991-01-01',array['cash']) data")).data;assert.equal(rows.length,1);assert.equal(Number(rows[0].amount),20);
 await assert.rejects(pg.query("select get_daily_activity_report('1991-01-02','1991-01-01')"),/valid date range/);
 for(const uid of [clientUser,staffB]){await as(uid);await assert.rejects(pg.query("select get_daily_activity_report('1991-01-01','1991-01-01')"),/Permission denied/);}
});

test('cancel check-in clears active timestamp, restores booked state and records reversal with revision guards',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/030_cancel_check_in.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const a=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status,checked_in_at) values($1,$2,1,8001,'1992-01-01',600,15,'Client','123','Check-in Test',80,'checked_in','1992-01-01T10:00:00Z') returning *",[c.id,clientUser]);
 for(const uid of [clientUser,accountant,staffB]){await as(uid);await assert.rejects(pg.query('select cancel_appointment_check_in($1,0)',[a.id]),/Permission denied/);}
 await as(staffA);await assert.rejects(pg.query('select cancel_appointment_check_in($1,99)',[a.id]),/changed/);
 const restored=await one('select * from cancel_appointment_check_in($1,0)',[a.id]);assert.equal(restored.status,'booked');assert.equal(restored.checked_in_at,null);assert.equal(restored.revision,1);
 await assert.rejects(pg.query('select cancel_appointment_check_in($1,1)',[a.id]),/Only checked-in/);
 await pg.exec('reset role');assert.equal((await one("select count(*) n from audit_events where appointment_id=$1 and action='appointment_check_in_cancelled'",[a.id])).n,1);
});

test('custom voucher amounts enforce decimal syntax and €5–€500 limits on the server',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/031_custom_voucher_amounts.sql',import.meta.url),'utf8'));await as(clientUser);
 for(const value of ['abc','5e1','45.999','4.99','500.01','-10'])await assert.rejects(pg.query("select purchase_demo_voucher($1,null,true,'','','saved_demo',true,gen_random_uuid())",[value]),/voucher amount/);
 for(const value of ['5','45.99','500.00']){const row=(await one("select purchase_demo_voucher($1,null,true,'','','saved_demo',true,gen_random_uuid()) data",[value])).data;assert.equal(Number(row.original_amount),Number(value));}
});

test('staff voucher recipient email links existing client and preserves unmatched recipient without assignment',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/032_staff_voucher_recipients.sql',import.meta.url),'utf8'));
 const c=await one('select * from clients where auth_user_id=$1',[clientUser]);await as(staffA);
 const v=await one('select * from create_staff_recipient_voucher(75,\'2035-01-01\',\'Buyer\',\'buyer@example.com\',\'Recipient\',$1)',[' '+c.email.toUpperCase()+' ']);assert.equal(v.client_id,c.id);assert.equal(v.assigned_client_name,c.name);assert.equal(v.recipient_email,c.email.toLowerCase());assert.equal(v.recipient_name,'Recipient');
 const unknown=await one("select * from create_staff_recipient_voucher(25,'2035-01-01',null,null,'Gift Recipient','unknown-gift@example.com')");assert.equal(unknown.client_id,null);assert.equal(unknown.assigned_client_name,null);assert.equal(unknown.recipient_email,'unknown-gift@example.com');
 const blank=await one("select * from create_staff_recipient_voucher(25,'2035-01-01')");assert.equal(blank.assigned_client_name,null);
 await as(accountant);await assert.rejects(pg.query("select create_staff_recipient_voucher(25,'2035-01-01')"),/Permission denied/);
});

test('My Vouchers returns only own assigned voucher history and blocks staff identities',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/033_my_voucher_history.sql',import.meta.url),'utf8'));
 await as(clientUser);const report=(await one('select get_my_voucher_history() data')).data;const own=(await one('select get_my_vouchers() data')).data;assert.deepEqual(report.vouchers.map(v=>v.id).sort(),own.map(v=>v.id).sort());assert(report.vouchers.every(v=>v.purchaser_name));assert(report.uses.every(r=>own.some(v=>v.id===r.voucher_id)));
 await as(accountant);await assert.rejects(pg.query('select get_my_voucher_history()'),/Client sign-in/);await as(null,'anon');await assert.rejects(pg.query('select get_my_voucher_history()'),/permission denied/);
});

 test('financial reports use recorded payment dates for future appointments and completion dates for counts',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/034_reporting_payment_dates.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const a=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status,completed_at) values($1,$2,1,8001,'2099-01-01',600,15,'Client','123','Early Checkout',50,'completed','1993-01-02T11:15:00Z') returning *",[c.id,clientUser]);
 await pg.query("insert into appointment_payments(appointment_id,method,amount,recorded_by,recorded_at) values($1,'cash',50,$2,'1993-01-02T11:15:00Z')",[a.id,staffA]);
 await as(accountant);let rows=(await one("select get_daily_activity_report('1993-01-02','1993-01-02') data")).data;assert.equal(rows.length,1);assert.equal(rows[0].appointment_id,a.id);assert.equal(rows[0].start_minute,675);
 let summary=await one("select * from get_activity_report('1993-01-02','1993-01-02')");assert.equal(Number(summary.cash_payments),50);assert.equal(Number(summary.appointments_completed),1);
 summary=await one("select * from get_activity_report('1993-01-15','1993-01-15','month')");assert.equal(Number(summary.cash_payments),50);
 await pg.exec('reset role');await pg.query("update no_show_fees set updated_at='1993-01-02T12:00:00Z' where order_id='revolut-order-test'");await as(accountant);
 rows=(await one("select get_daily_activity_report('1993-01-02','1993-01-02',array['card']) data")).data;assert.equal(rows.length,1);assert.equal(Number(rows[0].amount),10);summary=await one("select * from get_activity_report('1993-01-02','1993-01-02')");assert.equal(Number(summary.card_payments),10);
 });

test('discounts require permission, preserve original price and feed payment totals',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/035_checkout_discounts.sql',import.meta.url),'utf8'));
 const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const a=await one("insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,1,8001,'2098-01-01',600,15,'Client','123','Discount Test',80,'checked_in') returning *",[c.id,clientUser]);
 await as(staffB);await assert.rejects(pg.query('select apply_appointment_discount($1,0,60)',[a.id]),/Permission denied/);await as(staffA);
 for(const amount of [81,-1,60.123])await assert.rejects(pg.query('select apply_appointment_discount($1,0,$2)',[a.id,amount]),/lower price/);
 const saved=await one('select * from apply_appointment_discount($1,0,60)',[a.id]);assert.equal(Number(saved.price),60);assert.equal(saved.revision,1);await assert.rejects(pg.query('select apply_appointment_discount($1,0,50)',[a.id]),/changed/);
 await as(accountant);const rows=(await one('select get_discounts_report() data')).data;assert.equal(rows.length,1);assert.equal(Number(rows[0].original_price),80);assert.equal(Number(rows[0].discount_percentage),25);assert(rows[0].staff_name);await as(clientUser);await assert.rejects(pg.query('select get_discounts_report()'),/Permission denied/);
 await as(staffA);const done=await one("select * from checkout_appointment($1,1,'cash')",[a.id]);assert.equal(Number(done.price),60);
 });
test('manual calendar Busy blocks bookings, Free permits overlap, and edits/deletion are guarded',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/036_calendar_entries.sql',import.meta.url),'utf8'));await as(staffA);
 const e=await one("select * from save_calendar_entry(1,'2097-01-01',600,660,'busy','Training')");assert.equal(e.description,'Training');
 await as(accountant);await assert.rejects(pg.query("select save_calendar_entry(1,'2097-01-01',600,660,'free','Test')"),/Staff access|Permission denied/);
 await pg.exec('reset role');const c=await one('select id from clients where auth_user_id=$1',[clientUser]);
 const insert="insert into appointments(client_id,user_id,staff_id,treatment_id,appointment_date,start_minute,duration,client_name,phone,treatment_name,price,status) values($1,$2,1,8001,'2097-01-01',600,15,'Client','123','Calendar Test',50,'booked')";
 await assert.rejects(pg.query(insert,[c.id,clientUser]),/blocked as Busy/);await as(staffA);
 await one("select * from save_calendar_entry(1,'2097-01-01',600,660,'free','Training',$1,0)",[e.id]);
 await assert.rejects(pg.query("select save_calendar_entry(1,'2097-01-01',600,660,'free','Stale',$1,0)",[e.id]),/changed/);
 await pg.exec('reset role');await pg.query(insert,[c.id,clientUser]);await as(staffA);
 await assert.rejects(pg.query("select save_calendar_entry(1,'2097-01-01',600,660,'busy','Training',$1,1)",[e.id]),/overlaps/);
 await one("select * from save_calendar_entry(1,'2097-01-01',600,660,'free','Training',$1,1,true)",[e.id]);await pg.exec('reset role');assert.equal((await one('select count(*) n from staff_calendar_entries where id=$1',[e.id])).n,0);
});

test('upfront voucher and credit bookings redeem atomically and checkout never takes a second payment', async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/037_upfront_value_bookings.sql',import.meta.url),'utf8'));
 const c=await one('select * from clients where auth_user_id=$1',[clientUser]);
 await pg.exec("update treatments set price=50,patch_required=false,guarantee_required=true where id=8001;insert into staff_treatments(staff_id,treatment_id) values(1,8001) on conflict do nothing;");
 await pg.query('update clients set requires_deposit=true where id=$1',[c.id]);
 await as(staffA);const v=await one("select * from create_staff_recipient_voucher(100,'2099-01-01','Buyer','buyer@example.com','Client',$1)",[c.email]);
 const other=await one("select * from create_staff_recipient_voucher(100,'2099-01-01','Buyer','buyer@example.com','Someone','other-voucher@example.com')");
 const n=await one("select * from create_client_credit_note($1,80,'Testing upfront')",[c.id]);
 await as(clientUser);
 const opts=(await one('select get_booking_value_options(8001) data')).data;assert(opts.vouchers.some(x=>x.id===v.id));assert(!opts.vouchers.some(x=>x.id===other.id));assert(opts.credit_notes.some(x=>x.id===n.id));
 const sql="select * from book_with_value(8001,1,'2080-01-16',$1,'Client Test','0800000000',true,'client@example.com',null,false,null,null,$2,$3)";
 await assert.rejects(pg.query(sql,[600,'voucher',other.id]),/belonging to your account/);
 const slots=(await pg.query("select * from get_booking_slots(8001,'2080-01-16',1)")).rows;assert(slots.length>1);
 const a=await one(sql,[slots[0].start_minute,'voucher',v.id]);assert.equal(a.status,'booked');assert.equal(a.guarantee_required,false);assert.equal(a.prepaid_method,'voucher');assert.equal(a.prepaid_voucher_code,v.code);
 const b=await one(sql,[slots[1].start_minute,'credit',n.id]);assert.equal(b.prepaid_method,'credit');
 await assert.rejects(pg.query(sql,[slots[2].start_minute,'credit',n.id]),/no longer covers/);
 let values=(await one('select get_booking_value_options(8001) data')).data;assert.equal(Number(values.vouchers.find(x=>x.id===v.id).balance),50);assert(!values.credit_notes.some(x=>x.id===n.id));
 await as(staffA);await pg.query("select update_appointment_status($1,'checked_in',null,0)",[a.id]);
 await assert.rejects(pg.query("select checkout_appointment($1,1,'cash')",[a.id]),/already been paid/);
 const done=await one('select * from checkout_appointment($1,1,null)',[a.id]);assert.equal(done.status,'completed');assert.equal(done.payment_method,'voucher');
 await assert.rejects(pg.query('select apply_appointment_discount($1,0,40)',[b.id]),/checked-in/);
 await pg.exec('reset role');assert.equal(Number((await one('select count(*) n from appointment_payments where appointment_id=$1',[a.id])).n),1);assert.equal(Number((await one('select count(*) n from client_value_redemptions where appointment_id=$1',[a.id])).n),1);
 await as(accountant);const today=(await one("select (now() at time zone 'Europe/Dublin')::date::text d")).d;const rows=(await one('select get_daily_activity_report($1,$1) data',[today])).data;assert(rows.some(x=>x.appointment_id===b.id));
});

test('client voucher email preparation requires purchase ownership and preserves retry identity',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/038_client_voucher_email.sql',import.meta.url),'utf8'));
 await as(clientUser);const v=(await one("select purchase_demo_voucher('50',null,false,'Recipient','recipient-email@example.com','saved_demo',true,gen_random_uuid()) data")).data;
 const request='a1000000-0000-0000-0000-000000000001';
 const job=(await one('select prepare_client_voucher_email($1,$2,$3) data',[v.id,'edited@example.com',request])).data;assert.equal(job.snapshot.code,v.code);assert.equal(job.requested_email,'edited@example.com');
 const retry=(await one('select prepare_client_voucher_email($1,$2,$3) data',[v.id,'edited@example.com',request])).data;assert.equal(job.id,retry.id);
 await assert.rejects(pg.query('select prepare_client_voucher_email($1,$2,$3)',[v.id,'different@example.com',request]),/request changed/);
 await assert.rejects(pg.query('select prepare_client_voucher_email($1,$2,gen_random_uuid())',[v.id,'invalid']),/valid email/);
 await pg.exec('reset role');const other=await one('select id from vouchers where purchased_by is null limit 1');await as(clientUser);
 await assert.rejects(pg.query('select prepare_client_voucher_email($1,$2,gen_random_uuid())',[other.id,'edited@example.com']),/purchased by you/);
 await as(staffA);await assert.rejects(pg.query('select prepare_client_voucher_email($1,$2,gen_random_uuid())',[v.id,'edited@example.com']),/Client sign-in/);
});

test('voucher purchases belong to purchaser; code claims transfer remaining balance and email ownership',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/039_voucher_claims.sql',import.meta.url),'utf8'));
 const recipient='10000000-0000-0000-0000-000000000039';
 await pg.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'claim-client@example.com','{\"full_name\":\"Voucher Recipient\"}')",[recipient]);
 await as(clientUser);const owner=await one('select ensure_own_client() id');
 const v=(await one("select purchase_demo_voucher('45.99',null,false,'Ignored','ignored@example.com','saved_demo',true,gen_random_uuid()) data")).data;
 assert.equal(v.client_id,owner.id);assert.equal(Number(v.original_amount),45.99);
 await assert.rejects(pg.query("select purchase_demo_voucher('4.99',null,true,'','','saved_demo',true,gen_random_uuid())"),/between/);
 await assert.rejects(pg.query("select purchase_demo_voucher('501',null,true,'','','saved_demo',true,gen_random_uuid())"),/between/);
 await assert.rejects(pg.query("select purchase_demo_voucher('hello',null,true,'','','saved_demo',true,gen_random_uuid())"),/Choose a voucher amount/);
 await as(recipient);const claimed=await one('select * from claim_my_voucher($1)',[v.code.toLowerCase()]);assert.notEqual(claimed.client_id,owner.id);
 const own=(await one('select get_my_voucher_history() data')).data;assert(own.vouchers.some(x=>x.id===v.id));
 await one("select prepare_client_voucher_email($1,'recipient@example.com',gen_random_uuid()) data",[v.id]);
 await one('select claim_my_voucher($1)',[v.code]);
 await as(clientUser);const history=(await one('select get_my_voucher_history() data')).data;assert(!history.vouchers.some(x=>x.id===v.id));const transfers=history.transfers.filter(x=>x.code===v.code);assert.equal(transfers.length,1);assert.equal(transfers[0].transferred_to,'Voucher Recipient');
 await assert.rejects(pg.query("select prepare_client_voucher_email($1,'other@example.com',gen_random_uuid())",[v.id]),/currently assigned/);
 await as(staffA);await assert.rejects(pg.query('select claim_my_voucher($1)',[v.code]),/Client sign-in/);
 await as(recipient);await assert.rejects(pg.query("select claim_my_voucher('SC-NOT-A-REAL-CODE')"),/not found/);
 await pg.exec('reset role');await pg.query("update vouchers set expires_on='2000-01-01' where id=$1",[v.id]);await as(clientUser);await assert.rejects(pg.query('select claim_my_voucher($1)',[v.code]),/expired/);
});

test('checkout voucher lookup transfers a gift to the appointment client and preserves split redemption',async()=>{
 await as(clientUser);const owner=await one('select ensure_own_client() id');const v=(await one("select purchase_demo_voucher('20',null,true,'','','saved_demo',true,gen_random_uuid()) data")).data;
 await pg.exec('reset role');const target=await one("select id from clients where email='claim-client@example.com'");
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,1,8001,'Test transfer checkout','Recipient','123456789',50,'2080-02-20',600,60,'checked_in') returning *",[clientUser,target.id]);
 await as(staffA);const options=(await one('select claim_checkout_voucher($1,$2) data',[a.id,v.code])).data;assert.equal(options.found_voucher.id,v.id);assert(options.vouchers.some(x=>x.id===v.id));
 const done=await one("select * from checkout_appointment($1,0,'voucher',$2,null,'card',20)",[a.id,v.code]);assert.equal(done.status,'completed');
 await pg.exec('reset role');const nowOwner=await one('select client_id from vouchers where id=$1',[v.id]);assert.equal(nowOwner.client_id,target.id);const used=await one('select amount from client_value_redemptions where appointment_id=$1',[a.id]);assert.equal(Number(used.amount),20);
 await as(clientUser);const h=(await one('select get_my_voucher_history() data')).data;assert(h.transfers.some(x=>x.code===v.code));assert(!h.uses.some(x=>x.voucher_id===v.id));
});

test('treatment rebook windows validate permitted values and preserve permission and revision guards',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/040_treatment_rebook_window.sql',import.meta.url),'utf8'));await as(staffA);
 let t=await one('select * from treatments where id=8001');
 const sql='select * from save_treatment($1,$2,$3,$4,$5,$6,$7,$8,$9)';
 const args=[t.id,t.name,t.description||'',t.duration,t.price,t.patch_required,t.revision,t.guarantee_required,'4 weeks'];
 const saved=await one(sql,args);assert.equal(saved.rebook_window,'4 weeks');assert.equal(saved.revision,t.revision+1);
 await assert.rejects(pg.query(sql,args),/changed/);
 args[6]=saved.revision;args[8]='5 months';await assert.rejects(pg.query(sql,args),/valid rebook/);
 args[8]='12 months';await as(clientUser);await assert.rejects(pg.query(sql,args),/Permission denied/);
});

test('percentage guarantee snapshots 50% for new bookings, preserves old fees and queues the exact amount',async()=>{
 await pg.exec('reset role');const legacy=await one('select id from appointments limit 1');
 await pg.exec(await readFile(new URL('../supabase/041_percentage_booking_guarantee.sql',import.meta.url),'utf8'));
 assert.equal((await one('select guarantee_fee_cents from appointments where id=$1',[legacy.id])).guarantee_fee_cents,1000);
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,1,8001,'Percentage','Client','123456789',49.99,'2080-02-21',600,60,'booked') returning *",[clientUser,clientId]);
 assert.equal(a.guarantee_fee_cents,2500);
 const snapshot=await one('select snapshot from booking_email_queue where appointment_id=$1',[a.id]);assert.equal(snapshot.snapshot.guarantee_fee_cents,2500);
 await pg.query('update appointments set price=60 where id=$1',[a.id]);assert.equal((await one('select guarantee_fee_cents from appointments where id=$1',[a.id])).guarantee_fee_cents,2500);
 await as(staffA);await pg.query("select record_no_show_decision($1,0,true,'Apply guarantee')",[a.id]);
 await pg.exec('reset role');assert.equal((await one('select amount_cents from no_show_fees where appointment_id=$1',[a.id])).amount_cents,2500);
});

test('client appointment policy guards ownership and cancellation; deposit exemption grants both flags',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/042_client_appointment_changes.sql',import.meta.url),'utf8'));
 await pg.query('update clients set requires_deposit=true,can_amend_anytime=false,can_cancel_free=false where id=$1',[clientId]);
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,1,8001,'Change test','Client','123456789',50,(now() at time zone 'Europe/Dublin')::date+1,600,60,'booked') returning *",[clientUser,clientId]);
 await as(clientUser);let policy=(await one('select client_appointment_policy($1) data',[a.id])).data;assert.equal(policy.same_date_only,true);assert.equal(policy.cancel_free,true);
 await assert.rejects(pg.query("select client_amend_appointment($1,8001,1,(now() at time zone 'Europe/Dublin')::date+4,600,0,'Move')",[a.id]),/Within three days/);
 await assert.rejects(pg.query("select client_amend_appointment($1,8001,2,$2,600,0,'Move')",[a.id,a.appointment_date]),/date\/time only/);
 await as(staffA);await assert.rejects(pg.query('select client_cancel_appointment($1,0)',[a.id]),/Client sign-in/);
 await as(clientUser);const cancelled=(await one('select client_cancel_appointment($1,0) data',[a.id])).data;assert.equal(cancelled.fee_required,false);
 await assert.rejects(pg.query('select client_cancel_appointment($1,0)',[a.id]),/no longer/);
 await pg.exec('reset role');assert.equal((await one('select status from appointments where id=$1',[a.id])).status,'cancelled');
 await pg.query('update clients set requires_deposit=false,can_amend_anytime=false,can_cancel_free=false where id=$1',[clientId]);const c=await one('select * from clients where id=$1',[clientId]);assert.equal(c.can_amend_anytime,true);assert.equal(c.can_cancel_free,true);
});

 test('client amendments preserve original details and card cancellations create one fee',async()=>{
 await pg.exec('reset role');await pg.query('update clients set requires_deposit=true,can_amend_anytime=false,can_cancel_free=false where id=$1',[clientId]);
 const card=await one('select id from booking_guarantee_cards where verified_at is not null limit 1');
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status,guarantee_required,guarantee_card_id) values($1,$2,1,8001,'Original treatment label','Client','123456789',50,'2081-02-20',600,60,'booked',true,$3) returning *",[clientUser,clientId,card.id]);
 await pg.query("insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(1,'2081-02-21',540,1020) on conflict(staff_id,shift_date) do update set start_minute=540,end_minute=1020");
 await as(clientUser);const moved=await one("select * from client_amend_appointment($1,8001,1,'2081-02-21',600,0,'Client rescheduled appointment')",[a.id]);assert.equal(new Date(moved.appointment_date).toISOString().slice(0,10),'2081-02-21');assert.equal(moved.treatment_name,'Original treatment label');assert.equal(moved.price,a.price);
 const done=(await one('select client_cancel_appointment($1,1) data',[a.id])).data;assert.equal(done.fee_required,true);assert.equal(done.amount_cents,2500);
 await pg.exec('reset role');const audit=await one("select details from audit_events where appointment_id=$1 and action='appointment_amended'",[a.id]);assert.equal(audit.details.before.appointment_date,'2081-02-20');assert.equal(audit.details.after.appointment_date,'2081-02-21');const fee=await one('select * from no_show_fees where appointment_id=$1',[a.id]);assert.equal(fee.purpose,'cancellation');assert.equal(fee.amount_cents,2500);
 });

test('prepaid cancellation refunds full or half atomically and retains original payment history',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/043_booking_lifecycle_values_preferences.sql',import.meta.url),'utf8'));
 await pg.query('update clients set requires_deposit=true,can_cancel_free=false,can_amend_anytime=false where id=$1',[clientId]);
 for(const method of ['voucher','credit'])for(const free of [false,true]){
  await pg.exec('reset role');await pg.query('update clients set can_cancel_free=$2 where id=$1',[clientId,free]);
  let value;
  if(method==='voucher'){
   await as(clientUser);value=(await one("select purchase_demo_voucher('100',null,true,'','','saved_demo',true,gen_random_uuid()) data")).data;await pg.exec('reset role');
  }else value=await one("insert into client_credit_notes(client_id,amount,reason,created_by,staff_name) values($1,100,'Test',$2,'Aoife') returning *",[clientId,staffA]);
  const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,1,8001,'Prepaid test','Client','123456789',50,'2082-02-20',600,60,'booked') returning *",[clientUser,clientId]);
  const redemption=await one("insert into client_value_redemptions(client_id,voucher_id,credit_note_id,appointment_id,amount,treatment_name,staff_name,recorded_by) values($1,$2,$3,$4,50,'Prepaid test','Aoife',$5) returning *",[clientId,method==='voucher'?value.id:null,method==='credit'?value.id:null,a.id,clientUser]);
  await pg.query("insert into appointment_payments(appointment_id,method,amount,redemption_id,recorded_by) values($1,$2,50,$3,$4)",[a.id,method,redemption.id,clientUser]);
  await pg.query("update appointments set prepaid_method=$2,prepaid_value_id=$3,prepaid_at=now(),guarantee_required=false where id=$1",[a.id,method,value.id]);
  await as(clientUser);const policy=(await one('select client_appointment_policy($1) data',[a.id])).data;assert.equal(policy.cancel_free,free);assert.equal(policy.prepaid_method,method);
  const result=(await one('select client_cancel_appointment($1,0) data',[a.id])).data;assert.equal(result.fee_required,false);assert.equal(result.refund_amount,free?50:25);
  await assert.rejects(pg.query('select client_cancel_appointment($1,0)',[a.id]),/no longer/);
  const history=(await one(method==='voucher'?'select get_my_voucher_history() data':'select get_my_credit_notes() data')).data;
  const values=method==='voucher'?history.vouchers:history.credit_notes;assert.equal(Number(values.find(x=>x.id===value.id).balance),free?100:75);
  const uses=history.uses.filter(x=>x.appointment_id===a.id);assert.equal(uses.length,free?0:1);if(!free){assert.equal(Number(uses[0].amount),25);assert.equal(uses[0].treatment_name,'Prepaid test (cancellation fee)');}
  await pg.exec('reset role');assert.equal(Number((await one('select amount from appointment_payments where appointment_id=$1',[a.id])).amount),50);
  const adjustment=await one('select * from prepaid_cancellation_adjustments where appointment_id=$1',[a.id]);assert.equal(Number(adjustment.original_amount),50);assert.equal(Number(adjustment.refund_amount),free?50:25);
  const jobs=(await pg.query("select * from booking_email_queue where appointment_id=$1 and event_kind='cancelled'",[a.id])).rows;assert.equal(jobs.length,1);assert.equal(Number(jobs[0].snapshot.refund_amount),free?50:25);
  await as(staffA);const day=(await one("select (now() at time zone 'Europe/Dublin')::date::text today_label")).today_label;const rows=(await one('select get_daily_activity_report($1,$1) data',[day])).data.filter(x=>x.appointment_id===a.id);assert.equal(rows.reduce((sum,x)=>sum+Number(x.amount),0),free?0:25);
 }
 await as(staffA);await assert.rejects(pg.query('select get_my_credit_notes()'),/Client sign-in/);
});

test('lifecycle emails snapshot amended details and staff preference reports expand dynamically',async()=>{
 await pg.exec('reset role');const added=await one("insert into staff(id,name,active) values(90099,'New Therapist',true) returning id");
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status,staff_selected,preferred_staff_id) values($1,$2,1,8001,'Preference test','Client','123456789',50,'2083-02-20',600,60,'booked',true,$3) returning *",[clientUser,clientId,added.id]);
 await pg.query("update appointments set appointment_date='2083-02-21',start_minute=660,revision=revision+1 where id=$1",[a.id]);
 const job=await one("select * from booking_email_queue where appointment_id=$1 and event_kind='amended'",[a.id]);assert.equal(job.snapshot.original_date,'2083-02-20');assert.equal(job.snapshot.appointment_date,'2083-02-21');
 await pg.query("update appointments set status='cancelled',revision=revision+1 where id=$1",[a.id]);assert.equal((await one("select status from booking_email_queue where id=$1",[job.id])).status,'cancelled');
 await as(clientUser);await assert.rejects(pg.query('select get_staff_preference_report()'),/Permission denied/);
 await as(staffA);const report=(await one("select get_staff_preference_report('2083-02-21','2083-02-21') data")).data;assert(report.staff.some(x=>x.id===added.id));assert.equal(Number(report.rows.find(x=>x.treatment_name==='Preference test').selected[added.id]),1);
 const none=(await one("select get_staff_preference_report('2099-01-01','2099-01-02') data")).data;assert(!none.rows.some(x=>x.treatment_name==='Preference test'));
});

 test('new client bookings record explicit and no-preference choices at the booking boundary',async()=>{
 await pg.exec('reset role');await pg.query('update clients set requires_deposit=false where id=$1',[clientId]);
 await pg.exec("insert into treatments(id,name,category,price,price_type,duration,patch_required,guarantee_required) values(90999,'Preference boundary','Test',20,'Fixed',60,false,false);insert into staff_treatments(staff_id,treatment_id) values(1,90999);insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(1,'2085-02-20',540,1020);");
 await as(clientUser);const c=await one('select * from get_my_profile()');
 const a=await one("select * from book_guaranteed_appointment(90999,1,'2085-02-20',600,$1,$2,true,$3,null,false,null,null,false)",[c.name,c.phone,c.email]);assert.equal(a.staff_selected,false);assert.equal(a.preferred_staff_id,null);
 const value=(await one("select purchase_demo_voucher('100',null,true,'','','saved_demo',true,gen_random_uuid()) data")).data;
 const b=await one("select * from book_with_value(90999,1,'2085-02-20',660,$1,$2,true,$3,null,false,null,null,'voucher',$4,true)",[c.name,c.phone,c.email,value.id]);assert.equal(b.staff_selected,true);assert.equal(b.preferred_staff_id,1);
 });

test('staff transfers preserve preference, original allocation and booked details; enforce exact availability and revision',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/044_staff_appointment_transfers.sql',import.meta.url),'utf8'));
 await pg.exec("insert into staff_treatments(staff_id,treatment_id) values(2,90999) on conflict do nothing;insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(1,'2086-02-20',540,1020),(2,'2086-02-20',540,1020);");
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status,staff_selected,preferred_staff_id) values($1,$2,1,90999,'Transfer snapshot','Client','123456789',35,'2086-02-20',600,45,'checked_in',true,1) returning *",[clientUser,clientId]);
 await as(clientUser);await assert.rejects(pg.query('select * from get_appointment_transfer_options($1)',[a.id]),/Permission denied/);await assert.rejects(pg.query('select * from transfer_appointment($1,2,0)',[a.id]),/Permission denied/);
 await as(staffA);assert((await pg.query('select * from get_appointment_transfer_options($1)',[a.id])).rows.some(x=>x.id===2));
 await pg.exec('reset role');const conflict=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,2,90999,'Conflict','Client','123456789',20,'2086-02-20',630,30,'booked') returning *",[clientUser,clientId]);
 await as(staffA);assert.equal((await pg.query('select * from get_appointment_transfer_options($1)',[a.id])).rows.length,0);await assert.rejects(pg.query('select * from transfer_appointment($1,2,0)',[a.id]),/no longer available/);
 await pg.exec('reset role');await pg.query("update appointments set status='cancelled' where id=$1",[conflict.id]);
 await as(staffA);await assert.rejects(pg.query('select * from transfer_appointment($1,2,99)',[a.id]),/changed/);
 const moved=await one('select * from transfer_appointment($1,2,0)',[a.id]);assert.equal(moved.staff_id,2);assert.equal(moved.original_staff_id,1);assert.equal(moved.preferred_staff_id,1);assert.equal(moved.staff_selected,true);assert.equal(moved.duration,45);assert.equal(moved.treatment_name,a.treatment_name);assert.equal(moved.price,a.price);assert.equal(moved.status,'checked_in');
 const report=(await one("select get_staff_preference_report('2086-02-20','2086-02-20') data")).data;assert.equal(Number(report.rows.find(x=>x.treatment_name==='Transfer snapshot').selected[1]),1);
 await pg.exec('reset role');assert.equal((await one("select count(*)::integer n from audit_events where appointment_id=$1 and action='appointment_transferred'",[a.id])).n,1);assert.equal((await one("select count(*)::integer n from booking_email_queue where appointment_id=$1 and event_kind='amended'",[a.id])).n,1);
});

test('one-off reset clears bookings and all value/payment dependencies while retaining clients and staff',async()=>{
 await pg.exec('reset role');const before=await one('select (select count(*) from staff)::integer staff,(select count(*) from clients)::integer clients,(select count(*) from treatments)::integer treatments,(select count(*) from booking_guarantee_cards)::integer cards');
 await pg.exec(await readFile(new URL('../supabase/reset_bookings_and_values.sql',import.meta.url),'utf8'));
 for(const table of ['appointments','vouchers','client_credit_notes','appointment_payments','client_value_redemptions','appointment_discounts','no_show_fees','booking_email_queue','appointment_reminder_requests','voucher_email_requests','prepaid_cancellation_adjustments','demo_voucher_orders','voucher_transactions'])assert.equal((await one(`select count(*)::integer n from ${table}`)).n,0,table);
 const after=await one('select (select count(*) from staff)::integer staff,(select count(*) from clients)::integer clients,(select count(*) from treatments)::integer treatments,(select count(*) from booking_guarantee_cards)::integer cards');assert.deepEqual(after,before);
 assert.equal((await one("select count(*)::integer n from audit_events where action='testing_bookings_and_values_reset'")).n,1);
});

test('accepted booking and voucher emails create deduplicated SYSTEM communication history',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/045_system_email_communications.sql',import.meta.url),'utf8'));
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,1,90999,'Communication test','Client','123456789',20,'2089-02-20',600,60,'booked') returning *",[clientUser,clientId]);
 const job=await one('select id from booking_email_queue where appointment_id=$1',[a.id]);await pg.query("update booking_email_queue set status='accepted',resend_id='booking-test' where id=$1",[job.id]);await pg.query("update booking_email_queue set status=status where id=$1",[job.id]);
 assert.equal((await one("select count(*)::integer n from client_communications where email_source_key=$1",['booking-email:'+job.id])).n,1);
 await as(clientUser);const v=(await one("select purchase_demo_voucher('50',null,true,'','','saved_demo',true,gen_random_uuid()) data")).data;await pg.exec('reset role');
 for(const n of [1,2]){const r=await one("insert into voucher_email_requests(id,created_by,voucher_id,requested_email,snapshot) values(gen_random_uuid(),$1,$2,'client@example.com',$3) returning *",[clientUser,v.id,v]);await pg.query("select finish_staff_voucher_email($1,'accepted',$2,null)",[r.id,'voucher-test-'+n]);await pg.query("update voucher_email_requests set status=status where id=$1",[r.id]);const row=await one('select * from client_communications where email_source_key=$1',['voucher-email:'+r.id]);assert.equal(row.client_id,clientId);assert.equal(row.staff_name,'SYSTEM');assert(row.note.startsWith(n===1?'Voucher purchase email':'Voucher email re-send'));assert.equal((await one('select count(*)::integer n from client_communications where email_source_key=$1',['voucher-email:'+r.id])).n,1);}
 await as(clientUser);await assert.rejects(pg.query("select record_system_email_communication($1,$2,'forged','Forged',now())",[clientId,clientUser]),/permission denied/);
});

test('bulk treatment imports are atomic, permission-checked, audited and preserve appointment finances',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/046_bulk_treatment_csv.sql',import.meta.url),'utf8'));
 const originals=(await pg.query('select * from treatments where active order by id limit 2')).rows;
 const rows=originals.map(t=>({id:t.id,revision:t.revision,category:t.category,name:t.name+' renamed',description:'CSV description',duration:45,price:19.99,rebook_window:'2 weeks',guarantee_required:true,patch_required:false}));
 const a=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,1,$3,$4,'Client','123456789',80,'2090-02-20',600,60,'booked') returning *",[clientUser,clientId,originals[0].id,originals[0].name]);
 const patchId=(await one('select treatment_id from patch_booking_settings')).treatment_id;
 const p=await one("insert into appointments(user_id,client_id,staff_id,treatment_id,treatment_name,patch_for_treatment_id,patch_for_treatment_name,client_name,phone,price,appointment_date,start_minute,duration,status) values($1,$2,1,$3,$4,$5,$6,'Client','123456789',0,'2090-02-20',700,15,'booked') returning *",[clientUser,clientId,patchId,'Patch Test for '+originals[0].name,originals[0].id,originals[0].name]);
 await as(clientUser);await assert.rejects(pg.query('select bulk_update_treatments($1)',[JSON.stringify(rows)]),/Permission denied/);
 await as(staffA);
 for(const invalid of [[rows[0],{...rows[1],price:-1}],[rows[0],{...rows[1],revision:9999}],[rows[0],rows[0]],[rows[0],{...rows[1],id:99999999}],[rows[0],{...rows[1],patch_required:null}]]){
   await assert.rejects(pg.query('select bulk_update_treatments($1)',[JSON.stringify(invalid)]));
   assert.equal((await one('select name from treatments where id=$1',[rows[0].id])).name,originals[0].name);
 }
 const result=(await one('select bulk_update_treatments($1) data',[JSON.stringify(rows)])).data;
 assert.equal(result.changed,2);assert.equal(result.treatments[0].price,19.99);
 await pg.exec('reset role');
 const after=await one('select * from appointments where id=$1',[a.id]);assert.equal(after.treatment_name,rows[0].name);assert.equal(Number(after.price),80);assert.equal(after.duration,60);assert.equal(after.revision,a.revision+1);
 const patch=await one('select * from appointments where id=$1',[p.id]);assert.equal(patch.treatment_name,'Patch Test for '+rows[0].name);assert.equal(patch.patch_for_treatment_name,rows[0].name);assert.equal(Number(patch.price),0);
 assert.equal((await one("select count(*)::integer n from audit_events where action='treatment_bulk_updated' and details->>'batch_id'=$1",[result.batch_id])).n,2);
 assert.equal((await one("select count(*)::integer n from booking_email_queue where appointment_id=$1 and event_kind='amended'",[a.id])).n,0);
 await as(staffA);await assert.rejects(pg.query('select bulk_update_treatments($1)',[JSON.stringify(rows)]),/changed since the preview/);
 const unchanged=result.treatments.map(t=>({...t,revision:t.revision}));assert.equal((await one('select bulk_update_treatments($1) data',[JSON.stringify(unchanged)])).data.changed,0);
});

test('multi-treatment visits reserve sequential slots atomically and retain per-treatment fees and cancellation',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/047_multi_treatment_visits.sql',import.meta.url),'utf8'));
 await pg.exec("insert into treatments(id,name,category,price,price_type,duration,guarantee_required) values(92001,'Visit A','Test',30,'Fixed',15,false),(92002,'Visit B','Test',40,'Fixed',30,false),(92003,'Visit C','Test',50,'Fixed',45,false);insert into staff_treatments(staff_id,treatment_id) values(1,92001),(1,92002),(1,92003),(2,92001);insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(1,'2091-02-20',540,1020),(2,'2091-02-20',540,1020);");
 const ids=[92001,92002,92003],expected=ids.map((id,i)=>({id,revision:0,price:[30,40,50][i],duration:[15,30,45][i]}));
 await as(clientUser);let slots=(await pg.query("select * from get_visit_slots($1,'2091-02-20',null)",[ids])).rows;assert(slots.some(s=>s.staff_id===1&&s.start_minute===600));assert(!slots.some(s=>s.staff_id===2));
 assert(!slots.some(s=>s.start_minute===735),'full visit must not cross lunch');
 await pg.exec('reset role');const block=await one("insert into staff_calendar_entries(staff_id,appointment_date,start_minute,duration,show_as,description,created_by) values(1,'2091-02-20',650,15,'busy','Block',$1) returning id",[staffA]);
 await as(clientUser);assert(!(await pg.query("select * from get_visit_slots($1,'2091-02-20',1)",[ids])).rows.some(s=>s.start_minute===600));await pg.exec('reset role');await pg.query('delete from staff_calendar_entries where id=$1',[block.id]);await as(clientUser);
 const request='22222222-0000-0000-0000-000000000001';
 const args=[ids,JSON.stringify(expected),request,1,'2091-02-20',600,'Client','123456789',true,'client@example.com',null,false,false,null,null];
 await assert.rejects(pg.query('select visit_book_one(92001,1,$1,600,\'Client\',\'123456789\',true,true,\'client@example.com\',\'saved_demo\')',['2091-02-20']),/permission denied/);
 const call='select book_treatment_visit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) data';
 const result=(await one(call,args)).data;assert.equal(result.appointments.length,3);assert.deepEqual(result.appointments.map(a=>a.start_minute),[600,615,645]);assert.deepEqual(result.appointments.map(a=>a.guarantee_fee_cents),[1500,2000,2500]);assert(result.appointments.every(a=>a.staff_id===1));
 assert.equal((await one(call,args)).data.visit_id,result.visit_id);
 await pg.exec('reset role');assert.equal((await one('select count(*)::integer n from appointments where visit_id=$1',[result.visit_id])).n,3);
 await as(clientUser);slots=(await pg.query("select * from get_visit_slots($1,'2091-02-20',1)",[ids])).rows;assert(!slots.some(s=>s.start_minute===600));
 const free=await one('select client_cancel_appointment($1,0) data',[result.appointments[1].id]);assert(free.data);
 await pg.exec('reset role');assert.equal((await one('select status from appointments where id=$1',[result.appointments[0].id])).status,'booked');
 // A later member failing its card requirement must roll back earlier inserts.
 await pg.exec('update treatments set guarantee_required=true where id=92003');await pg.query('update clients set requires_deposit=true where id=$1',[clientId]);await as(clientUser);
 const failure=[...args];failure[2]='22222222-0000-0000-0000-000000000002';failure[5]=870;
 await assert.rejects(pg.query(call,failure),/guarantee/);
 await pg.exec('reset role');assert.equal((await one('select count(*)::integer n from booking_visits where request_id=$1',[failure[2]])).n,0);
 assert.equal((await one("select count(*)::integer n from appointments where appointment_date='2091-02-20' and start_minute>=870")).n,0);
 await as(clientUser);
 const small=(await one("select purchase_demo_voucher('50',null,true,'','','saved_demo',true,gen_random_uuid()) data")).data;
 const payment=[...failure];payment[2]='22222222-0000-0000-0000-000000000003';payment[13]='voucher';payment[14]=small.id;
 await assert.rejects(pg.query(call,payment),/balance/);
 await pg.exec('reset role');assert.equal((await one('select count(*)::integer n from client_value_redemptions where voucher_id=$1',[small.id])).n,0);
 await as(clientUser);const large=(await one("select purchase_demo_voucher('150',null,true,'','','saved_demo',true,gen_random_uuid()) data")).data;
 const options=(await one('select get_visit_value_options($1) data',[ids])).data;assert(options.vouchers.some(v=>v.id===large.id));assert(!options.vouchers.some(v=>v.id===small.id));
 payment[2]='22222222-0000-0000-0000-000000000004';payment[14]=large.id;
 const prepaid=(await one(call,payment)).data;assert(prepaid.appointments.every(a=>a.prepaid_method==='voucher'));
 await pg.exec('reset role');assert.equal(Number((await one('select sum(amount) total from client_value_redemptions where voucher_id=$1',[large.id])).total),120);
 await as(clientUser);await one(call,payment);await pg.exec('reset role');assert.equal(Number((await one('select sum(amount) total from client_value_redemptions where voucher_id=$1',[large.id])).total),120);
 await pg.query('update clients set can_cancel_free=false where id=$1',[clientId]);await as(clientUser);
 const cancelled=await one('select client_cancel_appointment($1,0) data',[prepaid.appointments[1].id]);assert.equal(Number(cancelled.data.refund_amount),20);
 await pg.exec('reset role');assert.equal((await one('select status from appointments where id=$1',[prepaid.appointments[0].id])).status,'booked');
 await pg.exec("insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(1,'2091-02-21',540,1020)");
 const card=await one("insert into booking_guarantee_cards(client_id,created_by,setup_order_id,verified_at) values($1,$2,'visit-card',now()) returning id",[clientId,clientUser]);
 await as(clientUser);const guaranteed=[...args];guaranteed[2]='22222222-0000-0000-0000-000000000005';guaranteed[4]='2091-02-21';guaranteed[10]=card.id;guaranteed[11]=true;
 const cardVisit=(await one(call,guaranteed)).data;assert(cardVisit.appointments.every(a=>a.guarantee_required));
 const policy=(await one('select client_appointment_policy($1) data',[cardVisit.appointments[1].id])).data;assert.equal(policy.fee_cents,2000);
});

test('patch-first booking atomically saves one test and ordered treatments, enforces 24h and maintains pending links',async()=>{
 await pg.exec('reset role');await pg.exec(await readFile(new URL('../supabase/048_patch_test_treatment_flow.sql',import.meta.url),'utf8'));
 await pg.query('update clients set requires_deposit=false where id=$1',[clientId]);
 const patchId=(await one('select treatment_id from patch_booking_settings')).treatment_id;
 await pg.query('update treatments set price=0,guarantee_required=false where id=$1',[patchId]);
 await pg.exec("insert into treatments(id,name,category,price,price_type,duration,patch_required,guarantee_required) values(95001,'Patch Lash','Test',40,'Fixed',30,true,true),(95002,'Patch Brow','Test',20,'Fixed',15,true,true),(95003,'No Patch Nail','Test',30,'Fixed',30,false,true)");
 for(const id of [patchId,95001,95002,95003])await pg.query('insert into staff_treatments(staff_id,treatment_id) values(1,$1) on conflict do nothing',[id]);
 await pg.exec("insert into staff_day_shifts(staff_id,shift_date,start_minute,end_minute) values(1,'2092-02-20',540,1020),(1,'2092-02-21',540,1020),(1,'2092-02-22',540,1020)");
 const expected=(await pg.query('select id,revision,price,duration from treatments where id=any($1) order by id',[[95001,95002,95003]])).rows;
 await as(clientUser);const plan=(await one('select get_booking_flow_plan($1,null) data',[[95001,95002,95003]])).data;assert.deepEqual(plan.needed,[95001,95002]);
 const before=(await one('select count(*)::integer n from appointments')).n;
 const slots=(await pg.query("select * from get_booking_flow_slots($1,null,'2092-02-21',1,'2092-02-20',600,false)",[[95001,95002,95003]])).rows;
 assert(!slots.some(x=>x.start_minute<600));assert(slots.some(x=>x.start_minute===600));
 const request='40000000-0000-0000-0000-000000000048';
 const args=[[95001,95002,95003],JSON.stringify(expected),request,'Client Test','0800000000','client@example.com'];
 const sql="select book_booking_flow($1,$2,$3,1,'2092-02-21',600,$4,$5,true,$6,null,false,false,null,null,'2092-02-20',600,1) data";
 await assert.rejects(pg.query(sql.replace("'2092-02-21',600","'2092-02-21',570"),args),/24 hours/);
 assert.equal((await one('select count(*)::integer n from appointments')).n,before);
 const result=(await one(sql,args)).data;assert.equal(result.appointments.length,4);
 const [patch,...treatments]=result.appointments;assert.deepEqual(patch.patch_target_ids,[95001,95002]);assert.deepEqual(treatments.map(a=>a.start_minute),[600,630,645]);assert.deepEqual(treatments.map(a=>a.patch_test_pending),[true,true,false]);
 const retry=(await one(sql,args)).data;assert.deepEqual(retry.appointments.map(x=>x.id),result.appointments.map(x=>x.id));assert.equal((await one('select count(*)::integer n from appointments')).n,before+4);
 await as(staffA);
 await assert.rejects(pg.query("select * from amend_appointment($1,$2,1,'2092-02-20',660,0,'Later test')",[patch.id,patchId]),/at least 24 hours/);
 await assert.rejects(pg.query("select update_appointment_status($1,'checked_in',null,0,null)",[treatments[0].id]),/recorded patch test/);
 await pg.exec('reset role');
 await pg.query("update appointments set status='cancelled' where id=$1",[patch.id]);assert.match((await one('select patch_test_alert from appointments where id=$1',[treatments[0].id])).patch_test_alert,/staff review/);
 await pg.query("insert into client_patch_tests(client_id,performed_by,staff_name,recorded_by,recorded_at,treatments_covered) values($1,1,'Aoife',$2,'2092-02-20 09:00:00+00',$3)",[clientId,staffA,JSON.stringify([{id:95001,name:'Patch Lash'},{id:95002,name:'Patch Brow'}])]);
 assert.equal((await one('select patch_test_pending from appointments where id=$1',[treatments[0].id])).patch_test_pending,false);
 // A single treatment for a new attendee still saves nothing if its payer has no valid guarantee.
 await as(clientUser);const singleExpected=expected.filter(t=>t.id===95001);
 const proxyArgs=[[95001],JSON.stringify(singleExpected),'40000000-0000-0000-0000-000000000049','New Guest','0800000099','newpatchguest@example.com'];
 const proxySql="select book_booking_flow($1,$2,$3,1,'2092-02-22',600,$4,$5,false,$6,null,false,false,null,null,'2092-02-21',570,1) data";
 const count=(await one('select count(*)::integer n from appointments')).n;
 await assert.rejects(pg.query(proxySql,proxyArgs),/Agree to the booking guarantee/);
 assert.equal((await one('select count(*)::integer n from appointments')).n,count);
 const voucher=(await one("select purchase_demo_voucher('100',null,true,'','','saved_demo',true,gen_random_uuid()) data")).data;
 const paid=(await one(proxySql.replace("false,null,null,'2092-02-21'","false,'voucher',$7,'2092-02-21'"),[...proxyArgs,voucher.id])).data;
 assert.equal(paid.appointments.length,2);assert.equal(paid.appointments[1].prepaid_method,'voucher');assert.equal(paid.appointments[1].patch_test_pending,true);assert.equal(paid.appointments[0].client_id,paid.appointments[1].client_id);
 await assert.rejects(pg.query("select * from flow_book_visit($1,$2,gen_random_uuid(),1,'2092-02-22',700,$3,$4,true,$5,null,false,false)",[[95001],JSON.stringify(singleExpected),'Client','0800000000','client@example.com']),/permission denied/);

});
