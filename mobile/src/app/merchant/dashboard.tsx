import { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMerchantAuth } from '@/contexts/MerchantAuthContext';
import { getMerchantDashboard, createReferralLink, toggleReferralLink } from '@/api/merchants';
import { ApiError } from '@/lib/api-client';

export default function MerchantDashboardScreen() {
  const { merchant, token, logout, handleUnauthorized } = useMerchantAuth();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [isCreatingLink, setIsCreatingLink] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: ['merchant-dashboard', merchant?.id],
    queryFn: () => getMerchantDashboard(token!, merchant!.id),
    enabled: !!token && !!merchant,
  });

  useEffect(() => {
    if (dashboardQuery.error instanceof ApiError && dashboardQuery.error.status === 401) {
      handleUnauthorized();
    }
  }, [dashboardQuery.error, handleUnauthorized]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['merchant-dashboard', merchant?.id] });
  }

  async function handleCreateLink() {
    if (!token || !merchant) return;
    setIsCreatingLink(true);
    try {
      await createReferralLink(token, merchant.id);
      refresh();
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setIsCreatingLink(false);
    }
  }

  async function handleToggleLink(linkId: string, isActive: boolean) {
    if (!token) return;
    try {
      await toggleReferralLink(token, linkId, isActive);
      refresh();
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Please try again.');
    }
  }

  if (dashboardQuery.isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" style={styles.loading} />
      </ThemedView>
    );
  }

  const data = dashboardQuery.data;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedText type="title" style={styles.title}>{data?.merchant.merchant_name ?? merchant?.merchant_name}</ThemedText>

          <ThemedView style={styles.statsGrid}>
            <StatCard label="Available Tokens" value={data?.stats.available_tokens ?? 0} theme={theme} />
            <StatCard label="Total Earned" value={data?.stats.total_tokens_earned ?? 0} theme={theme} />
            <StatCard label="Referrals" value={data?.stats.total_referrals ?? 0} theme={theme} />
            <StatCard label="Conversion" value={`${data?.stats.conversion_rate ?? 0}%`} theme={theme} />
          </ThemedView>

          <ThemedView style={styles.actionsRow}>
            <Pressable onPress={() => router.push('/merchant/withdraw')} style={styles.actionButton}>
              <ThemedText style={styles.actionButtonText}>💸 Withdraw</ThemedText>
            </Pressable>
            <Pressable onPress={() => router.push('/merchant/edit-profile')} style={[styles.actionButton, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText>⚙️ Profile</ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={styles.sectionHeader}>
            <ThemedText type="smallBold">Referral Links</ThemedText>
            <Pressable onPress={handleCreateLink} disabled={isCreatingLink}>
              <ThemedText type="link" themeColor="textSecondary">{isCreatingLink ? 'Creating…' : '+ New Link'}</ThemedText>
            </Pressable>
          </ThemedView>

          {(data?.referral_links ?? []).map((link) => (
            <ThemedView key={link.id} style={[styles.linkCard, { backgroundColor: theme.backgroundElement }]}>
              <ThemedView style={styles.linkCardText}>
                <ThemedText type="small" numberOfLines={1}>{link.full_link}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {link.clicks_count ?? 0} clicks · {link.registrations_count ?? 0} signups
                </ThemedText>
              </ThemedView>
              <Switch value={link.is_active} onValueChange={(v) => handleToggleLink(link.id, v)} />
            </ThemedView>
          ))}

          <ThemedText type="smallBold" style={styles.sectionHeaderStandalone}>Recent Activity</ThemedText>
          {(data?.recent_activity ?? []).length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">No referrals yet.</ThemedText>
          ) : (
            data!.recent_activity.map((activity, i) => (
              <ThemedView key={i} style={[styles.activityRow, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small">{activity.participant.name}</ThemedText>
                {activity.reward && (
                  <ThemedText type="small" themeColor="textSecondary">{activity.reward.tokens} tokens · {activity.reward.status}</ThemedText>
                )}
              </ThemedView>
            ))
          )}

          <Pressable onPress={() => logout()} style={styles.logoutButton}>
            <ThemedText style={styles.logoutText}>Log Out</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StatCard({ label, value, theme }: { label: string; value: string | number; theme: { backgroundElement: string } }) {
  return (
    <ThemedView style={[styles.statCard, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="title" style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  loading: { marginTop: Spacing.six },
  scrollContent: { paddingBottom: Spacing.four, gap: Spacing.two, paddingTop: Spacing.two },
  title: { fontSize: 22, marginBottom: Spacing.two },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  statCard: { width: '48%', borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.half },
  statValue: { fontSize: 22 },
  actionsRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  actionButton: { flex: 1, backgroundColor: '#15803d', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  actionButtonText: { color: '#fff', fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.three },
  sectionHeaderStandalone: { marginTop: Spacing.three },
  linkCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Spacing.two, padding: Spacing.three, marginTop: Spacing.two },
  linkCardText: { flex: 1, gap: 2, marginRight: Spacing.two },
  activityRow: { flexDirection: 'row', justifyContent: 'space-between', borderRadius: Spacing.two, padding: Spacing.three, marginTop: Spacing.two },
  logoutButton: { borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', borderWidth: 1, borderColor: '#e5484d', marginTop: Spacing.four },
  logoutText: { color: '#e5484d', fontWeight: '600' },
});
