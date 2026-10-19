// Paid voting is retired (owner decision, 19 October 2026). Dream Coins and
// virtual gifts replace it. Vote records and participants.total_votes are kept
// as history; no route may sell, credit or pay out votes any more.

export const PAID_VOTING_RETIRED = true;

export const PAID_VOTING_RETIRED_MESSAGE =
  'Paid voting has ended. Support creators and sellers with Dream Coins and gifts instead.';

// Sends 410 Gone and returns true when paid voting is retired.
export function refuseRetiredVoting(res) {
  if (!PAID_VOTING_RETIRED) return false;
  res.status(410).json({ error: PAID_VOTING_RETIRED_MESSAGE, retired: true });
  return true;
}
