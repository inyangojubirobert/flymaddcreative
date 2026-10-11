// Retired: superseded by /api/onedream/verify-usdt-payment (verification) and
// /api/onedream/vote (crediting), which use the shared on-chain verifier.
// No client calls this route.
export default function handler(req, res) {
  return res.status(410).json({ success: false, message: 'This endpoint has been retired. Use /api/onedream/vote.' });
}
