import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { Palette } from '@/constants/theme';
import { useCart } from '@/contexts/CartContext';

/** Height the floating cart occupies - add to scroll padding so it never hides the last row. */
export const FLOATING_CART_SPACE = 96;

/**
 * Lemon-green cart tab anchored to the right screen edge: rounded on the
 * left, flush against the right. Shows item count and running total; opens
 * the checkout page.
 */
export function FloatingCart() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { count, subtotalUsd } = useCart();
  const bump = useRef(new Animated.Value(1)).current;
  const previousCount = useRef(count);

  useEffect(() => {
    if (count === previousCount.current) return;
    previousCount.current = count;
    Animated.sequence([
      Animated.timing(bump, { toValue: 1.08, duration: 120, useNativeDriver: true }),
      Animated.spring(bump, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [count, bump]);

  const total = `$${subtotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Animated.View pointerEvents="box-none" style={[styles.anchor, { bottom: insets.bottom + 20, transform: [{ scale: bump }] }]}>
      <Pressable
        onPress={() => router.push('/shop/cart' as never)}
        accessibilityRole="button"
        accessibilityLabel={`Cart, ${count} item${count === 1 ? '' : 's'}, ${total}. Open checkout`}
        style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="cart" size={24} color={Palette.lemonInk} />
          {count > 0 ? (
            <View style={styles.badge}>
              <ThemedText style={styles.badgeText}>{count > 99 ? '99+' : count}</ThemedText>
            </View>
          ) : null}
        </View>
        <View style={styles.copy}>
          <ThemedText style={styles.caption}>{count ? `${count} item${count === 1 ? '' : 's'}` : 'Cart empty'}</ThemedText>
          <ThemedText style={styles.total}>{total}</ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={Palette.lemonInk} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', right: 0 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingLeft: 18,
    paddingRight: 14,
    paddingVertical: 10,
    backgroundColor: Palette.lemon,
    borderTopLeftRadius: 32,
    borderBottomLeftRadius: 32,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    elevation: 12,
    shadowColor: '#1A2E05',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: -2, height: 4 },
  },
  pressed: { opacity: 0.9 },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: Palette.lemonInk, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: Palette.lemon, fontSize: 11, lineHeight: 14, fontWeight: '800' },
  copy: { gap: 0 },
  caption: { color: Palette.lemonInk, fontSize: 12, lineHeight: 15, fontWeight: '600' },
  total: { color: Palette.lemonInk, fontSize: 19, lineHeight: 23, fontWeight: '800' },
});
