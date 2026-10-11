import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchMarketplace, type MarketplaceSearchOptions } from '@/api/participants';
import { getCategories } from '@/api/catalogue';
import { mapServerCategoryMatches, searchCatalogueEntries } from '@/lib/catalogue-directory';

/** Native and web consume the same API contract, debounce and fallback rules. */
export function useMarketplaceSearch(query: string, options: MarketplaceSearchOptions = {}) {
  const term = query.trim().slice(0, 200);
  const [debounced, setDebounced] = useState(term);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);
  const directory = useQuery({ queryKey: ['catalogue-categories'], queryFn: getCategories, staleTime: 60000 });
  const search = useQuery({
    queryKey: ['marketplace-search', debounced, options.categoryId, options.departmentId, options.listingType],
    queryFn: ({ signal }) => searchMarketplace(debounced, options, signal),
    enabled: !!term && term === debounced,
    staleTime: 30000,
    retry: false,
  });
  const current = !!term && term === debounced;
  const data = current ? search.data : undefined;
  const local = searchCatalogueEntries(directory.data ?? [], term, 12).filter((entry) =>
    (!options.categoryId || entry.id === options.categoryId)
    && (!options.departmentId || entry.id === options.departmentId
      || directory.data?.find((row) => row.id === entry.id)?.parent_id === options.departmentId));
  const server = mapServerCategoryMatches(directory.data ?? [], data?.categories ?? []);
  // A successful empty response is not a failure. Don't reintroduce broad local hits.
  const categories = data?.categorySearch === 'rpc' ? server
    : [...server, ...local.filter((entry) => !server.some((hit) => hit.id === entry.id))];
  return {
    ...search,
    data,
    categories: term ? categories : [],
    isSearching: !!term && (!current || search.isFetching),
    degraded: !!term && current && (search.isError || !!data?.unavailable?.length),
    useLocalItems: !data || !!data.unavailable?.includes('items') || data.categorySearch !== 'rpc',
  };
}
