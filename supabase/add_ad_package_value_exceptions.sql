-- ============================================================================
-- Advertising: package value exceptions
-- ============================================================================
-- Additive. Lets an admin mark an ascending-value warning (a dearer package
-- offering less than a cheaper one, lib/adPackageValidation.js) as
-- intentional. `signature` records the exact values compared, so an exception
-- stops applying as soon as either package changes.
--
-- Changes no existing table, package, price or entitlement. Server-only: RLS
-- on with no policies, no client-role privileges. Safe to re-run.
-- ============================================================================

create table if not exists advertising_package_value_exceptions (
  package_id text not null references advertising_packages(id) on delete cascade,
  compared_package_id text not null references advertising_packages(id) on delete cascade,
  rule text not null check (rule in ('creatives', 'duration', 'priority', 'placements')),
  signature text not null check (char_length(signature) <= 200),
  note text not null check (char_length(note) between 1 and 300),
  acknowledged_by uuid,
  acknowledged_by_email text,
  created_at timestamptz not null default now(),
  primary key (package_id, compared_package_id, rule)
);

alter table advertising_package_value_exceptions enable row level security;
revoke all on advertising_package_value_exceptions from anon, authenticated;

-- Verify
select count(*) as exceptions,
       (select relrowsecurity from pg_class where relname = 'advertising_package_value_exceptions') as rls_on
from advertising_package_value_exceptions;
