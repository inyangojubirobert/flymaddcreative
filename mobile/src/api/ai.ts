import { apiFetch } from '@/lib/api-client';

export type AiPlanId = 'free' | 'pro' | 'business';
export type AiAction = 'chat' | 'business_analysis';

export type AiPlan = {
  id: AiPlanId;
  name: string;
  monthlyCredits: number;
  priceUsd: number;
  businessAnalysis: boolean;
};

export type AiUsage = {
  creditsLimit: number;
  creditsUsed: number;
  creditsRemaining: number;
  requestsCount: number;
  inputTokens: number;
  outputTokens: number;
  resetsAt: string;
};

export type AiMetrics = {
  profile: {
    name: string;
    username: string;
    currentStage: string | null;
    joinedAt: string | null;
  };
  catalogue: {
    totalListings: number;
    activeListings: number;
    revenue30DaysUsd: number;
    previousRevenue30DaysUsd: number;
    revenueGrowthPercent: number | null;
    orders30Days: number;
    averageOrderValueUsd: number;
    topProducts: { itemId: string; title: string; units: number; revenueUsd: number }[];
    unsoldListings: { id: string; title: string; priceUsd: number }[];
  };
  votes: {
    total: number;
    last30Days: number | null;
    previous30Days: number | null;
  };
  leadership: {
    position: number | null;
    currentStage: string | null;
  };
};

export type AiOverview = {
  plan: AiPlan;
  usage: AiUsage;
  plans: AiPlan[];
  actionCosts: Record<AiAction, number>;
  storeProducts: {
    googlePlay: Record<Exclude<AiPlanId, 'free'>, string>;
  };
  subscription?: {
    plan: AiPlanId;
    provider: string | null;
    status: string;
    product_id?: string | null;
    current_period_end?: string | null;
    pending_product_id?: string | null;
    auto_renewing?: boolean | null;
  };
  billing?: {
    integrationVersion: number;
    packageName: string;
    subscriptions: {
      provider: string;
      product_id: string | null;
      plan: AiPlanId;
      status: string;
      current_period_end: string | null;
      pending_product_id: string | null;
      auto_renewing: boolean | null;
    }[];
  };
  metrics: AiMetrics;
};

export type AiConversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type AiMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  kind: AiAction;
  content: string;
  credits_charged: number;
  created_at: string;
};

export async function getAiOverview(token: string): Promise<AiOverview> {
  return apiFetch('/api/onedream/ai-overview', { token });
}

export async function getAiConversations(token: string): Promise<AiConversation[]> {
  const data = await apiFetch<{ conversations: AiConversation[] }>('/api/onedream/ai-conversations', { token });
  return data.conversations || [];
}

export async function getAiConversation(token: string, id: string): Promise<{ conversation: AiConversation; messages: AiMessage[] }> {
  return apiFetch(`/api/onedream/ai-conversations/${encodeURIComponent(id)}`, { token });
}

export async function deleteAiConversation(token: string, id: string): Promise<void> {
  await apiFetch(`/api/onedream/ai-conversations/${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

export async function deleteAllAiConversations(token: string): Promise<void> {
  await apiFetch('/api/onedream/ai-conversations', { method: 'DELETE', token });
}

export async function sendAiMessage(
  token: string,
  input: { question?: string; conversationId?: string | null; action: AiAction },
): Promise<{ conversation: AiConversation; messages: AiMessage[]; usage: AiUsage }> {
  return apiFetch('/api/onedream/ai-chat', {
    method: 'POST',
    token,
    body: {
      question: input.question,
      conversation_id: input.conversationId || undefined,
      action: input.action,
    },
  });
}

export async function verifyGooglePlayAiSubscription(
  token: string,
  input: { productId: string; purchaseToken: string },
): Promise<{ success: boolean; active: boolean; purchaseActive: boolean; status: string; plan: AiPlan; currentPeriodEnd: string | null; pendingProductId: string | null; message: string }> {
  return apiFetch('/api/onedream/ai-subscription/google-play', {
    method: 'POST',
    token,
    body: { product_id: input.productId, purchase_token: input.purchaseToken },
  });
}
