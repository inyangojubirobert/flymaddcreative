import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Palette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Palette.blue,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarActiveBackgroundColor: Palette.blueSoft,
        tabBarStyle: {
          backgroundColor: theme.backgroundElement,
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: Platform.select({ ios: 24, default: 16 }),
          borderRadius: 24,
          height: 68,
          borderTopWidth: 1,
          borderColor: Palette.ash,
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
