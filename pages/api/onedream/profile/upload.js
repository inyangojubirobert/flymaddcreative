import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import Busboy from 'busboy';

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'onedream_secret_2024';

const ALLOWED_VIDEO = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo'];
const ALLOWED_IMAGE = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;  //  10 MB

export const config = {
    api: { bodyParser: false }
};

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

    let decoded;
    try {
        decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    } catch {
        return res.status(401).json({ error: 'Invalid token' });
    }

    return new Promise((resolve) => {
        const busboy = Busboy({
            headers: req.headers,
            limits: { fileSize: MAX_VIDEO_BYTES, files: 1 }
        });

        let chunks = [];
        let mimeType = '';
        let originalName = 'media';
        let sizeLimitHit = false;

        busboy.on('file', (_field, file, info) => {
            mimeType     = info.mimeType || info.mimetype || '';
            originalName = info.filename || 'media';
            file.on('limit', () => { sizeLimitHit = true; });
            file.on('data',  (chunk) => chunks.push(chunk));
        });

        busboy.on('finish', async () => {
            if (sizeLimitHit) {
                res.status(413).json({ error: 'File too large. Videos max 100 MB, images max 10 MB.' });
                return resolve();
            }
            if (!chunks.length) {
                res.status(400).json({ error: 'No file provided.' });
                return resolve();
            }

            const isVideo = ALLOWED_VIDEO.includes(mimeType);
            const isImage = ALLOWED_IMAGE.includes(mimeType);

            if (!isVideo && !isImage) {
                res.status(400).json({ error: 'Unsupported file type. Allowed: mp4, webm, mov, avi, jpg, png, gif, webp.' });
                return resolve();
            }

            const fileBuffer = Buffer.concat(chunks);

            if (isImage && fileBuffer.length > MAX_IMAGE_BYTES) {
                res.status(413).json({ error: 'Image too large. Maximum 10 MB.' });
                return resolve();
            }

            const bucket     = isVideo ? 'participant-videos' : 'participant-photos';
            const rawExt     = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : '';
            const ext        = rawExt ? `.${rawExt}` : (isVideo ? '.mp4' : '.jpg');
            const storagePath = `${decoded.userId}/${Date.now()}${ext}`;

            const { error: uploadErr } = await supabase.storage
                .from(bucket)
                .upload(storagePath, fileBuffer, { contentType: mimeType, upsert: true });

            if (uploadErr) {
                res.status(500).json({ error: uploadErr.message });
                return resolve();
            }

            const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

            res.status(200).json({
                media_type:   isVideo ? 'video_upload' : 'photo_upload',
                storage_path: storagePath,
                public_url:   urlData.publicUrl,
                bucket,
            });
            resolve();
        });

        busboy.on('error', (err) => {
            res.status(500).json({ error: err.message });
            resolve();
        });

        req.pipe(busboy);
    });
}
