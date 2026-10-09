-- Apply once after 039. No rebooking automation is enabled by this migration.
begin;
alter table public.treatments add column rebook_window text check(rebook_window in('1 week','2 weeks','4 weeks','2 months','3 months','6 months','12 months'));
drop function public.save_treatment(integer,text,text,integer,numeric,boolean,integer,boolean);
create function public.save_treatment(p_id integer,p_name text,p_description text,p_duration integer,p_price numeric,p_patch_required boolean,p_revision integer,p_guarantee_required boolean default null,p_rebook_window text default null) returns public.treatments language plpgsql security definer set search_path='' as $$ declare old public.treatments;t public.treatments;begin
 if p_rebook_window is not null and p_rebook_window not in('1 week','2 weeks','4 weeks','2 months','3 months','6 months','12 months') then raise exception 'Choose a valid rebook window.';end if;
 perform public.require_any_permission(array['view.treatments']);
 if length(trim(coalesce(p_name,''))) not between 1 and 200 or length(coalesce(p_description,''))>5000 then raise exception 'Enter a treatment name and a description of up to 5000 characters.';end if;
 if p_duration is null or p_duration not between 1 and 720 or p_price is null or p_price<0 or p_price>=1000000 or p_price<>round(p_price,2) or p_patch_required is null then raise exception 'Enter a valid length, price and patch test setting.';end if;
 select * into old from public.treatments where id=p_id for update;
 if old.id is null or old.revision is distinct from p_revision then raise exception 'Treatment changed or was not found. Reload before saving.';end if;
 if p_patch_required and p_id=(select treatment_id from public.patch_booking_settings where id=true) then raise exception 'The Patch Test service cannot itself require a patch test.';end if;
 update public.treatments set rebook_window=p_rebook_window,guarantee_required=coalesce(p_guarantee_required,old.guarantee_required),name=trim(p_name),description=coalesce(p_description,''),duration=p_duration,price=p_price,patch_required=p_patch_required,revision=revision+1 where id=p_id returning * into t;
 insert into public.audit_events(user_id,action,details) values(auth.uid(),'treatment_updated',jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(t)));return t;
end; $$;
revoke all on function public.save_treatment(integer,text,text,integer,numeric,boolean,integer,boolean,text) from public;
grant execute on function public.save_treatment(integer,text,text,integer,numeric,boolean,integer,boolean,text) to authenticated;

commit;
