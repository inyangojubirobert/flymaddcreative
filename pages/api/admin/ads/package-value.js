// Admin: ascending package value check (lib/adPackageValidation.js).
//   GET                                   -> warnings for active packages, with any exceptions
//   POST   { package_id, compared_package_id, rule, note } -> mark a current warning intentional
//   DELETE ?package_id=&compared_package_id=&rule=          -> remove that exception
// Warnings only: packages, prices and entitlements are never changed here.
// Exceptions need supabase/add_ad_package_value_exceptions.sql; without it the
// warnings still work and `exceptions_available` is false.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb } from '../../../../lib/ads';
import { applyExceptions, validatePackageLadder, warningKey } from '../../../../lib/adPackageValidation';

const TABLE = 'advertising_package_value_exceptions';
const missingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205' || /does not exist|schema cache/i.test(error?.message || '');

async function currentWarnings() {
  const { data, error } = await adsDb.from('advertising_packages')
    .select('id, kind, name, price_usd, duration_hours, max_creatives, placements, priority, is_active');
  if (error) throw error;
  return validatePackageLadder(data || []);
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const warnings = await currentWarnings();
      const { data: exceptions, error } = await adsDb.from(TABLE).select('*');
      if (error && !missingTable(error)) throw error;
      const marked = applyExceptions(warnings, error ? [] : exceptions);
      return res.status(200).json({
        warnings: marked,
        open: marked.filter((w) => !w.exception).length,
        exceptions_available: !error,
      });
    }

    const packageId = String(req.body?.package_id ?? req.query.package_id ?? '');
    const comparedId = String(req.body?.compared_package_id ?? req.query.compared_package_id ?? '');
    const rule = String(req.body?.rule ?? req.query.rule ?? '');

    if (req.method === 'POST') {
      const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
      if (!note) return res.status(400).json({ error: 'Explain why this difference is intentional' });
      const warning = (await currentWarnings()).find((w) => warningKey(w) === `${packageId}|${comparedId}|${rule}`);
      if (!warning) return res.status(404).json({ error: 'That warning no longer applies' });
      const { error } = await adsDb.from(TABLE).upsert({
        package_id: packageId,
        compared_package_id: comparedId,
        rule,
        signature: warning.signature,
        note,
        acknowledged_by: admin.id,
        acknowledged_by_email: admin.email,
        created_at: new Date().toISOString(),
      }, { onConflict: 'package_id,compared_package_id,rule' });
      if (error) {
        if (missingTable(error)) return res.status(503).json({ error: 'Run supabase/add_ad_package_value_exceptions.sql to enable exceptions' });
        throw error;
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { error } = await adsDb.from(TABLE).delete()
        .eq('package_id', packageId).eq('compared_package_id', comparedId).eq('rule', rule);
      if (error && !missingTable(error)) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin/ads/package-value error:', error);
    return res.status(500).json({ error: 'Package check failed' });
  }
}
