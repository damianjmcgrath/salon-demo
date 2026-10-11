begin;
-- Consolidate before the booking transaction commits; webhook workers cannot see intermediate rows.
create function public.group_booking_confirmations(p_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare keeper uuid; items jsonb;begin
 if cardinality(p_ids)<2 then return;end if;
 select q.id into keeper from public.booking_email_queue q where q.appointment_id=any(p_ids) and q.event_kind='booked' and q.status='pending' and q.payload is null order by array_position(p_ids,q.appointment_id) limit 1;
 if keeper is null then return;end if;
 select jsonb_agg(to_jsonb(a)||jsonb_build_object('staff_name',s.name) order by array_position(p_ids,a.id)) into items from public.appointments a join public.staff s on s.id=a.staff_id where a.id=any(p_ids);
 update public.booking_email_queue set snapshot=snapshot||jsonb_build_object('appointments',items) where id=keeper;
 update public.booking_email_queue set status='cancelled',last_error='Included in combined booking confirmation.' where appointment_id=any(p_ids) and id<>keeper and event_kind='booked' and status='pending' and payload is null;
end;$$;
revoke all on function public.group_booking_confirmations(uuid[]) from public,anon,authenticated;
do $$ declare def text;begin
 def:=pg_get_functiondef('public.book_booking_flow(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid,date,integer,integer)'::regprocedure);
 if position('return result;' in def)=0 then raise exception 'Unexpected booking flow implementation';end if;
 execute replace(def,'return result;','perform public.group_booking_confirmations(ids); return result;');
 def:=pg_get_functiondef('public.book_treatment_visit(integer[],jsonb,uuid,integer,date,integer,text,text,boolean,text,uuid,boolean,boolean,text,uuid)'::regprocedure);
 execute replace(def,$text$insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_visit_booked'$text$, $text$perform public.group_booking_confirmations(array(select (x->>'id')::uuid from jsonb_array_elements(result) x)); insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_visit_booked'$text$);
 def:=pg_get_functiondef('public.log_booking_email_communication()'::regprocedure);
 execute replace(def,$text$coalesce(new.snapshot->>'treatment_name',a.treatment_name)$text$,$text$coalesce((select string_agg(x->>'treatment_name', ', ') from jsonb_array_elements(new.snapshot->'appointments') x),new.snapshot->>'treatment_name',a.treatment_name)$text$);
end;$$;
commit;
