import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabase = createClient(
    process.env.SUPABASE_URL || 'https://pjtuisyvpvoswmcgxsfs.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'onedream_secret_2024';

function verifyToken(req) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    try {
        return jwt.verify(auth.slice(7), JWT_SECRET);
    } catch {
        return null;
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { username } = req.query;

    const { data: participant } = await supabase
        .from('participants')
        .select('id')
        .eq('username', username)
        .single();

    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    // ── GET ──────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const { data, error } = await supabase
            .from('participant_profiles')
            .select('*')
            .eq('participant_id', participant.id)
            .single();

        if (error && error.code !== 'PGRST116') {
            return res.status(500).json({ error: error.message });
        }

        const profile = data || null;

        // ?public=true — strip private contact fields if contact_is_public is false
        if (req.query.public === 'true' && profile) {
            const pub = {
                bio: profile.bio,
                media_type: profile.media_type,
                media_url: profile.media_url,
                media_title: profile.media_title,
                contact_is_public: profile.contact_is_public,
            };
            if (profile.contact_is_public) {
                pub.phone          = profile.phone;
                pub.contact_email  = profile.contact_email;
                pub.whatsapp       = profile.whatsapp;
                pub.instagram      = profile.instagram;
                pub.facebook       = profile.facebook;
                pub.twitter        = profile.twitter;
                pub.website        = profile.website;
            }
            return res.status(200).json({ profile: pub });
        }

        return res.status(200).json({ profile });
    }

    // ── POST (upsert) ────────────────────────────────────────────────────────
    if (req.method === 'POST') {
        const decoded = verifyToken(req);
        if (!decoded) return res.status(401).json({ error: 'Unauthorized' });
        if (decoded.userId !== participant.id) return res.status(403).json({ error: 'Forbidden' });

        const {
            bio,
            media_type, media_url, storage_path, media_title,
            phone, contact_email, whatsapp, instagram, facebook, twitter, website,
            contact_is_public
        } = req.body;

        // Validate media_type when provided
        const validMediaTypes = ['video_upload', 'photo_upload', 'youtube', 'external'];
        if (media_type && !validMediaTypes.includes(media_type)) {
            return res.status(400).json({ error: 'Invalid media_type' });
        }

        const profileData = {
            participant_id:   participant.id,
            bio:              bio?.trim()            ?? '',
            media_type:       media_type             ?? null,
            media_url:        media_url              ?? null,
            storage_path:     storage_path           ?? null,
            media_title:      media_title?.trim()    ?? '',
            phone:            phone?.trim()          ?? '',
            contact_email:    contact_email?.trim()  ?? '',
            whatsapp:         whatsapp?.trim()       ?? '',
            instagram:        instagram?.trim()      ?? '',
            facebook:         facebook?.trim()       ?? '',
            twitter:          twitter?.trim()        ?? '',
            website:          website?.trim()        ?? '',
            contact_is_public: contact_is_public === true || contact_is_public === 'true',
            updated_at:       new Date().toISOString(),
        };

        const { data, error } = await supabase
            .from('participant_profiles')
            .upsert(profileData, { onConflict: 'participant_id' })
            .select()
            .single();

        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ profile: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
