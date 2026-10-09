import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CATEGORY_FIELDS = 'id, name, slug, icon, tint, ink, sort_order, parent_id, is_featured, is_active, is_selectable';
const DEFAULT_LOOK = { icon: 'pricetag', tint: '#DBEAFE', ink: '#1E3A8A' };

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const listed = (fields) => supabase
        .from('catalogue_categories')
        .select(fields)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      let { data, error } = await listed(`${CATEGORY_FIELDS}, image_url, banner_title, banner_subtitle`);
      if (error && /image_url|banner_title|banner_subtitle/.test(error.message || '')) {
        ({ data, error } = await listed(CATEGORY_FIELDS));
      }

      if (error) {
        console.error('Catalogue categories list error:', error);
        return res.status(500).json({ error: 'Failed to load categories' });
      }
      return res.status(200).json({ categories: data || [] });
    }

    if (req.method === 'POST') {
      const participant = await requireParticipant(req, res);
      if (!participant) return;

      const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
      if (name.length < 1 || name.length > 40) {
        return res.status(400).json({ error: 'Category name must be 1 to 40 characters.' });
      }

      let slug = slugify(name);
      if (!slug) return res.status(400).json({ error: 'Enter a category name using letters or numbers.' });

      const categoryFields = CATEGORY_FIELDS;
      let parentId = req.body?.parent_id || null;
      let parentSlug = '';
      if (parentId) {
        const { data: parent, error: parentError } = await supabase
          .from('catalogue_categories')
          .select('id, slug, parent_id')
          .eq('id', parentId)
          .maybeSingle();
        if (parentError || !parent) {
          return res.status(400).json({ error: 'Choose a department for this category.' });
        }
        if (parent.parent_id) {
          return res.status(400).json({ error: 'New categories belong under a department.' });
        }
        parentSlug = parent.slug;
      }

      // Names are unique per department; the same name may exist in another department.
      let existingQuery = supabase
        .from('catalogue_categories')
        .select(categoryFields)
        .ilike('name', name);
      existingQuery = parentId ? existingQuery.eq('parent_id', parentId) : existingQuery.is('parent_id', null);
      const { data: existing } = await existingQuery.limit(1).maybeSingle();

      if (existing) return res.status(200).json(existing);

      const { data: slugTaken } = await supabase
        .from('catalogue_categories')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (slugTaken && parentSlug) slug = `${slug}-${parentSlug}`.slice(0, 80);

      const { count } = await supabase
        .from('catalogue_categories')
        .select('id', { count: 'exact', head: true });

      const { data, error } = await supabase
        .from('catalogue_categories')
        .insert({
          name,
          slug,
          ...DEFAULT_LOOK,
          sort_order: (count || 0) + 1,
          parent_id: parentId,
          is_active: true,
          is_featured: false,
          is_selectable: true,
        })
        .select(categoryFields)
        .single();

      if (error) {
        console.error('Catalogue category create error:', error);
        return res.status(500).json({ error: 'Failed to create category' });
      }
      return res.status(201).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('catalogue/categories error:', error);
    return res.status(500).json({ error: 'Request failed' });
  }
}
