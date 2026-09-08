import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMerchantAuth } from '@/contexts/MerchantAuthContext';
import { getMerchantDashboard, withdrawMerchantTokens } from '@/api/merchants';
import { ApiError } from '@/lib/api-client';

const MIN_WITHDRAWAL = 50;

export default function MerchantWithdrawScreen() {
  const { merchant, token } = useMerchantAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const dashboardQuery = useQuery({
    queryKey: ['merchant-dashboard', merchant?.id],
    queryFn: () => getMerchantDashboard(token!, merchant!.id),
    enabled: !!token && !!merchant,
  });

  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const available = dashboardQuery.data?.stats.available_tokens ?? 0;

  async function handleSubmit() {
    setError(null);
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum < MIN_WITHDRAWAL) return setError(`Minimum withdrawal is ${MIN_WITHDRAWAL} tokens.`);
    if (amountNum > available) return setError(`You only have ${available} tokens available.`);

    setIsSubmitting(true);
    try {
      await withdrawMerchantTokens(token!, merchant!.id, amountNum);
      queryClient.invalidateQueries({ queryKey: ['merchant-dashboard', merchant?.id] });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Withdrawal failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedView type="backgroundElement" style={styles.balanceCard}>
            <ThemedText type="small" themeColor="textSecondary">Available tokens</ThemedText>
            <ThemedText type="title" style={styles.balanceValue}>{available}</ThemedText>
          </ThemedView>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <TextInput
            placeholder={`Amount (min ${MIN_WITHDRAWAL})`} placeholderTextColor={theme.textSecondary}
            value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Withdrawn to the wallet address on your profile. Update it under Profile if needed before withdrawing.
          </ThemedText>

          <Pressable onPress={handleSubmit} disabled={isSubmitting} style={[styles.button, { opacity: isSubmitting ? 0.6 : 1 }]}>
            {isSubmitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Request Withdrawal</ThemedText>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingTop: Spacing.three, gap: Spacing.three },
  balanceCard: { borderRadius: Spacing.two, padding: Spacing.three },
  balanceValue: { fontSize: 32, color: '#1D4ED8' },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  button: { backgroundColor: '#15803d', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#e5484d' },
});
