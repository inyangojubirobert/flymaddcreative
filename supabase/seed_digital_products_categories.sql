-- Digital Products categories shown in the UI.
-- Idempotent: inserts a row only if its slug is missing, and sets image_url only
-- when it is currently blank. Never changes ids, parents, or existing covers.
-- Paste each cover URL between the quotes in the VALUES list, then run.
-- Rows left as '' are inserted/kept without a cover.
with parent as (
  select id from public.catalogue_categories where slug = 'digital-products'
),
items(name, slug, icon, tint, ink, sort_order, image_url) as (
  values
    ('Online Courses',            'online-courses',          'school',        '#DCFCE7', '#15803D', 57, ''),
    ('Templates & Design Assets', 'templates-design-assets', 'color-palette', '#FCE7F3', '#BE185D', 58, ''),
    ('Software & Apps',           'software-apps',           'code-slash',    '#E0E7FF', '#4338CA', 59, ''),
    ('Music & Audio Files',       'music-audio-files',       'musical-notes', '#F3E8FF', '#7E22CE', 60, ''),
    ('Domains & Websites',        'domains-websites',        'globe',         '#DBEAFE', '#1D4ED8', 62, '')
),
inserted as (
  insert into public.catalogue_categories
    (name, slug, icon, tint, ink, sort_order, parent_id, is_active, is_selectable, image_url)
  select i.name, i.slug, i.icon, i.tint, i.ink, i.sort_order, p.id, true, true,
         nullif(btrim(i.image_url), '')
  from items i cross join parent p
  on conflict (slug) do nothing
  returning slug
)
update public.catalogue_categories c
set image_url = nullif(btrim(i.image_url), '')
from items i
where c.slug = i.slug
  and nullif(btrim(i.image_url), '') is not null
  and nullif(btrim(c.image_url), '') is null;

-- Verify
select c.name, c.slug, c.image_url
from public.catalogue_categories c
where c.slug in ('online-courses','templates-design-assets','software-apps','music-audio-files','domains-websites')
order by c.sort_order;
