import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { GO_CUAN_API_BASE_URL } from './config';

/**
 * Zero-Knowledge auth client for Go Cuan backend.
 * The server only ever sees `auth_hash` (derived from the password via PBKDF2 + HMAC),
 * never the password itself and never the KEK that unwraps the DEK.
 *
 * Contract (see docs/BACKEND_GO_REFERENCE.md):
 *   GET  /api/v1/auth/prelogin?email=   -> { kdf_salt }
 *   POST /api/v1/auth/register          -> { token, user_id }
 *   POST /api/v1/auth/login             -> { token, user_id, encrypted_dek, kdf_salt }
 */

const KEY_TOKEN = 'veine_pulse_session_token_v1';
const KEY_PENDING_REGISTER = 'veine_pulse_pending_register_v1';
const REQUEST_TIMEOUT_MS = 6000;

export class AuthApiError extends Error {
  constructor(
    public readonly code: 'NETWORK' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'CONFLICT' | 'SERVER',
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GO_CUAN_API_BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
      signal: controller.signal,
    });
  } catch {
    throw new AuthApiError('NETWORK', 'Tidak dapat terhubung ke Go Cuan Cloud.');
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 404) throw new AuthApiError('NOT_FOUND', 'Akun tidak ditemukan.');
  if (res.status === 401) throw new AuthApiError('UNAUTHORIZED', 'Email atau password salah.');
  if (res.status === 409) throw new AuthApiError('CONFLICT', 'Email sudah terdaftar.');
  if (!res.ok) throw new AuthApiError('SERVER', `Server error (${res.status}).`);
  return (await res.json()) as T;
}

export async function prelogin(email: string): Promise<{ kdf_salt: string }> {
  return request(`/api/v1/auth/prelogin?email=${encodeURIComponent(email)}`, { method: 'GET' });
}

export async function registerAccount(body: {
  email: string;
  auth_hash: string;
  kdf_salt: string;
  encrypted_dek: string;
}): Promise<{ token: string; user_id: string }> {
  return request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(body) });
}

export async function loginAccount(body: {
  email: string;
  auth_hash: string;
}): Promise<{ token: string; user_id: string; encrypted_dek: string; kdf_salt: string }> {
  return request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) });
}

/**
 * Updates `auth_hash` + wrapped DEK on the server after a password change (KEK rotation).
 */
export async function updatePasswordOnServer(body: {
  new_auth_hash: string;
  new_kdf_salt: string;
  new_encrypted_dek: string;
}): Promise<void> {
  const token = await getSessionToken();
  if (!token) throw new AuthApiError('UNAUTHORIZED', 'Belum login ke Go Cuan Cloud.');
  await request('/api/v1/auth/password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Session token storage (token is a bearer credential, not a decryption key)
// ---------------------------------------------------------------------------

async function kvSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    // Session token on web lives in memory only (cleared on reload), same policy as the DEK.
    memoryKv[key] = value;
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function kvGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return memoryKv[key] ?? null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function kvDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    delete memoryKv[key];
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

const memoryKv: Record<string, string> = {};

export const getSessionToken = () => kvGet(KEY_TOKEN);
export const setSessionToken = (token: string) => kvSet(KEY_TOKEN, token);
export const clearSessionToken = () => kvDelete(KEY_TOKEN);

/**
 * When a vault is created offline, the registration payload (no password, only auth_hash +
 * wrapped DEK) is queued so it can be sent once the backend is reachable.
 */
export async function queuePendingRegistration(body: {
  email: string;
  auth_hash: string;
  kdf_salt: string;
  encrypted_dek: string;
}): Promise<void> {
  await kvSet(KEY_PENDING_REGISTER, JSON.stringify(body));
}

export async function flushPendingRegistration(): Promise<boolean> {
  const raw = await kvGet(KEY_PENDING_REGISTER);
  if (!raw) return false;
  const body = JSON.parse(raw);
  const res = await registerAccount(body);
  await setSessionToken(res.token);
  await kvDelete(KEY_PENDING_REGISTER);
  return true;
}

export async function clearPendingRegistration(): Promise<void> {
  await kvDelete(KEY_PENDING_REGISTER);
}
