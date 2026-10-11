import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PasswordInput } from '@/components/password-input';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiFetch } from '@/lib/api-client';
import { isPushSupportedInThisClient, loadPushNotifications } from '@/lib/push-notifications';

const ADMIN_TOKEN_KEY = 'admin_alert_token';
const ADMIN_INBOX_URL = 'https://www.flymaddcreative.online/admin-portal.html';

function expoProjectId() {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId || Constants.easConfig?.projectId || '';
}

async function readAdminToken() {
  try {
    return await SecureStore.getItemAsync(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export default function AdminAlertsScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('Sign in with your admin account to receive support alerts on this phone.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const notifications = loadPushNotifications();
    if (!notifications) return;
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }, []);

  async function registerDevice(adminToken: string) {
    if (!isPushSupportedInThisClient()) {
      throw new Error('Phone alerts need the installed One Dream Android app. Expo Go cannot receive them.');
    }
    const notifications = loadPushNotifications();
    if (!notifications) {
      throw new Error('This installed build does not include phone alerts yet. Open this screen from an updated app build.');
    }
    if (!Device.isDevice) throw new Error('Phone alerts need a physical device.');

    const { status: permission } = await notifications.requestPermissionsAsync();
    if (permission !== 'granted') throw new Error('Allow notifications for One Dream to receive support alerts.');

    if (Platform.OS === 'android') {
      await notifications.setNotificationChannelAsync('admin-support', {
        name: 'Support messages',
        importance: notifications.AndroidImportance.MAX,
        sound: 'default',
      });
    }

    const projectId = expoProjectId();
    if (!projectId) {
      throw new Error('This app is not linked to an Expo project yet, so the phone cannot register for alerts.');
    }
    const tokenResult = await notifications.getExpoPushTokenAsync({ projectId });
    const expoPushToken = tokenResult.data;
    await apiFetch('/api/admin/push-devices', {
      method: 'POST',
      token: adminToken,
      body: {
        expo_push_token: expoPushToken,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        device_name: Device.deviceName || Device.modelName || '',
      },
    });
    await SecureStore.setItemAsync(ADMIN_TOKEN_KEY, adminToken);
    setEnabled(true);
    setStatus('This phone will alert you when someone messages support, even if the admin website is closed.');
  }

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const existing = await readAdminToken();
      if (existing) {
        try {
          await registerDevice(existing);
          return;
        } catch (caught) {
          if (!(caught instanceof ApiError) || caught.status !== 401) throw caught;
          await SecureStore.deleteItemAsync(ADMIN_TOKEN_KEY);
        }
      }
      if (!email.trim() || !password) {
        setError('Enter the admin email and password.');
        return;
      }
      const login = await apiFetch<{ token: string }>('/api/admin/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      setPassword('');
      await registerDevice(login.token);
    } catch (caught) {
      setEnabled(false);
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : 'Could not turn on alerts.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    setBusy(true);
    setError(null);
    try {
      const adminToken = await readAdminToken();
      const notifications = loadPushNotifications();
      const projectId = expoProjectId();
      if (adminToken && notifications && projectId) {
        const tokenResult = await notifications.getExpoPushTokenAsync({ projectId });
        await apiFetch('/api/admin/push-devices', {
          method: 'DELETE',
          token: adminToken,
          body: { expo_push_token: tokenResult.data },
        });
      }
      await SecureStore.deleteItemAsync(ADMIN_TOKEN_KEY);
      setEnabled(false);
      setStatus('Alerts are off on this phone.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not turn off alerts.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: true, title: 'Admin alerts' }} />
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Support alerts</ThemedText>
        <ThemedText themeColor="textSecondary">{status}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">The alert names the sender. It does not include the message.</ThemedText>

        {!enabled ? (
          <View style={styles.form}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Admin email"
              placeholderTextColor={theme.textSecondary}
              style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <PasswordInput value={password} onChangeText={setPassword} placeholder="Password" />
          </View>
        ) : null}

        {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

        <Pressable onPress={enabled ? handleDisable : handleEnable} disabled={busy} style={styles.button}>
          {busy ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>{enabled ? 'Turn off alerts' : 'Turn on alerts'}</ThemedText>}
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(ADMIN_INBOX_URL)} style={styles.linkButton}>
          <ThemedText type="smallBold" style={styles.linkText}>Open admin inbox</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  form: { gap: Spacing.two },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  button: { minHeight: 50, borderRadius: 14, backgroundColor: Palette.blue, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  linkButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: Palette.blue },
  error: { color: '#b91c1c' },
});
