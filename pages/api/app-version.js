// Lightweight "is a newer app build available" check for the mobile app,
// since there's no EAS/Play Store auto-update wired up - the app is
// side-loaded from a directly hosted APK/AAB. Values are read from env vars
// so a new release can be announced without a server code deploy: just bump
// APP_LATEST_VERSION (and APP_LATEST_VERSION_CODE) in Vercel's env vars when
// a new APK is uploaded.
export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  res.status(200).json({
    android: {
      latestVersion: process.env.APP_LATEST_VERSION || '1.0.0',
      latestVersionCode: Number(process.env.APP_LATEST_VERSION_CODE || 1),
      downloadUrl: process.env.APP_ANDROID_APK_URL || '',
      releaseNotes: process.env.APP_LATEST_RELEASE_NOTES || ''
    }
  });
}
