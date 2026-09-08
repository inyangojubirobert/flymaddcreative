import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

const services = [
  { title: 'Brand Design', text: 'Identity, positioning, and visual systems that make your work memorable.' },
  { title: 'Web Experiences', text: 'Launch-ready websites and digital experiences built to convert attention.' },
  { title: 'Mobile Products', text: 'App experiences that feel native, smooth, and built for real user journeys.' },
  { title: 'Growth Strategy', text: 'Audience and community systems that turn attention into traction.' },
];

const reasons = [
  'Built for creators and businesses',
  'Strategy-first, not just visuals',
  'Simple, polished user experiences',
];

export default function PublicHomeScreen() {
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedView type="backgroundElement" style={styles.heroCard}>
            <ThemedText type="smallBold" style={styles.eyebrow}>FlyMadd Creative</ThemedText>
            <ThemedText type="title" style={styles.title}>Turn ideas into attention that moves.</ThemedText>
            <ThemedText type="default" style={styles.copy}>
              Creative strategy, digital design, and product experiences built to help brands grow with real momentum.
            </ThemedText>

            <Pressable onPress={() => router.push('/(auth)/register')} style={styles.primaryButton}>
              <ThemedText style={styles.buttonText}>Join FlyMadd</ThemedText>
            </Pressable>

            <Pressable onPress={() => router.push('/(auth)/login')} style={styles.secondaryButton}>
              <ThemedText type="linkPrimary" style={styles.secondaryButtonText}>Already a member? Login</ThemedText>
            </Pressable>

          </ThemedView>

          <ThemedView style={styles.metricsRow}>
            <ThemedView type="backgroundElement" style={styles.metricCard}>
              <ThemedText type="smallBold" style={styles.metricValue}>4+</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Core services</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.metricCard}>
              <ThemedText type="smallBold" style={styles.metricValue}>24/7</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Growth mindset</ThemedText>
            </ThemedView>
            <ThemedView type="backgroundElement" style={styles.metricCard}>
              <ThemedText type="smallBold" style={styles.metricValue}>1</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Clear vision</ThemedText>
            </ThemedView>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.sectionCard}>
            <ThemedText type="smallBold" style={styles.sectionHeading}>What we do</ThemedText>
            <ThemedView style={styles.list}>
              {services.map((service) => (
                <ThemedView key={service.title} style={styles.serviceCard}>
                  <ThemedText type="default" style={styles.serviceTitle}>{service.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{service.text}</ThemedText>
                </ThemedView>
              ))}
            </ThemedView>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.sectionCard}>
            <ThemedText type="smallBold" style={styles.sectionHeading}>Why FlyMadd</ThemedText>
            <ThemedView style={styles.reasonList}>
              {reasons.map((reason) => (
                <ThemedText key={reason} type="default" style={styles.reasonItem}>• {reason}</ThemedText>
              ))}
            </ThemedView>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  heroCard: { borderRadius: 24, padding: Spacing.four, gap: Spacing.two },
  eyebrow: { letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontSize: 32, lineHeight: 40 },
  copy: { lineHeight: 24 },
  primaryButton: {
    marginTop: Spacing.two,
    backgroundColor: '#1D4ED8',
    paddingVertical: Spacing.three,
    borderRadius: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: {
    marginTop: Spacing.one,
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  secondaryButtonText: {
    textAlign: 'center',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  metricCard: {
    flex: 1,
    borderRadius: 16,
    padding: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricValue: { fontSize: 20, marginBottom: Spacing.half },
  sectionCard: { borderRadius: 20, padding: Spacing.three, gap: Spacing.two },
  sectionHeading: { fontSize: 18 },
  list: { gap: Spacing.two },
  serviceCard: {
    borderRadius: 14,
    padding: Spacing.three,
    gap: Spacing.half,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  serviceTitle: { fontWeight: '700' },
  reasonList: { gap: Spacing.one },
  reasonItem: { lineHeight: 24 },
});
