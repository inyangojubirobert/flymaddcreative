import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SponsoredBanner } from '@/components/sponsored';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { BASCARDO_LOGO_URL } from '@/constants/bascardo';
import { useTheme } from '@/hooks/use-theme';
import { getCategories } from '@/api/catalogue';
import { homeShortcuts } from '@/lib/catalogue-directory';
import { getLeaderboard } from '@/api/gifts';
import { useAuth } from '@/contexts/AuthContext';

const APP_LOGO_URL =
  'https://res.cloudinary.com/dljcj00ht/image/upload/v1751137778/90639762_2872585919484791_7377249381973491712_n_swlodr.jpg';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { token } = useAuth();

  const leaderboardQuery = useQuery({
    queryKey: ['reward-board', 'most_appreciated'],
    queryFn: () => getLeaderboard('most_appreciated'),
  });

  const categoriesQuery = useQuery({
    queryKey: ['catalogue-categories'],
    queryFn: getCategories,
  });

  const isRefreshing = leaderboardQuery.isFetching || categoriesQuery.isFetching;

  function refresh() {
    leaderboardQuery.refetch();
    categoriesQuery.refetch();
  }

  const topLeaderboard = (leaderboardQuery.data?.entries ?? []).slice(0, 5);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        >
          <ThemedView style={styles.heroCard}>
            <View style={styles.heroBrandRow}>
              <Image source={{ uri: APP_LOGO_URL }} style={styles.heroLogo} resizeMode="cover" />
              <View style={styles.heroBrandCopy}>
                <View style={styles.heroPill}>
                  <Ionicons name="sparkles" size={12} color={Palette.yellowInk} />
                  <ThemedText type="smallBold" style={styles.heroPillText}>CREATOR COMMERCE</ThemedText>
                </View>
                <ThemedText type="title" style={styles.heroTitle}>One Dream Initiative</ThemedText>
              </View>
            </View>
            <ThemedText type="subtitle" style={styles.heroSubtitle}>Harnessing support through social influence</ThemedText>
            <ThemedText type="default" style={styles.heroText}>
              FlyMadd Creative is building the future of creator commerce — where your personality, audience, and social influence become your biggest asset.
            </ThemedText>

            <View style={styles.ctaRow}>
              <Pressable
                onPress={() => router.push((token ? '/profile' : '/(auth)/register') as never)}
                style={[styles.primaryButton, token ? styles.profileButton : styles.getStartedButton]}
              >
                <Ionicons name={token ? 'person' : 'rocket'} size={17} color={token ? '#1F2937' : '#fff'} />
                <ThemedText style={[styles.buttonText, token && styles.profileButtonText]}>{token ? 'My Profile' : 'Get Started'}</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.push((token ? { pathname: '/shop', params: { view: '', department: '', category: '' } } : '/(auth)/login') as never)}
                style={[styles.heroSecondaryButton, token && styles.shopButton]}
              >
                <Ionicons name={token ? 'bag-handle' : 'log-in-outline'} size={17} color={Palette.white} />
                <ThemedText style={styles.heroSecondaryButtonText}>{token ? 'Shop' : 'Login'}</ThemedText>
              </Pressable>
            </View>
          </ThemedView>

          <Pressable onPress={() => router.push('/ai' as never)} style={styles.aiCard}>
            <View style={styles.aiCardIcon}>
              <Image source={{ uri: BASCARDO_LOGO_URL }} style={styles.aiCardLogo} resizeMode="contain" accessibilityLabel="Bascardo AI logo" />
            </View>
            <View style={styles.aiCardCopy}>
              <ThemedText type="smallBold" style={styles.aiCardTitle}>Bascardo AI business adviser</ThemedText>
              <ThemedText type="small" style={styles.aiCardText}>Ask about catalogue sales, customers, and how to grow your shop.</ThemedText>
            </View>
            <Ionicons name="arrow-forward" size={20} color={Palette.yellowInk} />
          </Pressable>

          <SponsoredBanner placement="home" />

          <View style={styles.browseHeader}>
            <View style={styles.sectionTitleWrap}>
              <View style={styles.sectionIcon}><Ionicons name="bag-handle" size={18} color={Palette.blue} /></View>
              <ThemedText type="smallBold" style={styles.sectionTitle}>Browse products</ThemedText>
            </View>
            <Pressable onPress={() => router.push({ pathname: '/shop', params: { view: 'directory', department: '', category: '' } } as never)} style={styles.viewAll}>
              <ThemedText type="smallBold" style={styles.viewAllText}>View all categories</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={Palette.blue} />
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {homeShortcuts(categoriesQuery.data ?? []).map((link) => (
              <CategoryTile
                key={link.key}
                name={link.label}
                icon={link.icon}
                tint={link.tint}
                ink={link.ink}
                onPress={() => router.push(`/shop?department=${link.departmentSlug}` as never)}
              />
            ))}
            <CategoryTile
              name="More"
              icon="ellipsis-horizontal"
              tint="#EDE9FE"
              ink="#6D28D9"
              onPress={() => router.push({ pathname: '/shop', params: { view: 'directory', department: '', category: '' } } as never)}
            />
          </ScrollView>

          <ThemedView style={styles.sectionTitleWrap}>
            <View style={styles.sectionIcon}><Ionicons name="compass" size={18} color={Palette.blue} /></View>
            <ThemedText type="smallBold" style={styles.sectionTitle}>How it works</ThemedText>
          </ThemedView>

          <ThemedView style={styles.stepsGrid}>
            {[
              { icon: 'person-add' as const, title: '1. Register', text: 'Create your profile and get your unique referral link.', tint: Palette.blueSoft, ink: Palette.blue },
              { icon: 'share-social' as const, title: '2. Share', text: 'Post your link and tell your community why your dream matters.', tint: Palette.yellowSoft, ink: Palette.yellowInk },
              { icon: 'gift' as const, title: '3. Get appreciated', text: 'Supporters send Dream Coin gifts. Earn recognition points, badges and a place on the recognition boards.', tint: Palette.ashSoft, ink: Palette.slate },
              { icon: 'storefront' as const, title: '4. Build your storefront', text: 'Publish 10 active listings with a promo video, then opt in (My Listings) to have it featured in One Dream’s social media ads. Each selected video gets up to $10 of ads paid by One Dream, from a $1,000 promotion budget.', tint: Palette.blueSoft, ink: Palette.blueDark },
            ].map((step) => (
              <ThemedView key={step.title} type="backgroundElement" style={[styles.stepCard, { borderColor: theme.backgroundSelected }]}>
                <View style={[styles.stepIcon, { backgroundColor: step.tint }]}>
                  <Ionicons name={step.icon} size={20} color={step.ink} />
                </View>
                <View style={styles.stepCopy}>
                  <ThemedText type="default" style={styles.stepTitle}>{step.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{step.text}</ThemedText>
                </View>
              </ThemedView>
            ))}
          </ThemedView>

          <ThemedView style={styles.sectionTitleWrap}>
            <View style={[styles.sectionIcon, { backgroundColor: Palette.yellowSoft }]}><Ionicons name="ribbon" size={18} color={Palette.yellowInk} /></View>
            <ThemedText type="smallBold" style={styles.sectionTitle}>Most appreciated</ThemedText>
          </ThemedView>

          {leaderboardQuery.isLoading ? (
            <ActivityIndicator size="large" style={styles.loading} />
          ) : leaderboardQuery.isError ? (
            <ThemedText style={styles.error}>Couldn&apos;t load recognition. Pull to retry.</ThemedText>
          ) : (
            <ThemedView style={styles.list}>
              {topLeaderboard.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">No gifts yet. Open a creator&apos;s profile and send the first one.</ThemedText>
              ) : null}
              {topLeaderboard.map((item, index) => (
                <Pressable
                  key={item.username}
                  onPress={() => router.push(`/profile/${item.username}` as never)}
                  style={[styles.row, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}
                >
                  <View style={[styles.rankBadge, index === 0 ? styles.rankFirst : styles.rankDefault]}>
                    <ThemedText type="smallBold" style={index === 0 ? styles.rankFirstText : styles.rankDefaultText}>#{index + 1}</ThemedText>
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText type="default" style={styles.personName}>{item.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">@{item.username}</ThemedText>
                  </View>
                  <ThemedText type="smallBold" style={styles.rowVotes}>{(item.recognition_points ?? 0).toLocaleString()} pts</ThemedText>
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                </Pressable>
              ))}
            </ThemedView>
          )}

          <Pressable onPress={() => router.push('/leaderboard' as never)} style={styles.leaderboardButton}>
            <Ionicons name="ribbon" size={19} color={Palette.blue} style={styles.leaderboardIcon} />
            <ThemedText style={styles.leaderboardButtonText}>View recognition boards</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function CategoryTile({ name, icon, tint, ink, onPress }: { name: string; icon: string; tint: string; ink: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.categoryTile}>
      <View style={[styles.categoryIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={26} color={ink} />
      </View>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.categoryName}>{name}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  // The Android tab bar floats over the screen. Reserve its full height plus
  // a little breathing room so the final "View recognition boards" button is
  // never hidden behind it in APK and AAB builds.
  content: { paddingHorizontal: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  heroCard: { borderRadius: 24, padding: Spacing.three, marginTop: Spacing.two, gap: Spacing.two, backgroundColor: Palette.blueDark, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 6 },
  heroBrandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heroLogo: { width: 72, height: 72, borderRadius: 20, borderWidth: 3, borderColor: Palette.yellowSoft },
  heroBrandCopy: { flex: 1, gap: 6 },
  heroPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Palette.yellowSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  heroPillText: { color: Palette.yellowInk, fontSize: 9, lineHeight: 12, letterSpacing: 0.7 },
  heroTitle: { color: Palette.white, fontSize: 27, lineHeight: 32 },
  heroSubtitle: { color: '#BFDBFE', fontSize: 18, lineHeight: 25 },
  heroText: { color: '#E2E8F0', lineHeight: 22 },
  ctaRow: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.one },
  primaryButton: { flex: 1, borderRadius: 14, paddingVertical: Spacing.three, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, elevation: 5, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  profileButton: { backgroundColor: '#C7F36B' },
  getStartedButton: { backgroundColor: Palette.blue },
  secondaryButton: { flex: 1, borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', borderWidth: 1 },
  buttonText: { color: '#fff', fontWeight: '600' },
  profileButtonText: { color: '#1F2937', fontWeight: '800' },
  secondaryButtonText: { fontWeight: '600' },
  heroSecondaryButton: { flex: 1, backgroundColor: 'rgba(14, 165, 233, 0.16)', borderColor: '#7DD3FC', borderWidth: 1, borderRadius: 14, paddingVertical: Spacing.three, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, elevation: 5, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
  shopButton: { backgroundColor: Palette.blue, borderColor: Palette.blue },
  heroSecondaryButtonText: { color: Palette.white, fontWeight: '700' },
  browseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewAllText: { color: Palette.blue },
  categoryRow: { gap: Spacing.two, paddingRight: Spacing.two },
  categoryTile: { width: 88, alignItems: 'center', gap: 8 },
  categoryIcon: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  categoryName: { fontSize: 12, lineHeight: 15, textAlign: 'center' },
  aiCard: { minHeight: 86, borderRadius: 18, padding: Spacing.three, backgroundColor: Palette.yellowSoft, borderWidth: 1, borderColor: '#FDE68A', flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiCardIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: Palette.white, alignItems: 'center', justifyContent: 'center' },
  aiCardLogo: { width: 42, height: 42, borderRadius: 13 },
  aiCardCopy: { flex: 1, gap: 2 },
  aiCardTitle: { color: Palette.yellowInk },
  aiCardText: { color: '#92400E', lineHeight: 18 },
  sectionTitleWrap: { marginTop: Spacing.one, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: Palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 18 },
  stepsGrid: { gap: Spacing.two },
  stepCard: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: 12, flexDirection: 'row' },
  stepIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepCopy: { flex: 1, gap: Spacing.half },
  stepTitle: { fontWeight: '700' },
  list: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  rankBadge: { width: 42, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rankFirst: { backgroundColor: Palette.yellowSoft },
  rankDefault: { backgroundColor: Palette.blueSoft },
  rankFirstText: { color: Palette.yellowInk },
  rankDefaultText: { color: Palette.blueDark },
  rowText: { flex: 1, gap: 2 },
  personName: { fontWeight: '700' },
  rowVotes: { color: Palette.blue },
  leaderboardButton: { minHeight: 54, borderRadius: 16, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: Palette.blueSoft, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.two, elevation: 5, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 8 },
  leaderboardIcon: { marginLeft: Spacing.three },
  leaderboardButtonText: { color: Palette.blueDark, fontWeight: '700', flex: 1, textAlign: 'center' },
  loading: { marginTop: Spacing.three },
  error: { textAlign: 'center', marginTop: Spacing.three },
});
