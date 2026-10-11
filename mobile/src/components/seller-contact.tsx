import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { getPrivateContact, savePrivateContact } from '@/api/wallet';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api-client';

/** The seller's private phone/WhatsApp. Never public: used by support and for order follow-up. */
export function useSellerContact() {
  const { token } = useAuth();
  const query = useQuery({
    queryKey: ['private-contact'],
    queryFn: () => getPrivateContact(token!),
    enabled: !!token,
  });
  const hasContact = !!query.data?.phone;

  /** Returns true when a contact is on file; otherwise explains why one is needed. */
  function requireContact(): boolean {
    if (hasContact) return true;
    Alert.alert(
      'Add your contact first',
      'Before publishing, add a phone or WhatsApp number in the "Private seller contact" box. It is never shown publicly - One Dream support uses it to follow up on orders.'
    );
    return false;
  }

  return { ...query, contact: query.data ?? null, hasContact, requireContact };
}

export function SellerContactCard() {
  const theme = useTheme();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { contact, hasContact, isLoading } = useSellerContact();
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPhone(contact?.phone ?? '');
    setWhatsapp(contact?.whatsapp ?? '');
  }, [contact?.phone, contact?.whatsapp]);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      const saved = await savePrivateContact(token, { phone: phone.trim(), whatsapp: whatsapp.trim() || undefined });
      queryClient.setQueryData(['private-contact'], saved);
      setEditing(false);
    } catch (e) {
      Alert.alert('Not saved', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <ActivityIndicator color={Palette.blue} />;

  const input = [styles.input, { color: theme.text, backgroundColor: theme.background, borderColor: theme.backgroundSelected }];
  const showForm = editing || !hasContact;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: hasContact ? theme.backgroundSelected : Palette.yellow }]}>
      <View style={styles.heading}>
        <Ionicons name={hasContact ? 'shield-checkmark' : 'alert-circle'} size={18} color={hasContact ? Palette.green : Palette.yellowInk} />
        <ThemedText type="smallBold" style={styles.title}>Private seller contact</ThemedText>
        {hasContact && !editing ? (
          <Pressable onPress={() => setEditing(true)} hitSlop={8}><ThemedText type="smallBold" style={styles.link}>Edit</ThemedText></Pressable>
        ) : null}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        Never shown publicly. One Dream support uses it to follow up on your orders and payouts.{hasContact ? '' : ' Required before you publish listings.'}
      </ThemedText>
      {showForm ? (
        <>
          <TextInput placeholder="Phone number" placeholderTextColor={theme.textSecondary} value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={input} />
          <TextInput placeholder="WhatsApp (if different)" placeholderTextColor={theme.textSecondary} value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" style={input} />
          <Pressable onPress={save} disabled={saving} style={[styles.save, saving && styles.disabled]}>
            {saving ? <ActivityIndicator color={Palette.white} /> : <ThemedText type="smallBold" style={styles.saveText}>Save contact</ThemedText>}
          </Pressable>
        </>
      ) : (
        <ThemedText type="smallBold">☎ {contact?.phone}{contact?.whatsapp && contact.whatsapp !== contact.phone ? `  ·  WhatsApp ${contact.whatsapp}` : ''}</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: Spacing.three, gap: Spacing.two },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flex: 1 },
  link: { color: Palette.blue },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: 12, fontSize: 14 },
  save: { backgroundColor: Palette.blue, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  saveText: { color: Palette.white },
  disabled: { opacity: 0.6 },
});
