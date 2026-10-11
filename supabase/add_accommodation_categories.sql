-- ============================================================
-- ONE DREAM CATALOGUE — HOTELS & ACCOMMODATION (Travel & Transport)
-- Safe to run repeatedly. Run after add_catalogue_categories.sql and
-- catalogue_department_scoped_names.sql.
--
-- "Hotels & Accommodation" is a display heading in the app, not a
-- database row with children. All seven categories sit directly under
-- the Travel & Transport department (no third level).
--
-- hotels-accommodation: existing row; only its name is set to "Hotels"
--   if it is not already. Id, slug, department and listings unchanged.
-- Six new categories: inserted only if their slug does not exist yet
--   (ON CONFLICT DO NOTHING); existing rows are never overwritten.
-- Logistics & Delivery, Travel & Tourism and Car Hire & Transport are
-- not touched.
-- ============================================================

-- 1. Safeguards. Stops before any change if:
--    - the Travel & Transport department is missing,
--    - hotels-accommodation is missing or sits in another department,
--    - any of the six new slugs already belongs to another department.
do $$
declare
  travel_id uuid;
  clash record;
begin
  select id into travel_id
  from public.catalogue_categories
  where slug = 'travel-transport' and parent_id is null;

  if travel_id is null then
    raise exception 'Travel & Transport department (travel-transport) not found. Run add_catalogue_categories.sql first.';
  end if;

  if not exists (
    select 1 from public.catalogue_categories
    where slug = 'hotels-accommodation' and parent_id = travel_id
  ) then
    raise exception 'hotels-accommodation is missing or not under Travel & Transport. Nothing was changed.';
  end if;

  select c.slug, coalesce(d.slug, '(no department)') as department
  into clash
  from public.catalogue_categories c
  left join public.catalogue_categories d on d.id = c.parent_id
  where c.slug in ('short-stays-short-lets', 'serviced-apartments', 'guesthouses-lodges', 'vacation-rentals', 'resorts', 'hostels')
    and c.parent_id is distinct from travel_id
  limit 1;

  if found then
    raise exception 'Slug "%" already belongs to %. Nothing was changed.', clash.slug, clash.department;
  end if;
end $$;

-- 2. Existing Hotels record: name only, and only when it differs.
update public.catalogue_categories
set name = 'Hotels'
where slug = 'hotels-accommodation'
  and name is distinct from 'Hotels';

-- 3. Six new categories, placed directly under Travel & Transport.
insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, parent_id, is_active, is_selectable)
select v.name, v.slug, v.icon, v.tint, v.ink, v.sort_order, travel.id, true, true
from (
  values
    ('Short Stays & Short Lets', 'short-stays-short-lets', 'key', '#FEF3C7', '#B45309', 401),
    ('Serviced Apartments', 'serviced-apartments', 'business', '#DBEAFE', '#1D4ED8', 402),
    ('Guesthouses & Lodges', 'guesthouses-lodges', 'home', '#DCFCE7', '#15803D', 403),
    ('Vacation Rentals', 'vacation-rentals', 'sunny', '#FFEDD5', '#C2410C', 404),
    ('Resorts', 'resorts', 'umbrella', '#E0F2FE', '#0369A1', 405),
    ('Hostels', 'hostels', 'people', '#EDE9FE', '#6D28D9', 406)
) as v(name, slug, icon, tint, ink, sort_order)
cross join (
  select id from public.catalogue_categories
  where slug = 'travel-transport' and parent_id is null
) as travel
on conflict (slug) do nothing;


-- ------------------------------------------------------------
-- CHECK: expect 10 categories in Travel & Transport.
-- ------------------------------------------------------------
-- select c.slug, c.name
--   from public.catalogue_categories c
--   join public.catalogue_categories d on d.id = c.parent_id
--  where d.slug = 'travel-transport'
--  order by c.sort_order;
