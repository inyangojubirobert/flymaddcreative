-- Compare the mobile Shop directory with catalogue_categories.
-- Reports inventory mismatches and frontend-visible departments/categories
-- without cover URLs. Read-only: this query does not change catalogue rows.
with ui_departments (slug, name) as (
  values
    ('fashion-beauty', 'Fashion & Beauty'),
    ('technology', 'Technology'),
    ('home-living', 'Home & Living'),
    ('food-grocery', 'Food & Grocery'),
    ('health-fitness', 'Health & Fitness'),
    ('kids-family', 'Kids & Family'),
    ('books-art-entertainment', 'Books, Art & Entertainment'),
    ('digital-products', 'Digital Products'),
    ('professional-services', 'Professional Services'),
    ('local-services', 'Local Services'),
    ('travel-transport', 'Travel & Transport'),
    ('automotive', 'Automotive'),
    ('property', 'Property'),
    ('business-industry', 'Business & Industry'),
    ('gifts-specialty', 'Gifts & Specialty'),
    ('construction-building', 'Construction, Electrical & Building Services'),
    ('artisans-technicians', 'Artisans, Technicians & Repairs')
),
ui_category_groups (department_slug, category_slugs) as (
  values
    ('fashion-beauty', array[
      'fashion', 'beauty-skincare', 'hair-haircare', 'fragrances', 'jewelry',
      'watches', 'bags-luggage', 'shoes', 'mens-clothing', 'womens-clothing',
      'sportswear', 'traditional-cultural-wear', 'fashion-accessories'
    ]::text[]),
    ('technology', array[
      'phones-tablets', 'computers-laptops', 'computer-accessories', 'electronics',
      'audio-headphones', 'cameras-photography', 'gaming', 'smart-devices',
      'tv-home-entertainment', 'appliances', 'solar-power'
    ]::text[]),
    ('home-living', array[
      'home-kitchen', 'furniture', 'home-decor', 'bedding-bath',
      'cleaning-supplies', 'garden-outdoor', 'tools-hardware', 'building-materials'
    ]::text[]),
    ('food-grocery', array[
      'food-groceries', 'drinks-beverages', 'snacks-confectionery', 'baked-goods',
      'farm-produce', 'meat-seafood', 'private-chefs-cooks',
      'event-catering-services', 'catering', 'home-cooked-meals',
      'cakes-pastries-baking', 'outdoor-catering-bbq', 'meal-prep-subscriptions',
      'culinary-training-classes', 'bartending-beverage-services',
      'food-decoration-presentation', 'restaurant-kitchen-consulting'
    ]::text[]),
    ('health-fitness', array[
      'health-wellness', 'fitness-gym', 'sports-equipment', 'medical-supplies'
    ]::text[]),
    ('kids-family', array[
      'kids-clothing', 'baby-products', 'toys-games'
    ]::text[]),
    ('books-art-entertainment', array[
      'books', 'stationery', 'art-crafts', 'music', 'movies-entertainment',
      'event-tickets'
    ]::text[]),
    ('digital-products', array[
      'digital', 'ebooks', 'online-courses', 'templates-design-assets',
      'software-apps', 'music-audio-files', 'photography-stock-media',
      'domains-websites'
    ]::text[]),
    ('professional-services', array[
      'services', 'business-services', 'graphic-design', 'web-development',
      'app-development', 'ai-automation-services', 'marketing-advertising',
      'social-media-services', 'photography-services', 'video-production',
      'music-audio-services', 'writing-editing', 'consulting',
      'accounting-finance-services', 'education-tutoring', 'legal-services',
      'business-corporate-law', 'property-real-estate-law',
      'family-matrimonial-law', 'criminal-defense-litigation',
      'immigration-visa-law', 'intellectual-property-law',
      'employment-labour-law', 'contract-drafting-review', 'tax-financial-law',
      'dispute-resolution-mediation', 'wills-probate-estate'
    ]::text[]),
    ('local-services', array[
      'repair-services', 'home-services', 'cleaning-services', 'beauty-services',
      'hair-barber-services', 'fashion-design-tailoring', 'printing-branding'
    ]::text[]),
    ('travel-transport', array[
      'hotels-accommodation', 'short-stays-short-lets', 'serviced-apartments',
      'guesthouses-lodges', 'vacation-rentals', 'resorts', 'hostels',
      'travel-tourism', 'car-hire-transport', 'logistics-delivery'
    ]::text[]),
    ('automotive', array[
      'cars-vehicles', 'auto-parts-accessories', 'motorcycles-bicycles'
    ]::text[]),
    ('property', array[
      'property-for-sale', 'property-for-rent'
    ]::text[]),
    ('business-industry', array[
      'office-business-supplies', 'industrial-equipment', 'agricultural-equipment'
    ]::text[]),
    ('gifts-specialty', array[
      'pet-supplies', 'gifts-souvenirs', 'religious-inspirational',
      'collectibles-antiques', 'other'
    ]::text[]),
    ('construction-building', array[
      'electrical-installation-repairs', 'electrical-materials-accessories',
      'solar-inverter-installation', 'generators-power-systems',
      'lighting-fixtures', 'wiring-cables-distribution', 'building-contractors',
      'building-materials-supplies', 'cement-blocks-concrete', 'roofing-ceiling',
      'tiles-flooring', 'painting-wall-finishing', 'doors-windows-aluminium',
      'welding-fabrication', 'carpentry-woodwork',
      'plumbing-installation-repairs', 'plumbing-materials',
      'borehole-water-systems', 'water-tanks-pumps',
      'air-conditioning-refrigeration', 'building-renovation',
      'pop-screeding-finishing', 'waterproofing-damp-control',
      'landscaping-exterior', 'building-maintenance-handyman',
      'architectural-design', 'civil-structural-engineering',
      'quantity-surveying', 'land-surveying-site-prep',
      'building-inspection-supervision', 'construction-tools-equipment',
      'heavy-machinery-rental', 'scaffolding-formwork',
      'cctv-security-installation', 'smart-home-automation'
    ]::text[]),
    ('artisans-technicians', array[
      'appliance-repairs', 'phone-tablet-repairs', 'computer-laptop-repairs',
      'electronics-repairs', 'generator-repairs', 'solar-inverter-technicians',
      'electrical-repairs', 'plumbing-pipe-repairs', 'ac-refrigeration-repairs',
      'borehole-pump-technicians', 'cctv-security-technicians',
      'automotive-mechanics', 'auto-electricians-diagnostics',
      'motorcycle-tricycle-repairs', 'welding-metal-fabrication',
      'carpentry-furniture-repairs', 'painting-decorating', 'tiling-flooring',
      'pop-ceiling-installation', 'locksmith-key-cutting',
      'upholstery-restoration', 'tailoring-alterations', 'shoe-making-repairs',
      'cleaning-maintenance-services', 'general-handyman'
    ]::text[])
),
ui_categories as (
  select groups.department_slug, slugs.slug
  from ui_category_groups as groups
  cross join lateral unnest(groups.category_slugs) as slugs(slug)
),
ui_entries as (
  select 'department'::text as ui_type, null::text as department_slug,
         department.slug, department.name
  from ui_departments as department
  union all
  select 'category', category.department_slug, category.slug, null::text
  from ui_categories as category
),
database_entries as (
  select
    category.id,
    case when category.parent_id is null then 'department' else 'category' end as ui_type,
    category.slug,
    category.name,
    department.slug as department_slug,
    category.parent_id,
    category.is_active,
    category.is_selectable,
    category.image_url
  from public.catalogue_categories as category
  left join public.catalogue_categories as department
    on department.id = category.parent_id
  where category.is_active is true
),
summary as (
  select
    (select count(*) from ui_entries where ui_type = 'department') as frontend_departments,
    (select count(*) from ui_entries where ui_type = 'category') as frontend_categories,
    (select count(*) from database_entries where ui_type = 'department') as database_departments,
    (select count(*) from database_entries where ui_type = 'category') as database_categories,
    (
      select count(*)
      from ui_entries as ui
      join database_entries as database on database.slug = ui.slug
      where ui.ui_type = 'department'
        and nullif(btrim(database.image_url), '') is null
    ) as departments_missing_cover,
    (
      select count(*)
      from ui_entries as ui
      join database_entries as database on database.slug = ui.slug
      where ui.ui_type = 'category'
        and database.slug <> 'other'
        and database.is_selectable is distinct from false
        and not (
          database.is_selectable is null
          and database.slug in ('fashion', 'digital', 'services')
        )
        and nullif(btrim(database.image_url), '') is null
    ) as categories_missing_cover,
    (select count(*) from ui_entries) as frontend_count,
    (select count(*) from database_entries) as database_count
),
comparison as (
  select
    'FRONTEND_LIST'::text as result_type,
    ui.ui_type as entry_type,
    coalesce(ui.name, database.name, initcap(replace(ui.slug, '-', ' '))) as title,
    ui.slug,
    ui.department_slug,
    database.id as database_id,
    case
      when database.id is null then 'missing_from_database'
      when ui.ui_type = 'department' and database.parent_id is not null then 'wrong_parent'
      when ui.ui_type = 'category' and database.department_slug is distinct from ui.department_slug then 'wrong_parent'
      when ui.name is not null and lower(btrim(ui.name)) <> lower(btrim(database.name)) then 'title_mismatch'
      else 'matched'
    end as status
  from ui_entries as ui
  left join database_entries as database
    on database.slug = ui.slug
  union all
  select
    'DATABASE_LIST',
    database.ui_type,
    database.name,
    database.slug,
    database.department_slug,
    database.id,
    'database_entry'
  from database_entries as database
  union all
  select
    'DATABASE_ONLY',
    database.ui_type,
    database.name,
    database.slug,
    database.department_slug,
    database.id,
    'not_referenced_by_frontend'
  from database_entries as database
  where not exists (
    select 1
    from ui_entries as ui
    where ui.slug = database.slug
  )
  union all
  select
    'MISSING_COVER',
    ui.ui_type,
    coalesce(ui.name, database.name),
    ui.slug,
    ui.department_slug,
    database.id,
    'missing_cover_url'
  from ui_entries as ui
  join database_entries as database
    on database.slug = ui.slug
  where nullif(btrim(database.image_url), '') is null
    and (
      ui.ui_type = 'department'
      or (
        database.slug <> 'other'
        and database.is_selectable is distinct from false
        and not (
          database.is_selectable is null
          and database.slug in ('fashion', 'digital', 'services')
        )
      )
    )
),
results as (
  select
  'SUMMARY'::text as result_type,
  null::text as entry_type,
  null::text as title,
  null::text as slug,
  null::text as department_slug,
  null::uuid as database_id,
  null::text as status,
  summary.frontend_departments,
  summary.frontend_categories,
  summary.database_departments,
  summary.database_categories,
  summary.departments_missing_cover,
  summary.categories_missing_cover,
  summary.frontend_count,
  summary.database_count
from summary
union all
select
  comparison.result_type,
  comparison.entry_type,
  comparison.title,
  comparison.slug,
  comparison.department_slug,
  comparison.database_id,
  comparison.status,
  null::bigint as frontend_departments,
  null::bigint as frontend_categories,
  null::bigint as database_departments,
  null::bigint as database_categories,
  null::bigint as departments_missing_cover,
  null::bigint as categories_missing_cover,
  null::bigint as frontend_count,
  null::bigint as database_count
from comparison
)
select *
from results
order by
  case result_type
    when 'SUMMARY' then 0
    when 'FRONTEND_LIST' then 1
    when 'DATABASE_LIST' then 2
    when 'DATABASE_ONLY' then 3
    else 4
  end,
  entry_type,
  department_slug nulls first,
  slug nulls first;
