import { createClient } from '@supabase/supabase-js';
import Busboy from 'busboy';
import { requireActiveAdmin } from '../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const ALLOWED_IMAGE = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export const config = {
  api: { bodyParser: false }
};

// Admin-authenticated counterpart to /api/onedream/profile/upload (which only
// accepts participant tokens signed with a different JWT secret).
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;

  return new Promise((resolve) => {
    let busboy;
    try {
      busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
    } catch (err) {
      res.status(400).json({ error: 'Invalid upload request: ' + err.message });
      return resolve();
    }

    let chunks = [];
    let mimeType = '';
    let originalName = 'media';
    let sizeLimitHit = false;
    let fileReceived = false;

    busboy.on('file', (_field, file, info) => {
      fileReceived = true;
      mimeType = info.mimeType || info.mimetype || '';
      originalName = info.filename || 'media';

      file.on('limit', () => { sizeLimitHit = true; });
      file.on('data', (chunk) => chunks.push(chunk));
      file.on('error', (err) => {
        if (!res.headersSent) res.status(500).json({ error: 'File stream error: ' + err.message });
        resolve();
      });
    });

    busboy.on('finish', async () => {
      if (sizeLimitHit) {
        res.status(413).json({ error: 'Image too large. Maximum 10 MB.' });
        return resolve();
      }
      if (!fileReceived || !chunks.length) {
        res.status(400).json({ error: 'No file received.' });
        return resolve();
      }
      if (!ALLOWED_IMAGE.includes(mimeType)) {
        res.status(400).json({ error: `Unsupported file type "${mimeType}". Allowed: jpg, png, gif, webp.` });
        return resolve();
      }

      const fileBuffer = Buffer.concat(chunks);
      if (fileBuffer.length > MAX_IMAGE_BYTES) {
        res.status(413).json({ error: 'Image too large. Maximum 10 MB.' });
        return resolve();
      }

      const bucket = 'support-message-attachments';
      const rawExt = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : '';
      const ext = rawExt ? `.${rawExt}` : '.jpg';
      const storagePath = `admin-${admin.id}/${Date.now()}${ext}`;

      try {
        await supabase.storage.createBucket(bucket, { public: true }).catch(() => {});

        const { error: uploadErr } = await supabase.storage
          .from(bucket)
          .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: true });
        if (uploadErr) {
          res.status(500).json({ error: 'Storage upload failed: ' + uploadErr.message });
          return resolve();
        }

        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);
        res.status(200).json({ public_url: urlData.publicUrl });
      } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: 'Upload processing error: ' + err.message });
      }
      resolve();
    });

    busboy.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'Form parse error: ' + err.message });
      resolve();
    });

    req.on('data', (chunk) => busboy.write(chunk));
    req.on('end', () => busboy.end());
    req.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: 'Request error: ' + err.message });
      resolve();
    });
  });
}
