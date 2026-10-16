import { useState } from 'react';
import { StyleSheet, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useMerchantAuth } from '@/contexts/MerchantAuthContext';
import { ApiError } from '@/lib/api-client';
import { PasswordInput } from '@/components/password-input';
import { ExternalLink } from '@/components/external-link';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function MerchantRegisterScreen() {
  const theme = useTheme();
  const { register } = useMerchantAuth();
  const [merchantName, setMerchantName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (isSubmitting) return;
    if (!merchantName.trim() || !email.trim() || !password) {
      setError('Name, email, and password are required.');
      return;
    }
    if (!EMAIL_REGEX.test(email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      // On success the session is stored and the merchant layout's
      // Stack.Protected guard flips straight to the dashboard.
      await register({ merchant_name: merchantName.trim(), email: email.trim().toLowerCase(), company_name: companyName.trim() || undefined, password });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Registration failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const inputStyle = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={styles.form}>
            <ThemedText type="title" style={styles.title}>Become a Merchant</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              Earn tokens for every confirmed vote from participants you refer.
            </ThemedText>

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}

            <TextInput placeholder="Merchant / your name" placeholderTextColor={theme.textSecondary} value={merchantName} onChangeText={setMerchantName} style={inputStyle} />
            <TextInput placeholder="Email" placeholderTextColor={theme.textSecondary} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} autoComplete="email" style={inputStyle} />
            <TextInput placeholder="Company name (optional)" placeholderTextColor={theme.textSecondary} value={companyName} onChangeText={setCompanyName} style={inputStyle} />
            <PasswordInput placeholder="Password (min 8 characters)" value={password} onChangeText={setPassword} />
            <PasswordInput placeholder="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} onSubmitEditing={handleSubmit} />

            <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
              By creating an account you agree to the{' '}
              <ExternalLink href="https://www.flymaddcreative.online/merchant-program.html"><ThemedText type="small" style={styles.inlineLink}>Merchant Program Rules</ThemedText></ExternalLink>
              {' '}and{' '}
              <ExternalLink href="https://www.flymaddcreative.online/privacy-policy.html"><ThemedText type="small" style={styles.inlineLink}>Privacy Policy</ThemedText></ExternalLink>.
            </ThemedText>

            <Pressable onPress={handleSubmit} disabled={isSubmitting} style={[styles.button, { opacity: isSubmitting ? 0.6 : 1 }]}>
              {isSubmitting ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Create Merchant Account</ThemedText>}
            </Pressable>

            <Link href="/merchant/login" style={styles.link}>
              <ThemedText type="link" themeColor="textSecondary">Already a merchant? Log in</ThemedText>
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
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 16 },
  button: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.one },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  link: { alignSelf: 'center', marginTop: Spacing.three },
  error: { textAlign: 'center', color: '#e5484d' },
  inlineLink: { color: '#1D4ED8', textDecorationLine: 'underline' },
});
