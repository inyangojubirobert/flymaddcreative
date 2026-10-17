import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';

/** Gift artwork: the admin-uploaded image, or the emoji fallback. */
export function GiftArt({ gift, size = 40 }: { gift: { image_url?: string | null; emoji?: string | null }; size?: number }) {
  if (gift.image_url) return <Image source={{ uri: gift.image_url }} style={{ width: size, height: size, borderRadius: size / 4 }} />;
  return <ThemedText style={{ fontSize: size * 0.75, lineHeight: size }}>{gift.emoji || '🎁'}</ThemedText>;
}

/**
 * Optional thank-you after a delivered marketplace order. Purely an invitation:
 * delivery, reviews, support and refunds never depend on it. Shown only to a
 * signed-in buyer once the order is confirmed (or funds released).
 */
export function AppreciationPrompt({ order, sellerUsername }: {
  order: { id: string; status: string; buyer_token?: string | null };
  sellerUsername: string | null | undefined;
}) {
  const { token, participant } = useAuth();
  const router = useRouter();
  if (!token || !sellerUsername || !order.buyer_token || !['buyer_confirmed', 'released'].includes(order.status)) return null;
  if (participant?.username?.toLowerCase() === sellerUsername.toLowerCase()) return null;

  return (
    <View style={styles.box}>
      <ThemedText type="small" style={styles.text}>Enjoyed your purchase? Show your appreciation to this seller with a virtual gift.</ThemedText>
      <Pressable
        onPress={() => router.push({ pathname: '/gifts/send', params: { username: sellerUsername, orderId: order.id, buyerToken: order.buyer_token } } as never)}
        style={styles.button}
        accessibilityRole="button"
      >
        <Ionicons name="gift" size={15} color={Palette.yellowInk} />
        <ThemedText type="smallBold" style={styles.buttonText}>Send a thank-you gift</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, backgroundColor: Palette.yellowSoft, padding: Spacing.two, gap: Spacing.two },
  text: { color: Palette.yellowInk },
  button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Palette.white },
  buttonText: { color: Palette.yellowInk },
});
