import {
  EncryptedPlayerStatsRow,
  EncryptedQuestRow,
  EncryptedTransactionRow,
  PulseSyncRequest,
  PulseSyncResponse,
} from '../types/pulse';
import { getSessionToken } from './authApi';
import { GO_CUAN_API_BASE_URL } from './config';

export { GO_CUAN_API_BASE_URL };

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type SyncErrorCode = 'NOT_LOGGED_IN' | 'NETWORK' | 'UNAUTHORIZED' | 'SERVER' | 'BAD_RESPONSE';

export class SyncError extends Error {
  constructor(public readonly code: SyncErrorCode, message: string) {
    super(message);
  }
}

/**
 * 1. POST /api/v1/pulse/sync
 * Mengirim batch transaksi offline (masih berwujud AES-256-GCM ciphertext `vp1:...`)
 * beserta metadata RPG (`level`, `xp`, `streak`, `wallet_hp_percent`) ke server Go/Gin.
 * Server Go TIDAK PERNAH menerima nominal Rupiah dalam bentuk plaintext!
 *
 * Tidak ada fallback/simulasi: kalau server tidak mengonfirmasi, fungsi ini melempar `SyncError`
 * dan data lokal tetap PENDING. `encrypted_dek`/`kdf_salt` sengaja TIDAK dikirim di sini —
 * penggantian kunci hanya lewat `/api/v1/auth/password`.
 */
export async function syncWithGoCuanBackend(params: {
  rawStats: EncryptedPlayerStatsRow;
  rawTransactions: EncryptedTransactionRow[];
  rawQuests: EncryptedQuestRow[];
  baseUrl?: string;
}): Promise<{ response: PulseSyncResponse; payloadPreview: PulseSyncRequest }> {
  const token = await getSessionToken();
  if (!token) {
    throw new SyncError('NOT_LOGGED_IN', 'Belum login ke Go Cuan Cloud. Data tetap aman di perangkat.');
  }

  const endpoint = `${params.baseUrl || GO_CUAN_API_BASE_URL}/api/v1/pulse/sync`;
  const s = params.rawStats;

  const requestBody: PulseSyncRequest = {
    client_version: '2.0.0-zk-e2ee',
    player_stats: {
      user_id: s.user_id,
      level: s.level,
      current_xp: s.current_xp,
      next_level_xp: s.next_level_xp,
      current_streak: s.current_streak,
      longest_streak: s.longest_streak,
      last_log_date: s.last_log_date,
      wallet_hp_percent: s.wallet_hp_percent,
      shield_percent: s.shield_percent,
      impulse_penalty_percent: s.impulse_penalty_percent,
      daily_tx_xp_count: s.daily_tx_xp_count,
      unlocked_title: s.unlocked_title,
      encrypted_financial_state: s.encrypted_financial_state,
      updated_at: s.updated_at,
    },
    pending_transactions: params.rawTransactions
      .filter((t) => t.sync_status === 'PENDING')
      .map(({ sync_status, ...rest }) => rest),
    quests: params.rawQuests
      .filter((q) => q.sync_status === 'PENDING')
      .map(({ sync_status, ...rest }) => rest),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veine-Pulse-Encryption': 'AES-256-GCM-ZeroKnowledge',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch {
    throw new SyncError('NETWORK', 'Go Cuan Cloud tidak dapat dihubungi. Data tetap PENDING.');
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401) {
    throw new SyncError('UNAUTHORIZED', 'Sesi kedaluwarsa. Kunci lalu buka vault lagi untuk login ulang.');
  }
  if (!res.ok) {
    throw new SyncError('SERVER', `Server menolak sync (${res.status}). Data tetap PENDING.`);
  }

  let data: PulseSyncResponse;
  try {
    data = (await res.json()) as PulseSyncResponse;
  } catch {
    throw new SyncError('BAD_RESPONSE', 'Respons server tidak valid. Data tetap PENDING.');
  }
  if (data?.status !== 'OK' || !Array.isArray(data.synced_tx_ids) || !Array.isArray(data.synced_quest_ids)) {
    throw new SyncError('BAD_RESPONSE', 'Respons server tidak lengkap. Data tetap PENDING.');
  }

  return { response: data, payloadPreview: requestBody };
}

/**
 * 2. GET /api/v1/pulse/profile
 * Mengambil state Level, XP, Streak, Wallet HP %, serta `encrypted_financial_state` & `encrypted_dek`
 * agar Go Cuan Web dan Veine Pulse Mobile selalu sinkron.
 */
export async function fetchPulseProfileFromGoCuan(
  userId: string,
  baseUrl = GO_CUAN_API_BASE_URL
): Promise<EncryptedPlayerStatsRow | null> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/pulse/profile?user_id=${encodeURIComponent(userId)}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(await authHeaders()),
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as EncryptedPlayerStatsRow;
  } catch {
    return null;
  }
}

/**
 * 3. POST /api/v1/pulse/quests
 * Mengirim Custom Saving Quest baru yang sudah terenkripsi (`encrypted_quest_payload`) ke backend Go/Gin.
 */
export async function postEncryptedQuestToGoCuan(
  questRow: EncryptedQuestRow,
  baseUrl = GO_CUAN_API_BASE_URL
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/pulse/quests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Veine-Pulse-Encryption': 'AES-256-GCM-ZeroKnowledge',
        ...(await authHeaders()),
      },
      body: JSON.stringify(questRow),
    });
    return res.ok;
  } catch {
    return false;
  }
}

