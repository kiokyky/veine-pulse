import * as assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import test from 'node:test';
import {
  aes256GcmDecrypt,
  aes256GcmEncryptWithIv,
  deriveKeysFromPassword,
  formatKeyFingerprint,
  PBKDF2_ITERATIONS,
} from '../src/crypto/cryptoPrimitives';
import * as zk from '../src/crypto/zeroKnowledgeCrypto';

test('PBKDF2_ITERATIONS is 100000 and deriveKeysFromPassword isolates authHash from kek', async () => {
  assert.strictEqual(PBKDF2_ITERATIONS, 100000);
  const salt = '0123456789abcdef0123456789abcdef';
  const k1 = await deriveKeysFromPassword('rahasia-veine-pulse', salt);
  const k2 = await deriveKeysFromPassword('rahasia-veine-pulse', salt);
  const kDiffSalt = await deriveKeysFromPassword(
    'rahasia-veine-pulse',
    'fedcba9876543210fedcba9876543210'
  );

  assert.strictEqual(k1.authHashHex.length, 64);
  assert.strictEqual(k1.kekHex.length, 64);
  assert.notStrictEqual(k1.authHashHex, k1.kekHex);
  assert.deepStrictEqual(k1, k2);
  assert.notStrictEqual(k1.kekHex, kDiffSalt.kekHex);
});

test('AES-256-GCM encrypt/decrypt round-trip, tamper detection, and envelope validation', () => {
  const key = nodeCrypto.randomBytes(32).toString('hex');
  const iv1 = nodeCrypto.randomBytes(12).toString('hex');
  const iv2 = nodeCrypto.randomBytes(12).toString('hex');
  const payload = JSON.stringify({ title: 'Kopi Susu 🧋', amount: 28000 });

  const env1 = aes256GcmEncryptWithIv(payload, key, iv1);
  const env2 = aes256GcmEncryptWithIv(payload, key, iv2);

  assert.match(env1, /^vp1:[0-9a-f]{24}:[0-9a-f]+$/);
  assert.notStrictEqual(env1, env2);
  assert.strictEqual(aes256GcmDecrypt(env1, key), payload);

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
  assert.strictEqual(formatKeyFingerprint(''), 'LOCKED');
  assert.match(formatKeyFingerprint('a'.repeat(64)), /^ZK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test('Zero-Knowledge Vault lifecycle: create, encrypt/decrypt, lock, biometric unlock, wrong password, rotate KEK, wipe', async () => {
  await zk.wipeVaultFromDevice();
  assert.strictEqual(zk.isVaultUnlocked(), false);
  assert.strictEqual(await zk.getStoredVaultMeta(), null);

  // 1. Create vault with user's password
  const created = await zk.createVault('ranger@veinestudio.my.id', 'super-secret-pass-99');
  assert.strictEqual(zk.isVaultUnlocked(), true);
  assert.strictEqual(await zk.hasCachedDek(), true);
  assert.strictEqual(zk.getKeyFingerprint(), created.keyFingerprint);

  // 2. Encrypt financial payload
  const txCipher = zk.encryptFinancialPayload({ title: 'GPU RTX', amount: 5000000 });
  assert.match(txCipher, /^vp1:/);
  assert.strictEqual(txCipher.includes('5000000'), false);
  assert.strictEqual(txCipher.includes('GPU'), false);
  assert.deepStrictEqual(zk.decryptFinancialPayload(txCipher, { title: '', amount: 0 }), {
    title: 'GPU RTX',
    amount: 5000000,
  });

  // 3. Lock vault -> RAM DEK cleared, cannot encrypt, decrypt returns fallback, cached DEK remains for biometric
  await zk.lockVault(false);
  assert.strictEqual(zk.isVaultUnlocked(), false);
  assert.strictEqual(zk.getKeyFingerprint(), 'LOCKED');
  assert.throws(() => zk.encryptFinancialPayload({ amount: 1 }));
  assert.deepStrictEqual(zk.decryptFinancialPayload(txCipher, { title: 'LOCKED', amount: -1 }), {
    title: 'LOCKED',
    amount: -1,
  });
  assert.strictEqual(await zk.unlockVaultFromCache(), true);
  assert.strictEqual(zk.isVaultUnlocked(), true);
  assert.strictEqual(zk.getKeyFingerprint(), created.keyFingerprint);

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
  assert.deepStrictEqual(zk.decryptFinancialPayload(txCipher, { title: '', amount: 0 }), {
    title: 'GPU RTX',
    amount: 5000000,
  });

  // 6. Rotate KEK (change password): fingerprint & DEK stay identical so old ciphertexts still decrypt
  const rotated = await zk.rotateLoginPasswordKek('new-master-pass-2026');
  assert.strictEqual(rotated.keyFingerprint, created.keyFingerprint);
  assert.notStrictEqual(rotated.wrappedDek, created.wrappedDek);

  // Old password can no longer unwrap the rotated DEK, new password can
  await assert.rejects(() =>
    zk.unlockVaultWithPassword('super-secret-pass-99', rotated.kdfSalt, rotated.wrappedDek)
  );
  await zk.unlockVaultWithPassword('new-master-pass-2026', rotated.kdfSalt, rotated.wrappedDek);
  assert.deepStrictEqual(zk.decryptFinancialPayload(txCipher, { title: '', amount: 0 }), {
    title: 'GPU RTX',
    amount: 5000000,
  });

  // 7. Rollback helper restores previous wrapped DEK
  await zk.restoreVaultMeta(meta.kdfSalt, meta.wrappedDek);
  const rolledBack = await zk.getStoredVaultMeta();
  assert.strictEqual(rolledBack?.wrappedDek, meta.wrappedDek);

  // 8. Wipe cleans all stored secrets
  await zk.wipeVaultFromDevice();
  assert.strictEqual(zk.isVaultUnlocked(), false);
  assert.strictEqual(await zk.getStoredVaultMeta(), null);
  assert.strictEqual(await zk.hasCachedDek(), false);
});
