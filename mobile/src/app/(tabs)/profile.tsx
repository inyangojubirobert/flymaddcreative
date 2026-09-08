import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Palette, Spacing } from '@/constants/theme';
import { BASCARDO_LOGO_URL } from '@/constants/bascardo';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { getCatalogueByUsername } from '@/api/catalogue';

type ProfileActionProps = {
  icon: keyof typeof Ionicons.glyphMap;
  iconBackground: string;
  iconColor: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  imageUri?: string;
};

export default function ProfileScreen() {
  const { participant, logout } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const shopQuery = useQuery({
    queryKey: ['my-catalogue', participant?.username],
    queryFn: () => getCatalogueByUsername(participant!.username),
    enabled: !!participant,
  });

  if (!participant) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" color={Palette.blue} style={styles.loading} />
      </ThemedView>
    );
  }

  const initials = participant.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          overScrollMode="always"
        >
          <View style={styles.pageHeading}>
            <ThemedText type="title" style={styles.pageTitle}>My profile</ThemedText>
            <View style={styles.activePill}>
              <View style={styles.activeDot} />
              <ThemedText type="smallBold" style={styles.activeText}>Active</ThemedText>
            </View>
          </View>

          <View style={styles.identityCard}>
            <View style={styles.avatar}>
              <ThemedText type="title" style={styles.avatarText}>{initials || 'OD'}</ThemedText>
            </View>
            <View style={styles.identityCopy}>
              <ThemedText type="title" style={styles.name}>{participant.name}</ThemedText>
              <ThemedText type="small" style={styles.username}>@{participant.username}</ThemedText>
              {participant.current_stage ? (
                <View style={styles.stagePill}>
                  <Ionicons name="sparkles" size={13} color={Palette.yellowInk} />
                  <ThemedText type="smallBold" style={styles.stageText}>{participant.current_stage}</ThemedText>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, styles.votesCard]}>
              <Ionicons name="heart" size={22} color={Palette.blue} />
              <ThemedText type="title" style={styles.summaryValue}>{participant.total_votes.toLocaleString()}</ThemedText>
              <ThemedText type="small" style={styles.summaryLabel}>Total votes</ThemedText>
            </View>
            <View style={[styles.summaryCard, styles.codeCard]}>
              <Ionicons name="key" size={22} color={Palette.yellowInk} />
              <ThemedText type="title" style={styles.codeValue} numberOfLines={1} adjustsFontSizeToFit>{participant.user_code}</ThemedText>
              <ThemedText type="small" style={styles.codeLabel}>Voting code</ThemedText>
            </View>
          </View>

          <View style={styles.tipCard}>
            <Ionicons name="bulb" size={22} color={Palette.yellowInk} />
            <ThemedText type="small" style={styles.tipText}>Share your voting code so supporters can quickly find your profile.</ThemedText>
          </View>

          <ThemedText type="smallBold" style={styles.sectionLabel}>YOUR SPACE</ThemedText>

          <View style={[styles.actionGroup, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
            <ProfileAction
              icon="storefront"
              iconBackground="#ECFCCB"
              iconColor="#3F6212"
              title={(shopQuery.data?.length ?? 0) > 0 ? 'View shop' : 'Create shop'}
              subtitle={(shopQuery.data?.length ?? 0) > 0
                ? `${shopQuery.data?.length} product${shopQuery.data?.length === 1 ? '' : 's'} · listings, orders and payments`
                : 'Open your storefront and add your first product'}
              onPress={() => router.push('/catalogue/manage' as never)}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ProfileAction
              icon="sparkles"
              imageUri={BASCARDO_LOGO_URL}
              iconBackground={Palette.yellowSoft}
              iconColor={Palette.yellowInk}
              title="Bascardo AI adviser"
              subtitle="Analyse your sales, catalogue, votes, and position"
              onPress={() => router.push('/ai' as never)}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ProfileAction
              icon="diamond"
              iconBackground={Palette.blueSoft}
              iconColor={Palette.blue}
              title="AI subscription"
              subtitle="See your credits and compare plans"
              onPress={() => router.push('/ai-subscription' as never)}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ProfileAction
              icon="trophy"
              iconBackground={Palette.yellowSoft}
              iconColor={Palette.yellowInk}
              title="Leaderboard"
              subtitle="See rankings and creator momentum"
              onPress={() => router.push('/leaderboard' as never)}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ProfileAction
              icon="wallet"
              iconBackground={Palette.blueSoft}
              iconColor={Palette.blue}
              title="Wallet"
              subtitle="View rewards and withdrawal activity"
              onPress={() => router.push('/wallet' as never)}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ProfileAction
              icon="chatbubbles"
              iconBackground={Palette.ashSoft}
              iconColor={Palette.slate}
              title="Support messages"
              subtitle="Chat privately with FlyMadd Support"
              onPress={() => router.push('/messages' as never)}
            />
            <View style={[styles.divider, { backgroundColor: theme.backgroundSelected }]} />
            <ProfileAction
              icon="help-circle"
              iconBackground={Palette.yellowSoft}
              iconColor={Palette.yellowInk}
              title="Help & FAQ"
              subtitle="Guides for catalogues, votes, and payments"
              onPress={() => router.push('/faq' as never)}
            />
          </View>

          <Pressable
            onPress={() => void logout()}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Ionicons name="log-out-outline" size={20} color={Palette.red} />
            <ThemedText style={styles.logoutText}>Log out</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function ProfileAction({ icon, iconBackground, iconColor, title, subtitle, onPress, imageUri }: ProfileActionProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]} accessibilityRole="button">
      <View style={[styles.actionIcon, { backgroundColor: iconBackground }]}>
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.actionLogo} resizeMode="contain" /> : <Ionicons name={icon} size={20} color={iconColor} />}
      </View>
      <View style={styles.actionCopy}>
        <ThemedText type="smallBold" style={styles.actionTitle}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.actionSubtitle}>{subtitle}</ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={20} color={Palette.slate} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingBottom: BottomTabInset + Spacing.two, overflow: 'hidden' },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.four, gap: Spacing.three },
  loading: { marginTop: Spacing.six },
  pageHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { fontSize: 28, lineHeight: 34 },
  activePill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#DCFCE7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, gap: 6 },
  activeDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: Palette.green },
  activeText: { color: '#166534', fontSize: 12, lineHeight: 16 },
  identityCard: { borderRadius: 24, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three, backgroundColor: Palette.blueDark, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 6 },
  avatar: { width: 68, height: 68, borderRadius: 22, backgroundColor: Palette.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Palette.yellowInk, fontSize: 25, lineHeight: 30, fontWeight: '800' },
  identityCopy: { flex: 1, gap: 3 },
  name: { color: Palette.white, fontSize: 24, lineHeight: 30 },
  username: { color: '#BFDBFE' },
  stagePill: { alignSelf: 'flex-start', marginTop: 5, flexDirection: 'row', alignItems: 'center', backgroundColor: Palette.yellowSoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, gap: 5 },
  stageText: { color: Palette.yellowInk, fontSize: 11, lineHeight: 15 },
  summaryRow: { flexDirection: 'row', gap: Spacing.two },
  summaryCard: { flex: 1, borderRadius: 18, padding: Spacing.three, gap: 3, borderWidth: 1 },
  votesCard: { backgroundColor: Palette.blueSoft, borderColor: '#BFDBFE' },
  codeCard: { backgroundColor: Palette.yellowSoft, borderColor: '#FDE68A' },
  summaryValue: { color: Palette.blueDark, fontSize: 25, lineHeight: 30 },
  summaryLabel: { color: Palette.blueDark, fontSize: 12 },
  codeValue: { color: Palette.yellowInk, fontSize: 22, lineHeight: 28, letterSpacing: 1.4 },
  codeLabel: { color: Palette.yellowInk, fontSize: 12 },
  tipCard: { borderRadius: 16, padding: Spacing.three, backgroundColor: Palette.ashSoft, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderColor: Palette.ash },
  tipText: { flex: 1, color: Palette.slateDark, lineHeight: 20 },
  sectionLabel: { color: Palette.slate, letterSpacing: 1.1, fontSize: 12, marginTop: Spacing.one },
  actionGroup: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.three, paddingVertical: 13, gap: 12 },
  actionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  actionLogo: { width: 36, height: 36, borderRadius: 11 },
  actionCopy: { flex: 1, gap: 1 },
  actionTitle: { fontSize: 15 },
  actionSubtitle: { fontSize: 12, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 70 },
  logoutButton: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: Spacing.two, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: Palette.redSoft, marginTop: Spacing.one },
  logoutText: { color: Palette.red, fontWeight: '700' },
  pressed: { opacity: 0.72 },
});
