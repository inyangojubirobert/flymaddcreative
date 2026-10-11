import type { CatalogueItem } from '@/api/catalogue';

/** Keep server relevance order and preserve cached listing discovery on failures. */
export function marketplaceItems({ remote, cached, query, useLocal, scopeIds, listingType, categoryText }: {
  remote?: CatalogueItem[];
  cached?: CatalogueItem[];
  query: string;
  useLocal: boolean;
  scopeIds?: string[] | null;
  listingType?: string;
  categoryText?: Map<string, string>;
}) {
  const needle = query.trim().toLowerCase();
  const local = !needle ? cached ?? [] : useLocal ? (cached ?? []).filter((item) =>
    [item.title, item.description, item.size, item.seller_username, categoryText?.get(item.category_id || '')]
      .some((value) => (value || '').toLowerCase().includes(needle))) : [];
  const entries = new Map<string, CatalogueItem>();
  for (const item of [...(needle ? remote ?? [] : []), ...local]) {
    if (scopeIds && !scopeIds.includes(item.category_id || '')) continue;
    if (listingType && (item.listing_type || 'product') !== listingType) continue;
    if (item.status !== 'active' || entries.has(item.id)) continue;
    entries.set(item.id, item);
  }
  return [...entries.values()];
}
