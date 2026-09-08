import { useState } from 'react';
import { FlatList, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert, Modal, ScrollView, Switch, Image, View, KeyboardAvoidingView, Platform, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import { getCatalogueByUsername, createItem, updateItem, deleteItem, uploadCatalogueMedia, type CatalogueItem } from '@/api/catalogue';
import { ApiError } from '@/lib/api-client';

type Draft = {
  id?: string;
  title: string;
  description: string;
  size: string;
  price_usd: string;
  status: 'active' | 'paused';
  images: string[];
  imageUrl: string;
  promo_video_url: string;
};

const EMPTY_DRAFT: Draft = { title: '', description: '', size: '', price_usd: '', status: 'active', images: [], imageUrl: '', promo_video_url: '' };

export default function MyListingsScreen() {
  const { participant, token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const itemsQuery = useQuery({
    queryKey: ['my-catalogue', participant?.username],
    queryFn: () => getCatalogueByUsername(participant!.username),
    enabled: !!participant,
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['my-catalogue', participant?.username] });
  }

  async function handleSave() {
    if (!draft || !token) return;
    const price = parseFloat(draft.price_usd);
    if (!draft.title.trim() || !price || price <= 0) {
      Alert.alert('Missing info', 'Enter a title and a valid price.');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        size: draft.size.trim() || null,
        price_usd: price,
        promo_video_url: draft.promo_video_url.trim() || null,
        images: draft.images.filter(Boolean),
        payment_methods: ['paystack', 'usdt'] as ('paystack' | 'usdt')[],
        status: draft.status,
      };
      if (draft.id) {
        await updateItem(token, draft.id, payload);
      } else {
        await createItem(token, payload);
      }
      setDraft(null);
      refresh();
    } catch (e) {
      Alert.alert('Save failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePickMedia() {
    if (!draft || !token || isUploading) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 0.85,
      allowsEditing: false,
      videoMaxDuration: 120,
    });
    const asset = !result.canceled ? result.assets?.[0] : null;
    if (!asset?.uri) return;

    const isVideo = asset.type === 'video' || asset.mimeType?.startsWith('video/');
    if (!isVideo && draft.images.length >= 4) {
      Alert.alert('Image limit', 'You can add up to four product images.');
      return;
    }
    if (isVideo && Number(asset.fileSize || 0) > 100 * 1024 * 1024) {
      Alert.alert('Video too large', 'Promotional videos must be 100 MB or smaller.');
      return;
    }
    if (!isVideo && Number(asset.fileSize || 0) > 10 * 1024 * 1024) {
      Alert.alert('Image too large', 'Product images must be 10 MB or smaller.');
      return;
    }

    setIsUploading(true);
    try {
      const uploaded = await uploadCatalogueMedia(token, {
        uri: asset.uri,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
      });
      setDraft((current) => current && (uploaded.media_type === 'video_upload'
        ? { ...current, promo_video_url: uploaded.public_url }
        : { ...current, images: [...new Set([...current.images, uploaded.public_url])] }));
    } catch (error) {
      Alert.alert('Upload failed', error instanceof ApiError ? error.message : 'Please try again.');
    } finally {
      setIsUploading(false);
    }
  }

  function handleDelete(item: CatalogueItem) {
    Alert.alert('Delete listing?', `"${item.title}" will be removed from your shop.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!token) return;
          try {
            await deleteItem(token, item.id);
            refresh();
          } catch (e) {
            Alert.alert('Delete failed', e instanceof ApiError ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'My Listings' }} />
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => setDraft({ ...EMPTY_DRAFT })} style={styles.addButton}>
          <ThemedText style={styles.addButtonText}>+ New Listing</ThemedText>
        </Pressable>

        {itemsQuery.isLoading ? (
          <ActivityIndicator size="large" style={styles.loading} />
        ) : (
          <FlatList<CatalogueItem>
            data={itemsQuery.data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<ThemedText style={styles.empty} themeColor="textSecondary">No listings yet.</ThemedText>}
            renderItem={({ item }) => (
              <ThemedView style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                {item.images?.[0] && <Image source={{ uri: item.images[0] }} style={styles.coverImage} />}
                <ThemedView style={styles.cardHeader}>
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.cardTitle}>{item.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">{item.status === 'active' ? '● Live' : '● Paused'}</ThemedText>
                </ThemedView>
                <ThemedText type="smallBold">${item.price_usd.toFixed(2)}</ThemedText>
                {item.size ? <ThemedText type="small" themeColor="textSecondary">Size: {item.size}</ThemedText> : null}
                {item.promo_video_url ? (
                  <Pressable onPress={() => void Linking.openURL(item.promo_video_url!)} style={styles.videoLink}>
                    <Ionicons name="play-circle" size={17} color={Palette.blue} />
                    <ThemedText type="smallBold" style={styles.videoLinkText}>Play promotional video</ThemedText>
                  </Pressable>
                ) : null}
                <ThemedView style={styles.cardActions}>
                  <Pressable
                    onPress={() => setDraft({ id: item.id, title: item.title, description: item.description, size: item.size || '', price_usd: String(item.price_usd), status: item.status === 'active' ? 'active' : 'paused', images: item.images ?? [], imageUrl: '', promo_video_url: item.promo_video_url || '' })}
                    style={styles.editButton}
                  >
                    <ThemedText type="small">Edit</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => handleDelete(item)} style={styles.editButton}>
                    <ThemedText type="small" style={{ color: '#e5484d' }}>Delete</ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>
            )}
          />
        )}

        <Modal visible={!!draft} animationType="slide" transparent>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ThemedView type="background" style={styles.modalCard}>
              <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                <ThemedText type="subtitle" style={styles.modalTitle}>{draft?.id ? 'Edit Listing' : 'New Listing'}</ThemedText>
                <TextInput
                  placeholder="Title" placeholderTextColor={theme.textSecondary}
                  value={draft?.title ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, title: v })}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  placeholder="Description" placeholderTextColor={theme.textSecondary}
                  value={draft?.description ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, description: v })}
                  multiline numberOfLines={3}
                  style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  placeholder="Size or dimensions (for example: S–XL or 40 × 60 cm)" placeholderTextColor={theme.textSecondary}
                  value={draft?.size ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, size: v })}
                  maxLength={120}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  placeholder="Price (USD)" placeholderTextColor={theme.textSecondary}
                  value={draft?.price_usd ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, price_usd: v })}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />

                <View style={styles.mediaUploadCard}>
                  <View style={styles.mediaUploadCopy}>
                    <Ionicons name="cloud-upload" size={21} color={Palette.blue} />
                    <View style={styles.mediaUploadText}>
                      <ThemedText type="smallBold">Product media</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">Up to 4 photos and 1 promotional video</ThemedText>
                    </View>
                  </View>
                  <Pressable onPress={() => void handlePickMedia()} disabled={isUploading} style={[styles.uploadButton, isUploading && styles.disabled]}>
                    {isUploading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="images" size={17} color="#fff" />}
                    <ThemedText type="smallBold" style={styles.uploadButtonText}>{isUploading ? 'Uploading…' : 'Upload photo or video'}</ThemedText>
                  </Pressable>
                </View>

                <View style={styles.imageField}>
                  <TextInput
                    placeholder="Or paste a product image URL" placeholderTextColor={theme.textSecondary}
                    value={draft?.imageUrl ?? ''}
                    onChangeText={(v) => setDraft((d) => d && { ...d, imageUrl: v })}
                    autoCapitalize="none"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, flex: 1 }]}
                  />
                  <Pressable
                    onPress={() => {
                      if (!draft?.imageUrl.trim()) return;
                      setDraft((d) => d && { ...d, images: [...new Set([...(d.images || []), d.imageUrl.trim()])], imageUrl: '' });
                    }}
                    style={styles.addImageButton}
                  >
                    <ThemedText type="small" style={styles.addImageText}>Add</ThemedText>
                  </Pressable>
                </View>

                {draft?.images?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imagePreviewRow}>
                    {draft.images.map((img, index) => (
                      <Pressable
                        key={`${img}-${index}`}
                        onPress={() => setDraft((d) => d && { ...d, images: d.images.filter((item) => item !== img) })}
                        style={styles.previewItem}
                      >
                        <Image source={{ uri: img }} style={styles.previewImage} />
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}

                {draft?.promo_video_url ? (
                  <View style={styles.videoPreview}>
                    <View style={styles.videoPreviewCopy}>
                      <Ionicons name="videocam" size={22} color={Palette.blue} />
                      <View style={styles.videoPreviewText}>
                        <ThemedText type="smallBold">Promotional video ready</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{draft.promo_video_url}</ThemedText>
                      </View>
                    </View>
                    <Pressable onPress={() => setDraft((d) => d && { ...d, promo_video_url: '' })} hitSlop={8}>
                      <Ionicons name="trash" size={19} color={Palette.red} />
                    </Pressable>
                  </View>
                ) : null}

                <ThemedView style={styles.switchRow}>
                  <ThemedText type="small">Live (visible to buyers)</ThemedText>
                  <Switch
                    value={draft?.status === 'active'}
                    onValueChange={(v) => setDraft((d) => d && { ...d, status: v ? 'active' : 'paused' })}
                  />
                </ThemedView>

                <Pressable onPress={handleSave} disabled={isSaving} style={[styles.primaryButton, { opacity: isSaving ? 0.6 : 1 }]}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryButtonText}>Save</ThemedText>}
                </Pressable>
                <Pressable onPress={() => setDraft(null)} style={styles.cancelButton}>
                  <ThemedText themeColor="textSecondary">Cancel</ThemedText>
                </Pressable>
              </ScrollView>
            </ThemedView>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  addButton: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center', marginTop: Spacing.three, marginBottom: Spacing.two },
  addButtonText: { color: '#fff', fontWeight: '600' },
  loading: { marginTop: Spacing.six },
  list: { gap: Spacing.two, paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.six },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  cardTitle: { flex: 1 },
  coverImage: { width: '100%', height: 160, borderTopLeftRadius: Spacing.two, borderTopRightRadius: Spacing.two },
  cardActions: { flexDirection: 'row', gap: Spacing.three },
  editButton: { paddingVertical: Spacing.one },
  videoLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  videoLinkText: { color: Palette.blue },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: Spacing.three, borderTopRightRadius: Spacing.three, maxHeight: '85%' },
  modalContent: { padding: Spacing.three, gap: Spacing.three },
  modalTitle: { fontSize: 20 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 14 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  imageField: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mediaUploadCard: { borderRadius: Spacing.two, padding: Spacing.three, backgroundColor: Palette.blueSoft, borderWidth: 1, borderColor: '#BFDBFE', gap: Spacing.two },
  mediaUploadCopy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mediaUploadText: { flex: 1 },
  uploadButton: { minHeight: 44, borderRadius: 12, backgroundColor: Palette.blue, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  uploadButtonText: { color: '#fff' },
  disabled: { opacity: 0.6 },
  addImageButton: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  addImageText: { color: '#fff', fontWeight: '600' },
  imagePreviewRow: { gap: Spacing.two, paddingVertical: Spacing.one },
  previewItem: { width: 72, height: 72, borderRadius: Spacing.two, overflow: 'hidden' },
  previewImage: { width: 72, height: 72 },
  videoPreview: { borderRadius: Spacing.two, padding: 12, borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: Palette.ashSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  videoPreviewCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  videoPreviewText: { flex: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  primaryButton: { backgroundColor: '#1D4ED8', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  cancelButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
