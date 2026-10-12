/// <reference types="node" />
import { cbc } from '@noble/ciphers/aes.js';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { test } from 'node:test';

import { decryptAes128Cbc } from '../lib/aes';

const key = Uint8Array.from({ length: 16 }, (_, i) => i * 7);
const iv = Uint8Array.from({ length: 16 }, (_, i) => 255 - i);

function encrypt(plain: Uint8Array) {
  const c = createCipheriv('aes-128-cbc', key, iv);
  return new Uint8Array(Buffer.concat([c.update(plain), c.final()]));
}

test('chunked decryption matches one-shot decryption at every size around the chunk edges', async () => {
  for (const size of [1, 15, 16, 17, 262143, 262144, 262145, 262144 * 3 + 5, 1_000_000]) {
    const plain = Uint8Array.from({ length: size }, (_, i) => (i * 131 + 7) & 255);
    const enc = encrypt(plain);
    const out = await decryptAes128Cbc(key, iv, enc);
    assert.equal(out.length, size, `size ${size}`);
    assert.deepEqual(Buffer.from(out), Buffer.from(plain), `size ${size}`);
    assert.deepEqual(Buffer.from(out), Buffer.from(cbc(key, iv).decrypt(enc)));
  }
});

test('rejects data that is not whole blocks', async () => {
  await assert.rejects(decryptAes128Cbc(key, iv, new Uint8Array(17)), /blocks/);
});
