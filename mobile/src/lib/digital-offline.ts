import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';

import type { DigitalAssetKind, LicenseAccess } from '../api/digital';
import { bytesToBase64 } from './base64';
import { decryptToBytes, decryptToFile, encryptFile, importOfflineKey } from './digital-crypto';

// Offline copies of licensed digital products, kept ENCRYPTED in the app's
// private document storage (not the gallery or shared downloads). Each copy
// is encrypted with a key the server derives for this licence (or
// subscription item) on this device; the key lives in the device keystore and
// is deleted with the copy. Each copy has a manifest with an offline expiry:
// the Library re-checks licences when online and wipes refunded / revoked /
// expired copies (files and key). Deterrence, not DRM: a determined user with
// a rooted device can still capture content while it plays.
//
// Entries are licence ids, or "s_<itemId>" for items opened through a
// creator subscription.

const DEVICE_KEY = 'onedream_device_v1';
const MANIFEST = 'manifest.json';

export const offlineSupported = Platform.OS !== 'web';

let cachedDevice: string | null = null;
export async function digitalDeviceId(): Promise<string> {
  if (cachedDevice) return cachedDevice;
  const random = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  try {
    const stored = Platform.OS === 'web' ? globalThis.localStorage?.getItem(DEVICE_KEY) : await SecureStore.getItemAsync(DEVICE_KEY);
    if (stored && stored.length >= 16) return (cachedDevice = stored);
    const fresh = random();
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(DEVICE_KEY, fresh);
    else await SecureStore.setItemAsync(DEVICE_KEY, fresh);
    return (cachedDevice = fresh);
  } catch {
    return (cachedDevice = random());
  }
}

export type OfflineFile = {
  id: string;
  kind: DigitalAssetKind;
  title: string | null;
  position: number;
  format: string;
  pages?: string[];      // encrypted page image files (PDF e-book)
  file?: string;         // encrypted file (EPUB / audio / video)
  watermark?: string;    // EPUB reader watermark line
  duration_seconds: number | null;
};

export type OfflineManifest = {
  entry_id: string;
  item_id: string;
  title: string;
  kind: string;
  offline_until: string;
  downloaded_at: string;
  encrypted: true;
  files: OfflineFile[];
};

const safe = (id: string) => id.toLowerCase().replace(/[^0-9a-z_-]/g, '');
const root = () => new Directory(Paths.document, 'digital');
const entryDir = (entryId: string) => new Directory(root(), safe(entryId));
const keyName = (entryId: string) => `odk_${safe(entryId)}`;
const playDir = () => new Directory(Paths.cache, 'digital-play');
const tempDir = () => new Directory(Paths.cache, 'digital-dl');

export async function readManifest(entryId: string): Promise<OfflineManifest | null> {
  if (!offlineSupported) return null;
  try {
    const file = new File(entryDir(entryId), MANIFEST);
    if (!file.exists) return null;
    const manifest = JSON.parse(await file.text()) as OfflineManifest;
    // Past the offline window without a re-check, or the key is gone: the copy is useless.
    if (!manifest.encrypted || new Date(manifest.offline_until).getTime() < Date.now() || !(await SecureStore.getItemAsync(keyName(entryId)))) {
      await removeOffline(entryId);
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

export async function removeOffline(entryId: string) {
  if (!offlineSupported) return;
  try {
    const dir = entryDir(entryId);
    if (dir.exists) dir.delete();
  } catch {
    // nothing to remove
  }
  await SecureStore.deleteItemAsync(keyName(entryId)).catch(() => {});
}

/** Downloaded entry ids on this device. */
export function downloadedEntryIds(): string[] {
  if (!offlineSupported) return [];
  try {
    const dir = root();
    if (!dir.exists) return [];
    return dir.list().filter((entry) => entry instanceof Directory).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Keep only copies whose licence / subscription item is still active. */
export async function purgeInactive(activeEntryIds: string[]) {
  const keep = new Set(activeEntryIds.map(safe));
  for (const id of downloadedEntryIds()) if (!keep.has(id)) await removeOffline(id);
}

/** Decrypted media for playback is temporary; clear it when leaving the player / opening the Library. */
export function clearPlaybackCache() {
  if (!offlineSupported) return;
  try {
    const dir = playDir();
    if (dir.exists) dir.delete();
  } catch {
    // in use; cleared next time
  }
}

/** Refresh the offline window after a successful online licence check. */
export async function extendOffline(entryId: string, offlineUntil: string) {
  const manifest = await readManifest(entryId);
  if (!manifest) return;
  manifest.offline_until = offlineUntil;
  new File(entryDir(entryId), MANIFEST).write(JSON.stringify(manifest));
}

export function bytesUsed(entryId: string): number {
  if (!offlineSupported) return 0;
  try {
    const dir = entryDir(entryId);
    if (!dir.exists) return 0;
    return dir.list().reduce((sum, entry) => sum + (entry instanceof File ? entry.size || 0 : 0), 0);
  } catch {
    return 0;
  }
}

const tagFor = (entryId: string, name: string) => `${safe(entryId)}/${name}`;

async function entryKey(entryId: string) {
  const stored = await SecureStore.getItemAsync(keyName(entryId));
  if (!stored) throw new Error('This download is no longer valid. Go online and download it again.');
  return importOfflineKey(stored);
}

/** Downloads and encrypts every file of a licence / subscription item for offline use. */
export async function downloadForOffline(
  access: LicenseAccess,
  meta: { entry_id: string; item_id: string; title: string; kind: string },
  onProgress?: (done: number, total: number) => void,
): Promise<OfflineManifest> {
  if (!offlineSupported) throw new Error('Offline downloads are available in the mobile app');
  if (!access.offline_key) throw new Error('Offline downloads are not available right now. You can still read, listen or watch online.');
  const key = await importOfflineKey(access.offline_key);
  const dir = entryDir(meta.entry_id);
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  const temp = tempDir();
  temp.create({ intermediates: true, idempotent: true });

  const total = access.files.reduce((n, f) => n + (f.access.type === 'pages' ? f.access.pages.length : 1), 0);
  let done = 0;
  const files: OfflineFile[] = [];

  async function fetchEncrypted(url: string, name: string) {
    const plain = await File.downloadFileAsync(url, new File(temp, `${safe(meta.entry_id)}_${name}.tmp`), { idempotent: true });
    try {
      await encryptFile(plain, new File(dir, name), key, tagFor(meta.entry_id, name));
    } finally {
      if (plain.exists) plain.delete();   // never leave a plain copy behind
    }
  }

  try {
    for (const file of access.files) {
      const base = { id: file.id, kind: file.kind, title: file.title, position: file.position, format: file.format, duration_seconds: file.duration_seconds };
      if (file.access.type === 'pages') {
        const pages: string[] = [];
        for (let i = 0; i < file.access.pages.length; i += 1) {
          const name = `${file.id}_p${String(i + 1).padStart(4, '0')}.bin`;
          await fetchEncrypted(file.access.pages[i], name);
          pages.push(name);
          onProgress?.((done += 1), total);
        }
        files.push({ ...base, pages });
      } else {
        const name = `${file.id}.bin`;
        await fetchEncrypted(file.access.url, name);
        files.push({ ...base, file: name, ...(file.access.type === 'epub' ? { watermark: file.access.watermark } : {}) });
        onProgress?.((done += 1), total);
      }
    }
  } catch (error) {
    if (dir.exists) dir.delete();   // never leave a half-downloaded copy
    throw error;
  }

  const manifest: OfflineManifest = {
    entry_id: meta.entry_id,
    item_id: meta.item_id,
    title: meta.title,
    kind: meta.kind,
    offline_until: access.offline_until,
    downloaded_at: new Date().toISOString(),
    encrypted: true,
    files: files.sort((a, b) => a.position - b.position),
  };
  await SecureStore.setItemAsync(keyName(meta.entry_id), access.offline_key);
  new File(dir, MANIFEST).write(JSON.stringify(manifest));
  return manifest;
}

/** One encrypted PDF page as an image data URI (decrypted in memory only). */
export async function offlinePageUri(entryId: string, name: string): Promise<string> {
  const bytes = await decryptToBytes(new File(entryDir(entryId), name), await entryKey(entryId), tagFor(entryId, name));
  return `data:image/jpeg;base64,${bytesToBase64(bytes)}`;
}

/** An encrypted EPUB, decrypted in memory. */
export async function offlineFileBytes(entryId: string, name: string): Promise<Uint8Array> {
  return decryptToBytes(new File(entryDir(entryId), name), await entryKey(entryId), tagFor(entryId, name));
}

/** Audio / video: decrypted into the temporary playback cache; returns its URI. */
export async function offlineMediaUri(entryId: string, file: OfflineFile): Promise<string> {
  const dir = playDir();
  dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${file.id}.${file.format.replace(/[^a-z0-9]/gi, '') || 'bin'}`);
  await decryptToFile(new File(entryDir(entryId), file.file!), target, await entryKey(entryId), tagFor(entryId, file.file!));
  return target.uri;
}
