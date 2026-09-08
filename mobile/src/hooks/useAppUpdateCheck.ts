import { useEffect, useState } from 'react';
import Constants from 'expo-constants';

import { apiFetch } from '@/lib/api-client';

type AppVersionResponse = {
  android: { latestVersion: string; latestVersionCode: number; downloadUrl: string; releaseNotes: string };
};

type UpdateInfo = { downloadUrl: string; latestVersion: string; releaseNotes: string };

// Side-loaded APK/AAB has no Play Store/EAS auto-update - this polls our own
// backend once per app launch and compares against the installed
// android.versionCode (must be bumped in app.json on every release build).
export function useAppUpdateCheck() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<AppVersionResponse>('/api/app-version')
      .then((data) => {
        if (cancelled) return;
        const currentCode = Number(Constants.expoConfig?.android?.versionCode || 0);
        const { latestVersionCode, latestVersion, downloadUrl, releaseNotes } = data.android;
        if (downloadUrl && latestVersionCode > currentCode) {
          setUpdateInfo({ downloadUrl, latestVersion, releaseNotes });
        }
      })
      .catch(() => {}); // a failed update check must never block app usage
    return () => {
      cancelled = true;
    };
  }, []);

  return updateInfo;
}
