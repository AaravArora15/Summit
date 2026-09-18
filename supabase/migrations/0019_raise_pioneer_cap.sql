-- Temporary: raise the pioneer cap so dev testing (including the app's
-- "Fake claim (dev)" button) doesn't run out of pioneer numbers mid-session.
-- 500 was never a deliberate product decision recorded anywhere in this
-- migration chain, just the schema's original default — this isn't one
-- either. Revisit the real cap before shipping.
alter table locations alter column pioneer_cap set default 1000;
update locations set pioneer_cap = 1000;
