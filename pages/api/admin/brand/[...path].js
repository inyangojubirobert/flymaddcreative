// Admin: brand network - manage the ads for our products that run across all
// our apps (Book of Memes hub, lib/brandNetwork.js). A pass-through that adds
// the server-only BRAND_NETWORK_KEY; the key never reaches the browser.
//   GET   /api/admin/brand/products        list + 30-day views/taps
//   POST  /api/admin/brand/products        add
//   PATCH /api/admin/brand/products/<id>   edit ({ status: 'paused' | 'active' | 'archived', ... })

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb } from '../../../../lib/ads';
import { brandAdminFetch } from '../../../../lib/brandNetwork';

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;
  if (!process.env.BRAND_NETWORK_KEY) {
    return res.status(503).json({ error: 'BRAND_NETWORK_KEY is not set on the server (make it in Book of Memes: Our products > Partner app keys)' });
  }

  const [section, id, ...rest] = Array.isArray(req.query.path) ? req.query.path : [];
  if (section !== 'products' || rest.length) return res.status(404).json({ error: 'Not found' });
  const allowed = id ? ['PATCH'] : ['GET', 'POST'];
  if (!allowed.includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid product id' });

  try {
    const r = await brandAdminFetch(id ? `/products/${encodeURIComponent(id)}` : '/products', req.method, req.body);
    const data = await r.json().catch(() => ({ error: `Brand network replied ${r.status}` }));
    // A rejected key is a server setting problem, not this admin's session:
    // don't pass 401/403 through (the admin portal signs out on those).
    if (r.status === 401 || r.status === 403) {
      return res.status(502).json({ error: `Brand network rejected BRAND_NETWORK_KEY: ${data?.error || r.status}` });
    }
    return res.status(r.status).json(data);
  } catch (error) {
    console.error('admin/brand error:', error.message || error);
    return res.status(502).json({ error: 'Brand network is unreachable' });
  }
}
