import CATEGORY_KEYWORDS from '../../../lib/catalogueSearchLegacy';
import type { CatalogueCategory } from '@/api/catalogue';
import type { MarketplaceSearchCategory } from '@/api/participants';

/** Old broad buckets. Products may still use them; sellers pick a specific category instead. */
const VAGUE_SLUGS = new Set(['fashion', 'digital', 'services']);
/** Holds older uncategorised products only. Never shown as a category, whatever is_selectable says. */
const HIDDEN_SLUGS = new Set(['other']);

export type ListingKind = 'products' | 'services';

/** A labelled group of categories on a department screen. Without a kind it shows under both Products and Services. */
export type SectionDef = {
  title: string;
  kind?: ListingKind;
  slugs: string[];
};

export type DepartmentDef = {
  slug: string;
  name: string;
  icon: string;
  tint: string;
  ink: string;
  memberSlugs: string[];
  sections?: SectionDef[];
};

type DepartmentSource = Omit<DepartmentDef, 'memberSlugs'> & { memberSlugs?: string[] };

const DEPARTMENT_SOURCES: DepartmentSource[] = [
  {
    slug: 'fashion-beauty',
    name: 'Fashion & Beauty',
    icon: 'shirt',
    tint: '#FFE4E6',
    ink: '#BE123C',
    memberSlugs: ['fashion', 'beauty-skincare', 'hair-haircare', 'fragrances', 'jewelry', 'watches', 'bags-luggage', 'shoes', 'mens-clothing', 'womens-clothing', 'sportswear', 'traditional-cultural-wear', 'fashion-accessories'],
  },
  {
    slug: 'technology',
    name: 'Technology',
    icon: 'phone-portrait',
    tint: '#DBEAFE',
    ink: '#1D4ED8',
    memberSlugs: ['phones-tablets', 'computers-laptops', 'computer-accessories', 'electronics', 'audio-headphones', 'cameras-photography', 'gaming', 'smart-devices', 'tv-home-entertainment', 'appliances', 'solar-power'],
  },
  {
    slug: 'home-living',
    name: 'Home & Living',
    icon: 'home',
    tint: '#DCFCE7',
    ink: '#15803D',
    memberSlugs: ['home-kitchen', 'furniture', 'home-decor', 'bedding-bath', 'cleaning-supplies', 'garden-outdoor', 'tools-hardware', 'building-materials'],
  },
  {
    slug: 'food-grocery',
    name: 'Food & Grocery',
    icon: 'basket',
    tint: '#FEF3C7',
    ink: '#B45309',
    sections: [
      {
        title: 'Food & Products',
        kind: 'products',
        slugs: ['food-groceries', 'drinks-beverages', 'snacks-confectionery', 'baked-goods', 'farm-produce', 'meat-seafood'],
      },
      {
        title: 'Culinary & Catering Services',
        kind: 'services',
        slugs: ['private-chefs-cooks', 'event-catering-services', 'catering', 'home-cooked-meals', 'cakes-pastries-baking', 'outdoor-catering-bbq', 'meal-prep-subscriptions', 'culinary-training-classes', 'bartending-beverage-services', 'food-decoration-presentation', 'restaurant-kitchen-consulting'],
      },
    ],
  },
  {
    slug: 'health-fitness',
    name: 'Health & Fitness',
    icon: 'heart',
    tint: '#DCFCE7',
    ink: '#166534',
    memberSlugs: ['health-wellness', 'fitness-gym', 'sports-equipment', 'medical-supplies'],
  },
  {
    slug: 'kids-family',
    name: 'Kids & Family',
    icon: 'happy',
    tint: '#FEF3C7',
    ink: '#A16207',
    memberSlugs: ['kids-clothing', 'baby-products', 'toys-games'],
  },
  {
    slug: 'books-art-entertainment',
    name: 'Books, Art & Entertainment',
    icon: 'book',
    tint: '#E0E7FF',
    ink: '#4338CA',
    memberSlugs: ['books', 'stationery', 'art-crafts', 'music', 'movies-entertainment', 'event-tickets'],
  },
  {
    slug: 'digital-products',
    name: 'Digital Products',
    icon: 'laptop',
    tint: '#DBEAFE',
    ink: '#1D4ED8',
    memberSlugs: ['digital', 'ebooks', 'online-courses', 'templates-design-assets', 'software-apps', 'music-audio-files', 'photography-stock-media', 'domains-websites'],
  },
  {
    slug: 'professional-services',
    name: 'Professional Services',
    icon: 'briefcase',
    tint: '#DBEAFE',
    ink: '#1E40AF',
    memberSlugs: ['services'],
    sections: [
      {
        title: 'Business, Creative & Tech',
        kind: 'services',
        slugs: ['business-services', 'graphic-design', 'web-development', 'app-development', 'ai-automation-services', 'marketing-advertising', 'social-media-services', 'photography-services', 'video-production', 'music-audio-services', 'writing-editing', 'consulting', 'accounting-finance-services', 'education-tutoring'],
      },
      {
        title: 'Legal Advice & Services',
        kind: 'services',
        slugs: ['legal-services', 'business-corporate-law', 'property-real-estate-law', 'family-matrimonial-law', 'criminal-defense-litigation', 'immigration-visa-law', 'intellectual-property-law', 'employment-labour-law', 'contract-drafting-review', 'tax-financial-law', 'dispute-resolution-mediation', 'wills-probate-estate'],
      },
    ],
  },
  {
    slug: 'local-services',
    name: 'Local Services',
    icon: 'construct',
    tint: '#F1F5F9',
    ink: '#475569',
    memberSlugs: ['repair-services', 'home-services', 'cleaning-services', 'beauty-services', 'hair-barber-services', 'fashion-design-tailoring', 'printing-branding'],
  },
  {
    slug: 'travel-transport',
    name: 'Travel & Transport',
    icon: 'airplane',
    tint: '#E0F2FE',
    ink: '#0369A1',
    sections: [
      {
        title: 'Hotels & Accommodation',
        slugs: ['hotels-accommodation', 'short-stays-short-lets', 'serviced-apartments', 'guesthouses-lodges', 'vacation-rentals', 'resorts', 'hostels'],
      },
      {
        title: 'Transport & Travel',
        slugs: ['travel-tourism', 'car-hire-transport', 'logistics-delivery'],
      },
    ],
  },
  {
    slug: 'automotive',
    name: 'Automotive',
    icon: 'car',
    tint: '#F1F5F9',
    ink: '#334155',
    memberSlugs: ['cars-vehicles', 'auto-parts-accessories', 'motorcycles-bicycles'],
  },
  {
    slug: 'property',
    name: 'Property',
    icon: 'business',
    tint: '#DBEAFE',
    ink: '#1D4ED8',
    memberSlugs: ['property-for-sale', 'property-for-rent'],
  },
  {
    slug: 'business-industry',
    name: 'Business & Industry',
    icon: 'cube',
    tint: '#E0E7FF',
    ink: '#4338CA',
    memberSlugs: ['office-business-supplies', 'industrial-equipment', 'agricultural-equipment'],
  },
  {
    slug: 'gifts-specialty',
    name: 'Gifts & Specialty',
    icon: 'gift',
    tint: '#FCE7F3',
    ink: '#BE185D',
    memberSlugs: ['pet-supplies', 'gifts-souvenirs', 'religious-inspirational', 'collectibles-antiques', 'other'],
  },
  {
    slug: 'construction-building',
    name: 'Construction, Electrical & Building Services',
    icon: 'hammer',
    tint: '#FFEDD5',
    ink: '#C2410C',
    sections: [
      {
        title: 'Electrical & Power',
        slugs: ['electrical-installation-repairs', 'electrical-materials-accessories', 'solar-inverter-installation', 'generators-power-systems', 'lighting-fixtures', 'wiring-cables-distribution'],
      },
      {
        title: 'Construction & Building',
        slugs: ['building-contractors', 'building-materials-supplies', 'cement-blocks-concrete', 'roofing-ceiling', 'tiles-flooring', 'painting-wall-finishing', 'doors-windows-aluminium', 'welding-fabrication', 'carpentry-woodwork'],
      },
      {
        title: 'Plumbing & Mechanical',
        slugs: ['plumbing-installation-repairs', 'plumbing-materials', 'borehole-water-systems', 'water-tanks-pumps', 'air-conditioning-refrigeration'],
      },
      {
        title: 'Property Improvement & Maintenance',
        kind: 'services',
        slugs: ['building-renovation', 'pop-screeding-finishing', 'waterproofing-damp-control', 'landscaping-exterior', 'building-maintenance-handyman'],
      },
      {
        title: 'Technical & Professional Services',
        kind: 'services',
        slugs: ['architectural-design', 'civil-structural-engineering', 'quantity-surveying', 'land-surveying-site-prep', 'building-inspection-supervision'],
      },
      {
        title: 'Equipment & Security',
        slugs: ['construction-tools-equipment', 'heavy-machinery-rental', 'scaffolding-formwork', 'cctv-security-installation', 'smart-home-automation'],
      },
    ],
  },
  {
    slug: 'artisans-technicians',
    name: 'Artisans, Technicians & Repairs',
    icon: 'build',
    tint: '#ECFCCB',
    ink: '#4D7C0F',
    sections: [
      {
        title: 'Phones, Computers & Appliances',
        kind: 'services',
        slugs: ['appliance-repairs', 'phone-tablet-repairs', 'computer-laptop-repairs', 'electronics-repairs', 'generator-repairs', 'solar-inverter-technicians'],
      },
      {
        title: 'Electrical, Plumbing & Cooling',
        kind: 'services',
        slugs: ['electrical-repairs', 'plumbing-pipe-repairs', 'ac-refrigeration-repairs', 'borehole-pump-technicians', 'cctv-security-technicians'],
      },
      {
        title: 'Vehicle Repairs',
        kind: 'services',
        slugs: ['automotive-mechanics', 'auto-electricians-diagnostics', 'motorcycle-tricycle-repairs'],
      },
      {
        title: 'Building Trades & Finishing',
        kind: 'services',
        slugs: ['welding-metal-fabrication', 'carpentry-furniture-repairs', 'painting-decorating', 'tiling-flooring', 'pop-ceiling-installation', 'locksmith-key-cutting'],
      },
      {
        title: 'Clothing, Shoes & Upholstery',
        kind: 'services',
        slugs: ['upholstery-restoration', 'tailoring-alterations', 'shoe-making-repairs'],
      },
      {
        title: 'Cleaning & Handyman',
        kind: 'services',
        slugs: ['cleaning-maintenance-services', 'general-handyman'],
      },
    ],
  },
];

export const DEPARTMENT_DEFS: DepartmentDef[] = DEPARTMENT_SOURCES.map((source) => ({
  ...source,
  memberSlugs: [...(source.memberSlugs ?? []), ...(source.sections ?? []).flatMap((section) => section.slugs)],
}));

/** Legacy offline fallback only. Online discovery uses the database RPC.
 * Retain until every historic keyword is confirmed in the database aliases. */
// The compatibility map is shared with the server while missing legacy aliases remain.

export function categoryKeywords(slug: string) {
  return CATEGORY_KEYWORDS[slug] ?? [];
}

export type FeaturedLink = {
  label: string;
  icon: string;
  tint: string;
  ink: string;
  departmentSlug: string;
  categorySlug?: string;
};

const FEATURED_LABELS: Record<string, string> = {
  'fashion-beauty': 'Fashion',
  'digital-products': 'Digital',
  'professional-services': 'Services',
  electronics: 'Electronics',
};

/** Used only before is_featured has been saved. Home shows the first three, plus a More control. */
export const FEATURED_LINKS: FeaturedLink[] = [
  { label: 'Fashion', icon: 'shirt', tint: '#FFE4E6', ink: '#BE123C', departmentSlug: 'fashion-beauty' },
  { label: 'Digital', icon: 'laptop', tint: '#DBEAFE', ink: '#1D4ED8', departmentSlug: 'digital-products' },
  { label: 'Services', icon: 'people', tint: '#DCFCE7', ink: '#15803D', departmentSlug: 'professional-services' },
  { label: 'Electronics', icon: 'flash', tint: '#FEF3C7', ink: '#B45309', departmentSlug: 'technology', categorySlug: 'electronics' },
];

export type FeaturedEntry = {
  key: string;
  label: string;
  icon: string;
  tint: string;
  ink: string;
  departmentSlug: string;
  categoryId?: string | null;
  categorySlug?: string;
  imageUrl?: string | null;
};

export function canSell(category: CatalogueCategory) {
  if (HIDDEN_SLUGS.has(category.slug)) return false;
  if (category.is_selectable === false) return false;
  if (category.is_selectable == null && VAGUE_SLUGS.has(category.slug)) return false;
  return true;
}

/** Featured rows are departments or categories. Electronics is a category under Technology. */
export function featuredEntries(categories: CatalogueCategory[]): FeaturedEntry[] {
  const active = categories.filter((category) => category.is_active !== false);
  const flagged = active.filter((category) => category.is_featured).sort(bySort);
  if (!flagged.length) {
    return FEATURED_LINKS.map((link) => {
      const match = active.find((category) => category.slug === (link.categorySlug ?? link.departmentSlug));
      return {
        key: link.label,
        label: link.label,
        icon: link.icon,
        tint: link.tint,
        ink: link.ink,
        departmentSlug: link.departmentSlug,
        categoryId: link.categorySlug ? match?.id ?? null : null,
        categorySlug: link.categorySlug,
        imageUrl: bannerText(match?.image_url),
      };
    });
  }
  const byId = new Map(active.map((category) => [category.id, category]));
  return flagged.map((record) => {
    const parent = record.parent_id ? byId.get(record.parent_id) : undefined;
    return {
      key: record.id,
      label: FEATURED_LABELS[record.slug] ?? record.name,
      icon: record.icon,
      tint: record.tint,
      ink: record.ink,
      departmentSlug: parent?.slug ?? record.slug,
      categoryId: parent ? record.id : null,
      categorySlug: parent ? record.slug : undefined,
      imageUrl: bannerText(record.image_url),
    };
  });
}

export function homeShortcuts(categories: CatalogueCategory[]) {
  return featuredEntries(categories).filter((entry) => !entry.categorySlug).slice(0, 3);
}

export type ShopSection = {
  title: string;
  kind: ListingKind | null;
  categories: CatalogueCategory[];
};

export type ShopDepartment = {
  /** Category groups for the department screen. Categories not named in a section land in a trailing group. */
  sections: ShopSection[];
  id: string | null;
  slug: string;
  name: string;
  icon: string;
  tint: string;
  ink: string;
  /** Specific categories a seller can pick. Broad Fashion / Digital / Services buckets are omitted. */
  categories: CatalogueCategory[];
  /** Includes older products still filed under a broad bucket. */
  productCategoryIds: string[];
  imageUrl: string | null;
  bannerTitle: string | null;
  bannerSubtitle: string | null;
};

export type CatalogueDirectory = {
  departments: ShopDepartment[];
};

function bySort(a: CatalogueCategory, b: CatalogueCategory) {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

function bannerText(value?: string | null) {
  const text = value?.trim();
  return text || null;
}

function toSections(def: DepartmentDef, selectable: CatalogueCategory[]): ShopSection[] {
  if (!def.sections?.length) return [{ title: 'Categories', kind: null, categories: selectable }];
  const placed = new Set<string>();
  const sections = def.sections.map((section) => {
    const categories = section.slugs
      .map((slug) => selectable.find((category) => category.slug === slug))
      .filter((category): category is CatalogueCategory => !!category);
    categories.forEach((category) => placed.add(category.id));
    return { title: section.title, kind: section.kind ?? null, categories };
  });
  const rest = selectable.filter((category) => !placed.has(category.id));
  if (rest.length) sections.push({ title: 'More categories', kind: null, categories: rest });
  return sections.filter((section) => section.categories.length);
}

/** Any department with listings can be filtered by each listing's stored type. */
export function hasListingKinds(department: ShopDepartment) {
  return department.categories.length > 0;
}

function toDepartment(def: DepartmentDef, id: string | null, children: CatalogueCategory[], source?: CatalogueCategory | null): ShopDepartment {
  const ordered = [...children].sort(bySort);
  const selectable = ordered.filter(canSell);
  return {
    sections: toSections(def, selectable),
    id,
    slug: def.slug,
    name: def.name,
    icon: def.icon,
    tint: def.tint,
    ink: def.ink,
    categories: selectable,
    productCategoryIds: ordered.map((category) => category.id),
    imageUrl: bannerText(source?.image_url),
    bannerTitle: bannerText(source?.banner_title),
    bannerSubtitle: bannerText(source?.banner_subtitle),
  };
}

export function buildCatalogueDirectory(categories: CatalogueCategory[]): CatalogueDirectory {
  const active = categories.filter((category) => category.is_active !== false);
  const linked = active.some((category) => category.parent_id);
  const knownSlugs = new Set(DEPARTMENT_DEFS.flatMap((department) => department.memberSlugs));

  if (linked) {
    const parentIds = new Set(active.map((category) => category.parent_id).filter((id): id is string => !!id));
    const departmentRoots = active.filter((category) =>
      !category.parent_id && (parentIds.has(category.id) || category.is_selectable === false));
    const departmentRootIds = new Set(departmentRoots.map((root) => root.id));
    const parents = new Map(departmentRoots.map((category) => [category.slug, category]));
    const departments = DEPARTMENT_DEFS.flatMap((def) => {
      const parent = parents.get(def.slug);
      if (!parent) return [];
      const children = active.filter((category) => category.parent_id === parent.id);
      return [toDepartment(def, parent.id, children, parent)];
    });
    const configuredSlugs = new Set(DEPARTMENT_DEFS.map((department) => department.slug));
    departments.push(...departmentRoots
      .filter((root) => !configuredSlugs.has(root.slug))
      .sort(bySort)
      .map((root) => toDepartment({
        slug: root.slug,
        name: root.name,
        icon: root.icon || 'grid',
        tint: root.tint || '#DBEAFE',
        ink: root.ink || '#1E3A8A',
        memberSlugs: [],
      }, root.id, active.filter((category) => category.parent_id === root.id), root)));
    const placed = new Set(departments.flatMap((department) => department.productCategoryIds));
    const orphans = active.filter((category) => !category.parent_id && !departmentRootIds.has(category.id) && !placed.has(category.id));
    let specialty = departments.find((department) => department.slug === 'gifts-specialty');
    if (!specialty && orphans.length) {
      const fallback = DEPARTMENT_DEFS.find((department) => department.slug === 'gifts-specialty');
      if (fallback) {
        specialty = toDepartment(fallback, null, [], null);
        departments.push(specialty);
      }
    }
    if (specialty && orphans.length) {
      specialty.categories.push(...orphans.filter(canSell).sort(bySort));
      specialty.productCategoryIds.push(...orphans.map((category) => category.id));
    }
    return { departments };
  }

  const bySlug = new Map(active.map((category) => [category.slug, category]));
  const departments = DEPARTMENT_DEFS.map((def) => {
    const children = def.memberSlugs
      .map((slug) => bySlug.get(slug))
      .filter((category): category is CatalogueCategory => !!category);
    return toDepartment(def, null, children);
  });
  const unmatched = active.filter((category) => !knownSlugs.has(category.slug));
  const specialty = departments.find((department) => department.slug === 'gifts-specialty');
  if (specialty && unmatched.length) {
    specialty.categories.push(...unmatched.sort(bySort));
    specialty.productCategoryIds.push(...unmatched.map((category) => category.id));
  }
  return { departments };
}

export function departmentForCategory(directory: CatalogueDirectory, categoryId: string) {
  return directory.departments.find((department) => department.productCategoryIds.includes(categoryId));
}

export type SearchableCategory = {
  kind: 'department' | 'category';
  id: string;
  name: string;
  slug: string;
  icon: string;
  tint: string;
  ink: string;
  departmentSlug: string;
  departmentName: string;
  imageUrl: string | null;
  keywords: string[];
  matchType?: string;
};

/** Selectable categories (and departments) for Shop / Discover search. */
export function searchableCatalogueEntries(categories: CatalogueCategory[]): SearchableCategory[] {
  const directory = buildCatalogueDirectory(categories);
  const entries: SearchableCategory[] = [];
  for (const department of directory.departments) {
    entries.push({
      kind: 'department',
      id: department.id || department.slug,
      name: department.name,
      slug: department.slug,
      icon: department.icon,
      tint: department.tint,
      ink: department.ink,
      departmentSlug: department.slug,
      departmentName: department.name,
      imageUrl: department.imageUrl,
      keywords: [],
    });
    for (const category of department.categories) {
      entries.push({
        kind: 'category',
        id: category.id,
        name: category.name,
        slug: category.slug,
        icon: category.icon,
        tint: category.tint,
        ink: category.ink,
        departmentSlug: department.slug,
        departmentName: department.name,
        imageUrl: bannerText(category.image_url),
        keywords: categoryKeywords(category.slug),
      });
    }
  }
  return entries;
}

export function searchCatalogueEntries(categories: CatalogueCategory[], query: string, limit = 12) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return searchableCatalogueEntries(categories)
    .filter((entry) => [entry.name, entry.slug, entry.departmentName, ...entry.keywords].some((value) => value.toLowerCase().includes(needle)))
    .slice(0, limit);
}

/**
 * Turns search_catalogue_categories RPC matches (id/name/slug/rank only)
 * into the same SearchableCategory shape the local keyword search produces,
 * using the already-fetched category list purely for display visuals
 * (icon/tint/ink/image). New categories use default visuals until the directory
 * refreshes, preserving the original ID and slug without an app update.
 */
export function mapServerCategoryMatches(
  categories: CatalogueCategory[],
  matches: MarketplaceSearchCategory[]
): SearchableCategory[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const entries: SearchableCategory[] = [];
  for (const match of matches) {
    const visual = byId.get(match.category_id);
    const departmentVisual = match.is_department ? visual : byId.get(match.department_id);
    entries.push({
      kind: match.is_department ? 'department' : 'category',
      id: match.category_id,
      name: match.category_name,
      slug: match.category_slug,
      icon: visual?.icon || (match.is_department ? 'grid' : 'pricetag'),
      tint: visual?.tint || '#DBEAFE',
      ink: visual?.ink || '#1E3A8A',
      departmentSlug: departmentVisual?.slug ?? match.category_slug,
      departmentName: departmentVisual?.name ?? match.department_name,
      imageUrl: bannerText(visual?.image_url),
      matchType: match.match_type,
      keywords: [],
    });
  }
  return entries;
}

/** Category name, department and keywords per category id, so product search also matches "plumber" or "cement". */
export function categorySearchText(categories: CatalogueCategory[]) {
  const directory = buildCatalogueDirectory(categories);
  const text = new Map<string, string>();
  for (const department of directory.departments) {
    for (const id of department.productCategoryIds) {
      const category = categories.find((item) => item.id === id);
      if (!category) continue;
      text.set(id, [category.name, department.name, ...categoryKeywords(category.slug)].join(' ').toLowerCase());
    }
  }
  return text;
}
