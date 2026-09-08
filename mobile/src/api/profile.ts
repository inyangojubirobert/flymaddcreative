import { apiFetch } from '../lib/api-client';

export type ProfileData = {
  bio?: string;
  media_type?: string;
  media_url?: string;
  media_title?: string;
  phone?: string;
  contact_email?: string;
  whatsapp?: string;
  instagram?: string;
  facebook?: string;
  twitter?: string;
  website?: string;
  contact_is_public?: boolean;
};

export async function getPublicProfile(username: string): Promise<ProfileData | null> {
  const data = await apiFetch<{ profile: ProfileData | null }>(
    `/api/onedream/profile/${encodeURIComponent(username)}?public=true`
  );
  return data.profile;
}

export type MilestoneProgress = {
  achievements: unknown[];
  totalAchieved: number;
  nextMilestone: { name: string; voteThreshold: number } | null;
  allMilestones: { id: string; name: string; voteThreshold: number; achieved: boolean; progress: number }[];
};

export async function getParticipantMilestones(username: string): Promise<MilestoneProgress> {
  return apiFetch(`/api/onedream/participant-milestones?username=${encodeURIComponent(username)}`);
}
