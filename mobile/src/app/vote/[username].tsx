import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Pressable, ActivityIndicator, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Clipboard from 'expo-clipboard';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getParticipantByUsername } from '@/api/participants';
import { createPaystackIntent, submitVote, verifyUsdtPayment, getExchangeRate, VOTE_VALUE_USD } from '@/api/votes';
import { loadRemoteConfig } from '@/lib/remote-config';
import { ApiError } from '@/lib/api-client';

type PaymentMethod = 'paystack' | 'usdt_bsc' | 'usdt_tron';
type Step = 'select' | 'processing' | 'usdt_pending_hash' | 'usdt_verifying' | 'success' | 'error';

const VOTE_PRESETS = [1, 5, 10, 25];

export default function BuyVotesScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { participant: buyer, token } = useAuth();
  const router = useRouter();
  const theme = useTheme();

  const [voteCount, setVoteCount] = useState(1);
  const [method, setMethod] = useState<PaymentMethod>('paystack');
  const [step, setStep] = useState<Step>('select');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState('');
  const [cryptoAddress, setCryptoAddress] = useState('');
  const [ngnRate, setNgnRate] = useState<number | null>(null);
  const [resultVotes, setResultVotes] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  const amountUsd = voteCount * VOTE_VALUE_USD;

  useEffect(() => {
    getExchangeRate().then((r) => setNgnRate(r.rate)).catch(() => {});
    if (username) {
      getParticipantByUsername(username).then((p) => setTargetId(p.id)).catch(() => setError('Could not load this profile.'));
    }
  }, [username]);

  useEffect(() => {
    if (method === 'usdt_bsc' || method === 'usdt_tron') {
      loadRemoteConfig().then((cfg) => {
        setCryptoAddress(method === 'usdt_bsc' ? cfg.crypto.addresses.bsc : cfg.crypto.addresses.tron);
      });
    }
  }, [method]);

  const amountNgnLabel = useMemo(
    () => (ngnRate ? `≈ ₦${Math.round(amountUsd * ngnRate).toLocaleString()}` : null),
    [amountUsd, ngnRate]
  );

  async function payWithPaystack() {
    if (!buyer || !token || !targetId) return;
    setStep('processing');
    setError(null);
    try {
      const redirectUrl = Linking.createURL('paystack-callback');
      const intent = await createPaystackIntent({
        participant_id: buyer.id,
        vote_count: voteCount,
        callback_url: redirectUrl,
      });

      const result = await WebBrowser.openAuthSessionAsync(intent.authorization_url, redirectUrl);

      if (result.type !== 'success' || !result.url) {
        setStep('select');
        setError(result.type === 'cancel' || result.type === 'dismiss' ? 'Payment was cancelled.' : null);
        return;
      }

      const returnedUrl = new URL(result.url);
      const reference = returnedUrl.searchParams.get('reference') || returnedUrl.searchParams.get('trxref') || intent.reference;

      const voteResult = await submitVote({
        token,
        participant_id: buyer.id,
        vote_count: voteCount,
        payment_amount: amountUsd,
        payment_method: 'paystack',
        payment_intent_id: reference,
      });

      setResultVotes(voteResult.votes_recorded);
      setStep('success');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Payment failed. Please try again.');
      setStep('error');
    }
  }

  async function verifyAndCreditUsdt() {
    if (!buyer || !token || !txHash.trim()) return;
    setStep('usdt_verifying');
    setError(null);
    try {
      const network = method === 'usdt_bsc' ? 'bsc' : 'tron';
      const result = await verifyUsdtPayment({
        token: token!,
        tx_hash: txHash.trim(),
        network,
        expected_amount: amountUsd,
      });

      if (!result.success) {
        if (result.pending) {
          setError(`Transaction found but only has ${result.confirmations ?? 0}/${result.required ?? '?'} confirmations. Wait a bit and try again.`);
        } else {
          setError(result.error || 'Verification failed.');
        }
        setStep('usdt_pending_hash');
        return;
      }

      const voteResult = await submitVote({
        token: token!,
        participant_id: buyer.id,
        vote_count: result.payment.vote_count,
        payment_amount: result.payment.amount,
        payment_method: 'crypto',
        payment_intent_id: txHash.trim(),
        network,
      });

      setResultVotes(voteResult.votes_recorded);
      setStep('success');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification failed. Please try again.');
      setStep('usdt_pending_hash');
    }
  }

  async function copyAddress() {
    await Clipboard.setStringAsync(cryptoAddress);
  }

  const isProcessing = step === 'processing' || step === 'usdt_verifying';

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: `Vote for @${username}`, presentation: 'modal' }} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {step === 'success' ? (
            <ThemedView style={styles.centered}>
              <ThemedText type="title" style={styles.successTitle}>✅ Thank you!</ThemedText>
              <ThemedText type="default" style={styles.centeredText}>
                {resultVotes} vote{resultVotes === 1 ? '' : 's'} recorded for @{username}.
              </ThemedText>
              <Pressable onPress={() => router.back()} style={styles.primaryButton}>
                <ThemedText style={styles.primaryButtonText}>Done</ThemedText>
              </Pressable>
            </ThemedView>
          ) : (
            <>
              <ThemedText type="title" style={styles.title}>Buy Votes</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">$2 per vote, for @{username}</ThemedText>

              <ThemedView style={styles.presetRow}>
                {VOTE_PRESETS.map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setVoteCount(n)}
                    style={[
                      styles.presetButton,
                      { backgroundColor: voteCount === n ? '#1D4ED8' : theme.backgroundElement },
                    ]}
                  >
                    <ThemedText style={voteCount === n ? styles.presetTextActive : undefined}>{n}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              <ThemedView type="backgroundElement" style={styles.amountCard}>
                <ThemedText type="smallBold">${amountUsd.toFixed(2)} USD</ThemedText>
                {amountNgnLabel && <ThemedText type="small" themeColor="textSecondary">{amountNgnLabel}</ThemedText>}
              </ThemedView>

              <ThemedText type="smallBold" style={styles.sectionLabel}>Payment method</ThemedText>
              <ThemedView style={styles.methodRow}>
                {(['paystack', 'usdt_bsc', 'usdt_tron'] as PaymentMethod[]).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => { setMethod(m); setStep('select'); setError(null); }}
                    style={[
                      styles.methodButton,
                      { backgroundColor: method === m ? '#1D4ED8' : theme.backgroundElement },
                    ]}
                  >
                    <ThemedText style={method === m ? styles.presetTextActive : undefined}>
                      {m === 'paystack' ? 'Paystack (NGN)' : m === 'usdt_bsc' ? 'USDT (BSC)' : 'USDT (Tron)'}
                    </ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              {error && <ThemedText style={styles.error}>{error}</ThemedText>}

              {method === 'paystack' ? (
                <Pressable onPress={payWithPaystack} disabled={isProcessing || !targetId} style={[styles.primaryButton, { opacity: isProcessing ? 0.6 : 1 }]}>
                  {isProcessing ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryButtonText}>Pay with Paystack</ThemedText>}
                </Pressable>
              ) : (
                <ThemedView style={styles.usdtSection}>
                  <ThemedText type="small">Send exactly ${amountUsd.toFixed(2)} in USDT to:</ThemedText>
                  <Pressable onPress={copyAddress} style={[styles.addressBox, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText type="code" style={styles.addressText}>{cryptoAddress || 'Loading address…'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">Tap to copy</ThemedText>
                  </Pressable>

                  <TextInput
                    placeholder="Paste your transaction hash"
                    placeholderTextColor={theme.textSecondary}
                    value={txHash}
                    onChangeText={setTxHash}
                    autoCapitalize="none"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />

                  <Pressable
                    onPress={verifyAndCreditUsdt}
                    disabled={isProcessing || !txHash.trim()}
                    style={[styles.primaryButton, { opacity: isProcessing || !txHash.trim() ? 0.6 : 1 }]}
                  >
                    {isProcessing ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryButtonText}>Verify Payment</ThemedText>}
                  </Pressable>
                </ThemedView>
              )}
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
  scrollContent: { paddingBottom: Spacing.four, gap: Spacing.three },
  title: { fontSize: 22, marginTop: Spacing.two },
  presetRow: { flexDirection: 'row', gap: Spacing.two },
  presetButton: { flex: 1, paddingVertical: Spacing.three, borderRadius: Spacing.two, alignItems: 'center' },
  presetTextActive: { color: '#fff', fontWeight: '600' },
  amountCard: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.half },
  sectionLabel: { marginTop: Spacing.two },
  methodRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  methodButton: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Spacing.two },
  usdtSection: { gap: Spacing.two },
  addressBox: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.half },
  addressText: { fontSize: 13 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 14 },
  primaryButton: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#e5484d', textAlign: 'center' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingTop: Spacing.six },
  centeredText: { textAlign: 'center' },
  successTitle: { fontSize: 24 },
});
