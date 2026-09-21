-- Revert the temporary pioneer cap raise from 0019.
--
-- 0019 raised the default from 500 to 1000 for dev testing. This migration
-- reverts the default and updates locations whose pioneer_taken is still
-- below 500. Locations that accumulated more than 500 claims during testing
-- keep their current cap to avoid invalidating existing pioneer numbers.
--
-- The claim_location() function checks pioneer_taken < pioneer_cap, so
-- lowering the cap on a location with pioneer_taken >= new cap simply means
-- future claims receive Explorer edition (null number) instead of a pioneer
-- number. Existing claims are never affected.

-- 1. Revert the column default for new locations.
alter table locations alter column pioneer_cap set default 500;

-- 2. Update locations that can safely be reverted (fewer than 500 claims).
--    Locations with pioneer_taken >= 500 keep their current cap.
update locations
   set pioneer_cap = 500
 where pioneer_taken < 500;
