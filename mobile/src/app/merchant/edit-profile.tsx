import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMerchantAuth } from '@/contexts/MerchantAuthContext';
import { updateMerchantProfile } from '@/api/merchants';
import { ApiError } from '@/lib/api-client';

export default function MerchantEditProfileScreen() {
  const { merchant, token } = useMerchantAuth();
  const theme = useTheme();
  const router = useRouter();

  const [merchantName, setMerchantName] = useState(merchant?.merchant_name ?? '');
  const [companyName, setCompanyName] = useState(merchant?.company_name ?? '');
  const [walletAddress, setWalletAddress] = useState(merchant?.wallet_address ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    if (!token || !merchant) return;
    setError(null);
    setIsSaving(true);
    try {
      await updateMerchantProfile(token, merchant.id, {
        merchant_name: merchantName.trim(),
        company_name: companyName.trim(),
        wallet_address: walletAddress.trim(),
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed.');
    } finally {
      setIsSaving(false);
    }
  }

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedText type="smallBold">Merchant name</ThemedText>
          <TextInput value={merchantName} onChangeText={setMerchantName} style={inputStyle} />

          <ThemedText type="smallBold">Company name</ThemedText>
          <TextInput value={companyName} onChangeText={setCompanyName} style={inputStyle} />

          <ThemedText type="smallBold">Payout wallet address</ThemedText>
          <TextInput value={walletAddress} onChangeText={setWalletAddress} autoCapitalize="none" style={inputStyle} />
          <ThemedText type="small" themeColor="textSecondary">Withdrawals are sent to this address - double-check it.</ThemedText>

          <Pressable onPress={handleSave} disabled={isSaving} style={[styles.button, { opacity: isSaving ? 0.6 : 1 }]}>
            {isSaving ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Save</ThemedText>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingTop: Spacing.three, gap: Spacing.two },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16, marginBottom: Spacing.two },
  button: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.three },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#e5484d' },
});
