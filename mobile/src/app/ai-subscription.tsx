import type { ComponentType } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';

// Google Play billing uses a native module that Expo Go does not include.
// Load it only in an Android build, so opening the app in Expo Go still works.
const playBillingAvailable = Platform.OS === 'android'
  && Constants.executionEnvironment !== 'storeClient'
  && Constants.appOwnership !== 'expo';

export default function AiSubscriptionRoute() {
  if (!playBillingAvailable) return <BillingUnavailable />;
  const Screen = require('@/components/ai-subscription-billing').default as ComponentType;
  return <Screen />;
}

function BillingUnavailable() {
  const router = useRouter();
  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Bascardo AI' }} />
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.card}>
          <Ionicons name="card" size={28} color={Palette.blue} />
          <ThemedText type="subtitle">Subscriptions open in the installed app</ThemedText>
          <ThemedText themeColor="textSecondary">
            Google Play billing is part of the One Dream Android build. Expo Go does not include that purchase module, so this screen stays available there without stopping the rest of the app.
          </ThemedText>
        </ThemedView>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={18} color={Palette.blueDark} />
          <ThemedText style={styles.backButtonText}>Go back</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: 18, padding: Spacing.three, gap: Spacing.two, backgroundColor: Palette.blueSoft },
  backButton: { minHeight: 50, borderRadius: 15, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: Palette.blueSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  backButtonText: { color: Palette.blueDark, fontWeight: '700' },
});
