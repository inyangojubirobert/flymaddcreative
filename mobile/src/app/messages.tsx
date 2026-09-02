import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View, Image, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { useCloudinaryUpload } from '@/hooks/useCloudinaryUpload';
import { getSupportMessages, sendSupportMessage, type SupportMessage } from '@/api/messages';
import { ApiError } from '@/lib/api-client';

export default function MessagesScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInput | null>(null);
  const [body, setBody] = useState('');
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const { uploadToCloudinary } = useCloudinaryUpload();

  const messagesQuery = useQuery({
    queryKey: ['support-messages'],
    queryFn: () => getSupportMessages(token!),
    enabled: !!token,
  });

  async function handlePickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });

    if (!result.canceled && result.assets?.[0]?.uri) {
      setSelectedImageUri(result.assets[0].uri);
    }
  }

  async function handleSend() {
    const message = body.trim();
    if (!message && !selectedImageUri) return;
    setError(null);
    setIsSending(true);
    try {
      let finalBody = message;
      if (selectedImageUri) {
        // Upload first: a local device file:// path is meaningless once the
        // message reaches the website or another device, so it must become a
        // real hosted URL before the message is sent.
        const uploaded = await uploadToCloudinary(selectedImageUri);
        if (!uploaded?.secure_url) {
          throw new Error('Could not upload the screenshot. Please try again.');
        }
        finalBody = `${message ? `${message}\n\n` : ''}[Payment screenshot]\n${uploaded.secure_url}`;
      }
      await sendSupportMessage(token!, finalBody);
      setBody('');
      setSelectedImageUri(null);
      await queryClient.invalidateQueries({ queryKey: ['support-messages'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not send your message.');
    } finally {
      setIsSending(false);
    }
  }

  const dismissKeyboard = () => {
    Keyboard.dismiss();
    inputRef.current?.blur();
  };

  return (
    <TouchableWithoutFeedback onPress={dismissKeyboard} accessible={false}>
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          <KeyboardAvoidingView
            style={styles.keyboardContainer}
            behavior="padding"
            keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}
          >
            <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
              Ask about a withdrawal or view payout updates from the administration team.
            </ThemedText>

            {messagesQuery.isLoading ? (
              <ActivityIndicator size="large" style={styles.loading} />
            ) : (
              <FlatList
                data={messagesQuery.data || []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={[styles.messageList, { paddingBottom: 170 }]}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.empty}>No messages yet.</ThemedText>}
                renderItem={({ item }) => <MessageRow item={item} theme={theme} />}
              />
            )}

            <Pressable onPress={dismissKeyboard} style={[styles.composer, { borderTopColor: theme.backgroundElement, backgroundColor: theme.background }]}>
              {error && <ThemedText style={styles.error}>{error}</ThemedText>}

              {selectedImageUri ? (
                <View style={styles.imagePreviewWrap}>
                  <Image source={{ uri: selectedImageUri }} style={styles.imagePreview} />
                  <Pressable onPress={() => setSelectedImageUri(null)} style={styles.removeImageButton}>
                    <ThemedText style={styles.removeImageText}>Remove</ThemedText>
                  </Pressable>
                </View>
              ) : null}

              <TextInput
                ref={inputRef}
                placeholder="Write a message…"
                placeholderTextColor={theme.textSecondary}
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={2000}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />

              <View style={styles.actionRow}>
                <Pressable onPress={handlePickImage} style={styles.attachButton}>
                  <ThemedText style={styles.attachButtonText}>Attach image</ThemedText>
                </Pressable>
                <Pressable onPress={handleSend} disabled={isSending || (!body.trim() && !selectedImageUri)} style={[styles.button, { opacity: isSending || (!body.trim() && !selectedImageUri) ? 0.55 : 1 }]}>
                  {isSending ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>Send</ThemedText>}
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ThemedView>
    </TouchableWithoutFeedback>
  );
}

function extractImageUri(body: string) {
  const match = body.match(/(https?:\/\/[^\s]+|data:image\/[^\s]+)/i);
  return match ? match[1] : null;
}

function MessageRow({ item, theme }: { item: SupportMessage; theme: { backgroundElement: string } }) {
  const fromParticipant = item.sender_type === 'participant';
  const sender = fromParticipant ? 'You' : item.sender_type === 'system' ? 'Payout update' : 'Support';
  const date = new Date(item.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const imageUri = extractImageUri(item.body);
  const textBody = imageUri ? item.body.replace(imageUri, '').trim() : item.body;

  return (
    <ThemedView style={[styles.messageCard, { backgroundColor: fromParticipant ? theme.backgroundElement : '#14532d' }]}>
      <View style={styles.messageMeta}>
        <ThemedText type="smallBold">{sender}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{date}</ThemedText>
      </View>
      {imageUri ? <Image source={{ uri: imageUri }} style={styles.messageImage} /> : null}
      {textBody ? <ThemedText type="small" style={styles.messageBody}>{textBody}</ThemedText> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardContainer: { flex: 1 },
  intro: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.one },
  loading: { marginTop: Spacing.six },
  messageList: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  messageCard: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  messageMeta: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  messageImage: { width: '100%', height: 220, borderRadius: Spacing.two, marginTop: Spacing.one },
  messageBody: { lineHeight: 20 },
  composer: {
    borderTopWidth: 1,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Platform.OS === 'ios' ? Spacing.four : Spacing.three,
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  imagePreviewWrap: { position: 'relative', alignSelf: 'flex-start', marginBottom: Spacing.one },
  imagePreview: { width: 120, height: 120, borderRadius: Spacing.two },
  removeImageButton: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  removeImageText: { color: '#fff', fontSize: 10 },
  input: { minHeight: 58, maxHeight: 120, borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, textAlignVertical: 'top', fontSize: 15 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  attachButton: { flex: 1, backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, alignItems: 'center' },
  attachButtonText: { color: '#fff', fontWeight: '600' },
  button: { alignSelf: 'flex-end', backgroundColor: '#15803d', borderRadius: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, minWidth: 80, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#e5484d' },
});
