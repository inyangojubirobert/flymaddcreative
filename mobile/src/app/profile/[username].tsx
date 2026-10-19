import { StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { ThemedView } from '@/components/themed-view';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getParticipantByUsername } from '@/api/participants';
import { getPublicProfile } from '@/api/profile';
import { getRecognition } from '@/api/gifts';

export default function ParticipantProfileScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const router = useRouter();

  const participantQuery = useQuery({
    queryKey: ['participant', username],
    queryFn: () => getParticipantByUsername(username),
    enabled: !!username,
  });

  const profileQuery = useQuery({
    queryKey: ['profile', username],
    queryFn: () => getPublicProfile(username),
    enabled: !!username,
  });

  const recognitionQuery = useQuery({
    queryKey: ['recognition', username],
    queryFn: () => getRecognition(username),
    enabled: !!username,
  });

  if (participantQuery.isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator size="large" style={styles.loading} />
      </ThemedView>
    );
  }

  if (participantQuery.isError || !participantQuery.data) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.loading}>Participant not found.</ThemedText>
      </ThemedView>
    );
  }

  const participant = participantQuery.data;
  const recognition = recognitionQuery.data;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedText type="title" style={styles.name}>{participant.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">@{participant.username}</ThemedText>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">
              {(recognition?.recognition_points ?? 0).toLocaleString()} recognition points · {recognition?.supporters ?? 0} supporters
            </ThemedText>
            {participant.current_stage && (
              <ThemedText type="small" themeColor="textSecondary">Stage: {participant.current_stage}</ThemedText>
            )}
          </ThemedView>

          {profileQuery.data?.bio && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="default">{profileQuery.data.bio}</ThemedText>
            </ThemedView>
          )}

          <Pressable
            onPress={() => router.push({ pathname: '/gifts/send', params: { username: participant.username } } as never)}
            style={styles.giftButton}
          >
            <ThemedText style={styles.giftButtonText}>🎁 Send a gift</ThemedText>
          </Pressable>

          <Pressable onPress={() => router.push(`/catalogue/${participant.username}`)} style={styles.shopButton}>
            <ThemedText style={styles.shopButtonText}>🛍️ View Shop</ThemedText>
          </Pressable>

          <Pressable onPress={() => router.push(`/gifts/recognition/${participant.username}` as never)} style={styles.shopButton}>
            <ThemedText style={styles.shopButtonText}>🏅 Appreciation & badges</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  scrollContent: { paddingBottom: Spacing.four, gap: Spacing.three },
  loading: { marginTop: Spacing.six, textAlign: 'center' },
  name: { fontSize: 24, marginTop: Spacing.two },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.half },
  giftButton: {
    backgroundColor: '#1D4ED8',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  giftButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  shopButton: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1D4ED8',
  },
  shopButtonText: { color: '#1D4ED8', fontWeight: '600', fontSize: 16 },
});
