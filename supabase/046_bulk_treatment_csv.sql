-- Apply once after 045. CSV imports update existing active treatment IDs only.
begin;
create function public.bulk_update_treatments(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; old public.treatments; updated public.treatments;
 batch_id uuid:=gen_random_uuid(); changed integer:=0; result jsonb:='[]'::jsonb;
begin
 perform public.require_any_permission(array['view.treatments']);
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid treatment import.';end if;
 if jsonb_array_length(p_rows) not between 1 and 2000 then raise exception 'Include between 1 and 2,000 treatments.';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) e where jsonb_typeof(e) is distinct from 'object'
   or jsonb_typeof(e->'id') is distinct from 'number' or jsonb_typeof(e->'revision') is distinct from 'number'
   or jsonb_typeof(e->'category') is distinct from 'string' or jsonb_typeof(e->'name') is distinct from 'string'
   or jsonb_typeof(e->'description') is distinct from 'string' or jsonb_typeof(e->'duration') is distinct from 'number'
   or jsonb_typeof(e->'price') is distinct from 'number' or jsonb_typeof(e->'guarantee_required') is distinct from 'boolean'
   or jsonb_typeof(e->'patch_required') is distinct from 'boolean'
   or not (e ? 'rebook_window') or jsonb_typeof(e->'rebook_window') not in ('string','null')
   or (e->>'id')::numeric<>trunc((e->>'id')::numeric)
   or (e->>'revision')::numeric<>trunc((e->>'revision')::numeric)
   or (e->>'duration')::numeric<>trunc((e->>'duration')::numeric)) then raise exception 'Invalid treatment import values.';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) e group by e->>'id' having count(*)>1) then raise exception 'Duplicate Treatment IDs are not allowed.';end if;
 -- Lock in ID order and compare every preview revision, even for unchanged rows.
 for r in select * from jsonb_to_recordset(p_rows) as x(id integer,revision integer,category text,name text,description text,duration integer,price numeric,rebook_window text,guarantee_required boolean,patch_required boolean) order by id loop
   select * into old from public.treatments where id=r.id and active for update;
   if old.id is null then raise exception 'Treatment ID % is not an active treatment.',r.id;end if;
   if old.revision is distinct from r.revision then raise exception 'Treatment ID % changed since the preview. Cancel, reload and upload the CSV again. No changes were applied.',r.id;end if;
   if length(trim(r.category)) not between 1 and 200 or length(trim(r.name)) not between 1 and 200 or length(r.description)>5000
     or r.duration not between 1 and 720 or r.price<0 or r.price>=1000000 or r.price<>round(r.price,2)
     or (r.rebook_window is not null and r.rebook_window not in('1 week','2 weeks','4 weeks','2 months','3 months','6 months','12 months')) then
     raise exception 'Treatment ID % contains invalid field values. No changes were applied.',r.id;
   end if;
   if r.patch_required and r.id=(select treatment_id from public.patch_booking_settings where id=true) then raise exception 'The Patch Test service cannot itself require a patch test.';end if;
   if (old.category,old.name,old.description,old.duration,old.price,old.rebook_window,old.guarantee_required,old.patch_required)
      is distinct from (trim(r.category),trim(r.name),r.description,r.duration,r.price,r.rebook_window,r.guarantee_required,r.patch_required) then
     update public.treatments set category=trim(r.category),name=trim(r.name),description=r.description,duration=r.duration,price=r.price,
       rebook_window=r.rebook_window,guarantee_required=r.guarantee_required,patch_required=r.patch_required,revision=revision+1
       where id=r.id returning * into updated;
     if old.name is distinct from updated.name then
       -- Existing prices/durations/guarantees and original financial audit snapshots remain unchanged.
       update public.appointments a set treatment_name=case when a.patch_for_treatment_id is not null then 'Patch Test for '||coalesce((select name from public.treatments where id=a.patch_for_treatment_id),a.patch_for_treatment_name) else updated.name end,
         revision=a.revision+1 where a.treatment_id=r.id and a.patch_for_treatment_id is distinct from r.id;
       update public.appointments a set patch_for_treatment_name=updated.name,treatment_name='Patch Test for '||updated.name,revision=a.revision+1 where a.patch_for_treatment_id=r.id;
     end if;
     insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_bulk_updated',jsonb_build_object('batch_id',batch_id,'treatment_id',r.id,'before',to_jsonb(old),'after',to_jsonb(updated)));
     changed:=changed+1;
   else updated:=old;
   end if;
   result:=result||jsonb_build_array(to_jsonb(updated));
 end loop;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_csv_imported',jsonb_build_object('batch_id',batch_id,'rows',jsonb_array_length(p_rows),'changed',changed));
 return jsonb_build_object('changed',changed,'treatments',result,'batch_id',batch_id);
end; $$;
revoke all on function public.bulk_update_treatments(jsonb) from public,anon;
grant execute on function public.bulk_update_treatments(jsonb) to authenticated;
commit;
