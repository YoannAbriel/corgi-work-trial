-- 0010: the suspense account for customer money that arrives before its policy can be bound.
--
-- Rule 14 (DECISIONS.md, decided by Yoann on 2026-09-08): a payment that Stripe collects while
-- the broker is no longer eligible is journaled the moment it exists, as cash at Stripe against
-- a liability to the customer, instead of waiting unjournaled for a human. Binding the policy
-- later moves the parked amount to premium, tax and fee; refunding it moves it back to cash.
-- Ledger cash therefore equals Stripe cash at every instant (review findings F-B2-17, F-B3-01).
--
-- The chart of accounts is append-only (0001), so the account is added, never edited.
insert into accounts (id, name, side) values
  ('unapplied_customer_cash', 'Customer money received at Stripe and not yet applied to a policy', 'credit');

-- The policy_current cache learns the status 'paid_not_bound': money received, policy not
-- bound, because the broker was not eligible when it arrived (review finding F-B3-07: such a
-- policy read as awaiting_payment and offered the broker a second payment). Same reasoning as
-- 0007: policy_current is a rebuildable cache, not a financial record, and the only table the
-- application may UPDATE; the protected tables are untouched.
alter table policy_current drop constraint policy_current_status_check;

alter table policy_current
  add constraint policy_current_status_check
  check (status in ('draft', 'awaiting_payment', 'payment_failed', 'paid_not_bound', 'bound', 'cancelled', 'voided'));
