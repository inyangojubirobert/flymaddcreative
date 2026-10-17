// Short partner links: <site>/r/<code> (rewritten here by next.config.js).
//   listing link    -> records the click, then opens the listing in the web
//                      app with the attribution token (?aff=)
//   storefront link -> opens the partner's storefront; clicks are recorded
//                      when a listing there is opened
// Unknown or inactive links go to the shop, never to an error page.

import { earningsDb, must, recordAffiliateClick, siteUrl } from '../../../../lib/earnings';

export default async function handler(req, res) {
  const code = String(req.query.code || '');
  const fallback = `${siteUrl()}/app/shop`;
  if (!/^[A-Za-z0-9]{6,16}$/.test(code)) return res.redirect(302, fallback);

  try {
    const link = must(await earningsDb.from('affiliate_links').select('id, code, target, partner:affiliate_partners(handle, status)').eq('code', code).maybeSingle());
    if (!link || link.partner?.status !== 'active') return res.redirect(302, fallback);
    if (link.target !== 'membership') {
      const collection = link.target === 'collection' ? `&collection=${encodeURIComponent(code)}` : '';
      return res.redirect(302, `${siteUrl()}/app/m/${link.partner.handle}?via=${encodeURIComponent(code)}${collection}`);
    }
    const result = await recordAffiliateClick(code, null, String(req.headers['x-forwarded-for'] || '').split(',')[0] + String(req.headers['user-agent'] || ''));
    if (result.reply) return res.redirect(302, fallback);
    return res.redirect(302, `${siteUrl()}/app/catalogue/item/${result.click.item_id}?aff=${encodeURIComponent(result.token)}`);
  } catch (error) {
    console.error('affiliate/r error:', error);
    return res.redirect(302, fallback);
  }
}
