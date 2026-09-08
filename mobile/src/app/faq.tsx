import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getProjectFaqs } from '@/api/faqs';

export default function FaqScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const faqQuery = useQuery({
    queryKey: ['project-faqs'],
    queryFn: () => getProjectFaqs(token!),
    enabled: !!token,
  });

  const faqs = faqQuery.data || [];

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Help & FAQ' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={faqQuery.isFetching} onRefresh={() => faqQuery.refetch()} />}
        >
          <ThemedView style={[styles.hero, { backgroundColor: '#172554' }]}>
            <ThemedText type="subtitle" style={styles.heroTitle}>How can we help?</ThemedText>
            <ThemedText type="small" style={styles.heroText}>
              Clear guides for the One Dream Initiative, your catalogue, votes, payments, and account support.
            </ThemedText>
            <Pressable onPress={() => router.push('/ai' as never)} style={styles.askButton}>
              <ThemedText style={styles.askButtonText}>Ask Bascardo AI</ThemedText>
            </Pressable>
          </ThemedView>

          {faqQuery.isLoading ? (
            <ActivityIndicator size="large" style={styles.loading} />
          ) : faqQuery.isError ? (
            <ThemedView type="backgroundElement" style={styles.emptyCard}>
              <ThemedText type="smallBold">Help topics are unavailable right now.</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Pull down to try again, or ask Support directly.</ThemedText>
            </ThemedView>
          ) : faqs.length ? (
            faqs.map((faq) => {
              const expanded = openId === faq.id;
              return (
                <Pressable
                  key={faq.id}
                  onPress={() => setOpenId(expanded ? null : faq.id)}
                  style={[styles.faqCard, { backgroundColor: theme.backgroundElement }]}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                >
                  <View style={styles.questionRow}>
                    <View style={styles.questionText}>
                      <ThemedText type="small" style={styles.category}>{faq.category}</ThemedText>
                      <ThemedText type="default" style={styles.question}>{faq.question}</ThemedText>
                    </View>
                    <ThemedText type="subtitle" style={styles.chevron}>{expanded ? '−' : '+'}</ThemedText>
                  </View>
                  {expanded ? <ThemedText type="small" themeColor="textSecondary" style={styles.answer}>{faq.answer}</ThemedText> : null}
                </Pressable>
              );
            })
          ) : (
            <ThemedView type="backgroundElement" style={styles.emptyCard}>
              <ThemedText type="small" themeColor="textSecondary">No help topics have been published yet.</ThemedText>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: Spacing.six, gap: Spacing.two },
  hero: { borderRadius: Spacing.three, padding: Spacing.four, gap: Spacing.two, marginBottom: Spacing.one },
  heroTitle: { color: '#fff', fontSize: 22 },
  heroText: { color: '#dbeafe', lineHeight: 20 },
  askButton: { backgroundColor: '#7e22ce', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
  askButtonText: { color: '#fff', fontWeight: '700' },
  loading: { marginTop: Spacing.six },
  faqCard: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  questionRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  questionText: { flex: 1, gap: Spacing.half },
  category: { color: '#60a5fa', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11 },
  question: { fontWeight: '700', lineHeight: 20 },
  chevron: { color: '#60a5fa', fontSize: 24 },
  answer: { lineHeight: 21 },
  emptyCard: { borderRadius: Spacing.two, padding: Spacing.four, gap: Spacing.one },
});
