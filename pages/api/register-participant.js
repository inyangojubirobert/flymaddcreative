import { registerParticipant, getParticipantByEmail, getParticipantByUsername } from '../../src/backend/supabase';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { name, email, username } = req.body;

    // Validate
    if (!name || !email || !username) {
      return res.status(400).json({ error: 'Name, email, and username are required' });
    }

    // Check email
    const emailCheck = await getParticipantByEmail(email);
    if (emailCheck.success && emailCheck.data) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Check username  
    const usernameCheck = await getParticipantByUsername(username);
    if (usernameCheck.success && usernameCheck.data) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Register
    const result = await registerParticipant({ name, email, username });
    
    if (result.success) {
      return res.status(201).json(result);
    } else {
      return res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('Registration API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
