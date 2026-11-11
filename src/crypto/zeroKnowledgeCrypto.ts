import { bytesToHex } from '@noble/ciphers/utils';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  aes256GcmDecrypt,
  aes256GcmEncryptWithIv,
  deriveKeysFromPassword,
  formatKeyFingerprint,
  PBKDF2_ITERATIONS,
} from './cryptoPrimitives';

export { aes256GcmDecrypt, deriveKeysFromPassword, PBKDF2_ITERATIONS };

/**
 * Storage keys.
 * - DEK_CACHE: unwrapped DEK cached in iOS Keychain / Android Keystore so the user does not need to
 *   retype the password on every app open (gated by biometrics). NEVER persisted on web.
 * - SALT / WRAPPED_DEK: safe to persist anywhere — useless without the user's password.
 * - EMAIL: used for login from another device (prelogin -> salt).
 */
const KEY_DEK_CACHE = 'veine_pulse_zk_dek_v3';
const KEY_SALT = 'veine_pulse_zk_salt_v3';
const KEY_WRAPPED_DEK = 'veine_pulse_zk_wrapped_dek_v3';
const KEY_EMAIL = 'veine_pulse_zk_email_v3';

// In-memory DEK (cleared on lock). 32 bytes hex = 64 chars.
let activeDekHex: string | null = null;

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const isWeb = Platform.OS === 'web';

/**
 * @param sensitive if true the value is never written to web localStorage (memory only on web).
 */
async function storeSet(key: string, value: string, sensitive: boolean): Promise<void> {
  if (isWeb) {
    if (sensitive) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore storage errors in restricted webviews
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function storeGet(key: string): Promise<string | null> {
  if (isWeb) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function storeDelete(key: string): Promise<void> {
  if (isWeb) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Generates cryptographically secure random bytes using OS CSPRNG (`expo-crypto`).
 */
export function getRandomBytesHex(byteLength: number): string {
  // Never fall back to Math.random(): a weak DEK/IV would silently break the Zero-Knowledge guarantee.
  const bytes = Crypto.getRandomBytes(byteLength);
  return bytesToHex(bytes);
}

/**
 * Low-level AES-256-GCM encryption returning `vp1:<12-byte-iv-hex>:<ciphertext+authTag-hex>`
 */
export function aes256GcmEncrypt(plaintextUtf8: string, keyHex: string): string {
  return aes256GcmEncryptWithIv(plaintextUtf8, keyHex, getRandomBytesHex(12));
}

/**
 * Returns a short, non-sensitive public fingerprint of the active 256-bit DEK
 * so the user can verify that Mobile and Go Cuan Web share the exact same key.
 */
export function getKeyFingerprint(dekHex?: string): string {
  return formatKeyFingerprint(dekHex || activeDekHex || '');
}

// ---------------------------------------------------------------------------
// Vault lifecycle
// ---------------------------------------------------------------------------

export interface VaultMaterial {
  wrappedDek: string;
  kdfSalt: string;
  authHashHex: string;
  keyFingerprint: string;
}

export function isVaultUnlocked(): boolean {
  return activeDekHex !== null;
}

/**
 * Returns the locally stored (wrapped) vault metadata, or null if this device has no vault yet.
 */
export async function getStoredVaultMeta(): Promise<{
  wrappedDek: string;
  kdfSalt: string;
  email: string | null;
} | null> {
  const [wrappedDek, kdfSalt, email] = await Promise.all([
    storeGet(KEY_WRAPPED_DEK),
    storeGet(KEY_SALT),
    storeGet(KEY_EMAIL),
  ]);
  if (!wrappedDek || !kdfSalt) return null;
  return { wrappedDek, kdfSalt, email };
}

/**
 * Whether a cached (unwrapped) DEK exists in Keychain/Keystore. Always false on web.
 */
export async function hasCachedDek(): Promise<boolean> {
  if (isWeb) return false;
  return (await storeGet(KEY_DEK_CACHE)) !== null;
}

/**
 * First-time setup: creates a fresh random DEK and wraps it with a KEK derived from the
 * user's own login password. The password itself is never stored anywhere.
 */
export async function createVault(email: string, password: string): Promise<VaultMaterial> {
  const kdfSalt = getRandomBytesHex(16);
  const dekHex = getRandomBytesHex(32);
  const { kekHex, authHashHex } = await deriveKeysFromPassword(password, kdfSalt);
  const wrappedDek = aes256GcmEncrypt(dekHex, kekHex);

  await storeSet(KEY_SALT, kdfSalt, false);
  await storeSet(KEY_WRAPPED_DEK, wrappedDek, false);
  await storeSet(KEY_EMAIL, email, false);
  await storeSet(KEY_DEK_CACHE, dekHex, true);

  activeDekHex = dekHex;
  return { wrappedDek, kdfSalt, authHashHex, keyFingerprint: getKeyFingerprint(dekHex) };
}

/**
 * Unlocks a vault with the user's password. Works for both a local vault and one fetched
 * from Go Cuan Cloud (login on a new device). Throws `WRONG_PASSWORD` if the password
 * cannot unwrap the DEK (AES-GCM auth tag mismatch).
 */
export async function unlockVaultWithPassword(
  password: string,
  kdfSalt: string,
  wrappedDek: string,
  email?: string
): Promise<VaultMaterial> {
  const keys = await deriveKeysFromPassword(password, kdfSalt);
  return unlockVaultWithDerivedKeys(keys, kdfSalt, wrappedDek, email);
}

/**
 * Same as `unlockVaultWithPassword` but with keys already derived (avoids running PBKDF2 twice
 * when logging in on a new device: derive -> send auth_hash -> receive wrapped DEK -> unwrap).
 */
export async function unlockVaultWithDerivedKeys(
  keys: { kekHex: string; authHashHex: string },
  kdfSalt: string,
  wrappedDek: string,
  email?: string
): Promise<VaultMaterial> {
  const { kekHex, authHashHex } = keys;
  let dekHex: string;
  try {
    dekHex = aes256GcmDecrypt(wrappedDek, kekHex);
  } catch {
    throw new Error('WRONG_PASSWORD');
  }

  await storeSet(KEY_SALT, kdfSalt, false);
  await storeSet(KEY_WRAPPED_DEK, wrappedDek, false);
  if (email) await storeSet(KEY_EMAIL, email, false);
  await storeSet(KEY_DEK_CACHE, dekHex, true);

  activeDekHex = dekHex;
  return { wrappedDek, kdfSalt, authHashHex, keyFingerprint: getKeyFingerprint(dekHex) };
}

/**
 * Unlocks using the DEK cached in Keychain/Keystore. Caller is responsible for
 * gating this behind biometric authentication.
 */
export async function unlockVaultFromCache(): Promise<boolean> {
  if (isWeb) return false;
  const cached = await storeGet(KEY_DEK_CACHE);
  if (!cached) return false;
  activeDekHex = cached;
  return true;
}

/**
 * Clears the DEK from memory. The cached DEK stays in Keychain for biometric unlock
 * unless `forgetDevice` is true.
 */
export async function lockVault(forgetDevice = false): Promise<void> {
  activeDekHex = null;
  if (forgetDevice) {
    await storeDelete(KEY_DEK_CACHE);
  }
}

/**
 * Re-wraps the existing DEK with a new password. Historical rows do NOT need re-encryption.
 */
export async function rotateLoginPasswordKek(newPassword: string): Promise<VaultMaterial> {
  if (!activeDekHex) throw new Error('Vault terkunci.');
  const dekHex = activeDekHex;
  const kdfSalt = getRandomBytesHex(16);
  const { kekHex, authHashHex } = await deriveKeysFromPassword(newPassword, kdfSalt);
  const wrappedDek = aes256GcmEncrypt(dekHex, kekHex);

  await storeSet(KEY_SALT, kdfSalt, false);
  await storeSet(KEY_WRAPPED_DEK, wrappedDek, false);

  return { wrappedDek, kdfSalt, authHashHex, keyFingerprint: getKeyFingerprint(dekHex) };
}

/**
 * Restores a previous salt + wrapped DEK (rollback when a server-side password update fails).
 */
export async function restoreVaultMeta(kdfSalt: string, wrappedDek: string): Promise<void> {
  await storeSet(KEY_SALT, kdfSalt, false);
  await storeSet(KEY_WRAPPED_DEK, wrappedDek, false);
}

/**
 * Removes every trace of the vault from this device (logout + forget).
 */
export async function wipeVaultFromDevice(): Promise<void> {
  activeDekHex = null;
  await Promise.all([
    storeDelete(KEY_DEK_CACHE),
    storeDelete(KEY_SALT),
    storeDelete(KEY_WRAPPED_DEK),
    storeDelete(KEY_EMAIL),
  ]);
}

// ---------------------------------------------------------------------------
// Payload encryption
// ---------------------------------------------------------------------------

/**
 * Encrypts a typed financial object into an AES-256-GCM ciphertext string (`vp1:<iv>:<ciphertext>`)
 * before saving to SQLite or sending to PostgreSQL.
 */
export function encryptFinancialPayload<T>(payload: T): string {
  if (!activeDekHex) {
    throw new Error('Vault terkunci — tidak bisa mengenkripsi.');
  }
  return aes256GcmEncrypt(JSON.stringify(payload), activeDekHex);
}

/**
 * Decrypts an AES-256-GCM ciphertext string (`vp1:<iv>:<ciphertext>`) from SQLite or PostgreSQL
 * back into a typed financial object in client RAM.
 */
export function decryptFinancialPayload<T>(ciphertextEnvelope: string, fallback: T): T {
  if (!activeDekHex) {
    return fallback;
  }
  try {
    return JSON.parse(aes256GcmDecrypt(ciphertextEnvelope, activeDekHex)) as T;
  } catch {
    return fallback;
  }
}
