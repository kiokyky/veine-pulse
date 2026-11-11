import * as assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import Module from 'node:module';
import test from 'node:test';
import {
  aes256GcmDecrypt,
  aes256GcmEncryptWithIv,
  deriveKeysFromPassword,
  formatKeyFingerprint,
  PBKDF2_ITERATIONS,
} from '../src/crypto/cryptoPrimitives';

// ---------------------------------------------------------------------------
// Mock Expo / React Native native modules so zeroKnowledgeCrypto.ts runs in Node
// ---------------------------------------------------------------------------
const secureStoreMap = new Map<string, string>();
const originalLoad = Module._load;

Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'react-native') {
    return { Platform: { OS: 'ios' } };
  }
  if (request === 'expo-crypto') {
    return {
      getRandomBytes: (len: number) => new Uint8Array(nodeCrypto.randomBytes(len)),
    };
  }
  if (request === 'expo-secure-store') {
    return {
      setItemAsync: async (k: string, v: string) => {
        secureStoreMap.set(k, v);
      },
      getItemAsync: async (k: string) => secureStoreMap.get(k) ?? null,
      deleteItemAsync: async (k: string) => {
        secureStoreMap.delete(k);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const zk = require('../src/crypto/zeroKnowledgeCrypto') as typeof import('../src/crypto/zeroKnowledgeCrypto');

test('PBKDF2_ITERATIONS is 100000 and deriveKeysFromPassword isolates authHash from kek', async () => {
  assert.equal(PBKDF2_ITERATIONS, 100000);
  const salt = '0123456789abcdef0123456789abcdef';
  const k1 = await deriveKeysFromPassword('rahasia-veine-pulse', salt);
  const k2 = await deriveKeysFromPassword('rahasia-veine-pulse', salt);
  const kDiffSalt = await deriveKeysFromPassword('rahasia-veine-pulse', 'fedcba9876543210fedcba9876543210');

  assert.equal(k1.authHashHex.length, 64);
  assert.equal(k1.kekHex.length, 64);
  assert.notEqual(k1.authHashHex, k1.kekHex);
  assert.deepEqual(k1, k2);
  assert.notEqual(k1.kekHex, kDiffSalt.kekHex);
});

test('AES-256-GCM encrypt/decrypt round-trip, tamper detection, and envelope validation', () => {
  const key = nodeCrypto.randomBytes(32).toString('hex');
  const iv1 = nodeCrypto.randomBytes(12).toString('hex');
  const iv2 = nodeCrypto.randomBytes(12).toString('hex');
  const payload = JSON.stringify({ title: 'Kopi Susu 🧋', amount: 28000 });

  const env1 = aes256GcmEncryptWithIv(payload, key, iv1);
  const env2 = aes256GcmEncryptWithIv(payload, key, iv2);

  assert.match(env1, /^vp1:[0-9a-f]{24}:[0-9a-f]+$/);
  assert.notEqual(env1, env2);
  assert.equal(aes256GcmDecrypt(env1, key), payload);

  // Wrong key must fail authentication
  const wrongKey = nodeCrypto.randomBytes(32).toString('hex');
  assert.throws(() => aes256GcmDecrypt(env1, wrongKey));

  // Tampering 1 character in ciphertext/tag must fail
  const lastChar = env1.slice(-1);
  const tampered = env1.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a');
  assert.throws(() => aes256GcmDecrypt(tampered, key));

  // Invalid envelope format must throw
  assert.throws(() => aes256GcmDecrypt('invalid:00:00', key));
  assert.throws(() => aes256GcmDecrypt('vp1:shortiv:abcd', key));
});

test('formatKeyFingerprint produces ZK-XXXX-XXXX-XXXX or LOCKED', () => {
  assert.equal(formatKeyFingerprint(''), 'LOCKED');
  assert.match(formatKeyFingerprint('a'.repeat(64)), /^ZK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test('Zero-Knowledge Vault lifecycle: create, encrypt/decrypt, lock, biometric unlock, wrong password, rotate KEK, wipe', async () => {
  secureStoreMap.clear();
  await zk.wipeVaultFromDevice();
  assert.equal(zk.isVaultUnlocked(), false);
  assert.equal(await zk.getStoredVaultMeta(), null);

  // 1. Create vault with user's password
  const created = await zk.createVault('ranger@veinestudio.my.id', 'super-secret-pass-99');
  assert.equal(zk.isVaultUnlocked(), true);
  assert.equal(await zk.hasCachedDek(), true);
  assert.equal(zk.getKeyFingerprint(), created.keyFingerprint);

  // 2. Encrypt financial payload
  const txCipher = zk.encryptFinancialPayload({ title: 'GPU RTX', amount: 5000000 });
  assert.match(txCipher, /^vp1:/);
  assert.equal(txCipher.includes('5000000'), false);
  assert.equal(txCipher.includes('GPU'), false);
  assert.deepEqual(zk.decryptFinancialPayload(txCipher, { title: '', amount: 0 }), {
    title: 'GPU RTX',
    amount: 5000000,
  });

  // 3. Lock vault -> RAM DEK cleared, cannot encrypt, decrypt returns fallback, cached DEK remains for biometric
  await zk.lockVault(false);
  assert.equal(zk.isVaultUnlocked(), false);
  assert.equal(zk.getKeyFingerprint(), 'LOCKED');
  assert.throws(() => zk.encryptFinancialPayload({ amount: 1 }));
  assert.deepEqual(zk.decryptFinancialPayload(txCipher, { title: 'LOCKED', amount: -1 }), {
    title: 'LOCKED',
    amount: -1,
  });
  assert.equal(await zk.unlockVaultFromCache(), true);
  assert.equal(zk.isVaultUnlocked(), true);
  assert.equal(zk.getKeyFingerprint(), created.keyFingerprint);

  // 4. Wrong password must throw WRONG_PASSWORD
  const meta = await zk.getStoredVaultMeta();
  if (!meta) throw new Error('Expected stored vault meta');
  await zk.lockVault(true);
  await assert.rejects(
    () => zk.unlockVaultWithPassword('wrong-password', meta.kdfSalt, meta.wrappedDek),
    (err: Error) => err.message === 'WRONG_PASSWORD'
  );

  // 5. Right password unlocks and decrypts historical ciphertext
  await zk.unlockVaultWithPassword('super-secret-pass-99', meta.kdfSalt, meta.wrappedDek);
  assert.deepEqual(zk.decryptFinancialPayload(txCipher, { title: '', amount: 0 }), {
    title: 'GPU RTX',
    amount: 5000000,
  });

  // 6. Rotate KEK (change password): fingerprint & DEK stay identical so old ciphertexts still decrypt
  const rotated = await zk.rotateLoginPasswordKek('new-master-pass-2026');
  assert.equal(rotated.keyFingerprint, created.keyFingerprint);
  assert.notEqual(rotated.wrappedDek, created.wrappedDek);

  // Old password can no longer unwrap the rotated DEK, new password can
  await assert.rejects(() =>
    zk.unlockVaultWithPassword('super-secret-pass-99', rotated.kdfSalt, rotated.wrappedDek)
  );
  await zk.unlockVaultWithPassword('new-master-pass-2026', rotated.kdfSalt, rotated.wrappedDek);
  assert.deepEqual(zk.decryptFinancialPayload(txCipher, { title: '', amount: 0 }), {
    title: 'GPU RTX',
    amount: 5000000,
  });

  // 7. Rollback helper restores previous wrapped DEK
  await zk.restoreVaultMeta(meta.kdfSalt, meta.wrappedDek);
  const rolledBack = await zk.getStoredVaultMeta();
  assert.equal(rolledBack?.wrappedDek, meta.wrappedDek);

  // 8. Wipe cleans all stored secrets
  await zk.wipeVaultFromDevice();
  assert.equal(zk.isVaultUnlocked(), false);
  assert.equal(await zk.getStoredVaultMeta(), null);
  assert.equal(await zk.hasCachedDek(), false);
});
