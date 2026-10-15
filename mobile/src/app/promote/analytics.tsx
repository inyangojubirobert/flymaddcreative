import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { STATE_BADGE } from '@/components/ad-state';
import { formatDuration, getCampaignAnalytics, type AnalyticsRange, type CampaignAnalytics } from '@/api/ads';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

// Campaign analytics: real impressions and clicks from the server
// (/api/ads/campaign-analytics). Daily totals and the placement breakdown
// add up to the range totals - the server builds all three from the same events.

const RANGES: { key: AnalyticsRange; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'lifetime', label: 'Lifetime' },
];
const PLACEMENT_LABEL: Record<string, string> = { home: 'Home', shop: 'Shop', search: 'Search', category: 'Category', other: 'Other' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Validated with the dataviz palette checker against each mode's surface.
const BAR_LIGHT = '#1D4ED8';
const BAR_DARK = '#3B82F6';

/** 'YYYY-MM-DD' -> 'Oct 15' without time-zone shifting. */
const dayLabel = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;
const dateLabel = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const pct = (ctr: number | null) => (ctr === null ? '—' : `${(ctr * 100).toFixed(1)}%`);

function timeLeftLabel(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m`;
}

export default function CampaignAnalyticsScreen() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const { token } = useAuth();
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const query = useQuery({
    queryKey: ['campaign-analytics', campaignId, range],
    queryFn: () => getCampaignAnalytics(token!, campaignId!, range),
    enabled: !!token && !!campaignId,
  });
  const data = query.data;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Campaign analytics' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={query.isFetching && !query.isLoading} onRefresh={() => void query.refetch()} />}
        >
          {query.isLoading ? <ActivityIndicator style={styles.loading} /> : query.error || !data ? (
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {query.error instanceof Error ? query.error.message : 'Analytics are not available for this campaign.'}
            </ThemedText>
          ) : (
            <>
              <Header data={data} />
              <TimeCard data={data} />
              <View style={styles.ranges} accessibilityRole="tablist">
                {RANGES.map((r) => (
                  <Pressable key={r.key} accessibilityRole="tab" accessibilityState={{ selected: range === r.key }} onPress={() => setRange(r.key)}
                    style={[styles.range, range === r.key && styles.rangeSelected]}>
                    <ThemedText type="smallBold" style={{ color: range === r.key ? Palette.white : Palette.blueDark }}>{r.label}</ThemedText>
                  </Pressable>
                ))}
              </View>
              <Totals data={data} />
              <DailyCharts data={data} />
              <Placements data={data} />
              <PackageCard data={data} />
              <ThemedText type="small" themeColor="textSecondary">
                Each viewer is counted at most once per hour for impressions and once per hour for clicks. Days follow your time zone ({data.analytics.time_zone}).
              </ThemedText>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Header({ data }: { data: CampaignAnalytics }) {
  const badge = STATE_BADGE[data.campaign.state];
  const note = data.campaign.review_note && ['rejected', 'suspended', 'revoked'].includes(data.campaign.state) ? data.campaign.review_note : null;
  return (
    <View style={styles.section}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <ThemedText type="subtitle" numberOfLines={2}>{data.campaign.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{data.campaign.kind === 'boost' ? 'Listing boost' : 'Advertising campaign'} · {data.package.name}</ThemedText>
        </View>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}><ThemedText type="smallBold" style={[styles.badgeText, { color: badge.ink }]}>{badge.label}</ThemedText></View>
      </View>
      {data.campaign.state === 'pending_review' ? (
        <ThemedText type="small" themeColor="textSecondary">One Dream is reviewing this campaign. Your time starts when it goes live.</ThemedText>
      ) : null}
      {note ? (
        <View style={styles.note}>
          <Ionicons name="alert-circle" size={16} color={Palette.red} />
          <ThemedText type="small" style={styles.noteText}>One Dream: {note}</ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function TimeCard({ data }: { data: CampaignAnalytics }) {
  const theme = useTheme();
  const { campaign } = data;
  // Live campaigns tick down locally; the server's clock sets the starting point.
  const [offset] = useState(() => new Date(data.server_now).getTime() - Date.now());
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!campaign.counting) return;
    const timer = setInterval(() => setNow(Date.now() + offset), 30000);
    return () => clearInterval(timer);
  }, [campaign.counting, offset]);

  const remaining = campaign.counting && campaign.ends_at ? Math.max(0, new Date(campaign.ends_at).getTime() - now) : campaign.remaining_ms;
  const headline = campaign.not_started ? `Runs ${formatDuration(data.package.duration_hours ?? 0)} once live`
    : campaign.counting ? `${timeLeftLabel(remaining)} left`
      : campaign.state === 'paused' ? `Paused · ${timeLeftLabel(remaining)} left once re-approved`
        : 'Ended';
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={styles.headRow}>
        <Ionicons name={campaign.counting ? 'time' : 'time-outline'} size={18} color={Palette.blue} />
        <ThemedText type="smallBold" style={styles.flex}>{headline}</ThemedText>
      </View>
      <View style={styles.dates}>
        <View style={styles.flex}>
          <ThemedText type="small" themeColor="textSecondary">Started</ThemedText>
          <ThemedText type="small">{campaign.starts_at ? dateLabel(campaign.starts_at) : 'Not yet'}</ThemedText>
        </View>
        <View style={styles.flex}>
          <ThemedText type="small" themeColor="textSecondary">{campaign.counting || campaign.state === 'paused' ? 'Ends' : 'Ended'}</ThemedText>
          <ThemedText type="small">{campaign.ends_at ? dateLabel(campaign.ends_at) : '—'}</ThemedText>
        </View>
      </View>
    </View>
  );
}

function Totals({ data }: { data: CampaignAnalytics }) {
  const theme = useTheme();
  const t = data.analytics.totals;
  const tiles = [
    { label: 'Impressions', value: t.impressions.toLocaleString() },
    { label: 'Clicks', value: t.clicks.toLocaleString() },
    { label: 'Click rate', value: pct(t.ctr) },
  ];
  return (
    <View style={styles.tiles}>
      {tiles.map((tile) => (
        <View key={tile.label} style={[styles.tile, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
          <ThemedText style={styles.tileValue}>{tile.value}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">{tile.label}</ThemedText>
        </View>
      ))}
    </View>
  );
}

function DailyCharts({ data }: { data: CampaignAnalytics }) {
  const theme = useTheme();
  const [asTable, setAsTable] = useState(false);
  const { daily } = data.analytics;
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <View style={styles.headRow}>
        <ThemedText type="smallBold" style={styles.flex}>Daily performance</ThemedText>
        <Pressable accessibilityRole="button" onPress={() => setAsTable((v) => !v)} hitSlop={8}>
          <ThemedText type="small" style={{ color: Palette.blue }}>{asTable ? 'Show charts' : 'Show table'}</ThemedText>
        </Pressable>
      </View>
      {asTable ? <DailyTable daily={daily} /> : (
        <>
          <BarChart title="Impressions" daily={daily} field="impressions" />
          <BarChart title="Clicks" daily={daily} field="clicks" />
        </>
      )}
    </View>
  );
}

/** One measure per chart (impressions and clicks have different scales). Tap a bar for its value. */
function BarChart({ title, daily, field }: { title: string; daily: CampaignAnalytics['analytics']['daily']; field: 'impressions' | 'clicks' }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const color = scheme === 'dark' ? BAR_DARK : BAR_LIGHT;
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...daily.map((d) => d[field]));
  const picked = selected !== null ? daily[selected] : null;
  const total = daily.reduce((sum, d) => sum + d[field], 0);
  return (
    <View style={styles.chart}>
      <View style={styles.headRow}>
        <ThemedText type="small" style={styles.flex}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {picked ? `${dayLabel(picked.date)}: ${picked[field].toLocaleString()}` : `${total.toLocaleString()} total`}
        </ThemedText>
      </View>
      <View style={styles.plot}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.axisMax}>{max.toLocaleString()}</ThemedText>
        <View style={[styles.bars, { borderColor: theme.backgroundSelected }]}>
          {daily.map((d, i) => (
            <Pressable
              key={d.date}
              accessibilityLabel={`${dayLabel(d.date)}: ${d[field]} ${title.toLowerCase()}`}
              onPress={() => setSelected(selected === i ? null : i)}
              style={styles.barSlot}
            >
              <View style={[styles.bar, {
                height: `${(d[field] / max) * 100}%`,
                backgroundColor: color,
                opacity: selected === null || selected === i ? 1 : 0.4,
              }]} />
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.axisDates}>
        <ThemedText type="small" themeColor="textSecondary">{daily.length ? dayLabel(daily[0].date) : ''}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{daily.length ? dayLabel(daily[daily.length - 1].date) : ''}</ThemedText>
      </View>
    </View>
  );
}

function DailyTable({ daily }: { daily: CampaignAnalytics['analytics']['daily'] }) {
  const theme = useTheme();
  return (
    <View>
      <View style={styles.tableRow}>
        <ThemedText type="smallBold" style={styles.tableDate}>Day</ThemedText>
        <ThemedText type="smallBold" style={styles.tableNum}>Impressions</ThemedText>
        <ThemedText type="smallBold" style={styles.tableNum}>Clicks</ThemedText>
      </View>
      {[...daily].reverse().map((d) => (
        <View key={d.date} style={[styles.tableRow, { borderTopColor: theme.backgroundSelected, borderTopWidth: 1 }]}>
          <ThemedText type="small" style={styles.tableDate}>{dayLabel(d.date)}</ThemedText>
          <ThemedText type="small" style={styles.tableNum}>{d.impressions.toLocaleString()}</ThemedText>
          <ThemedText type="small" style={styles.tableNum}>{d.clicks.toLocaleString()}</ThemedText>
        </View>
      ))}
    </View>
  );
}

function Placements({ data }: { data: CampaignAnalytics }) {
  const theme = useTheme();
  const scheme = useColorScheme();
  const color = scheme === 'dark' ? BAR_DARK : BAR_LIGHT;
  const eligible = new Set(data.package.placements);
  const max = Math.max(1, ...data.analytics.placements.map((p) => p.impressions));
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">Where it appeared</ThemedText>
      {data.analytics.placements.map((p) => {
        const inPackage = p.placement === 'other' || eligible.has(p.placement);
        return (
          <View key={p.placement} style={styles.placement}>
            <View style={styles.headRow}>
              <ThemedText type="small" style={styles.flex}>{PLACEMENT_LABEL[p.placement] || p.placement}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {inPackage ? `${p.impressions.toLocaleString()} views · ${p.clicks.toLocaleString()} clicks · ${pct(p.ctr)}` : 'Not in your package'}
              </ThemedText>
            </View>
            {inPackage ? (
              <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
                <View style={[styles.fill, { width: `${(p.impressions / max) * 100}%`, backgroundColor: color }]} />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function PackageCard({ data }: { data: CampaignAnalytics }) {
  const theme = useTheme();
  const p = data.package;
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected }]}>
      <ThemedText type="smallBold">Your package: {p.name}</ThemedText>
      <View style={styles.benefits}>
        {p.duration_hours ? <Benefit icon="calendar" text={`${formatDuration(p.duration_hours)} of exposure`} /> : null}
        {data.campaign.kind === 'ad' && p.max_creatives ? <Benefit icon="images" text={`Up to ${p.max_creatives} creative${p.max_creatives === 1 ? '' : 's'}`} /> : null}
        <Benefit icon="location" text={`Shown in: ${p.placements.map((x) => PLACEMENT_LABEL[x] || x).join(', ')}`} />
        <Benefit icon="trending-up" text={`Exposure priority ${p.priority} of ${p.top_priority}${p.relative_weight && p.relative_weight !== 1 ? ` · ${p.relative_weight}× the selection weight of the entry package` : ''}`} />
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        One Dream places your campaign automatically. Priority sets how often it is picked when it competes with other campaigns for the same spot - it is not a guarantee of views or clicks.
      </ThemedText>
    </View>
  );
}

function Benefit({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={15} color={Palette.blue} />
      <ThemedText type="small" style={styles.flex}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scroll: { paddingTop: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.three },
  loading: { marginTop: Spacing.five },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  flex: { flex: 1 },
  section: { gap: Spacing.two },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { fontSize: 11 },
  note: { flexDirection: 'row', gap: 6, borderRadius: 12, padding: Spacing.two, backgroundColor: Palette.redSoft },
  noteText: { flex: 1, color: Palette.red },
  card: { borderRadius: 18, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  dates: { flexDirection: 'row', gap: Spacing.two },
  ranges: { flexDirection: 'row', gap: Spacing.two },
  range: { flex: 1, alignItems: 'center', borderRadius: 999, paddingVertical: 9, backgroundColor: Palette.blueSoft },
  rangeSelected: { backgroundColor: Palette.blue },
  tiles: { flexDirection: 'row', gap: Spacing.two },
  tile: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: Spacing.three, alignItems: 'center', gap: 2 },
  tileValue: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  chart: { gap: 6, marginTop: Spacing.one },
  plot: { height: 120 },
  axisMax: { position: 'absolute', top: -2, left: 0, fontSize: 11 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, borderBottomWidth: 1, paddingTop: 16 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', minHeight: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axisDates: { flexDirection: 'row', justifyContent: 'space-between' },
  tableRow: { flexDirection: 'row', paddingVertical: 6 },
  tableDate: { flex: 1 },
  tableNum: { width: 96, textAlign: 'right' },
  placement: { gap: 4 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  benefits: { gap: 6 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
