import { cbc } from '@noble/ciphers/aes.js';

const CHUNK = 256 * 1024; // a multiple of the 16-byte AES block
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * AES-128-CBC decryption (PKCS#7 padding) in chunks, yielding between them.
 * Pure-JS AES is slow on Hermes (~5 MB/s), so decrypting a multi-megabyte
 * stream piece in one call would freeze the UI for a second or more. CBC
 * chunks can be decrypted independently: each one's IV is the last
 * ciphertext block before it.
 */
export async function decryptAes128Cbc(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error('Encrypted data is not a whole number of blocks');
  if (data.length <= CHUNK) return cbc(key, iv).decrypt(data);

  const out = new Uint8Array(data.length);
  let written = 0;
  let chunkIv = iv;
  for (let start = 0; start < data.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, data.length);
    const last = end === data.length;
    const plain = cbc(key, chunkIv, { disablePadding: !last }).decrypt(data.subarray(start, end));
    out.set(plain, written);
    written += plain.length;
    chunkIv = data.slice(end - 16, end);
    if (!last) await tick();
  }
  return out.subarray(0, written);
}
