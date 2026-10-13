/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#172033',
    background: '#F8FAFC',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8EEF6',
    textSecondary: '#5B6678',
  },
  // The hosted web app always uses this scheme, styled like the website:
  // screens are transparent over the page's navy gradient, cards are glass.
  dark: Platform.OS === 'web'
    ? {
        text: '#F8FAFC',
        background: 'transparent',
        backgroundElement: 'rgba(255, 255, 255, 0.07)',
        backgroundSelected: 'rgba(255, 255, 255, 0.16)',
        textSecondary: '#CBD5E1',
      }
    : {
        text: '#F8FAFC',
        background: '#0F172A',
        backgroundElement: '#1E293B',
        backgroundSelected: '#334155',
        textSecondary: '#CBD5E1',
      },
};

export const Palette = {
  // Brighter on the web app's navy background, where #1D4ED8 text is too dark.
  blue: Platform.OS === 'web' ? '#3B82F6' : '#1D4ED8',
  blueDark: '#1E3A8A',
  blueSoft: '#DBEAFE',
  yellow: '#F59E0B',
  yellowSoft: '#FEF3C7',
  yellowInk: '#713F12',
  ash: '#E2E8F0',
  ashSoft: '#F1F5F9',
  slate: '#475569',
  slateDark: '#1E293B',
  green: '#15803D',
  lemon: '#C6F135',
  lemonInk: '#1A2E05',
  red: '#DC2626',
  redSoft: '#FEE2E2',
  white: '#FFFFFF',
};

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80, web: 84 }) ?? 0;
export const MaxContentWidth = 800;
/** Widest the hosted web app's content column gets on desktop. */
export const WebMaxWidth = 1180;
/** Viewport width from which the web app switches to the desktop layout (top navigation). */
export const WebDesktopBreakpoint = 900;
