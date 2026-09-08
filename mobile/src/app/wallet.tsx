import { useState } from 'react';
import { StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getWalletSummary, requestWithdrawal, type Withdrawal } from '@/api/wallet';
import { ApiError } from '@/lib/api-client';

// Participant withdrawals are available at any time. The server still
// independently verifies the participant and available balance before it
// creates a request.
const isWithdrawalWindowOpen = () => true;

export default function WalletScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const walletQuery = useQuery({
    queryKey: ['wallet'],
    queryFn: () => getWalletSummary(token!),
    enabled: !!token,
  });

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const windowOpen = isWithdrawalWindowOpen();
  const available = walletQuery.data?.available_balance ?? 0;

  async function handleSubmit() {
    setError(null);
    setMessage(null);
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) return setError('Enter a valid amount.');
    if (amountNum > available) return setError(`Max available is $${available.toFixed(2)}.`);
    if (!method.trim() || !details.trim()) return setError('Enter a payment method and details.');
    setIsSubmitting(true);
    try {
      await requestWithdrawal(token!, { amount: amountNum, method: method.trim(), details: details.trim() });
      setMessage('Withdrawal request submitted and is pending review.');
      setAmount('');
      setDetails('');
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Submission failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Wallet' }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {walletQuery.isLoading ? (
            <ActivityIndicator size="large" style={styles.loading} />
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.summaryCard}>
                <ThemedText type="small" themeColor="textSecondary">Total Earned</ThemedText>
                <ThemedText type="smallBold">${(walletQuery.data?.earned ?? 0).toFixed(2)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.summaryGap}>Withdrawn</ThemedText>
                <ThemedText type="smallBold">${(walletQuery.data?.withdrawn ?? 0).toFixed(2)}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.summaryGap}>Available</ThemedText>
                <ThemedText type="title" style={styles.availableAmount}>${available.toFixed(2)}</ThemedText>
              </ThemedView>

              <ThemedView type="backgroundElement" style={[styles.banner, { opacity: windowOpen ? 1 : 0.7 }]}>
                <ThemedText type="small">
                  ✅ Withdrawals are available at any time.
                </ThemedText>
              </ThemedView>

              {windowOpen && available > 0 && (
                <ThemedView style={styles.form}>
                  <ThemedText type="smallBold">Request a withdrawal</ThemedText>
                  {error && <ThemedText style={styles.error}>{error}</ThemedText>}
                  {message && <ThemedText style={styles.success}>{message}</ThemedText>}
                  <TextInput
                    placeholder="Amount (USD)" placeholderTextColor={theme.textSecondary}
                    value={amount} onChangeText={setAmount} keyboardType="decimal-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <TextInput
                    placeholder="Payment method (e.g. Bank transfer, USDT)" placeholderTextColor={theme.textSecondary}
                    value={method} onChangeText={setMethod}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <TextInput
                    placeholder="Account / wallet details" placeholderTextColor={theme.textSecondary}
                    value={details} onChangeText={setDetails} multiline numberOfLines={2}
                    style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                  <Pressable onPress={handleSubmit} disabled={isSubmitting} style={[styles.submitButton, { opacity: isSubmitting ? 0.6 : 1 }]}>
                    {isSubmitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.submitButtonText}>Submit Withdrawal Request</ThemedText>}
                  </Pressable>
                </ThemedView>
              )}

              <ThemedText type="smallBold" style={styles.historyTitle}>History</ThemedText>
              <FlatList<Withdrawal>
                data={walletQuery.data?.withdrawals ?? []}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
                ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary">No withdrawals yet.</ThemedText>}
                renderItem={({ item }) => (
                  <ThemedView style={[styles.historyRow, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="small">${item.amount_usd.toFixed(2)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{item.status}</ThemedText>
                  </ThemedView>
                )}
              />
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.four, gap: Spacing.three, paddingTop: Spacing.three },
  loading: { marginTop: Spacing.six },
  summaryCard: { borderRadius: Spacing.two, padding: Spacing.three },
  summaryGap: { marginTop: Spacing.two },
  availableAmount: { fontSize: 32, color: '#1D4ED8' },
  banner: { borderRadius: Spacing.two, padding: Spacing.three },
  form: { gap: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 14 },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  submitButton: { backgroundColor: '#15803d', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  submitButtonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#e5484d' },
  success: { color: '#15803d' },
  historyTitle: { marginTop: Spacing.two },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', borderRadius: Spacing.two, padding: Spacing.three, marginBottom: Spacing.two },
});
