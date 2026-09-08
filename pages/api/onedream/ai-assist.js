import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

function cleanQuestion(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

// Keep the project explanation in a table that non-developers can update in
// Supabase. If the migration has not reached an environment yet, a small
// fallback still gives the assistant truthful core guidance rather than
// failing a user's support request.
const FALLBACK_PROJECT_KNOWLEDGE = [
  {
    category: 'Bascardo AI',
    question: 'What is Bascardo AI?',
    answer: 'Bascardo AI analyzes your sales and business activity to reveal trends, identify opportunities, and recommend actions to help you grow. Open its dedicated mobile dashboard for AI chat, business analysis, sales insights, recommendations, and chat history.'
  },
  {
    category: 'Catalogue',
    question: 'How do I build my catalogue in the mobile app?',
    answer: 'Sign in, open Profile, choose My Listings, then select + New Listing. Add a title, description, USD price, artwork image URL, and choose whether the listing is live. Save it, then use your public profile’s View Shop button to check what buyers see.'
  },
  {
    category: 'One Dream Initiative',
    question: 'What is the One Dream Initiative?',
    answer: 'It is FlyMadd Creative’s referral and voting rewards programme. Participants share their profile or referral link, build support through votes, progress through stages, and can request withdrawals of their available earnings.'
  },
  {
    category: 'Support',
    question: 'Where can I ask for help?',
    answer: 'Open Profile and choose Support Messages to contact FlyMadd Support. Bascardo AI has its own dashboard and can also be opened from the support shortcut.'
  }
];

async function getProjectKnowledge() {
  const { data, error } = await supabase
    .from('project_faqs')
    .select('category, question, answer, keywords, sort_order')
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(40);

  if (error) {
    // The table may not exist on a preview deployment that has not run the
    // migration. Do not reveal database details to the user or take the AI
    // service down because of that deployment mismatch.
    console.error('Project FAQ context unavailable:', error.message);
    return FALLBACK_PROJECT_KNOWLEDGE;
  }

  return data?.length ? data : FALLBACK_PROJECT_KNOWLEDGE;
}

// Builds the assistant's context strictly from the requesting participant's
// own records - it must never see or reference another participant's data.
async function buildParticipantContext(participant) {
  const [{ data: profile }, { data: recentMessages }, { data: withdrawals }] = await Promise.all([
    supabase
      .from('participants')
      .select('username, name, total_votes, current_stage, user_code, created_at')
      .eq('id', participant.id)
      .maybeSingle(),
    supabase
      .from('support_messages')
      .select('sender_type, body, created_at')
      .eq('participant_id', participant.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('participant_withdrawals')
      .select('amount_usd, status, created_at')
      .eq('username', participant.username)
      .order('created_at', { ascending: false })
      .limit(5)
  ]);

  return { profile: profile || null, recentMessages: (recentMessages || []).reverse(), withdrawals: withdrawals || [] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const question = cleanQuestion(req.body?.question);
  if (!question) return res.status(400).json({ error: 'Ask Bascardo a question first.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI assistant is not configured.' });

  try {
    const { error: questionSaveError } = await supabase
      .from('support_messages')
      .insert({
        participant_id: participant.id,
        sender_type: 'participant',
        message_type: 'general',
        body: question
      });
    if (questionSaveError) throw questionSaveError;

    const [context, projectKnowledge] = await Promise.all([
      buildParticipantContext(participant),
      getProjectKnowledge()
    ]);

    const systemPrompt = `You are "Bascardo AI", FlyMadd Creative's AI business adviser and app assistant. Bascardo AI analyzes the participant's sales and business activity to reveal trends, identify opportunities, and recommend actions to help them grow.
Rules:
- Only use the participant data provided below to answer account-specific questions. Never invent or reference data belonging to any other user.
- Use the approved Project knowledge below for questions about the app, catalogue, payments, voting, withdrawals, and FlyMadd Creative. Treat it as the source of truth. If the answer is not in the knowledge or participant data, say what you do know and direct the user to FlyMadd Support; do not invent product rules, prices, deadlines, or account status.
- Keep answers concise, friendly, and helpful. If the data below doesn't contain what's needed to answer an account question, say so honestly instead of guessing.

Project knowledge (approved FAQs):
${JSON.stringify(projectKnowledge, null, 2)}

Participant data (belongs only to the user asking):
${JSON.stringify(context, null, 2)}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Bascardo AI is unavailable right now.' });
    }

    const data = await response.json();
    const answer = (data?.content || []).map((block) => block.text || '').join('').trim()
      || "Sorry, I couldn't come up with a response.";

    const { data: saved, error: saveError } = await supabase
      .from('support_messages')
      .insert({
        participant_id: participant.id,
        sender_type: 'ai',
        message_type: 'ai_response',
        body: answer
      })
      .select('id, sender_type, message_type, body, read_at, created_at')
      .single();
    if (saveError) throw saveError;

    return res.status(200).json({ success: true, message: saved });
  } catch (error) {
    console.error('Bascardo AI assist error:', error);
    return res.status(500).json({ error: 'Unable to get a response from Bascardo AI.' });
  }
}
