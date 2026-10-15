import type { CampaignState } from '@/api/ads';
import { Palette } from '@/constants/theme';

/** Campaign status badge colours, shared by Promote and campaign analytics. */
export const STATE_BADGE: Record<CampaignState, { label: string; bg: string; ink: string }> = {
  draft: { label: 'Draft', bg: Palette.ashSoft, ink: Palette.slate },
  pending_review: { label: 'In review', bg: Palette.yellowSoft, ink: Palette.yellowInk },
  active: { label: 'Live', bg: '#DCFCE7', ink: Palette.green },
  paused: { label: 'Paused', bg: Palette.ashSoft, ink: Palette.slate },
  rejected: { label: 'Needs changes', bg: Palette.redSoft, ink: Palette.red },
  suspended: { label: 'Suspended', bg: Palette.redSoft, ink: Palette.red },
  revoked: { label: 'Ended (refunded)', bg: Palette.ashSoft, ink: Palette.slate },
  completed: { label: 'Completed', bg: Palette.blueSoft, ink: Palette.blueDark },
};
