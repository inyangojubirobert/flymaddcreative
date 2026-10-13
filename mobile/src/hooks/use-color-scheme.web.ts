/**
 * The hosted web app (/app) always uses the dark scheme, matching the
 * website's navy look (see Colors.dark in constants/theme.ts).
 */
export function useColorScheme() {
  return 'dark' as const;
}
