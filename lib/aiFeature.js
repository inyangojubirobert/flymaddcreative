export const AI_PLAN_DEFINITIONS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyCredits: 25,
    priceUsd: 0,
    businessAnalysis: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyCredits: 200,
    priceUsd: 9,
    businessAnalysis: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    monthlyCredits: 750,
    priceUsd: 20,
    businessAnalysis: true,
  },
};

export const AI_ACTION_COSTS = {
  chat: 1,
  business_analysis: 5,
};

const COMPLETED_ORDER_STATUSES = new Set(['paid', 'buyer_confirmed', 'released']);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

export async function resolveAiSubscription(supabase, participantId) {
  const { data, error } = await supabase.rpc('get_ai_subscription_entitlement', { p_participant_id: participantId });
  if (error) throw error;
  return data;
}

export async function resolveAiPlan(supabase, participantId) {
  const subscription = await resolveAiSubscription(supabase, participantId);
  return AI_PLAN_DEFINITIONS[subscription?.plan] || AI_PLAN_DEFINITIONS.free;
}

export async function getAiUsage(supabase, participantId, plan) {
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('ai_usage_monthly')
    .select('credits_used, requests_count, input_tokens, output_tokens')
    .eq('participant_id', participantId)
    .eq('usage_month', month.toISOString().slice(0, 10))
    .maybeSingle();

  const creditsUsed = error ? 0 : number(data?.credits_used);
  return {
    creditsLimit: plan.monthlyCredits,
    creditsUsed,
    creditsRemaining: Math.max(plan.monthlyCredits - creditsUsed, 0),
    requestsCount: error ? 0 : number(data?.requests_count),
    inputTokens: error ? 0 : number(data?.input_tokens),
    outputTokens: error ? 0 : number(data?.output_tokens),
    resetsAt: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)).toISOString(),
  };
}

export async function buildBusinessMetrics(supabase, participant) {
  const now = Date.now();
  const currentStart = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const previousStart = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();

  const [profileResult, itemsResult, ordersResult, recentVotesResult, previousVotesResult] = await Promise.all([
    supabase
      .from('participants')
      .select('username, name, total_votes, current_stage, created_at')
      .eq('id', participant.id)
      .maybeSingle(),
    supabase
      .from('catalogue_items')
      .select('id, title, price_usd, status, created_at')
      .eq('seller_username', participant.username)
      .neq('status', 'deleted')
      .limit(500),
    supabase
      .from('catalogue_orders')
      .select('item_id, amount_usd, status, created_at, catalogue_items(title)')
      .eq('seller_username', participant.username)
      .gte('created_at', previousStart)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('votes')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', participant.id)
      .gte('created_at', currentStart),
    supabase
      .from('votes')
      .select('id', { count: 'exact', head: true })
      .eq('participant_id', participant.id)
      .gte('created_at', previousStart)
      .lt('created_at', currentStart),
  ]);

  const profile = profileResult.data || {
    username: participant.username,
    name: participant.username,
    total_votes: 0,
    current_stage: null,
    created_at: null,
  };
  const items = itemsResult.error ? [] : (itemsResult.data || []);
  const orders = ordersResult.error ? [] : (ordersResult.data || []);
  const completed = orders.filter((order) => COMPLETED_ORDER_STATUSES.has(order.status));
  const currentOrders = completed.filter((order) => order.created_at >= currentStart);
  const previousOrders = completed.filter((order) => order.created_at >= previousStart && order.created_at < currentStart);
  const revenue30Days = currentOrders.reduce((sum, order) => sum + number(order.amount_usd), 0);
  const previousRevenue30Days = previousOrders.reduce((sum, order) => sum + number(order.amount_usd), 0);
  const revenueGrowthPercent = previousRevenue30Days > 0
    ? round(((revenue30Days - previousRevenue30Days) / previousRevenue30Days) * 100, 1)
    : null;

  const itemPerformance = new Map();
  for (const order of currentOrders) {
    const title = order.catalogue_items?.title || 'Untitled product';
    const existing = itemPerformance.get(order.item_id) || { itemId: order.item_id, title, units: 0, revenueUsd: 0 };
    existing.units += 1;
    existing.revenueUsd += number(order.amount_usd);
    itemPerformance.set(order.item_id, existing);
  }
  const productPerformance = [...itemPerformance.values()]
    .map((item) => ({ ...item, revenueUsd: round(item.revenueUsd) }))
    .sort((a, b) => b.revenueUsd - a.revenueUsd);

  const totalVotes = number(profile.total_votes);
  const { count: aheadCount, error: rankError } = await supabase
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .gt('total_votes', totalVotes);

  return {
    profile: {
      name: profile.name,
      username: profile.username,
      currentStage: profile.current_stage,
      joinedAt: profile.created_at,
    },
    catalogue: {
      totalListings: items.length,
      activeListings: items.filter((item) => item.status === 'active').length,
      revenue30DaysUsd: round(revenue30Days),
      previousRevenue30DaysUsd: round(previousRevenue30Days),
      revenueGrowthPercent,
      orders30Days: currentOrders.length,
      averageOrderValueUsd: currentOrders.length ? round(revenue30Days / currentOrders.length) : 0,
      topProducts: productPerformance.slice(0, 5),
      unsoldListings: items
        .filter((item) => !itemPerformance.has(item.id))
        .slice(0, 5)
        .map((item) => ({ id: item.id, title: item.title, priceUsd: round(item.price_usd) })),
    },
    votes: {
      total: totalVotes,
      last30Days: recentVotesResult.error ? null : number(recentVotesResult.count),
      previous30Days: previousVotesResult.error ? null : number(previousVotesResult.count),
    },
    leadership: {
      position: rankError || aheadCount === null ? null : aheadCount + 1,
      currentStage: profile.current_stage,
    },
  };
}

export function publicPlanDefinitions() {
  return Object.values(AI_PLAN_DEFINITIONS).map((plan) => ({
    id: plan.id,
    name: plan.name,
    monthlyCredits: plan.monthlyCredits,
    priceUsd: plan.priceUsd,
    businessAnalysis: plan.businessAnalysis,
  }));
}
