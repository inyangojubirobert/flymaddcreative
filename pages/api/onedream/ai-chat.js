import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import {
  AI_ACTION_COSTS,
  buildBusinessMetrics,
  getAiUsage,
  resolveAiPlan,
} from '../../../lib/aiFeature';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const FALLBACK_PROJECT_KNOWLEDGE = [
  {
    category: 'Bascardo AI',
    question: 'What is Bascardo AI?',
    answer: 'Bascardo AI analyzes your sales and business activity to reveal trends, identify opportunities, and recommend actions to help you grow. It has its own mobile interface for chat, analysis, insights, recommendations, and history.',
  },
  {
    category: 'Catalogue',
    question: 'How do I build my catalogue?',
    answer: 'Open Profile, choose My Listings, then select + New Listing. Add a title, description, USD price, product image, payment methods, and publish it when ready.',
  },
  {
    category: 'Voting',
    question: 'How do voting and the leaderboard work?',
    answer: 'Supporters use a participant profile or voting code to vote. Confirmed votes increase the participant total and leaderboard position. Higher totals can unlock new One Dream stages.',
  },
  {
    category: 'Orders',
    question: 'Where do sellers manage sales?',
    answer: 'Open Profile and choose My Orders. Sellers can view payment status, message buyers, and release eligible funds after buyer confirmation.',
  },
  {
    category: 'Support',
    question: 'How do I contact FlyMadd Support?',
    answer: 'Open Profile and choose Support Messages. AI conversations are kept separately from staff support messages.',
  },
];

function cleanQuestion(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

function titleFromQuestion(question) {
  const compact = question.replace(/\s+/g, ' ').trim();
  return compact.length > 64 ? `${compact.slice(0, 61)}...` : compact || 'New conversation';
}

async function getProjectKnowledge() {
  const { data, error } = await supabase
    .from('project_faqs')
    .select('category, question, answer, keywords, sort_order')
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .limit(40);
  return error || !data?.length ? FALLBACK_PROJECT_KNOWLEDGE : data;
}

async function getOwnedConversation(participantId, conversationId) {
  if (!conversationId) return null;
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('id, title, created_at, updated_at')
    .eq('id', conversationId)
    .eq('participant_id', participantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const action = req.body?.action === 'business_analysis' ? 'business_analysis' : 'chat';
  const defaultAnalysisQuestion = 'Analyse my FlyMadd business performance for the last 30 days. Explain my catalogue sales, products, votes, and leaderboard position, then give me practical next actions.';
  const question = cleanQuestion(req.body?.question) || (action === 'business_analysis' ? defaultAnalysisQuestion : '');
  const conversationId = req.body?.conversation_id ? String(req.body.conversation_id) : null;
  if (!question) return res.status(400).json({ error: 'Ask Bascardo a question first.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI assistant is not configured.' });

  let creditsReserved = false;
  const requiredCredits = AI_ACTION_COSTS[action];

  try {
    const plan = await resolveAiPlan(supabase, participant.id);
    if (action === 'business_analysis' && !plan.businessAnalysis) {
      return res.status(403).json({
        code: 'AI_PLAN_REQUIRED',
        error: 'Business analysis is available on Pro and Business plans.',
      });
    }

    const ownedConversation = await getOwnedConversation(participant.id, conversationId);
    if (conversationId && !ownedConversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const { data: consumed, error: consumeError } = await supabase.rpc('consume_ai_credits', {
      p_participant_id: participant.id,
      p_plan: plan.id,
      p_credits_limit: plan.monthlyCredits,
      p_credits: requiredCredits,
    });
    if (consumeError) {
      console.error('AI credit reservation error:', consumeError);
      return res.status(503).json({ error: 'AI usage tracking is being set up. Please try again later.' });
    }

    const creditState = Array.isArray(consumed) ? consumed[0] : consumed;
    if (!creditState?.allowed) {
      return res.status(429).json({
        code: 'AI_QUOTA_EXCEEDED',
        error: 'You have used all of your AI credits for this month.',
        usage: {
          creditsUsed: creditState?.credits_used ?? plan.monthlyCredits,
          creditsRemaining: creditState?.credits_remaining ?? 0,
          creditsLimit: plan.monthlyCredits,
        },
      });
    }
    creditsReserved = true;

    const [metrics, projectKnowledge, historyResult] = await Promise.all([
      buildBusinessMetrics(supabase, participant),
      getProjectKnowledge(),
      ownedConversation
        ? supabase
          .from('ai_messages')
          .select('role, content')
          .eq('conversation_id', ownedConversation.id)
          .eq('participant_id', participant.id)
          .order('created_at', { ascending: false })
          .limit(12)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (historyResult.error) throw historyResult.error;

    const history = (historyResult.data || []).reverse().map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const systemPrompt = `You are "Bascardo AI", FlyMadd Creative's private AI business adviser and app assistant. Bascardo AI analyzes the participant's sales and business activity to reveal trends, identify opportunities, and recommend actions to help them grow.
Rules:
- Use only the requesting participant's metrics below for account-specific answers. Never invent sales, views, votes, ranks, prices, or another user's data.
- Revenue includes paid, buyer-confirmed, and released catalogue orders. Do not call pending or disputed orders completed sales.
- A null growth percentage means there was no previous-period revenue; explain that plainly instead of claiming 100% growth.
- Unsold listings only means no completed order for those listings in the last 30 days. It does not prove that nobody viewed them.
- Use approved project knowledge for app guidance. If a rule is absent, direct the user to FlyMadd Support.
- Give concise, specific, practical recommendations. When data is sparse, say so and recommend the next measurable action.

Approved project knowledge:
${JSON.stringify(projectKnowledge, null, 2)}

Participant business metrics:
${JSON.stringify(metrics, null, 2)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: action === 'business_analysis' ? 900 : 650,
        system: systemPrompt,
        messages: [...history, { role: 'user', content: question }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      throw new Error('ai_provider_unavailable');
    }

    const data = await response.json();
    const answer = (data?.content || []).map((block) => block.text || '').join('').trim();
    if (!answer) throw new Error('empty_ai_response');

    let conversation = ownedConversation;
    if (!conversation) {
      const { data: created, error } = await supabase
        .from('ai_conversations')
        .insert({ participant_id: participant.id, title: titleFromQuestion(question) })
        .select('id, title, created_at, updated_at')
        .single();
      if (error) throw error;
      conversation = created;
    }

    const { data: savedMessages, error: saveError } = await supabase
      .from('ai_messages')
      .insert([
        {
          conversation_id: conversation.id,
          participant_id: participant.id,
          role: 'user',
          kind: action,
          content: question,
          credits_charged: requiredCredits,
        },
        {
          conversation_id: conversation.id,
          participant_id: participant.id,
          role: 'assistant',
          kind: action,
          content: answer,
          credits_charged: 0,
        },
      ])
      .select('id, conversation_id, role, kind, content, credits_charged, created_at');
    if (saveError) throw saveError;

    const now = new Date().toISOString();
    await supabase.from('ai_conversations').update({ updated_at: now }).eq('id', conversation.id);

    const inputTokens = Number(data?.usage?.input_tokens || 0);
    const outputTokens = Number(data?.usage?.output_tokens || 0);
    await supabase.rpc('record_ai_request_usage', {
      p_participant_id: participant.id,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_estimated_cost_usd: 0,
    });

    creditsReserved = false;
    const usage = await getAiUsage(supabase, participant.id, plan);
    return res.status(200).json({
      success: true,
      conversation: { ...conversation, updated_at: now },
      messages: savedMessages || [],
      usage,
    });
  } catch (error) {
    if (creditsReserved) {
      await supabase.rpc('refund_ai_credits', {
        p_participant_id: participant.id,
        p_credits: requiredCredits,
      });
    }
    console.error('Bascardo AI chat error:', error);
    const unavailable = error?.message === 'ai_provider_unavailable';
    return res.status(unavailable ? 502 : 500).json({
      error: unavailable ? 'Bascardo AI is unavailable right now.' : 'Unable to get a response from Bascardo AI.',
    });
  }
}
