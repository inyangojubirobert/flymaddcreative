-- ============================================================
-- ONE DREAM CATALOGUE — AGRICULTURE & FARMING department
-- Safe to run repeatedly. Run after add_catalogue_categories.sql,
-- add_dynamic_listing_engine.sql and add_catalogue_search_aliases.sql.
--
-- Before this, agriculture had only "Agricultural Equipment" (under
-- Business & Industry) and "Farm Produce" / "Meat & Seafood" (under
-- Food & Grocery, for shoppers). There was nowhere for livestock,
-- poultry, fish farming, seeds, fertiliser, feed or farm services.
--
-- 1. New department "Agriculture & Farming" (a heading, not selectable).
-- 2. 15 categories under it (inserted only if the slug is new; existing
--    rows are never overwritten).
-- 3. "Agricultural Equipment" moves under the new department. Its id,
--    slug and listings are unchanged; only its parent changes.
-- 4. Farm Produce and Meat & Seafood stay in Food & Grocery (shoppers
--    look there); search aliases point farm words at the right places.
-- No listing, price or payment data is touched.
-- ============================================================

-- 1. Safeguards: stop before any change if a new slug already belongs to a
--    different department.
do $$
declare clash record;
begin
  select c.slug, coalesce(d.slug, '(no department)') as department into clash
    from public.catalogue_categories c
    left join public.catalogue_categories d on d.id = c.parent_id
   where c.slug in ('crops-grains', 'tubers-root-crops', 'farm-fruits-vegetables', 'cash-crops', 'livestock',
                    'poultry-eggs', 'fish-farming-aquaculture', 'seeds-seedlings', 'fertilisers-agrochemicals',
                    'animal-feed-supplements', 'farm-tools-supplies', 'tractor-hire-mechanisation',
                    'veterinary-services', 'agronomy-farm-consulting', 'agro-processing-storage')
     and (d.slug is distinct from 'agriculture-farming')
   limit 1;
  if found then
    raise exception 'Slug "%" already belongs to %. Nothing was changed.', clash.slug, clash.department;
  end if;
end $$;

-- 2. The department
insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, is_featured, is_selectable, banner_subtitle)
values
('Agriculture & Farming', 'agriculture-farming', 'leaf', '#DCFCE7', '#15803D', 18, false, false,
 'Crops, livestock, inputs and farm services, straight from farmers and suppliers')
on conflict (slug) do nothing;

-- 3. Its categories
insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, parent_id, is_active, is_selectable, listing_types, suggested_listing_type)
select v.name, v.slug, v.icon, v.tint, v.ink, v.sort_order, dept.id, true, true, v.listing_types, v.suggested
from (
  values
    ('Crops & Grains',                 'crops-grains',               'nutrition', '#FEF9C3', '#A16207', 501, array['product']::text[],            'product'),
    ('Tubers & Root Crops',            'tubers-root-crops',          'nutrition', '#FFEDD5', '#C2410C', 502, array['product']::text[],            'product'),
    ('Fresh Fruits & Vegetables (Farm)', 'farm-fruits-vegetables',   'leaf',      '#DCFCE7', '#15803D', 503, array['product']::text[],            'product'),
    ('Cash Crops',                     'cash-crops',                 'cash',      '#FEF3C7', '#B45309', 504, array['product']::text[],            'product'),
    ('Livestock',                      'livestock',                  'paw',       '#FEE2E2', '#B91C1C', 505, array['product']::text[],            'product'),
    ('Poultry & Eggs',                 'poultry-eggs',               'egg',       '#FEF9C3', '#A16207', 506, array['product']::text[],            'product'),
    ('Fish Farming & Aquaculture',     'fish-farming-aquaculture',   'fish',      '#E0F2FE', '#0369A1', 507, array['product','service']::text[],  'product'),
    ('Seeds, Seedlings & Nursery',     'seeds-seedlings',            'flower',    '#DCFCE7', '#166534', 508, array['product']::text[],            'product'),
    ('Fertilisers & Agrochemicals',    'fertilisers-agrochemicals',  'flask',     '#EDE9FE', '#6D28D9', 509, array['product']::text[],            'product'),
    ('Animal Feed & Supplements',      'animal-feed-supplements',    'bag',       '#FFEDD5', '#9A3412', 510, array['product']::text[],            'product'),
    ('Farm Tools & Supplies',          'farm-tools-supplies',        'hammer',    '#E5E7EB', '#374151', 511, array['product']::text[],            'product'),
    ('Tractor Hire & Mechanisation',   'tractor-hire-mechanisation', 'construct', '#FEF3C7', '#92400E', 512, array['service']::text[],            'service'),
    ('Veterinary Services',            'veterinary-services',        'medkit',    '#FCE7F3', '#BE185D', 513, array['service']::text[],            'service'),
    ('Agronomy & Farm Consulting',     'agronomy-farm-consulting',   'school',    '#E0E7FF', '#4338CA', 514, array['service']::text[],            'service'),
    ('Agro-processing & Storage',      'agro-processing-storage',    'business',  '#F3F4F6', '#1F2937', 515, array['product','service']::text[],  null)
) as v(name, slug, icon, tint, ink, sort_order, listing_types, suggested)
cross join (select id from public.catalogue_categories where slug = 'agriculture-farming' and parent_id is null) as dept
on conflict (slug) do nothing;

-- 4. Agricultural Equipment joins the new department (parent only).
update public.catalogue_categories c
   set parent_id = dept.id
  from (select id from public.catalogue_categories where slug = 'agriculture-farming' and parent_id is null) dept
 where c.slug = 'agricultural-equipment'
   and c.parent_id is distinct from dept.id;

-- 5. Search aliases (what buyers and sellers actually type)
insert into public.catalogue_search_aliases (category_id, alias)
select c.id, v.alias
from public.catalogue_categories c
join (values
  ('agriculture-farming', 'Agriculture'), ('agriculture-farming', 'Farming'), ('agriculture-farming', 'Farm'), ('agriculture-farming', 'Agro'),
  ('crops-grains', 'Maize'), ('crops-grains', 'Corn'), ('crops-grains', 'Rice'), ('crops-grains', 'Beans'), ('crops-grains', 'Sorghum'),
  ('crops-grains', 'Millet'), ('crops-grains', 'Soybeans'), ('crops-grains', 'Groundnut'), ('crops-grains', 'Wheat'),
  ('tubers-root-crops', 'Yam'), ('tubers-root-crops', 'Cassava'), ('tubers-root-crops', 'Cocoyam'), ('tubers-root-crops', 'Sweet potato'), ('tubers-root-crops', 'Garri'),
  ('farm-fruits-vegetables', 'Tomatoes'), ('farm-fruits-vegetables', 'Pepper'), ('farm-fruits-vegetables', 'Onions'), ('farm-fruits-vegetables', 'Plantain'),
  ('farm-fruits-vegetables', 'Pineapple'), ('farm-fruits-vegetables', 'Vegetables wholesale'),
  ('cash-crops', 'Cocoa'), ('cash-crops', 'Cashew'), ('cash-crops', 'Palm oil'), ('cash-crops', 'Palm kernel'), ('cash-crops', 'Sesame'),
  ('cash-crops', 'Ginger'), ('cash-crops', 'Shea butter'), ('cash-crops', 'Rubber'), ('cash-crops', 'Coffee'),
  ('livestock', 'Goats'), ('livestock', 'Cattle'), ('livestock', 'Cows'), ('livestock', 'Sheep'), ('livestock', 'Ram'), ('livestock', 'Pigs'), ('livestock', 'Rabbits'),
  ('poultry-eggs', 'Chicken'), ('poultry-eggs', 'Broilers'), ('poultry-eggs', 'Layers'), ('poultry-eggs', 'Day-old chicks'), ('poultry-eggs', 'Turkey'),
  ('poultry-eggs', 'Eggs'), ('poultry-eggs', 'Crate of eggs'),
  ('fish-farming-aquaculture', 'Catfish'), ('fish-farming-aquaculture', 'Tilapia'), ('fish-farming-aquaculture', 'Fingerlings'), ('fish-farming-aquaculture', 'Juveniles'), ('fish-farming-aquaculture', 'Fish pond'),
  ('seeds-seedlings', 'Seeds'), ('seeds-seedlings', 'Seedlings'), ('seeds-seedlings', 'Improved seeds'), ('seeds-seedlings', 'Nursery'),
  ('fertilisers-agrochemicals', 'Fertiliser'), ('fertilisers-agrochemicals', 'Fertilizer'), ('fertilisers-agrochemicals', 'NPK'), ('fertilisers-agrochemicals', 'Urea'),
  ('fertilisers-agrochemicals', 'Herbicide'), ('fertilisers-agrochemicals', 'Pesticide'), ('fertilisers-agrochemicals', 'Organic manure'),
  ('animal-feed-supplements', 'Poultry feed'), ('animal-feed-supplements', 'Fish feed'), ('animal-feed-supplements', 'Livestock feed'), ('animal-feed-supplements', 'Vaccines'),
  ('farm-tools-supplies', 'Hoe'), ('farm-tools-supplies', 'Cutlass'), ('farm-tools-supplies', 'Sprayer'), ('farm-tools-supplies', 'Irrigation'), ('farm-tools-supplies', 'Greenhouse'),
  ('tractor-hire-mechanisation', 'Tractor hire'), ('tractor-hire-mechanisation', 'Ploughing'), ('tractor-hire-mechanisation', 'Harrowing'), ('tractor-hire-mechanisation', 'Land clearing'),
  ('veterinary-services', 'Vet'), ('veterinary-services', 'Veterinarian'), ('veterinary-services', 'Animal doctor'),
  ('agronomy-farm-consulting', 'Agronomist'), ('agronomy-farm-consulting', 'Soil testing'), ('agronomy-farm-consulting', 'Farm setup'), ('agronomy-farm-consulting', 'Extension services'),
  ('agro-processing-storage', 'Milling'), ('agro-processing-storage', 'Rice mill'), ('agro-processing-storage', 'Cold storage'), ('agro-processing-storage', 'Warehouse'), ('agro-processing-storage', 'Packaging'),
  ('agricultural-equipment', 'Tractor'), ('agricultural-equipment', 'Planter'), ('agricultural-equipment', 'Harvester'), ('agricultural-equipment', 'Water pump'),
  ('farm-produce', 'Farm fresh'), ('meat-seafood', 'Fresh fish'), ('meat-seafood', 'Smoked fish')
) as v(slug, alias) on v.slug = c.slug
on conflict (category_id, normalized_alias) do nothing;

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'department exists', exists (select 1 from public.catalogue_categories where slug = 'agriculture-farming' and parent_id is null and not is_selectable)
  union all select '15 categories under it', (select count(*) from public.catalogue_categories c join public.catalogue_categories d on d.id = c.parent_id
                                              where d.slug = 'agriculture-farming' and c.slug <> 'agricultural-equipment') >= 15
  union all select 'Agricultural Equipment moved', exists (select 1 from public.catalogue_categories c join public.catalogue_categories d on d.id = c.parent_id
                                                           where c.slug = 'agricultural-equipment' and d.slug = 'agriculture-farming')
  union all select 'Farm Produce still in Food & Grocery', exists (select 1 from public.catalogue_categories c join public.catalogue_categories d on d.id = c.parent_id
                                                                   where c.slug = 'farm-produce' and d.slug = 'food-grocery')
  union all select 'search aliases added', (select count(*) from public.catalogue_search_aliases a join public.catalogue_categories c on c.id = a.category_id
                                            join public.catalogue_categories d on d.id = c.parent_id where d.slug = 'agriculture-farming') >= 60
)
select * from checks order by ok, check_name;
