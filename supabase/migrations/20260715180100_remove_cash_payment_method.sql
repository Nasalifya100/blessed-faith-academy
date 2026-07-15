-- ===========================================================================
-- Phase 4a follow-up: remove cash from payment_method
--
-- The first fees migration included 'cash'. School policy is mobile money and
-- bank transfer only. Any existing cash rows (unlikely) are remapped to
-- mobile_money before the enum is replaced.
-- ===========================================================================

alter type public.payment_method rename to payment_method_old;

create type public.payment_method as enum (
  'mobile_money',
  'bank_transfer'
);

alter table public.payments
  alter column method drop default;

alter table public.payments
  alter column method type public.payment_method
  using (
    case
      when method::text = 'cash' then 'mobile_money'
      else method::text
    end
  )::public.payment_method;

alter table public.payments
  alter column method set default 'mobile_money'::public.payment_method;

drop type public.payment_method_old;
