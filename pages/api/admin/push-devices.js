import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function cleanToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!/^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(token)) return '';
  return token;
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;

  if (req.method === 'POST') {
    const expoPushToken = cleanToken(req.body?.expo_push_token);
    const platform = req.body?.platform === 'ios' ? 'ios' : req.body?.platform === 'android' ? 'android' : '';
    const deviceName = typeof req.body?.device_name === 'string' ? req.body.device_name.trim().slice(0, 80) : '';
    if (!expoPushToken || !platform) {
      return res.status(400).json({ error: 'A valid Expo push token and platform are required.' });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('admin_push_devices')
      .upsert({
        admin_user_id: admin.id,
        expo_push_token: expoPushToken,
        platform,
        device_name: deviceName || null,
        is_active: true,
        updated_at: now,
      }, { onConflict: 'expo_push_token' })
      .select('id, platform, device_name, is_active, updated_at')
      .single();

    if (error) {
      console.error('Admin push device register failed:', error);
      return res.status(500).json({ error: 'Unable to register this phone.' });
    }
    return res.status(200).json({ success: true, device: data });
  }

  if (req.method === 'DELETE') {
    const expoPushToken = cleanToken(req.body?.expo_push_token);
    if (!expoPushToken) return res.status(400).json({ error: 'A valid Expo push token is required.' });

    const { error } = await supabase
      .from('admin_push_devices')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('expo_push_token', expoPushToken)
      .eq('admin_user_id', admin.id);

    if (error) {
      console.error('Admin push device deactivate failed:', error);
      return res.status(500).json({ error: 'Unable to turn off alerts on this phone.' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
