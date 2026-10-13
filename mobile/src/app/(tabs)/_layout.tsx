import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useIsDesktopWeb } from '@/hooks/use-content-width';

export default function TabsLayout() {
  const theme = useTheme();
  // Desktop web uses the top navigation (components/web-shell.web.tsx) instead.
  const desktopWeb = useIsDesktopWeb();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Palette.blue,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarActiveBackgroundColor: Palette.blueSoft,
        tabBarStyle: desktopWeb ? { display: 'none' } : {
          backgroundColor: Platform.OS === 'web' ? 'rgba(15, 23, 42, 0.94)' : theme.backgroundElement,
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: Platform.select({ ios: 24, default: 16 }),
          borderRadius: 24,
          height: 68,
          borderTopWidth: 1,
          borderColor: Platform.OS === 'web' ? 'rgba(255, 255, 255, 0.12)' : Palette.ash,
          paddingHorizontal: 6,
          paddingTop: 5,
          paddingBottom: 5,
          elevation: 12,
          shadowColor: Palette.slateDark,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.15,
          shadowRadius: 12,
        },
        tabBarItemStyle: { borderRadius: 18, marginHorizontal: 2 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Leaders',
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
