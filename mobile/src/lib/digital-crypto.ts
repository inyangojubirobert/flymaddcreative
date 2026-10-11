import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { File, FileMode } from 'expo-file-system';
import { strToU8 } from 'fflate';

// Encrypted offline copies (AES-256-GCM, native expo-crypto).
// File layout: "ODE1" | chunk size (u32) | per chunk: length (u32) | IV + ciphertext + tag.
// Chunks are 1 MB so a large video never has to fit in memory; each chunk is
// authenticated with "<tag>|<index>" so chunks can't be swapped or reordered,
// and a copy moved to another file / item / device fails to decrypt.
// The key comes from the server per licence + device and lives in the
// device keystore (SecureStore); without it the files are unreadable.

const MAGIC = strToU8('ODE1');
const CHUNK = 1024 * 1024;

export const importOfflineKey = (base64: string) => AESEncryptionKey.import(base64, 'base64');

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const readU32 = (b: Uint8Array) => ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
const aad = (tag: string, index: number) => strToU8(`${tag}|${index}`);

/** Encrypts `source` into `target` (overwritten). */
export async function encryptFile(source: File, target: File, key: AESEncryptionKey, tag: string) {
  const size = source.size;
  if (target.exists) target.delete();
  target.create();
  const input = source.open(FileMode.ReadOnly);
  const output = target.open(FileMode.WriteOnly);
  try {
    output.writeBytes(new Uint8Array([...MAGIC, ...u32(CHUNK)]));
    for (let offset = 0, index = 0; offset < size; offset += CHUNK, index += 1) {
      input.offset = offset;
      const plain = input.readBytes(Math.min(CHUNK, size - offset));
      const sealed = await aesEncryptAsync(plain, key, { additionalData: aad(tag, index) });
      const bytes = await sealed.combined();
      output.writeBytes(u32(bytes.length));
      output.writeBytes(bytes);
    }
  } finally {
    input.close();
    output.close();
  }
}

/** Decrypts chunk by chunk, handing each plain chunk to `onChunk`. Throws if anything was altered. */
async function decryptChunks(source: File, key: AESEncryptionKey, tag: string, onChunk: (plain: Uint8Array) => void) {
  const input = source.open(FileMode.ReadOnly);
  try {
    const size = source.size;
    const header = input.readBytes(8);
    if (header.length < 8 || header[0] !== MAGIC[0] || header[1] !== MAGIC[1] || header[2] !== MAGIC[2] || header[3] !== MAGIC[3]) {
      throw new Error('This offline copy is damaged. Remove it and download again.');
    }
    let offset = 8;
    for (let index = 0; offset < size; index += 1) {
      input.offset = offset;
      const length = readU32(input.readBytes(4));
      if (!(length > 28) || offset + 4 + length > size) throw new Error('This offline copy is damaged. Remove it and download again.');
      const sealed = AESSealedData.fromCombined(input.readBytes(length));
      onChunk(await aesDecryptAsync(sealed, key, { additionalData: aad(tag, index), output: 'bytes' }) as Uint8Array);
      offset += 4 + length;
    }
  } finally {
    input.close();
  }
}

export async function decryptToBytes(source: File, key: AESEncryptionKey, tag: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  await decryptChunks(source, key, tag, (plain) => parts.push(plain));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Decrypts into a temporary plain file (for the media player); delete it after playback. */
export async function decryptToFile(source: File, target: File, key: AESEncryptionKey, tag: string) {
  if (target.exists) target.delete();
  target.create();
  const output = target.open(FileMode.WriteOnly);
  try {
    await decryptChunks(source, key, tag, (plain) => output.writeBytes(plain));
  } catch (error) {
    output.close();
    if (target.exists) target.delete();
    throw error;
  }
  output.close();
}
