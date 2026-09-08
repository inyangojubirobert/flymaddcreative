import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api-client';
import { PasswordInput } from '@/components/password-input';

export default function LoginScreen() {
  const theme = useTheme();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      // RootNavigator swaps to (tabs) automatically once `token` is set.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={styles.form}>
          <ThemedText type="title" style={styles.title}>One Dream Initiative</ThemedText>
          <ThemedText type="subtitle" style={styles.subtitle}>Log in</ThemedText>

          {error && <ThemedText style={[styles.error, { color: '#e5484d' }]}>{error}</ThemedText>}

          <TextInput
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <PasswordInput
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
          />

          <Pressable
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={[styles.button, { opacity: isSubmitting ? 0.6 : 1 }]}
          >
            {isSubmitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Log In</ThemedText>}
          </Pressable>

          <Link href="/(auth)/register" style={styles.link}>
            <ThemedText type="link" themeColor="textSecondary">Don&apos;t have an account? Register</ThemedText>
          </Link>
          <Link href="/merchant/login" style={styles.link}>
            <ThemedText type="link" themeColor="textSecondary">Are you a merchant? Merchant login</ThemedText>
          </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Spacing.four, paddingVertical: Spacing.four },
  form: { gap: Spacing.three },
  title: { fontSize: 24, textAlign: 'center', marginBottom: Spacing.one },
  subtitle: { textAlign: 'center', marginBottom: Spacing.three },
  input: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#1D4ED8',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  link: { alignSelf: 'center', marginTop: Spacing.three },
  error: { textAlign: 'center' },
});
