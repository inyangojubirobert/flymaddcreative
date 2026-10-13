import { Platform, useWindowDimensions } from 'react-native';

import { WebDesktopBreakpoint, WebMaxWidth } from '@/constants/theme';

/** True in the hosted web app on a desktop-sized window (top navigation, centred column). */
export function useIsDesktopWeb() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= WebDesktopBreakpoint;
}

/**
 * Width of the content column: the window on phones, capped on desktop web
 * where content sits in a centred column.
 */
export function useContentWidth() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' ? Math.min(width, WebMaxWidth) : width;
}

/** Card width for a wrapping grid: 2 columns on phones, more on wide screens. */
export function useGridCardWidth({ padding, gap, minCard = 220 }: { padding: number; gap: number; minCard?: number }) {
  const width = useContentWidth();
  const inner = width - padding * 2;
  const columns = Math.max(2, Math.floor((inner + gap) / (minCard + gap)));
  return Math.floor((inner - gap * (columns - 1)) / columns);
}
