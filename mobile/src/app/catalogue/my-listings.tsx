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
import { cataloguePriceLabel, getCatalogueByUsername, getCatalogueDrafts, getCategories, getCatalogueListingConfiguration, createCategory, createItem, updateItem, deleteItem, saveCatalogueDraft, publishCatalogueDraft, deleteCatalogueDraft, uploadCatalogueMedia, type CatalogueItem, type CatalogueListingDraft, type CatalogueListingType, type CatalogueProductDetails, type CatalogueServiceDetails } from '@/api/catalogue';
import { ApiError } from '@/lib/api-client';
import { buildCatalogueDirectory, canSell, departmentForCategory } from '@/lib/catalogue-directory';

type Draft = {
  id?: string;
  draft_id?: string;
  title: string;
  description: string;
  size: string;
  category_id: string;
  categoryName: string;
  departmentSlug: string;
  price_usd: string;
  price_max_usd: string;
  min_order_qty: string;
  max_order_qty: string;
  stock_status: CatalogueListingDraft['stock_status'];
  stock_quantity: string;
  status: 'active' | 'paused';
  images: string[];
  imageUrl: string;
  promo_video_url: string;
  listing_type: CatalogueListingType;
  pricing_model: string;
  price_unit: string;
  service_scope: string;
  service_terms: string;
  service_scope_confirmed: boolean;
  condition: CatalogueProductDetails['condition'] | '';
  fulfillment_methods: NonNullable<CatalogueProductDetails['fulfillment_methods']>;
  service_modes: NonNullable<CatalogueServiceDetails['service_modes']>;
  service_area: string;
  typical_duration_minutes: string;
  attributes: { attribute_id?: string; custom_label?: string; value: unknown }[];
};

const EMPTY_DRAFT: Draft = { title: '', description: '', size: '', category_id: '', categoryName: '', departmentSlug: '', price_usd: '', price_max_usd: '', min_order_qty: '', max_order_qty: '', stock_status: null, stock_quantity: '', status: 'active', images: [], imageUrl: '', promo_video_url: '', listing_type: 'product', pricing_model: 'fixed', price_unit: '', service_scope: '', service_terms: '', service_scope_confirmed: false, condition: '', fulfillment_methods: [], service_modes: [], service_area: '', typical_duration_minutes: '', attributes: [] };

export default function MyListingsScreen() {
  const { participant, token } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const itemsQuery = useQuery({
    queryKey: ['my-catalogue', participant?.username],
    queryFn: () => getCatalogueByUsername(participant!.username),
    enabled: !!participant,
  });

  const draftsQuery = useQuery({
    queryKey: ['catalogue-listing-drafts'],
    queryFn: () => getCatalogueDrafts(token!),
    enabled: !!token,
  });

  const categoriesQuery = useQuery({
    queryKey: ['catalogue-categories'],
    queryFn: getCategories,
  });

  const listingConfigQuery = useQuery({
    queryKey: ['catalogue-listing-configuration', draft?.category_id, draft?.listing_type],
    queryFn: () => getCatalogueListingConfiguration(draft?.category_id || null, draft?.listing_type || 'product'),
    enabled: !!draft,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['my-catalogue', participant?.username] });
    queryClient.invalidateQueries({ queryKey: ['catalogue-listing-drafts'] });
  }

  async function handleSave() {
    if (!draft || !token) return;
    const price = parseFloat(draft.price_usd);
    if (!draft.title.trim() || !Number.isFinite(price) || price <= 0) {
      Alert.alert('Missing info', 'Enter a title and a valid price.');
      return;
    }
    const pricingModel = listingConfigQuery.data?.pricing_models.find((model) => model.key === draft.pricing_model);
    if (!pricingModel?.checkout_compatible) {
      Alert.alert('Save as a draft', 'This pricing model is not supported by the existing checkout. Save it privately as a draft instead.');
      return;
    }
    if (draft.price_max_usd.trim() || draft.min_order_qty.trim() || draft.max_order_qty.trim()
      || draft.stock_status || draft.stock_quantity.trim()) {
      Alert.alert('Save as a draft', 'Price ranges, inventory and quantity descriptions cannot be enforced by checkout. Save this listing privately as a draft.');
      return;
    }
    if (pricingModel?.requires_unit && !draft.price_unit) {
      Alert.alert('Choose a unit', 'Select the unit used to describe the product price.');
      return;
    }
    if (pricingModel?.requires_unit && draft.price_unit.startsWith('other:') && !draft.price_unit.slice(6).trim()) {
      Alert.alert('Specify the unit', 'Enter the custom unit name before saving.');
      return;
    }
    if (draft.listing_type === 'service' && (!draft.service_scope.trim() || !draft.service_terms.trim() || !draft.service_scope_confirmed)) {
      Alert.alert('Complete service details', 'Add the service scope and terms, then confirm they describe the complete offering.');
      return;
    }
    if (draft.listing_type === 'service' && !draft.service_modes.length) {
      Alert.alert('Choose a delivery method', 'Select how the service is delivered.');
      return;
    }
    if (draft.pricing_model === 'per_session' && (!Number.isInteger(Number(draft.typical_duration_minutes)) || Number(draft.typical_duration_minutes) <= 0)) {
      Alert.alert('Session duration required', 'Enter a positive session duration in minutes.');
      return;
    }
    if (draft.listing_type === 'product' && !draft.fulfillment_methods.length) {
      Alert.alert('Choose fulfillment', 'Select at least one way the product can be fulfilled.');
      return;
    }
    if (draft.listing_type === 'product' && !draft.images.length) {
      Alert.alert('Add a product image', 'Add at least one product image before publishing.');
      return;
    }
    setIsSaving(true);
    try {
      let categoryId = draft.category_id;
      const customName = draft.categoryName.trim();
      if (customName) {
        const directory = buildCatalogueDirectory(categoriesQuery.data ?? []);
        const department = directory.departments.find((item) => item.slug === draft.departmentSlug);
        if (!department) {
          Alert.alert('Choose a department', 'Pick the department this category belongs to.');
          setIsSaving(false);
          return;
        }
        const created = await createCategory(token, customName, department.id);
        categoryId = created.id;
        queryClient.invalidateQueries({ queryKey: ['catalogue-categories'] });
      }
      if (!categoryId) {
        Alert.alert('Choose a category', 'Pick a category, or type a new category name.');
        setIsSaving(false);
        return;
      }
      const chosen = (categoriesQuery.data ?? []).find((category) => category.id === categoryId);
      if (chosen && !canSell(chosen)) {
        Alert.alert('Choose a specific category', 'Pick a category inside the department, such as Web Development.');
        setIsSaving(false);
        return;
      }
      if (chosen?.listing_types && !chosen.listing_types.includes(draft.listing_type)) {
        Alert.alert('Choose a compatible category', 'This category does not accept the selected listing type.');
        setIsSaving(false);
        return;
      }
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        size: draft.size.trim() || null,
        category_id: categoryId,
        price_usd: price,
        promo_video_url: draft.promo_video_url.trim() || null,
        images: draft.images.filter(Boolean),
        payment_methods: ['paystack', 'usdt'] as ('paystack' | 'usdt')[],
        status: draft.status,
        listing_type: draft.listing_type,
        pricing_model: draft.pricing_model,
        price_unit: draft.price_unit.trim() || null,
        service_scope: draft.listing_type === 'service' ? draft.service_scope.trim() : null,
        service_terms: draft.listing_type === 'service' ? draft.service_terms.trim() : null,
        service_scope_confirmed: draft.listing_type === 'service' && draft.service_scope_confirmed,
        product_details: draft.listing_type === 'product' ? {
          condition: draft.condition || null,
          fulfillment_methods: draft.fulfillment_methods,
        } : undefined,
        service_details: draft.listing_type === 'service' ? {
          service_modes: draft.service_modes,
          service_area: draft.service_area.trim() || null,
          typical_duration_minutes: draft.typical_duration_minutes ? Number(draft.typical_duration_minutes) : null,
        } : undefined,
        attributes: draft.attributes,
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

  function draftPayload(categoryId: string | null) {
    if (!draft) throw new Error('No draft is open.');
    return {
      ...(draft.draft_id ? { id: draft.draft_id } : {}),
      title: draft.title.trim(),
      description: draft.description.trim(),
      category_id: categoryId,
      listing_type: draft.listing_type,
      pricing_model: draft.pricing_model,
      price_usd: draft.price_usd.trim() || null,
      price_max_usd: draft.price_max_usd.trim() || null,
      price_unit: draft.price_unit.trim() || null,
      min_order_qty: draft.min_order_qty.trim() ? Number(draft.min_order_qty) : null,
      max_order_qty: draft.max_order_qty.trim() ? Number(draft.max_order_qty) : null,
      stock_status: draft.stock_status,
      stock_quantity: draft.stock_quantity.trim() ? Number(draft.stock_quantity) : null,
      service_scope: draft.listing_type === 'service' ? draft.service_scope.trim() : null,
      service_terms: draft.listing_type === 'service' ? draft.service_terms.trim() : null,
      service_scope_confirmed: draft.listing_type === 'service' && draft.service_scope_confirmed,
      product_details: draft.listing_type === 'product' ? {
        condition: draft.condition || null,
        fulfillment_methods: draft.fulfillment_methods,
      } : undefined,
      service_details: draft.listing_type === 'service' ? {
        service_modes: draft.service_modes,
        service_area: draft.service_area.trim() || null,
        typical_duration_minutes: draft.typical_duration_minutes ? Number(draft.typical_duration_minutes) : null,
      } : undefined,
      attributes: draft.attributes,
      images: draft.images.filter(Boolean),
      promo_video_url: draft.promo_video_url.trim() || null,
    };
  }

  async function saveCurrentDraft() {
    if (!draft || !token) throw new Error('Sign in to save listing drafts.');
    let categoryId = draft.category_id || null;
    const customName = draft.categoryName.trim();
    if (customName) {
      const directory = buildCatalogueDirectory(categoriesQuery.data ?? []);
      const department = directory.departments.find((item) => item.slug === draft.departmentSlug);
      if (!department) throw new Error('Choose the department for this custom category.');
      const created = await createCategory(token, customName, department.id);
      categoryId = created.id;
      queryClient.invalidateQueries({ queryKey: ['catalogue-categories'] });
    }
    return saveCatalogueDraft(token, draftPayload(categoryId));
  }

  async function handleSaveDraft() {
    if (!draft || !token) return;
    setIsSaving(true);
    try {
      const saved = await saveCurrentDraft();
      setDraft((current) => current && ({ ...current, draft_id: saved.id, category_id: saved.category_id || '' }));
      refresh();
      Alert.alert('Draft saved', saved.blocking_reasons.length
        ? `Saved privately. Before publishing:\n• ${saved.blocking_reasons.join('\n• ')}`
        : 'Saved privately. It is not visible to buyers until you publish it.');
    } catch (error) {
      Alert.alert('Draft not saved', error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublishDraft() {
    if (!draft || !token) return;
    setIsSaving(true);
    try {
      const saved = await saveCurrentDraft();
      await publishCatalogueDraft(token, saved.id);
      setDraft(null);
      refresh();
    } catch (error) {
      Alert.alert('Draft not published', error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  function handleDeleteDraft(item: CatalogueListingDraft) {
    Alert.alert('Delete listing draft?', `"${item.title}" will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!token) return;
          try {
            await deleteCatalogueDraft(token, item.id);
            refresh();
          } catch (error) {
            Alert.alert('Draft not deleted', error instanceof ApiError ? error.message : 'Please try again.');
          }
        },
      },
    ]);
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

  function openEditor(item?: CatalogueItem) {
    if (!item) {
      setDraft({ ...EMPTY_DRAFT });
      return;
    }
    const directory = buildCatalogueDirectory(categoriesQuery.data ?? []);
    const department = item.category_id ? departmentForCategory(directory, item.category_id) : undefined;
    setDraft({
      id: item.id,
      title: item.title,
      description: item.description,
      size: item.size || '',
      category_id: item.category_id || '',
      categoryName: '',
      departmentSlug: department?.slug || '',
      price_usd: String(item.price_usd),
      price_max_usd: '',
      min_order_qty: '',
      max_order_qty: '',
      stock_status: null,
      stock_quantity: '',
      status: item.status === 'active' ? 'active' : 'paused',
      images: item.images ?? [],
      imageUrl: '',
      promo_video_url: item.promo_video_url || '',
      listing_type: item.listing_type || 'product',
      pricing_model: item.pricing_model || 'fixed',
      price_unit: item.price_unit || '',
      service_scope: item.service_scope || '',
      service_terms: item.service_terms || '',
      service_scope_confirmed: !!item.service_scope_confirmed,
      condition: item.product_details?.condition || '',
      fulfillment_methods: item.product_details?.fulfillment_methods || [],
      service_modes: item.service_details?.service_modes || [],
      service_area: item.service_details?.service_area || '',
      typical_duration_minutes: item.service_details?.typical_duration_minutes ? String(item.service_details.typical_duration_minutes) : '',
      attributes: item.attributes?.map((attribute) => ({
        ...(attribute.attribute_id ? { attribute_id: attribute.attribute_id } : { custom_label: attribute.custom_label || '' }),
        value: attribute.value,
      })) || [],
    });
  }

  function openDraftEditor(item: CatalogueListingDraft) {
    const directory = buildCatalogueDirectory(categoriesQuery.data ?? []);
    const department = item.category_id ? departmentForCategory(directory, item.category_id) : undefined;
    setDraft({
      ...EMPTY_DRAFT,
      draft_id: item.id,
      title: item.title,
      description: item.description || '',
      category_id: item.category_id || '',
      departmentSlug: department?.slug || '',
      price_usd: item.price_usd === null ? '' : String(item.price_usd),
      price_max_usd: item.price_max_usd === null ? '' : String(item.price_max_usd),
      min_order_qty: item.min_order_qty === null ? '' : String(item.min_order_qty),
      max_order_qty: item.max_order_qty === null ? '' : String(item.max_order_qty),
      stock_status: item.stock_status,
      stock_quantity: item.stock_quantity === null ? '' : String(item.stock_quantity),
      listing_type: item.listing_type,
      pricing_model: item.pricing_model,
      price_unit: item.price_unit || '',
      images: item.images || [],
      promo_video_url: item.promo_video_url || '',
      service_scope: item.service_scope || '',
      service_terms: item.service_terms || '',
      service_scope_confirmed: item.service_scope_confirmed,
      condition: item.product_details?.condition || '',
      fulfillment_methods: item.product_details?.fulfillment_methods || [],
      service_modes: item.service_details?.service_modes || [],
      service_area: item.service_details?.service_area || '',
      typical_duration_minutes: item.service_details?.typical_duration_minutes ? String(item.service_details.typical_duration_minutes) : '',
      attributes: item.attributes || [],
    });
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

  const listingDirectory = buildCatalogueDirectory(categoriesQuery.data ?? []);
  const listingDepartment = listingDirectory.departments.find((department) => department.slug === draft?.departmentSlug)
    ?? (draft?.category_id ? departmentForCategory(listingDirectory, draft.category_id) : undefined);
  const currentCategory = (categoriesQuery.data ?? []).find((category) => category.id === draft?.category_id);
  const listingGroups = listingDepartment
    ? [
        ...listingDepartment.sections.map((section) => ({
          ...section,
          categories: section.categories.filter((category) => !category.listing_types || category.listing_types.includes(draft?.listing_type || 'product')),
        })).filter((section) => section.categories.length),
        ...(currentCategory && canSell(currentCategory) && !currentCategory.listing_types?.includes(draft?.listing_type || 'product')
          ? [{ title: 'Current category (incompatible)', categories: [currentCategory] }]
          : []),
        ...(currentCategory && canSell(currentCategory) && currentCategory.listing_types?.includes(draft?.listing_type || 'product') && !listingDepartment.categories.some((category) => category.id === currentCategory.id)
          ? [{ title: 'Current category', categories: [currentCategory] }]
          : []),
      ]
    : [];
  const showGroupTitles = listingGroups.length > 1;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'My Listings' }} />
      <SafeAreaView style={styles.safeArea}>
        <Pressable onPress={() => openEditor()} style={styles.addButton}>
          <ThemedText style={styles.addButtonText}>+ New Listing</ThemedText>
        </Pressable>

        {draftsQuery.isLoading ? <ActivityIndicator size="small" /> : null}
        {draftsQuery.isError ? <ThemedText type="small" style={{ color: Palette.red }}>Saved drafts could not be loaded.</ThemedText> : null}
        {(draftsQuery.data || []).length > 0 ? (
          <View style={styles.draftSection}>
            <ThemedText type="smallBold">Saved drafts (private)</ThemedText>
            {draftsQuery.data?.map((item) => (
              <ThemedView key={item.id} style={[styles.draftCard, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="smallBold">{item.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.listing_type === 'service' ? 'Service' : 'Product'} · {item.pricing_model.replaceAll('_', ' ')}
                  {item.price_usd ? ` · $${Number(item.price_usd).toFixed(2)}${item.price_max_usd ? `–$${Number(item.price_max_usd).toFixed(2)}` : ''}` : ' · Price not set'}
                </ThemedText>
                {item.blocking_reasons.map((reason) => (
                  <ThemedText key={reason} type="small" style={{ color: Palette.red }}>• {reason}</ThemedText>
                ))}
                <View style={styles.draftActions}>
                  <Pressable onPress={() => openDraftEditor(item)} style={styles.editButton}>
                    <ThemedText type="small">Edit</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!token) return;
                      setIsSaving(true);
                      void publishCatalogueDraft(token, item.id).then(refresh).catch((error) => {
                        Alert.alert('Draft not published', error instanceof ApiError ? error.message : 'Please try again.');
                      }).finally(() => setIsSaving(false));
                    }}
                    disabled={isSaving || item.blocking_reasons.length > 0}
                    style={[styles.editButton, (isSaving || item.blocking_reasons.length > 0) && styles.disabled]}
                  >
                    <ThemedText type="small">Publish</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => handleDeleteDraft(item)} style={styles.editButton}>
                    <ThemedText type="small" style={{ color: Palette.red }}>Delete</ThemedText>
                  </Pressable>
                </View>
              </ThemedView>
            ))}
          </View>
        ) : null}

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
                <ThemedText type="smallBold">{cataloguePriceLabel(item)}</ThemedText>
                {item.size ? <ThemedText type="small" themeColor="textSecondary">Size: {item.size}</ThemedText> : null}
                {item.promo_video_url ? (
                  <Pressable onPress={() => void Linking.openURL(item.promo_video_url!)} style={styles.videoLink}>
                    <Ionicons name="play-circle" size={17} color={Palette.blue} />
                    <ThemedText type="smallBold" style={styles.videoLinkText}>Play promotional video</ThemedText>
                  </Pressable>
                ) : null}
                <ThemedView style={styles.cardActions}>
                  <Pressable
                    onPress={() => openEditor(item)}
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
                <ThemedText type="smallBold">Listing type</ThemedText>
                <View style={styles.categoryWrap}>
                  {(['product', 'service'] as const).map((type) => (
                    <Pressable
                      key={type}
                      onPress={() => setDraft((current) => current && ({
                        ...current,
                        listing_type: type,
                        pricing_model: type === 'service' ? 'fixed' : (current.pricing_model === 'per_session' ? 'fixed' : current.pricing_model),
                        price_unit: type === 'service' ? '' : current.price_unit,
                        attributes: [],
                        stock_status: type === 'service' ? null : current.stock_status,
                        stock_quantity: type === 'service' ? '' : current.stock_quantity,
                      }))}
                      style={[styles.categoryChip, { backgroundColor: draft?.listing_type === type ? Palette.blue : theme.backgroundElement }]}
                    >
                      <ThemedText type="smallBold" style={{ color: draft?.listing_type === type ? '#fff' : theme.text }}>
                        {type === 'product' ? 'Sell a Product' : 'Offer a Service'}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  placeholder="Size or dimensions (for example: S–XL or 40 × 60 cm)" placeholderTextColor={theme.textSecondary}
                  value={draft?.size ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, size: v })}
                  maxLength={120}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <ThemedText type="smallBold">Department</ThemedText>
                <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} contentContainerStyle={styles.departmentScroll}>
                  {listingDirectory.departments.map((department) => {
                    const selected = listingDepartment?.slug === department.slug;
                    return (
                      <Pressable
                        key={department.slug}
                        onPress={() => setDraft((current) => {
                          if (!current || current.departmentSlug === department.slug) return current;
                          return { ...current, departmentSlug: department.slug, category_id: '', categoryName: '', attributes: [] };
                        })}
                        style={[styles.categoryChip, { backgroundColor: selected ? department.ink : department.tint }]}
                      >
                        <ThemedText type="smallBold" style={{ color: selected ? '#fff' : department.ink }}>{department.name}</ThemedText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <ThemedText type="smallBold">Category</ThemedText>
                {listingDepartment ? (
                  listingGroups.map((group) => (
                    <View key={group.title} style={styles.categoryGroup}>
                      {showGroupTitles ? <ThemedText type="small" themeColor="textSecondary">{group.title}</ThemedText> : null}
                      <View style={styles.categoryWrap}>
                        {group.categories.map((category) => {
                          const selected = draft?.category_id === category.id && !draft.categoryName.trim();
                          return (
                            <Pressable
                              key={category.id}
                              onPress={() => setDraft((current) => current && { ...current, category_id: category.id, categoryName: '', attributes: [] })}
                              style={[styles.categoryChip, { backgroundColor: selected ? category.ink : category.tint }]}
                            >
                              <ThemedText type="smallBold" style={{ color: selected ? '#fff' : category.ink }}>{category.name}</ThemedText>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">Choose a department, then a category.</ThemedText>
                )}
                <TextInput
                  placeholder="Or name a new category in this department" placeholderTextColor={theme.textSecondary}
                  value={draft?.categoryName ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, categoryName: v })}
                  maxLength={40}
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  placeholder={draft?.pricing_model === 'custom_quote' ? 'Starting price (optional, USD)' : draft?.listing_type === 'service' ? 'Service price (USD)' : 'Price (USD)'}
                  placeholderTextColor={theme.textSecondary}
                  value={draft?.price_usd ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, price_usd: v })}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  placeholder="Maximum advertised price (optional, USD)" placeholderTextColor={theme.textSecondary}
                  value={draft?.price_max_usd ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, price_max_usd: v })}
                  keyboardType="decimal-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  placeholder="Minimum order quantity (optional)" placeholderTextColor={theme.textSecondary}
                  value={draft?.min_order_qty ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, min_order_qty: v })}
                  keyboardType="number-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  placeholder="Maximum order quantity (optional)" placeholderTextColor={theme.textSecondary}
                  value={draft?.max_order_qty ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, max_order_qty: v })}
                  keyboardType="number-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                {draft?.listing_type === 'product' ? (
                  <>
                    <ThemedText type="smallBold">Stock description (draft metadata)</ThemedText>
                    <View style={styles.categoryWrap}>
                      {([
                        [null, 'Not specified'], ['in_stock', 'In stock'], ['limited', 'Limited'],
                        ['made_to_order', 'Made to order'], ['preorder', 'Preorder'], ['out_of_stock', 'Out of stock'],
                      ] as const).map(([value, label]) => (
                        <Pressable key={value || 'unspecified'} onPress={() => setDraft((current) => current && ({ ...current, stock_status: value }))} style={[styles.categoryChip, { backgroundColor: draft?.stock_status === value ? Palette.blue : theme.backgroundElement }]}>
                          <ThemedText type="smallBold" style={{ color: draft?.stock_status === value ? '#fff' : theme.text }}>{label}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      placeholder="Stock quantity (draft only; checkout does not reserve stock)" placeholderTextColor={theme.textSecondary}
                      value={draft?.stock_quantity ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, stock_quantity: v })}
                      keyboardType="number-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                  </>
                ) : null}
                <ThemedText type="smallBold">Pricing model</ThemedText>
                <View style={styles.categoryWrap}>
                  {(listingConfigQuery.data?.pricing_models || []).filter((model) =>
                    model.applies_to.includes(draft?.listing_type || 'product')
                  ).map((model) => (
                    <Pressable
                      key={model.key}
                      onPress={() => setDraft((current) => current && ({ ...current, pricing_model: model.key }))}
                      style={[styles.categoryChip, { backgroundColor: draft?.pricing_model === model.key ? Palette.blue : theme.backgroundElement }]}
                    >
                      <ThemedText type="smallBold" style={{ color: draft?.pricing_model === model.key ? '#fff' : theme.text }}>
                        {model.label}{model.checkout_compatible ? '' : ' · draft only'}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
                {listingConfigQuery.data?.pricing_models.find((model) => model.key === draft?.pricing_model)?.requires_unit ? (
                  <>
                    <ThemedText type="smallBold">Price unit</ThemedText>
                    <View style={styles.categoryWrap}>
                      {(listingConfigQuery.data?.units || []).filter((unit) => unit.applies_to.includes(draft?.listing_type || 'product')).map((unit) => (
                        <Pressable key={unit.key} onPress={() => setDraft((current) => current && ({ ...current, price_unit: unit.key }))} style={[styles.categoryChip, { backgroundColor: draft?.price_unit === unit.key ? Palette.blue : theme.backgroundElement }]}>
                          <ThemedText type="smallBold" style={{ color: draft?.price_unit === unit.key ? '#fff' : theme.text }}>{unit.label}</ThemedText>
                        </Pressable>
                      ))}
                      <Pressable onPress={() => setDraft((current) => current && ({ ...current, price_unit: current.price_unit.startsWith('other:') ? current.price_unit : 'other:' }))} style={[styles.categoryChip, { backgroundColor: draft?.price_unit.startsWith('other:') ? Palette.blue : theme.backgroundElement }]}>
                        <ThemedText type="smallBold" style={{ color: draft?.price_unit.startsWith('other:') ? '#fff' : theme.text }}>Other</ThemedText>
                      </Pressable>
                    </View>
                    {draft?.price_unit.startsWith('other:') ? (
                      <TextInput
                        placeholder="Specify unit (up to 20 characters)"
                        placeholderTextColor={theme.textSecondary}
                        value={draft?.price_unit.slice(6) ?? ''}
                        maxLength={20}
                        onChangeText={(value) => setDraft((current) => current && ({ ...current, price_unit: `other:${value}` }))}
                        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                      />
                    ) : null}
                  </>
                ) : null}
                {draft?.listing_type === 'product' ? (
                  <>
                    <ThemedText type="smallBold">Condition</ThemedText>
                    <View style={styles.categoryWrap}>
                      {([['new', 'New'], ['used_like_new', 'Used - like new'], ['used_good', 'Used - good'], ['used_fair', 'Used - fair'], ['refurbished', 'Refurbished'], ['not_applicable', 'Not applicable']] as const).map(([key, label]) => (
                        <Pressable key={key} onPress={() => setDraft((current) => current && ({ ...current, condition: key }))} style={[styles.categoryChip, { backgroundColor: draft?.condition === key ? Palette.blue : theme.backgroundElement }]}>
                          <ThemedText type="smallBold" style={{ color: draft?.condition === key ? '#fff' : theme.text }}>{label}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                    <ThemedText type="smallBold">Fulfillment options</ThemedText>
                    <View style={styles.categoryWrap}>
                      {([['pickup', 'Local pickup'], ['delivery', 'Seller delivery'], ['shipping', 'Shipping'], ['digital_delivery', 'Digital delivery']] as const).map(([key, label]) => {
                        const selected = draft?.fulfillment_methods.includes(key) ?? false;
                        return (
                          <Pressable key={key} onPress={() => setDraft((current) => current && ({ ...current, fulfillment_methods: selected ? current.fulfillment_methods.filter((method) => method !== key) : [...current.fulfillment_methods, key] }))} style={[styles.categoryChip, { backgroundColor: selected ? Palette.blue : theme.backgroundElement }]}>
                            <ThemedText type="smallBold" style={{ color: selected ? '#fff' : theme.text }}>{label}</ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <>
                    <ThemedText type="smallBold">Service delivery method *</ThemedText>
                    <View style={styles.categoryWrap}>
                      {([
                        ['on_site', 'At customer location'],
                        ['at_provider', 'At provider location'],
                        ['remote', 'Remote / online'],
                      ] as const).map(([key, label]) => {
                        const selected = draft?.service_modes.includes(key) ?? false;
                        return (
                          <Pressable key={key} onPress={() => setDraft((current) => current && ({ ...current, service_modes: selected ? current.service_modes.filter((mode) => mode !== key) : [...current.service_modes, key] }))} style={[styles.categoryChip, { backgroundColor: selected ? Palette.blue : theme.backgroundElement }]}>
                            <ThemedText type="smallBold" style={{ color: selected ? '#fff' : theme.text }}>{label}</ThemedText>
                          </Pressable>
                        );
                      })}
                    </View>
                    <TextInput
                      placeholder="Service area / coverage (optional)" placeholderTextColor={theme.textSecondary}
                      value={draft?.service_area ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, service_area: v })}
                      maxLength={300} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                    {draft?.pricing_model === 'per_session' ? (
                      <TextInput
                        placeholder="Session duration (minutes) *" placeholderTextColor={theme.textSecondary}
                        value={draft?.typical_duration_minutes ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, typical_duration_minutes: v })}
                        keyboardType="number-pad" style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                      />
                    ) : null}
                    <TextInput
                      placeholder="Service scope (what is included)" placeholderTextColor={theme.textSecondary}
                      value={draft?.service_scope ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, service_scope: v })}
                      multiline style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                    <TextInput
                      placeholder="Service terms (where, when and how it is delivered)" placeholderTextColor={theme.textSecondary}
                      value={draft?.service_terms ?? ''} onChangeText={(v) => setDraft((d) => d && { ...d, service_terms: v })}
                      multiline style={[styles.input, styles.textArea, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                    <Pressable onPress={() => setDraft((d) => d && { ...d, service_scope_confirmed: !d.service_scope_confirmed })} style={styles.confirmRow}>
                      <Ionicons name={draft?.service_scope_confirmed ? 'checkbox' : 'square-outline'} size={22} color={Palette.blue} />
                      <ThemedText type="small">I confirm the scope and terms describe the complete service being offered.</ThemedText>
                    </Pressable>
                  </>
                )}
                {listingConfigQuery.isLoading ? <ActivityIndicator size="small" /> : null}
                {listingConfigQuery.isError ? <ThemedText type="small" style={{ color: Palette.red }}>Category fields could not be loaded. Retry before saving.</ThemedText> : null}
                {(listingConfigQuery.data?.attributes || []).map((attribute) => {
                  const stored = draft?.attributes.find((item) => item.attribute_id === attribute.id);
                  const value = stored?.value;
                  const setValue = (next: unknown) => setDraft((current) => current && ({
                    ...current,
                    attributes: [
                      ...current.attributes.filter((item) => item.attribute_id !== attribute.id),
                      { attribute_id: attribute.id, value: next },
                    ],
                  }));
                  return (
                    <View key={attribute.id} style={styles.attributeField}>
                      <ThemedText type="smallBold">{attribute.label}{attribute.is_required ? ' *' : ''}</ThemedText>
                      {attribute.input_type === 'boolean' ? (
                        <Pressable onPress={() => setValue(value !== true)} style={styles.confirmRow}>
                          <Ionicons name={value === true ? 'checkbox' : 'square-outline'} size={22} color={Palette.blue} />
                          <ThemedText type="small">{value === true ? 'Yes' : 'No'}</ThemedText>
                        </Pressable>
                      ) : attribute.input_type === 'select' || attribute.input_type === 'multi_select' ? (
                        <View style={styles.categoryWrap}>
                          {attribute.options.map((option) => {
                            const optionValue = typeof option === 'string' ? option : option.value;
                            const optionLabel = typeof option === 'string' ? option : option.label;
                            const selected = attribute.input_type === 'multi_select'
                              ? Array.isArray(value) && value.includes(optionValue)
                              : value === optionValue;
                            return (
                              <Pressable key={optionValue} onPress={() => setValue(attribute.input_type === 'multi_select'
                                ? selected ? (value as string[]).filter((entry) => entry !== optionValue) : [...(Array.isArray(value) ? value as string[] : []), optionValue]
                                : optionValue)} style={[styles.categoryChip, { backgroundColor: selected ? Palette.blue : theme.backgroundElement }]}>
                                <ThemedText type="smallBold" style={{ color: selected ? '#fff' : theme.text }}>{optionLabel}</ThemedText>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <TextInput
                          placeholder={attribute.input_type === 'number' ? 'Enter a number' : 'Enter a value'}
                          placeholderTextColor={theme.textSecondary}
                          value={value === undefined || value === null ? '' : String(value)}
                          onChangeText={(text) => setValue(attribute.input_type === 'number' ? (text ? Number(text) : null) : text)}
                          keyboardType={attribute.input_type === 'number' ? 'decimal-pad' : 'default'}
                          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                        />
                      )}
                    </View>
                  );
                })}

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

                <Pressable onPress={handleSaveDraft} disabled={isSaving} style={[styles.secondaryButton, { opacity: isSaving ? 0.6 : 1 }]}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.secondaryButtonText}>Save privately as draft</ThemedText>}
                </Pressable>
                <Pressable onPress={draft?.draft_id ? handlePublishDraft : handleSave} disabled={isSaving} style={[styles.primaryButton, { opacity: isSaving ? 0.6 : 1 }]}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.primaryButtonText}>{draft?.draft_id ? 'Publish draft' : 'Save live listing'}</ThemedText>}
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
  draftSection: { gap: Spacing.two, marginBottom: Spacing.three },
  draftCard: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  draftActions: { flexDirection: 'row', gap: Spacing.three },
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
  departmentScroll: { gap: Spacing.two, paddingVertical: Spacing.one },
  categoryWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  categoryGroup: { gap: Spacing.one },
  attributeField: { gap: Spacing.one },
  categoryChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  input: { borderRadius: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontSize: 14 },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  imageField: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  confirmRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.one },
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
  secondaryButton: { backgroundColor: '#475569', borderRadius: Spacing.two, paddingVertical: Spacing.three, alignItems: 'center' },
  secondaryButtonText: { color: '#fff', fontWeight: '600' },
  cancelButton: { alignItems: 'center', paddingVertical: Spacing.two },
});
