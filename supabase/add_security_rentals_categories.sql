-- ============================================================
-- ONE DREAM CATALOGUE — SECURITY & TRACKING and RENTALS & HIRE departments
-- Safe to run repeatedly. Run after add_catalogue_categories.sql,
-- add_dynamic_listing_engine.sql and add_catalogue_search_aliases.sql.
--
-- Before this, security meant only CCTV (installation under Construction,
-- technicians under Artisans) and there was nowhere for guards, bodyguards,
-- event security or tracking. Rentals existed only for property, holiday
-- homes, car hire and heavy machinery - nothing for event, generator,
-- sound, camera, furniture or outfit hire.
--
-- 1. Two new departments (headings, not selectable).
-- 2. 7 security & tracking categories and 9 rental categories (inserted
--    only if the slug is new; existing rows are never overwritten).
-- 3. Existing rental and CCTV categories stay where they are (the app
--    groups them in fixed sections); search aliases point rental and
--    security words at them as well.
-- 4. Lost Phone Recovery & Device Security is for the owner's own phones, a company's
--    own devices and lost/stolen phone recovery. Locating another person's phone
--    or number without their consent is not allowed on One Dream.
-- No listing, price or payment data is touched.
-- ============================================================

-- 1. Safeguards: stop before any change if a new slug already belongs to a
--    different department.
do $$
declare clash record;
begin
  select c.slug, coalesce(d.slug, '(no department)') as department, x.dept as expected into clash
    from public.catalogue_categories c
    left join public.catalogue_categories d on d.id = c.parent_id
    join (values
      ('security-guards', 'security-tracking'), ('bodyguards-close-protection', 'security-tracking'),
      ('event-security-crowd-control', 'security-tracking'), ('security-training-consulting', 'security-tracking'),
      ('security-equipment-alarms', 'security-tracking'), ('vehicle-fleet-tracking', 'security-tracking'),
      ('device-recovery-security', 'security-tracking'),
      ('event-party-rentals', 'rentals-hire'), ('generator-power-hire', 'rentals-hire'),
      ('sound-stage-lighting-hire', 'rentals-hire'), ('camera-studio-rental', 'rentals-hire'),
      ('furniture-appliance-rental', 'rentals-hire'), ('wedding-decor-rentals', 'rentals-hire'),
      ('costume-outfit-rental', 'rentals-hire'), ('tools-equipment-hire', 'rentals-hire'),
      ('electronics-gadget-rental', 'rentals-hire')
    ) as x(slug, dept) on x.slug = c.slug
   where d.slug is distinct from x.dept
   limit 1;
  if found then
    raise exception 'Slug "%" already belongs to %. Nothing was changed.', clash.slug, clash.department;
  end if;
end $$;

-- 2. The departments
insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, is_featured, is_selectable, banner_subtitle)
values
('Security & Tracking', 'security-tracking', 'shield-checkmark', '#E0E7FF', '#3730A3', 19, false, false,
 'Guards, close protection, alarms and GPS tracking for your own vehicles and devices'),
('Rentals & Hire', 'rentals-hire', 'key', '#FEF3C7', '#B45309', 20, false, false,
 'Rent what you need for events, shoots, projects and everyday life')
on conflict (slug) do nothing;

-- 3. Their categories
insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, parent_id, is_active, is_selectable, listing_types, suggested_listing_type)
select v.name, v.slug, v.icon, v.tint, v.ink, v.sort_order, dept.id, true, true, v.listing_types, v.suggested
from (
  values
    ('security-tracking', 'Security Guards & Manned Guarding', 'security-guards',              'shield-checkmark', '#E0E7FF', '#3730A3', 601, array['service']::text[],           'service'),
    ('security-tracking', 'Bodyguards & Close Protection',     'bodyguards-close-protection',  'body',             '#E0E7FF', '#4338CA', 602, array['service']::text[],           'service'),
    ('security-tracking', 'Event Security & Crowd Control',    'event-security-crowd-control', 'people',           '#FEE2E2', '#B91C1C', 603, array['service']::text[],           'service'),
    ('security-tracking', 'Security Training & Consulting',    'security-training-consulting', 'school',           '#F1F5F9', '#334155', 604, array['service']::text[],           'service'),
    ('security-tracking', 'Security Equipment & Alarms',       'security-equipment-alarms',    'alarm',            '#FEF3C7', '#B45309', 605, array['product','service']::text[], 'product'),
    ('security-tracking', 'Vehicle & Fleet Tracking',          'vehicle-fleet-tracking',       'navigate',         '#DCFCE7', '#15803D', 606, array['product','service']::text[], null),
    ('security-tracking', 'Lost Phone Recovery & Device Security', 'device-recovery-security', 'phone-portrait',         '#DBEAFE', '#1D4ED8', 607, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Event & Party Rentals',             'event-party-rentals',          'calendar',         '#FCE7F3', '#BE185D', 701, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Generator & Power Hire',            'generator-power-hire',         'flash',            '#FEF9C3', '#A16207', 702, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Sound, Stage & Lighting Hire',      'sound-stage-lighting-hire',    'musical-notes',    '#EDE9FE', '#6D28D9', 703, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Camera & Studio Rental',            'camera-studio-rental',         'camera',           '#F3F4F6', '#1F2937', 704, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Furniture & Appliance Rental',      'furniture-appliance-rental',   'bed',              '#DCFCE7', '#166534', 705, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Wedding & Decor Rentals',           'wedding-decor-rentals',        'sparkles',         '#FFE4E6', '#BE123C', 706, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Costume & Outfit Rental',           'costume-outfit-rental',        'shirt',            '#FFEDD5', '#C2410C', 707, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Tools & Equipment Hire',            'tools-equipment-hire',         'hammer',           '#E5E7EB', '#374151', 708, array['product','service']::text[], 'service'),
    ('rentals-hire',      'Electronics & Gadget Rental',       'electronics-gadget-rental',    'tv',               '#DBEAFE', '#1E40AF', 709, array['product','service']::text[], 'service')
) as v(dept_slug, name, slug, icon, tint, ink, sort_order, listing_types, suggested)
join public.catalogue_categories dept on dept.slug = v.dept_slug and dept.parent_id is null
on conflict (slug) do nothing;

-- 4. Search aliases (what buyers and sellers actually type)
insert into public.catalogue_search_aliases (category_id, alias)
select c.id, v.alias
from public.catalogue_categories c
join (values
  ('security-tracking', 'Security'), ('security-tracking', 'Security services'), ('security-tracking', 'Security company'), ('security-tracking', 'Tracking'),
  ('security-guards', 'Security guard'), ('security-guards', 'Guards'), ('security-guards', 'Watchman'), ('security-guards', 'Gateman'),
  ('security-guards', 'Night guard'), ('security-guards', 'Estate security'), ('security-guards', 'Guard service'),
  ('bodyguards-close-protection', 'Bodyguard'), ('bodyguards-close-protection', 'Close protection'), ('bodyguards-close-protection', 'VIP protection'),
  ('bodyguards-close-protection', 'Personal security'), ('bodyguards-close-protection', 'Security escort'),
  ('event-security-crowd-control', 'Event security'), ('event-security-crowd-control', 'Bouncer'), ('event-security-crowd-control', 'Bouncers'),
  ('event-security-crowd-control', 'Crowd control'), ('event-security-crowd-control', 'Ushers security'),
  ('security-training-consulting', 'Security training'), ('security-training-consulting', 'Security consultant'),
  ('security-training-consulting', 'Security audit'), ('security-training-consulting', 'Risk assessment'),
  ('security-equipment-alarms', 'Burglar alarm'), ('security-equipment-alarms', 'Alarm system'), ('security-equipment-alarms', 'Metal detector'),
  ('security-equipment-alarms', 'Walkie talkie'), ('security-equipment-alarms', 'Safe'), ('security-equipment-alarms', 'Access control'),
  ('security-equipment-alarms', 'Electric fence'), ('security-equipment-alarms', 'Smart lock'),
  ('vehicle-fleet-tracking', 'Car tracker'), ('vehicle-fleet-tracking', 'Vehicle tracking'), ('vehicle-fleet-tracking', 'GPS tracker'),
  ('vehicle-fleet-tracking', 'Fleet tracking'), ('vehicle-fleet-tracking', 'Fleet management'), ('vehicle-fleet-tracking', 'Tracker installation'),
  ('vehicle-fleet-tracking', 'Bike tracker'), ('vehicle-fleet-tracking', 'Asset tracking'),
  ('device-recovery-security', 'Track my phone'), ('device-recovery-security', 'Lost phone'),
  ('device-recovery-security', 'Stolen phone recovery'), ('device-recovery-security', 'Phone recovery'),
  ('rentals-hire', 'Rentals'), ('rentals-hire', 'Rental'), ('rentals-hire', 'Hire'), ('rentals-hire', 'For hire'), ('rentals-hire', 'Rent'), ('rentals-hire', 'Lease'),
  ('event-party-rentals', 'Canopy'), ('event-party-rentals', 'Canopies'), ('event-party-rentals', 'Chairs and tables'), ('event-party-rentals', 'Tent hire'),
  ('event-party-rentals', 'Marquee'), ('event-party-rentals', 'Party rentals'), ('event-party-rentals', 'Bouncy castle'), ('event-party-rentals', 'Chafing dish'),
  ('generator-power-hire', 'Generator hire'), ('generator-power-hire', 'Generator rental'), ('generator-power-hire', 'Power hire'),
  ('generator-power-hire', 'Inverter rental'), ('generator-power-hire', 'Diesel generator'),
  ('sound-stage-lighting-hire', 'PA system'), ('sound-stage-lighting-hire', 'Sound hire'), ('sound-stage-lighting-hire', 'Speaker rental'),
  ('sound-stage-lighting-hire', 'Stage hire'), ('sound-stage-lighting-hire', 'Event lighting'), ('sound-stage-lighting-hire', 'LED screen rental'),
  ('camera-studio-rental', 'Camera rental'), ('camera-studio-rental', 'Lens rental'), ('camera-studio-rental', 'Studio rental'),
  ('camera-studio-rental', 'Drone rental'), ('camera-studio-rental', 'Lighting kit'),
  ('furniture-appliance-rental', 'Furniture rental'), ('furniture-appliance-rental', 'Fridge rental'), ('furniture-appliance-rental', 'AC rental'),
  ('furniture-appliance-rental', 'Freezer hire'),
  ('wedding-decor-rentals', 'Wedding decor'), ('wedding-decor-rentals', 'Decor rental'), ('wedding-decor-rentals', 'Centerpieces'),
  ('wedding-decor-rentals', 'Backdrop'), ('wedding-decor-rentals', 'Wedding chairs'),
  ('costume-outfit-rental', 'Costume rental'), ('costume-outfit-rental', 'Wedding gown rental'), ('costume-outfit-rental', 'Suit rental'),
  ('costume-outfit-rental', 'Dress rental'), ('costume-outfit-rental', 'Graduation gown'),
  ('tools-equipment-hire', 'Tool hire'), ('tools-equipment-hire', 'Ladder hire'), ('tools-equipment-hire', 'Drill rental'),
  ('tools-equipment-hire', 'Pressure washer'), ('tools-equipment-hire', 'Concrete mixer hire'),
  ('electronics-gadget-rental', 'Projector rental'), ('electronics-gadget-rental', 'Laptop rental'), ('electronics-gadget-rental', 'PS5 rental'),
  ('electronics-gadget-rental', 'Game console rental'), ('electronics-gadget-rental', 'TV rental'),
  ('cctv-security-installation', 'Security installation'), ('cctv-security-technicians', 'Alarm technician'),
  ('property-for-rent', 'House for rent'), ('property-for-rent', 'Shop for rent'), ('property-for-rent', 'Office for rent'),
  ('car-hire-transport', 'Bus hire'), ('heavy-machinery-rental', 'Excavator hire')
) as v(slug, alias) on v.slug = c.slug
on conflict (category_id, normalized_alias) do nothing;

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'security department exists', exists (select 1 from public.catalogue_categories where slug = 'security-tracking' and parent_id is null and not is_selectable)
  union all select 'rentals department exists', exists (select 1 from public.catalogue_categories where slug = 'rentals-hire' and parent_id is null and not is_selectable)
  union all select '7 security categories', (select count(*) from public.catalogue_categories c join public.catalogue_categories d on d.id = c.parent_id
                                              where d.slug = 'security-tracking') >= 7
  union all select '9 rental categories', (select count(*) from public.catalogue_categories c join public.catalogue_categories d on d.id = c.parent_id
                                            where d.slug = 'rentals-hire') >= 9
  union all select 'lost phone recovery & device security selectable', exists (select 1 from public.catalogue_categories where slug = 'device-recovery-security' and is_selectable and is_active)
  union all select 'search aliases added', (select count(*) from public.catalogue_search_aliases a join public.catalogue_categories c on c.id = a.category_id
                                            left join public.catalogue_categories d on d.id = c.parent_id
                                            where d.slug in ('security-tracking', 'rentals-hire') or c.slug in ('security-tracking', 'rentals-hire')) >= 99
)
select * from checks order by ok, check_name;
