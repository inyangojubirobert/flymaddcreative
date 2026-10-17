import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GiftArt } from '@/components/gift-art';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';
import { getCoinWallet, getGiftCatalogue, sendGift } from '@/api/gifts';

// Send a virtual appreciation gift to a seller. Always optional. Costs come
// from the server's catalogue and are charged from coins already owned;
// a retry with the same request id never charges twice.

export default function SendGiftScreen() {
  const { username, orderId, buyerToken } = useLocalSearchParams<{ username: string; orderId?: string; buyerToken?: string }>();
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [giftId, setGiftId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const requestId = useRef(Crypto.randomUUID());

  const giftsQuery = useQuery({ queryKey: ['gift-catalogue'], queryFn: getGiftCatalogue });
  const walletQuery = useQuery({ queryKey: ['coin-wallet'], queryFn: () => getCoinWallet(token!), enabled: !!token });

  const gift = giftsQuery.data?.find((g) => g.id === giftId) ?? null;
  const balance = walletQuery.data?.balance ?? 0;
  const cost = gift ? gift.coin_cost * quantity : 0;
  const enough = !!gift && balance >= cost;

  async function submit() {
    if (!token || !gift || !username) return;
    setSending(true);
    try {
      const result = await sendGift(token, {
        recipient_username: username,
        gift_id: gift.id,
        quantity,
        client_request_id: requestId.current,
        message: message.trim() || undefined,
        anonymous,
        order_id: orderId || undefined,
        buyer_token: buyerToken || undefined,
      });
      requestId.current = Crypto.randomUUID();
      void queryClient.invalidateQueries({ queryKey: ['coin-wallet'] });
      void queryClient.invalidateQueries({ queryKey: ['recognition', username] });
      Alert.alert('Gift sent', `${gift.name} sent to @${result.recipient.username}. Thank you for supporting them!`, [{ text: 'Done', onPress: () => router.back() }]);
    } catch (error) {
      Alert.alert('Gift not sent', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  const card = { backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Send a gift' }} />
      <SafeAreaView edges={['bottom']} style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Appreciate @{username}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {orderId ? 'Thank this seller for your delivered order. ' : ''}Gifts are virtual recognition shown on the seller&apos;s profile. They are not money, votes or prize entries, and they are always optional.
          </ThemedText>

          <View style={[styles.balanceRow, card]}>
            <ThemedText type="smallBold">Your balance</ThemedText>
            {walletQuery.isLoading ? <ActivityIndicator /> : <ThemedText type="smallBold">🪙 {balance.toLocaleString()}</ThemedText>}
          </View>

          {giftsQuery.isLoading ? <ActivityIndicator style={styles.loading} /> : (
            <View style={styles.giftGrid}>
              {(giftsQuery.data ?? []).map((g) => {
                const selected = g.id === giftId;
                return (
                  <Pressable
                    key={g.id}
                    onPress={() => setGiftId(g.id)}
                    style={[styles.giftCell, card, selected && styles.giftSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <GiftArt gift={g} size={40} />
                    <ThemedText type="smallBold" numberOfLines={1}>{g.name}</ThemedText>
                    <ThemedText type="small" style={styles.cost}>🪙 {g.coin_cost.toLocaleString()}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}

          {gift ? (
            <View style={[styles.section, card]}>
              <View style={styles.quantityRow}>
                <ThemedText type="smallBold">Quantity</ThemedText>
                <View style={styles.stepper}>
                  <Pressable onPress={() => setQuantity((q) => Math.max(1, q - 1))} style={styles.stepButton}><ThemedText type="smallBold">−</ThemedText></Pressable>
                  <ThemedText type="smallBold">{quantity}</ThemedText>
                  <Pressable onPress={() => setQuantity((q) => Math.min(99, q + 1))} style={styles.stepButton}><ThemedText type="smallBold">+</ThemedText></Pressable>
                </View>
              </View>
              <TextInput
                value={message}
                onChangeText={(text) => setMessage(text.slice(0, 140))}
                placeholder="Add a short thank-you note (optional)"
                placeholderTextColor={Palette.slate}
                style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
                multiline
              />
              <View style={styles.quantityRow}>
                <ThemedText type="small">Hide my name on the seller&apos;s profile</ThemedText>
                <Switch value={anonymous} onValueChange={setAnonymous} />
              </View>
              <ThemedText type="smallBold">Total: 🪙 {cost.toLocaleString()}</ThemedText>
              {!enough ? (
                <Pressable onPress={() => router.push('/gifts' as never)}>
                  <ThemedText type="small" style={{ color: Palette.blue }}>Not enough Dream Coins - get more</ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={!enough || sending}
            style={[styles.sendButton, (!enough || sending) && styles.disabled]}
            accessibilityRole="button"
          >
            {sending ? <ActivityIndicator color={Palette.white} /> : <ThemedText style={styles.sendText}>{gift ? `Send ${gift.name}` : 'Choose a gift'}</ThemedText>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  loading: { marginTop: Spacing.four },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderRadius: 14, padding: Spacing.three },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  giftCell: { width: '30%', flexGrow: 1, alignItems: 'center', gap: 2, borderWidth: 1, borderRadius: 14, paddingVertical: Spacing.three, paddingHorizontal: Spacing.one },
  giftSelected: { borderColor: Palette.blue, borderWidth: 2 },
  cost: { color: Palette.yellowInk },
  section: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  quantityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  stepButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.ashSoft },
  input: { borderWidth: 1, borderRadius: 10, padding: Spacing.two, minHeight: 60, textAlignVertical: 'top' },
  sendButton: { backgroundColor: Palette.blue, borderRadius: 12, paddingVertical: Spacing.three, alignItems: 'center' },
  sendText: { color: Palette.white, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
