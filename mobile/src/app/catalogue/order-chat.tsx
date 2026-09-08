import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  Keyboard,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { useCloudinaryUpload } from '@/hooks/useCloudinaryUpload';
import { getOrderMessages, sendOrderMessage, deleteOrderMessage, type OrderMessage } from '@/api/order-messages';
import { ApiError } from '@/lib/api-client';

export default function OrderChatScreen() {
  const { orderId, buyerToken, title } = useLocalSearchParams<{ orderId: string; buyerToken?: string; title?: string }>();
  const { token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const inputRef = useRef<TextInput | null>(null);
  const listRef = useRef<FlatList<OrderMessage> | null>(null);
  const [body, setBody] = useState('');
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const { uploadToCloudinary } = useCloudinaryUpload();

  useEffect(() => {
    const keyboardEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(keyboardEvent, () => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return () => subscription.remove();
  }, []);

  // A buyer_token means "I'm the buyer" - takes priority even if also logged
  // in as a participant, since the participant branch on the server only
  // authorizes the seller (see pages/api/catalogue/order-messages.js).
  const auth = buyerToken ? { buyer_token: buyerToken } : { token: token || undefined };
  const role: 'buyer' | 'seller' = buyerToken ? 'buyer' : 'seller';

  const messagesQuery = useQuery({
    queryKey: ['order-messages', orderId],
    queryFn: () => getOrderMessages(orderId, auth),
    enabled: !!orderId,
  });

  async function handlePickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true });
    if (!result.canceled && result.assets?.[0]?.uri) setSelectedImageUri(result.assets[0].uri);
  }

  async function handleSend() {
    const message = body.trim();
    if (!message && !selectedImageUri) return;
    setError(null);
    setIsSending(true);
    try {
      let mediaUrl: string | undefined;
      if (selectedImageUri) {
        const uploaded = await uploadToCloudinary(selectedImageUri);
        if (!uploaded?.secure_url) throw new Error('Could not upload the image. Please try again.');
        mediaUrl = uploaded.secure_url;
      }
      await sendOrderMessage(orderId, auth, message, mediaUrl);
      setBody('');
      setSelectedImageUri(null);
      await queryClient.invalidateQueries({ queryKey: ['order-messages', orderId] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not send your message.');
    } finally {
      setIsSending(false);
    }
  }

  function handleDelete(id: string) {
    Alert.alert('Delete message', 'This message and any attached image will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOrderMessage(orderId, id, auth);
            await queryClient.invalidateQueries({ queryKey: ['order-messages', orderId] });
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not delete the message.');
          }
        },
      },
    ]);
  }

  const dismissKeyboard = () => {
    Keyboard.dismiss();
    inputRef.current?.blur();
  };

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: title ? `Chat · ${title}` : 'Order Chat' }} />
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboardContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}
        >
            <View style={styles.contextCard}>
              <View style={styles.contextIcon}>
                <Ionicons name="bag-handle" size={21} color={Palette.yellowInk} />
              </View>
              <View style={styles.contextCopy}>
                <ThemedText type="smallBold" style={styles.contextTitle}>{role === 'seller' ? 'Buyer conversation' : 'Seller conversation'}</ThemedText>
                <ThemedText type="small" style={styles.contextText}>Messages and delivery updates for this order.</ThemedText>
              </View>
            </View>
            {messagesQuery.isLoading ? (
              <ActivityIndicator size="large" style={styles.loading} />
            ) : (
              <FlatList
                ref={listRef}
                style={styles.messageListFlex}
                data={messagesQuery.data || []}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.messageList}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                nestedScrollEnabled
                scrollEnabled
                overScrollMode="always"
                showsVerticalScrollIndicator
                automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
                onScrollBeginDrag={dismissKeyboard}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
                ListEmptyComponent={<ThemedText type="small" themeColor="textSecondary" style={styles.empty}>No messages yet.</ThemedText>}
                renderItem={({ item }) => (
                  <OrderMessageRow item={item} isOwn={item.sender_role === role} onDelete={item.sender_role === role ? () => handleDelete(item.id) : undefined} />
                )}
              />
            )}

            <View style={[styles.composer, { borderTopColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}> 
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
                placeholder={role === 'seller' ? 'Message the buyer about delivery…' : 'Ask about delivery, shipping, or anything else…'}
                placeholderTextColor={theme.textSecondary}
                value={body}
                onChangeText={setBody}
                multiline
                maxLength={2000}
                onFocus={() => requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }))}
                onContentSizeChange={() => requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }))}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />

              <View style={styles.actionRow}>
                <Pressable onPress={handlePickImage} style={styles.attachButton}>
                  <Ionicons name="image-outline" size={18} color={Palette.blue} />
                  <ThemedText style={styles.attachButtonText}>Image</ThemedText>
                </Pressable>
                <Pressable onPress={handleSend} disabled={isSending || (!body.trim() && !selectedImageUri)} style={[styles.button, { opacity: isSending || (!body.trim() && !selectedImageUri) ? 0.55 : 1 }]}> 
                  {isSending ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={16} color="#fff" /><ThemedText style={styles.buttonText}>Send</ThemedText></>}
                </Pressable>
              </View>
            </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function OrderMessageRow({ item, isOwn, onDelete }: { item: OrderMessage; isOwn: boolean; onDelete?: () => void }) {
  const isSeller = item.sender_role === 'seller';
  const sender = isSeller ? 'Seller' : 'Buyer';
  const date = new Date(item.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const bubbleColor = isOwn ? Palette.blue : Palette.ashSoft;
  const textColor = isOwn ? Palette.white : Palette.slateDark;
  const metaColor = isOwn ? '#DBEAFE' : Palette.slate;

  return (
    <ThemedView style={[styles.messageCard, isOwn ? styles.messageSent : styles.messageReceived, { backgroundColor: bubbleColor }]}> 
      <View style={styles.messageMeta}>
        <View style={styles.senderWrap}>
          <Ionicons name={isSeller ? 'storefront' : 'person'} size={14} color={textColor} />
          <ThemedText type="smallBold" style={{ color: textColor }}>{isOwn ? `You · ${sender}` : sender}</ThemedText>
        </View>
        <View style={styles.messageMetaRight}>
          <ThemedText type="small" style={[styles.messageDate, { color: metaColor }]}>{date}</ThemedText>
          {onDelete ? (
            <Pressable onPress={onDelete} hitSlop={8} style={styles.deleteButton}>
              <ThemedText style={[styles.deleteButtonText, { color: isOwn ? '#FECACA' : Palette.red }]}>Delete</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>
      {item.media_url ? <Image source={{ uri: item.media_url }} style={styles.messageImage} /> : null}
      {item.body ? <ThemedText type="small" style={[styles.messageBody, { color: textColor }]}>{item.body}</ThemedText> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardContainer: { flex: 1 },
  contextCard: { marginHorizontal: Spacing.three, marginTop: Spacing.two, marginBottom: Spacing.one, padding: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Palette.yellowSoft, borderWidth: 1, borderColor: '#FDE68A' },
  contextIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: Palette.white, alignItems: 'center', justifyContent: 'center' },
  contextCopy: { flex: 1 },
  contextTitle: { color: Palette.yellowInk },
  contextText: { color: Palette.slate, lineHeight: 18 },
  loading: { marginTop: Spacing.six },
  messageListFlex: { flex: 1 },
  messageList: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: Spacing.two, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  messageCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 5,
    maxWidth: '88%',
  },
  messageSent: { alignSelf: 'flex-end', borderBottomRightRadius: 5 },
  messageReceived: { alignSelf: 'flex-start', borderBottomLeftRadius: 5 },
  messageMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  senderWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  messageMetaRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  messageDate: { fontSize: 11, lineHeight: 15 },
  deleteButton: { paddingHorizontal: 6, paddingVertical: 2 },
  deleteButtonText: { color: '#e5484d', fontSize: 12, fontWeight: '600' },
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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  imagePreviewWrap: { position: 'relative', alignSelf: 'flex-start', marginBottom: Spacing.one },
  imagePreview: { width: 120, height: 120, borderRadius: Spacing.two },
  removeImageButton: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  removeImageText: { color: '#fff', fontSize: 10 },
  input: { minHeight: 56, maxHeight: 120, borderRadius: 16, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, textAlignVertical: 'top', fontSize: 15, borderWidth: 1, borderColor: Palette.ash },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.two },
  attachButton: { flex: 1, backgroundColor: Palette.blueSoft, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  attachButtonText: { color: Palette.blueDark, fontWeight: '700' },
  button: { flex: 1, backgroundColor: Palette.blue, borderRadius: 12, paddingHorizontal: Spacing.four, paddingVertical: 10, minWidth: 80, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#e5484d' },
});
