import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Palette, Spacing } from '@/constants/theme';
import { BASCARDO_LOGO_URL } from '@/constants/bascardo';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/contexts/AuthContext';
import {
  deleteAiConversation,
  deleteAllAiConversations,
  getAiConversation,
  getAiConversations,
  getAiOverview,
  sendAiMessage,
  type AiMessage,
} from '@/api/ai';
import { ApiError } from '@/lib/api-client';

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function AiScreen() {
  const { token } = useAuth();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList<AiMessage> | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isDraftConversation, setIsDraftConversation] = useState(false);
  const [question, setQuestion] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ['ai-overview'],
    queryFn: () => getAiOverview(token!),
    enabled: !!token,
  });

  const conversationsQuery = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: () => getAiConversations(token!),
    enabled: !!token,
  });
  const effectiveConversationId = isDraftConversation
    ? null
    : activeConversationId || conversationsQuery.data?.[0]?.id || null;

  const conversationQuery = useQuery({
    queryKey: ['ai-conversation', effectiveConversationId],
    queryFn: () => getAiConversation(token!, effectiveConversationId!),
    enabled: !!token && !!effectiveConversationId,
  });

  useEffect(() => {
    const keyboardEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(keyboardEvent, () => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    });
    return () => subscription.remove();
  }, []);

  async function runAi(action: 'chat' | 'business_analysis', suggestedQuestion?: string) {
    const prompt = (suggestedQuestion || question).trim();
    if (action === 'chat' && !prompt) return;

    if (action === 'business_analysis' && !overviewQuery.data?.plan.businessAnalysis) {
      router.push('/ai-subscription' as never);
      return;
    }

    const setBusy = action === 'business_analysis' ? setIsAnalysing : setIsSending;
    setError(null);
    setBusy(true);
    try {
      const result = await sendAiMessage(token!, {
        question: prompt || undefined,
        conversationId: effectiveConversationId,
        action,
      });
      setQuestion('');
      setIsDraftConversation(false);
      setActiveConversationId(result.conversation.id);
      queryClient.setQueryData(['ai-conversation', result.conversation.id], {
        conversation: result.conversation,
        messages: [
          ...(effectiveConversationId === result.conversation.id ? (conversationQuery.data?.messages || []) : []),
          ...result.messages,
        ],
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['ai-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['ai-overview'] }),
      ]);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Bascardo AI is unavailable right now.';
      setError(message);
      if (caught instanceof ApiError && (caught.status === 403 || caught.status === 429)) {
        Alert.alert('AI plan or credits needed', message, [
          { text: 'Not now', style: 'cancel' },
          { text: 'View plans', onPress: () => router.push('/ai-subscription' as never) },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  function startNewChat() {
    setActiveConversationId(null);
    setIsDraftConversation(true);
    setQuestion('');
    setError(null);
    inputRef.current?.focus();
  }

  function confirmDeleteCurrent() {
    if (!effectiveConversationId || !token) return;
    Alert.alert('Delete this AI chat?', 'The conversation will be permanently removed. Used AI credits will not be restored.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete chat',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAiConversation(token, effectiveConversationId);
            const remaining = (conversationsQuery.data || []).filter((item) => item.id !== effectiveConversationId);
            queryClient.setQueryData(['ai-conversations'], remaining);
            setActiveConversationId(remaining[0]?.id || null);
            setIsDraftConversation(remaining.length === 0);
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Could not delete this chat.');
          }
        },
      },
    ]);
  }

  function confirmClearAll() {
    if (!token || !(conversationsQuery.data?.length)) return;
    Alert.alert('Clear all AI chats?', 'Every AI conversation will be permanently removed. Your monthly usage will stay unchanged.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear all',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAllAiConversations(token);
            queryClient.setQueryData(['ai-conversations'], []);
            setActiveConversationId(null);
            setIsDraftConversation(true);
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Could not clear AI chats.');
          }
        },
      },
    ]);
  }

  const overview = overviewQuery.data;
  const metrics = overview?.metrics;
  const messages = effectiveConversationId ? (conversationQuery.data?.messages || []) : [];
  const isBusy = isSending || isAnalysing;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.keyboardContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 110 : 0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListHeaderComponent={
              <View style={styles.headerContent}>
                <View style={styles.heroCard}>
                  <View style={styles.heroTopRow}>
                    <View style={styles.aiMark}>
                      <Image source={{ uri: BASCARDO_LOGO_URL }} style={styles.aiLogo} resizeMode="contain" accessibilityLabel="Bascardo AI logo" />
                    </View>
                    <View style={styles.heroCopy}>
                      <ThemedText type="subtitle" style={styles.heroTitle}>What can Bascardo AI help you with?</ThemedText>
                      <ThemedText type="small" style={styles.heroSubtitle}>Ask a question or analyze your business performance.</ThemedText>
                    </View>
                  </View>

                  <ThemedText type="small" style={styles.heroDefinition}>
                    Bascardo AI analyzes your sales and business activity to reveal trends, identify opportunities, and recommend actions to help you grow.
                  </ThemedText>

                  <View style={styles.planRow}>
                    <View style={styles.planPill}>
                      <ThemedText type="smallBold" style={styles.planText}>{overview?.plan.name || 'Free'} plan</ThemedText>
                    </View>
                    <ThemedText type="small" style={styles.creditText}>
                      {overview ? `${overview.usage.creditsRemaining}/${overview.usage.creditsLimit} credits left` : 'Loading credits…'}
                    </ThemedText>
                  </View>

                  <Pressable onPress={() => router.push('/ai-subscription' as never)} style={styles.subscriptionButton}>
                    <Ionicons name="diamond" size={17} color={Palette.blueDark} />
                    <ThemedText style={styles.subscriptionButtonText}>AI subscription</ThemedText>
                    <Ionicons name="chevron-forward" size={17} color={Palette.blueDark} />
                  </Pressable>
                </View>

                <View style={styles.quickSection}>
                  <ThemedText type="smallBold" style={styles.sectionTitle}>WHAT WOULD YOU LIKE TO DO?</ThemedText>
                  <View style={styles.quickGrid}>
                    <QuickAction
                      icon="stats-chart"
                      title="Analyze My Sales"
                      subtitle="Trends and opportunities"
                      tint={Palette.yellowSoft}
                      ink={Palette.yellowInk}
                      disabled={isBusy}
                      onPress={() => void runAi('business_analysis', 'Analyze my catalogue sales for the last 30 days, compare them with the previous 30 days, identify trends and opportunities, and recommend my next actions.')}
                    />
                    <QuickAction
                      icon="pricetags"
                      title="Improve My Products"
                      subtitle="Catalogue recommendations"
                      tint={Palette.blueSoft}
                      ink={Palette.blueDark}
                      disabled={isBusy}
                      onPress={() => void runAi('chat', 'Review my current catalogue performance and recommend specific improvements to my product titles, descriptions, prices, and product mix using only the data available.')}
                    />
                    <QuickAction
                      icon="megaphone"
                      title="Marketing Ideas"
                      subtitle="Actions to reach buyers"
                      tint="#DCFCE7"
                      ink={Palette.green}
                      disabled={isBusy}
                      onPress={() => void runAi('chat', 'Give me practical marketing ideas for my FlyMadd catalogue based on my products, recent sales, votes, stage, and leaderboard position.')}
                    />
                    <QuickAction
                      icon="chatbubble-ellipses"
                      title="Ask Anything"
                      subtitle="Chat with Bascardo AI"
                      tint={Palette.ashSoft}
                      ink={Palette.slateDark}
                      disabled={false}
                      onPress={() => inputRef.current?.focus()}
                    />
                  </View>
                </View>

                {metrics ? (
                  <View style={styles.metricsSection}>
                    <View style={styles.sectionHeading}>
                      <ThemedText type="smallBold" style={styles.sectionTitle}>LAST 30 DAYS</ThemedText>
                      <Ionicons name="analytics" size={18} color={Palette.blue} />
                    </View>
                    <View style={styles.metricsGrid}>
                      <MetricCard icon="cash" label="Sales" value={money(metrics.catalogue.revenue30DaysUsd)} tint={Palette.blueSoft} ink={Palette.blueDark} />
                      <MetricCard icon="bag-check" label="Orders" value={String(metrics.catalogue.orders30Days)} tint={Palette.yellowSoft} ink={Palette.yellowInk} />
                      <MetricCard icon="heart" label="New votes" value={metrics.votes.last30Days === null ? '—' : metrics.votes.last30Days.toLocaleString()} tint={Palette.ashSoft} ink={Palette.slateDark} />
                      <MetricCard icon="trophy" label="Position" value={metrics.leadership.position ? `#${metrics.leadership.position}` : '—'} tint="#DCFCE7" ink={Palette.green} />
                    </View>
                    <View style={styles.metricNote}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {metrics.catalogue.activeListings} active listings · Average order {money(metrics.catalogue.averageOrderValueUsd)}
                        {metrics.catalogue.revenueGrowthPercent === null ? ' · No prior-period sales comparison yet' : ` · ${metrics.catalogue.revenueGrowthPercent >= 0 ? '+' : ''}${metrics.catalogue.revenueGrowthPercent}% vs prior 30 days`}
                      </ThemedText>
                    </View>
                    <Pressable
                      onPress={() => void runAi('business_analysis')}
                      disabled={isBusy}
                      style={({ pressed }) => [styles.analysisButton, pressed && styles.pressed, isBusy && styles.disabled]}
                    >
                      {isAnalysing ? <ActivityIndicator color={Palette.yellowInk} /> : <Ionicons name="stats-chart" size={19} color={Palette.yellowInk} />}
                      <View style={styles.analysisCopy}>
                        <ThemedText type="smallBold" style={styles.analysisTitle}>
                          {overview?.plan.businessAnalysis ? 'Analyse my business' : 'Unlock business analysis'}
                        </ThemedText>
                        <ThemedText type="small" style={styles.analysisSubtitle}>
                          {overview?.plan.businessAnalysis ? `${overview.actionCosts.business_analysis} AI credits` : 'Available with Pro and Business'}
                        </ThemedText>
                      </View>
                      <Ionicons name={overview?.plan.businessAnalysis ? 'sparkles' : 'lock-closed'} size={18} color={Palette.yellowInk} />
                    </Pressable>
                  </View>
                ) : overviewQuery.isLoading ? (
                  <ActivityIndicator color={Palette.blue} style={styles.overviewLoading} />
                ) : (
                  <Pressable onPress={() => overviewQuery.refetch()} style={styles.retryCard}>
                    <Ionicons name="refresh" size={18} color={Palette.red} />
                    <ThemedText type="small" style={styles.errorText}>Couldn&apos;t load business metrics. Tap to retry.</ThemedText>
                  </Pressable>
                )}

                <View style={styles.chatTools}>
                  <View style={styles.sectionHeading}>
                    <ThemedText type="smallBold" style={styles.sectionTitle}>AI CONVERSATIONS</ThemedText>
                    <View style={styles.toolButtons}>
                      <Pressable onPress={startNewChat} style={styles.toolButton} accessibilityLabel="Start new AI chat">
                        <Ionicons name="add" size={18} color={Palette.blue} />
                        <ThemedText type="smallBold" style={styles.toolButtonText}>New</ThemedText>
                      </Pressable>
                      <Pressable onPress={confirmClearAll} disabled={!conversationsQuery.data?.length} style={[styles.toolButton, !conversationsQuery.data?.length && styles.disabled]} accessibilityLabel="Clear all AI chats">
                        <Ionicons name="trash-outline" size={17} color={Palette.red} />
                      </Pressable>
                    </View>
                  </View>

                  {conversationsQuery.data?.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyRow}>
                      {conversationsQuery.data.map((conversation) => {
                        const selected = conversation.id === effectiveConversationId;
                        return (
                          <Pressable
                            key={conversation.id}
                            onPress={() => {
                              setIsDraftConversation(false);
                              setActiveConversationId(conversation.id);
                            }}
                            style={[styles.historyPill, { borderColor: selected ? Palette.blue : theme.backgroundSelected, backgroundColor: selected ? Palette.blueSoft : theme.backgroundElement }]}
                          >
                            <Ionicons name="chatbubble-outline" size={14} color={selected ? Palette.blueDark : theme.textSecondary} />
                            <ThemedText type="small" numberOfLines={1} style={[styles.historyText, selected && styles.historyTextSelected]}>{conversation.title}</ThemedText>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : null}

                  <View style={styles.currentChatRow}>
                    <ThemedText type="smallBold">{effectiveConversationId ? conversationQuery.data?.conversation.title || 'Conversation' : 'New conversation'}</ThemedText>
                    {effectiveConversationId ? (
                      <Pressable onPress={confirmDeleteCurrent} style={styles.deleteChatButton} accessibilityLabel="Delete current AI chat">
                        <Ionicons name="trash-outline" size={16} color={Palette.red} />
                        <ThemedText type="smallBold" style={styles.deleteChatText}>Delete chat</ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            }
            ListEmptyComponent={
              conversationQuery.isLoading && effectiveConversationId ? (
                <ActivityIndicator color={Palette.blue} style={styles.chatLoading} />
              ) : (
                <View style={styles.emptyChat}>
                  <View style={styles.emptyIcon}><Ionicons name="sparkles" size={26} color={Palette.yellowInk} /></View>
                  <ThemedText type="smallBold">Start a clean AI chat</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
                    Ask which product to promote, how to improve sales, or what your votes and leaderboard position mean.
                  </ThemedText>
                </View>
              )
            }
            renderItem={({ item }) => <AiMessageBubble item={item} />}
          />

          <View style={[styles.composer, { backgroundColor: theme.backgroundElement, borderTopColor: theme.backgroundSelected }]}>
            {error ? <ThemedText type="small" style={styles.errorText}>{error}</ThemedText> : null}
            <View style={[styles.inputWrap, { borderColor: theme.backgroundSelected, backgroundColor: theme.background }]}>
              <TextInput
                ref={inputRef}
                value={question}
                onChangeText={setQuestion}
                placeholder="Ask about your business or FlyMadd…"
                placeholderTextColor={theme.textSecondary}
                multiline
                maxLength={2000}
                editable={!isBusy}
                onFocus={() => requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }))}
                onContentSizeChange={() => requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }))}
                style={[styles.input, { color: theme.text }]}
              />
              <Pressable
                onPress={() => void runAi('chat')}
                disabled={!question.trim() || isBusy}
                style={[styles.sendButton, (!question.trim() || isBusy) && styles.disabled]}
                accessibilityLabel="Send message to Bascardo AI"
              >
                {isSending ? <ActivityIndicator color={Palette.white} /> : <Ionicons name="arrow-up" size={21} color={Palette.white} />}
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={styles.composerHint}>
              Chat uses {overview?.actionCosts.chat || 1} credit · AI can make mistakes, so verify important decisions.
            </ThemedText>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function MetricCard({ icon, label, value, tint, ink }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; tint: string; ink: string }) {
  return (
    <View style={[styles.metricCard, { backgroundColor: tint }]}>
      <Ionicons name={icon} size={18} color={ink} />
      <ThemedText type="subtitle" style={[styles.metricValue, { color: ink }]}>{value}</ThemedText>
      <ThemedText type="small" style={[styles.metricLabel, { color: ink }]}>{label}</ThemedText>
    </View>
  );
}

function QuickAction({ icon, title, subtitle, tint, ink, disabled, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  tint: string;
  ink: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.quickCard, { backgroundColor: tint }, pressed && styles.pressed, disabled && styles.disabled]}>
      <Ionicons name={icon} size={21} color={ink} />
      <ThemedText type="smallBold" style={[styles.quickTitle, { color: ink }]}>{title}</ThemedText>
      <ThemedText type="small" style={[styles.quickSubtitle, { color: ink }]}>{subtitle}</ThemedText>
    </Pressable>
  );
}

function AiMessageBubble({ item }: { item: AiMessage }) {
  const isUser = item.role === 'user';
  const timestamp = new Date(item.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.aiBubble]}>
      <View style={styles.messageMeta}>
        {isUser ? (
          <Ionicons name="person" size={14} color={Palette.white} />
        ) : (
          <Image source={{ uri: BASCARDO_LOGO_URL }} style={styles.messageLogo} resizeMode="contain" />
        )}
        <ThemedText type="smallBold" style={{ color: isUser ? Palette.white : Palette.yellowInk }}>{isUser ? 'You' : 'Bascardo AI'}</ThemedText>
        <ThemedText type="small" style={[styles.messageTime, { color: isUser ? '#DBEAFE' : '#92400E' }]}>{timestamp}</ThemedText>
      </View>
      <ThemedText type="small" style={[styles.messageContent, { color: isUser ? Palette.white : Palette.yellowInk }]}>{item.content}</ThemedText>
      {isUser && item.credits_charged > 0 ? <ThemedText type="small" style={styles.creditCharge}>{item.credits_charged} credit{item.credits_charged === 1 ? '' : 's'}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  keyboardContainer: { flex: 1 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  headerContent: { gap: Spacing.three, marginBottom: Spacing.three },
  heroCard: { backgroundColor: Palette.blueDark, borderRadius: 24, padding: Spacing.three, gap: Spacing.three, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.18, shadowRadius: 14, elevation: 5 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  aiMark: { width: 52, height: 52, borderRadius: 17, backgroundColor: Palette.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  aiLogo: { width: 45, height: 45, borderRadius: 14 },
  heroCopy: { flex: 1, gap: 3 },
  heroTitle: { color: Palette.white, fontSize: 19, lineHeight: 24 },
  heroSubtitle: { color: '#BFDBFE', lineHeight: 18 },
  heroDefinition: { color: '#E2E8F0', lineHeight: 19 },
  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planPill: { backgroundColor: Palette.yellowSoft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  planText: { color: Palette.yellowInk },
  creditText: { color: '#E2E8F0' },
  subscriptionButton: { minHeight: 48, borderRadius: 14, backgroundColor: Palette.white, paddingHorizontal: Spacing.three, alignItems: 'center', flexDirection: 'row', gap: Spacing.two },
  subscriptionButtonText: { color: Palette.blueDark, fontWeight: '800', flex: 1 },
  quickSection: { gap: Spacing.two },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  quickCard: { width: '48%', flexGrow: 1, minHeight: 116, borderRadius: 17, padding: 12, gap: 4 },
  quickTitle: { marginTop: 4, lineHeight: 18 },
  quickSubtitle: { opacity: 0.82, lineHeight: 16 },
  metricsSection: { gap: Spacing.two },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: Palette.slate, letterSpacing: 1.1, fontSize: 12 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metricCard: { width: '48%', flexGrow: 1, borderRadius: 17, padding: 12, gap: 2, minHeight: 100 },
  metricValue: { fontSize: 21, lineHeight: 27, marginTop: 4 },
  metricLabel: { opacity: 0.84 },
  metricNote: { paddingHorizontal: 2 },
  analysisButton: { minHeight: 62, borderRadius: 17, backgroundColor: Palette.yellowSoft, borderWidth: 1, borderColor: '#FDE68A', paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: 12 },
  analysisCopy: { flex: 1 },
  analysisTitle: { color: Palette.yellowInk },
  analysisSubtitle: { color: '#92400E' },
  overviewLoading: { marginVertical: Spacing.four },
  retryCard: { borderRadius: 14, backgroundColor: Palette.redSoft, padding: Spacing.three, flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  chatTools: { gap: Spacing.two },
  toolButtons: { flexDirection: 'row', gap: Spacing.one },
  toolButton: { minHeight: 34, borderRadius: 10, backgroundColor: Palette.ashSoft, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  toolButtonText: { color: Palette.blue },
  historyRow: { gap: Spacing.two, paddingRight: Spacing.three },
  historyPill: { maxWidth: 210, minHeight: 38, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyText: { maxWidth: 165 },
  historyTextSelected: { color: Palette.blueDark, fontWeight: '700' },
  currentChatRow: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  deleteChatButton: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6 },
  deleteChatText: { color: Palette.red, fontSize: 12 },
  chatLoading: { marginVertical: Spacing.four },
  emptyChat: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingHorizontal: Spacing.four },
  emptyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: Palette.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  emptyText: { textAlign: 'center', lineHeight: 19 },
  messageBubble: { maxWidth: '90%', borderRadius: 18, padding: Spacing.three, gap: Spacing.one, elevation: 2, shadowColor: Palette.slateDark, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.09, shadowRadius: 5 },
  userBubble: { backgroundColor: Palette.blue, alignSelf: 'flex-end', borderBottomRightRadius: 5 },
  aiBubble: { backgroundColor: Palette.yellowSoft, alignSelf: 'flex-start', borderBottomLeftRadius: 5, borderWidth: 1, borderColor: '#FDE68A' },
  messageMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  messageLogo: { width: 18, height: 18, borderRadius: 5 },
  messageTime: { marginLeft: 'auto', fontSize: 10 },
  messageContent: { lineHeight: 20 },
  creditCharge: { color: '#BFDBFE', fontSize: 10, textAlign: 'right' },
  composer: { borderTopWidth: 1, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Platform.OS === 'ios' ? Spacing.four : Spacing.three, gap: 6, elevation: 9, shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.08, shadowRadius: 9 },
  inputWrap: { minHeight: 54, maxHeight: 130, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: Spacing.three, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, minHeight: 40, maxHeight: 112, fontSize: 15, paddingVertical: 9, textAlignVertical: 'top' },
  sendButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: Palette.blue, alignItems: 'center', justifyContent: 'center' },
  composerHint: { fontSize: 10, textAlign: 'center' },
  errorText: { color: Palette.red, flex: 1 },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.76 },
});
