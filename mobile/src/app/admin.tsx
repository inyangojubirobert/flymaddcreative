import { useState } from 'react';
import { StyleSheet, Pressable, ScrollView, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface AdminData {
  messages: any[];
  withdrawals: any[];
  orders: any[];
}

async function fetchAdminData(token: string): Promise<AdminData> {
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  
  const [messagesRes, withdrawalsRes, ordersRes] = await Promise.all([
    fetch('/api/admin/messages', { headers }),
    fetch('/api/admin/withdrawals', { headers }),
    fetch('/api/admin/orders', { headers })
  ]);

  return {
    messages: await messagesRes.json().then(d => d.messages || []),
    withdrawals: await withdrawalsRes.json().then(d => d.withdrawals || []),
    orders: await ordersRes.json().then(d => d.orders || [])
  };
}

export default function AdminDashboardScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [adminToken] = useState(''); // Would come from auth context
  const [activeTab, setActiveTab] = useState<'messages' | 'withdrawals' | 'orders'>('messages');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-data'],
    queryFn: () => adminToken ? fetchAdminData(adminToken) : Promise.resolve({ messages: [], withdrawals: [], orders: [] }),
    enabled: !!adminToken,
  });

  if (!adminToken) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>Admin Access</ThemedText>
          <ThemedText type="default" style={styles.subtitle}>Admin features are not available in this app build.</ThemedText>
          <ThemedText type="small" style={styles.hint}>Access admin portal at: /admin-portal.html</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ThemedText type="title" style={styles.title}>Admin Dashboard</ThemedText>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {['messages', 'withdrawals', 'orders'].map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab as any)}
              style={[styles.tabButton, { backgroundColor: activeTab === tab ? theme.backgroundElement : theme.background }]}
            >
              <ThemedText type="smallBold">{tab === 'messages' ? '💬' : tab === 'withdrawals' ? '💰' : '🛍️'} {tab}</ThemedText>
            </Pressable>
          ))}
        </ScrollView>

        {isLoading ? (
          <ThemedText style={styles.loading}>Loading…</ThemedText>
        ) : (
          <FlatList
            data={
              activeTab === 'messages' ? data?.messages :
              activeTab === 'withdrawals' ? data?.withdrawals :
              data?.orders
            }
            keyExtractor={(_, i) => i.toString()}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <ThemedView type="backgroundElement" style={styles.item}>
                <ThemedText type="smallBold">{item.body || item.username || item.seller_username}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{new Date(item.created_at).toLocaleDateString()}</ThemedText>
              </ThemedView>
            )}
            ListEmptyComponent={<ThemedText style={styles.empty}>No {activeTab} to display</ThemedText>}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  title: { fontSize: 24, marginTop: Spacing.two, marginBottom: Spacing.three },
  subtitle: { marginBottom: Spacing.two },
  hint: { color: '#888', marginBottom: Spacing.four },
  tabBar: { marginBottom: Spacing.three, marginHorizontal: -Spacing.three },
  tabButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, marginHorizontal: Spacing.half, borderRadius: Spacing.two },
  list: { paddingBottom: Spacing.four, gap: Spacing.two },
  item: { borderRadius: Spacing.two, padding: Spacing.three },
  loading: { textAlign: 'center', marginTop: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.four, color: '#888' },
});
