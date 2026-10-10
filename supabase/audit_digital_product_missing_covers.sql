-- List active Digital Products UI entries that still need cover image URLs.
-- Read-only: this query does not modify catalogue rows.
select
  category.id,
  category.name,
  category.slug,
  department.name as department_name,
  category.image_url,
  count(*) over () as missing_cover_count
from public.catalogue_categories as category
left join public.catalogue_categories as department
  on department.id = category.parent_id
where category.is_active is true
  and nullif(btrim(category.image_url), '') is null
  and (
    (category.parent_id is null and category.slug = 'digital-products')
    or department.slug = 'digital-products'
  )
order by category.sort_order, category.name;
