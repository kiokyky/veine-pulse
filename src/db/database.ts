import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import {
  decryptFinancialPayload,
  encryptFinancialPayload,
} from '../crypto/zeroKnowledgeCrypto';
import {
  calculateNextLevelXp,
  computeHudMetrics,
  DAILY_SAFE_BURN_QUEST_LIMIT,
  getEndOfWeekDateString,
  getTodayDateString,
  resolveTitleByLevel,
} from '../engine/pulseRpgEngine';
import {
  ConfidentialPlayerFinancialState,
  ConfidentialQuestPayload,
  ConfidentialTransactionPayload,
  EncryptedPlayerStatsRow,
  EncryptedQuestRow,
  EncryptedTransactionRow,
  FinancialQuest,
  PlayerPulseStats,
  QuestType,
  SpendNature,
  SyncStatus,
  TransactionItem,
  TransactionType,
} from '../types/pulse';

export const DEFAULT_USER_ID = 'usr_veine_cuan_01';

/**
 * DDL SQL Skema Database Zero-Knowledge (SQLite di HP & PostgreSQL di Backend Go).
 * Perhatikan bahwa seluruh nominal Rupiah & nama transaksi dienkripsi ke dalam
 * kolom `encrypted_*` menggunakan AES-256-GCM sebelum menyentuh database!
 */
export const ZERO_KNOWLEDGE_SCHEMA_SQL = `
-- 1. Tabel Status Karakter / RPG Profile (Zero-Knowledge Financial State)
CREATE TABLE IF NOT EXISTS player_pulse_stats (
  user_id TEXT PRIMARY KEY NOT NULL,
  level INTEGER DEFAULT 1,
  current_xp INTEGER DEFAULT 0,
  next_level_xp INTEGER DEFAULT 500,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  last_log_date TEXT,
  wallet_hp_percent INTEGER DEFAULT 100,
  shield_percent INTEGER DEFAULT 30,
  impulse_penalty_percent INTEGER DEFAULT 0,
  daily_tx_xp_count INTEGER DEFAULT 0,
  unlocked_title TEXT DEFAULT 'Rookie Cuan Crafter',
  encrypted_financial_state TEXT NOT NULL, -- AES-256-GCM: { monthly_budget_limit, emergency_shield_target, ... }
  encrypted_dek TEXT NOT NULL,             -- Wrapped 256-bit DEK (dibuka dengan Password Login)
  kdf_salt TEXT NOT NULL,
  sync_status TEXT DEFAULT 'PENDING',
  updated_at TEXT NOT NULL
);

-- 2. Tabel Transaksi Lokal (Zero-Knowledge Nominal & Detail Transaksi)
CREATE TABLE IF NOT EXISTS local_transactions (
  tx_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  tx_type TEXT CHECK(tx_type IN ('EXPENSE', 'INCOME', 'SAVING')) NOT NULL,
  tx_date TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,         -- AES-256-GCM: { title, amount, category, spend_nature, notes }
  hp_damage_dealt INTEGER DEFAULT 0,
  xp_earned INTEGER DEFAULT 0,
  sync_status TEXT DEFAULT 'PENDING',
  created_at TEXT NOT NULL
);

-- 3. Tabel Quest Keuangan (Daily / Weekly / Custom Saving Goal)
CREATE TABLE IF NOT EXISTS financial_quests (
  quest_id TEXT PRIMARY KEY NOT NULL,
  quest_type TEXT CHECK(quest_type IN ('DAILY', 'WEEKLY', 'SAVING_GOAL')) NOT NULL,
  progress_percent INTEGER DEFAULT 0,
  xp_reward INTEGER NOT NULL,
  is_completed INTEGER DEFAULT 0,
  expires_at TEXT,
  encrypted_quest_payload TEXT NOT NULL,   -- AES-256-GCM: { title, target_amount, current_progress }
  sync_status TEXT DEFAULT 'PENDING'
);
`;

let sqliteDb: SQLite.SQLiteDatabase | null = null;
let useMemoryStore = Platform.OS === 'web';

// Fallback store in case SQLite native module isn't available (e.g. Web preview)
const memoryTables: {
  stats: EncryptedPlayerStatsRow | null;
  transactions: EncryptedTransactionRow[];
  quests: EncryptedQuestRow[];
} = {
  stats: null,
  transactions: [],
  quests: [],
};

async function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (useMemoryStore) return null;
  if (sqliteDb) return sqliteDb;
  try {
    sqliteDb = await SQLite.openDatabaseAsync('veine_pulse_zk_v2.db');
    await sqliteDb.execAsync(ZERO_KNOWLEDGE_SCHEMA_SQL);
    return sqliteDb;
  } catch {
    useMemoryStore = true;
    return null;
  }
}

/**
 * Helper untuk membuat UUID v4 ringan.
 */
export function generateUuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Mendekripsi baris `EncryptedPlayerStatsRow` di memori klien.
 */
function decryptStatsRow(row: EncryptedPlayerStatsRow): PlayerPulseStats {
  const defaultFinancial: ConfidentialPlayerFinancialState = {
    monthly_budget_limit: 3000000,
    emergency_shield_target: 1500000,
    emergency_shield_saved: 450000,
    daily_safe_spend_limit: DAILY_SAFE_BURN_QUEST_LIMIT,
  };
  const decryptedFin = decryptFinancialPayload<ConfidentialPlayerFinancialState>(
    row.encrypted_financial_state,
    defaultFinancial
  );
  return {
    ...row,
    ...decryptedFin,
  };
}

/**
 * Mendekripsi baris `EncryptedTransactionRow` di memori klien.
 */
function decryptTransactionRow(row: EncryptedTransactionRow): TransactionItem {
  const fallbackPayload: ConfidentialTransactionPayload = {
    title: '[Encrypted Transaction]',
    amount: 0,
    category: 'General',
    spend_nature: 'ESSENTIAL',
  };
  const decrypted = decryptFinancialPayload<ConfidentialTransactionPayload>(
    row.encrypted_payload,
    fallbackPayload
  );
  return {
    ...row,
    ...decrypted,
    raw_ciphertext_preview: row.encrypted_payload,
  };
}

/**
 * Mendekripsi baris `EncryptedQuestRow` di memori klien.
 */
function decryptQuestRow(row: EncryptedQuestRow): FinancialQuest {
  const fallbackQuest: ConfidentialQuestPayload = {
    title: '[Encrypted Quest]',
    target_amount: 1,
    current_progress: 0,
  };
  const decrypted = decryptFinancialPayload<ConfidentialQuestPayload>(
    row.encrypted_quest_payload,
    fallbackQuest
  );
  return {
    ...row,
    ...decrypted,
    is_completed: row.is_completed === 1,
  };
}

/**
 * Inisialisasi Database + profil awal akun baru (dienkripsi penuh dengan AES-256-GCM).
 * Dipanggil hanya setelah Vault terbuka (DEK aktif di memori).
 */
export async function initializePulseDatabase(vault: {
  wrappedDek: string;
  kdfSalt: string;
}): Promise<void> {
  const db = await getDb();
  const todayStr = getTodayDateString();
  const nowIso = new Date().toISOString();

  let existingRow: EncryptedPlayerStatsRow | null = null;
  if (db) {
    existingRow = await db.getFirstAsync<EncryptedPlayerStatsRow>(
      'SELECT * FROM player_pulse_stats WHERE user_id = ? LIMIT 1',
      [DEFAULT_USER_ID]
    );
  } else {
    existingRow = memoryTables.stats;
  }

  if (existingRow) {
    // Profil sudah ada: pastikan wrapped DEK & salt terbaru tersimpan (mis. setelah login di perangkat baru).
    if (existingRow.encrypted_dek !== vault.wrappedDek || existingRow.kdf_salt !== vault.kdfSalt) {
      if (db) {
        await db.runAsync(
          'UPDATE player_pulse_stats SET encrypted_dek = ?, kdf_salt = ? WHERE user_id = ?',
          [vault.wrappedDek, vault.kdfSalt, DEFAULT_USER_ID]
        );
      } else if (memoryTables.stats) {
        memoryTables.stats.encrypted_dek = vault.wrappedDek;
        memoryTables.stats.kdf_salt = vault.kdfSalt;
      }
    }
    return;
  }

  // 1. Profil awal: Lv.1, belum ada streak, HP penuh.
  const initialFinancialState: ConfidentialPlayerFinancialState = {
    monthly_budget_limit: 3000000,
    emergency_shield_target: 2000000,
    emergency_shield_saved: 0,
    daily_safe_spend_limit: DAILY_SAFE_BURN_QUEST_LIMIT,
  };

  const seedStatsRow: EncryptedPlayerStatsRow = {
    user_id: DEFAULT_USER_ID,
    level: 1,
    current_xp: 0,
    next_level_xp: calculateNextLevelXp(1),
    current_streak: 0,
    longest_streak: 0,
    last_log_date: null,
    wallet_hp_percent: 100,
    shield_percent: 0,
    impulse_penalty_percent: 0,
    daily_tx_xp_count: 0,
    unlocked_title: resolveTitleByLevel(1),
    encrypted_financial_state: encryptFinancialPayload(initialFinancialState),
    encrypted_dek: vault.wrappedDek,
    kdf_salt: vault.kdfSalt,
    sync_status: 'PENDING',
    updated_at: nowIso,
  };

  // 2. Quest bawaan sesuai Blueprint 2.C (tanpa transaksi palsu).
  const seedQuests: Array<{
    quest_id: string;
    quest_type: QuestType;
    xp_reward: number;
    expires_at: string | null;
    payload: ConfidentialQuestPayload;
  }> = [
    {
      quest_id: 'q_daily_log_1',
      quest_type: 'DAILY',
      xp_reward: 15,
      expires_at: `${todayStr}T23:59:59`,
      payload: { title: 'Catat minimal 1 transaksi hari ini', target_amount: 1, current_progress: 0 },
    },
    {
      quest_id: 'q_daily_burn_75k',
      quest_type: 'DAILY',
      xp_reward: 40,
      expires_at: `${todayStr}T23:59:59`,
      payload: {
        title: 'Pertahankan pengeluaran harian di bawah Rp 75.000',
        target_amount: DAILY_SAFE_BURN_QUEST_LIMIT,
        current_progress: 0,
      },
    },
    {
      quest_id: 'q_weekly_no_coffee',
      quest_type: 'WEEKLY',
      xp_reward: 150,
      expires_at: `${getEndOfWeekDateString()}T23:59:59`,
      payload: { title: 'Minggu Tanpa Jajan Kopi > 3x', target_amount: 3, current_progress: 0 },
    },
  ];

  const questRows: EncryptedQuestRow[] = seedQuests.map((q) => ({
    quest_id: q.quest_id,
    quest_type: q.quest_type,
    progress_percent: 0,
    xp_reward: q.xp_reward,
    is_completed: 0,
    expires_at: q.expires_at,
    encrypted_quest_payload: encryptFinancialPayload(q.payload),
    sync_status: 'PENDING' as SyncStatus,
  }));

  if (db) {
    await db.runAsync(
      `INSERT INTO player_pulse_stats (
        user_id, level, current_xp, next_level_xp, current_streak, longest_streak,
        last_log_date, wallet_hp_percent, shield_percent, impulse_penalty_percent,
        daily_tx_xp_count, unlocked_title, encrypted_financial_state, encrypted_dek,
        kdf_salt, sync_status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        seedStatsRow.user_id,
        seedStatsRow.level,
        seedStatsRow.current_xp,
        seedStatsRow.next_level_xp,
        seedStatsRow.current_streak,
        seedStatsRow.longest_streak,
        seedStatsRow.last_log_date,
        seedStatsRow.wallet_hp_percent,
        seedStatsRow.shield_percent,
        seedStatsRow.impulse_penalty_percent,
        seedStatsRow.daily_tx_xp_count,
        seedStatsRow.unlocked_title,
        seedStatsRow.encrypted_financial_state,
        seedStatsRow.encrypted_dek,
        seedStatsRow.kdf_salt,
        seedStatsRow.sync_status,
        seedStatsRow.updated_at,
      ]
    );

    for (const q of questRows) {
      await db.runAsync(
        `INSERT INTO financial_quests (
          quest_id, quest_type, progress_percent, xp_reward,
          is_completed, expires_at, encrypted_quest_payload, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          q.quest_id,
          q.quest_type,
          q.progress_percent,
          q.xp_reward,
          q.is_completed,
          q.expires_at,
          q.encrypted_quest_payload,
          q.sync_status,
        ]
      );
    }
  } else {
    memoryTables.stats = seedStatsRow;
    memoryTables.transactions = [];
    memoryTables.quests = questRows;
  }
}

/**
 * Menghapus seluruh data lokal. Wajib dipanggil saat membuat Vault baru di perangkat
 * yang mungkin masih menyimpan baris terenkripsi dengan DEK lama (tidak bisa dibuka lagi).
 */
export async function resetLocalDatabase(): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.execAsync(
      'DELETE FROM local_transactions; DELETE FROM financial_quests; DELETE FROM player_pulse_stats;'
    );
  }
  memoryTables.stats = null;
  memoryTables.transactions = [];
  memoryTables.quests = [];
}

/**
 * Mengambil seluruh state aplikasi (sudah didekripsi di RAM untuk UI)
 * beserta snapshot mentah (`rawEncryptedSnapshot`) untuk pembuktian Zero-Knowledge DB.
 */
export async function loadDecryptedPulseState(): Promise<{
  stats: PlayerPulseStats;
  transactions: TransactionItem[];
  quests: FinancialQuest[];
  rawStatsRow: EncryptedPlayerStatsRow;
  rawTransactionRows: EncryptedTransactionRow[];
  rawQuestRows: EncryptedQuestRow[];
}> {
  const db = await getDb();

  let rawStatsRow: EncryptedPlayerStatsRow | null = null;
  let rawTransactionRows: EncryptedTransactionRow[] = [];
  let rawQuestRows: EncryptedQuestRow[] = [];

  if (db) {
    rawStatsRow = await db.getFirstAsync<EncryptedPlayerStatsRow>(
      'SELECT * FROM player_pulse_stats WHERE user_id = ? LIMIT 1',
      [DEFAULT_USER_ID]
    );
    rawTransactionRows = await db.getAllAsync<EncryptedTransactionRow>(
      'SELECT * FROM local_transactions WHERE user_id = ? ORDER BY created_at DESC',
      [DEFAULT_USER_ID]
    );
    rawQuestRows = await db.getAllAsync<EncryptedQuestRow>(
      'SELECT * FROM financial_quests ORDER BY quest_type ASC'
    );
  } else {
    rawStatsRow = memoryTables.stats;
    rawTransactionRows = [...memoryTables.transactions];
    rawQuestRows = [...memoryTables.quests];
  }

  if (!rawStatsRow) {
    throw new Error('Gagal memuat profil player_pulse_stats dari database.');
  }

  const decryptedStats = decryptStatsRow(rawStatsRow);
  const decryptedTransactions = rawTransactionRows.map(decryptTransactionRow);
  const decryptedQuests = rawQuestRows.map(decryptQuestRow);

  // Sinkronkan kalkulasi HP % dan Shield % terkini di memori
  const metrics = computeHudMetrics(decryptedStats, decryptedTransactions);
  decryptedStats.wallet_hp_percent = metrics.walletHpPercent;
  decryptedStats.shield_percent = metrics.shieldPercent;

  return {
    stats: decryptedStats,
    transactions: decryptedTransactions,
    quests: decryptedQuests,
    rawStatsRow,
    rawTransactionRows,
    rawQuestRows,
  };
}

/**
 * Menyimpan transaksi baru (dienkripsi dengan AES-256-GCM sebelum INSERT ke SQLite)
 * serta memperbarui XP, Level, Streak, HP %, dan progres Daily/Saving Quest!
 */
export async function insertEncryptedTransaction(params: {
  title: string;
  amount: number;
  txType: TransactionType;
  category: string;
  spendNature: SpendNature;
  notes?: string;
  updatedStats: PlayerPulseStats;
  hpDamageDealt: number;
  xpEarned: number;
}): Promise<TransactionItem> {
  const db = await getDb();
  const todayStr = getTodayDateString();
  const nowIso = new Date().toISOString();
  const txId = generateUuidV4();

  // 1. Enkripsi detail finansial transaksi dengan AES-256-GCM
  const confidentialTx: ConfidentialTransactionPayload = {
    title: params.title,
    amount: params.amount,
    category: params.category,
    spend_nature: params.spendNature,
    notes: params.notes,
  };
  const encryptedPayload = encryptFinancialPayload(confidentialTx);

  const newRawTx: EncryptedTransactionRow = {
    tx_id: txId,
    user_id: DEFAULT_USER_ID,
    tx_type: params.txType,
    tx_date: todayStr,
    encrypted_payload: encryptedPayload,
    hp_damage_dealt: params.hpDamageDealt,
    xp_earned: params.xpEarned,
    sync_status: 'PENDING',
    created_at: nowIso,
  };

  // 2. Enkripsi ulang state finansial player jika ada perubahan tabungan/budget
  const confidentialFinState: ConfidentialPlayerFinancialState = {
    monthly_budget_limit: params.updatedStats.monthly_budget_limit,
    emergency_shield_target: params.updatedStats.emergency_shield_target,
    emergency_shield_saved: params.updatedStats.emergency_shield_saved,
    daily_safe_spend_limit: params.updatedStats.daily_safe_spend_limit,
  };
  const encryptedFinState = encryptFinancialPayload(confidentialFinState);

  if (db) {
    await db.runAsync(
      `INSERT INTO local_transactions (
        tx_id, user_id, tx_type, tx_date, encrypted_payload,
        hp_damage_dealt, xp_earned, sync_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newRawTx.tx_id,
        newRawTx.user_id,
        newRawTx.tx_type,
        newRawTx.tx_date,
        newRawTx.encrypted_payload,
        newRawTx.hp_damage_dealt,
        newRawTx.xp_earned,
        newRawTx.sync_status,
        newRawTx.created_at,
      ]
    );

    await db.runAsync(
      `UPDATE player_pulse_stats SET
        level = ?, current_xp = ?, next_level_xp = ?, current_streak = ?,
        longest_streak = ?, last_log_date = ?, wallet_hp_percent = ?,
        shield_percent = ?, impulse_penalty_percent = ?, daily_tx_xp_count = ?,
        unlocked_title = ?, encrypted_financial_state = ?, sync_status = 'PENDING',
        updated_at = ?
      WHERE user_id = ?`,
      [
        params.updatedStats.level,
        params.updatedStats.current_xp,
        params.updatedStats.next_level_xp,
        params.updatedStats.current_streak,
        params.updatedStats.longest_streak,
        todayStr,
        params.updatedStats.wallet_hp_percent,
        params.updatedStats.shield_percent,
        params.updatedStats.impulse_penalty_percent,
        params.updatedStats.daily_tx_xp_count,
        params.updatedStats.unlocked_title,
        encryptedFinState,
        nowIso,
        DEFAULT_USER_ID,
      ]
    );
  } else {
    memoryTables.transactions.unshift(newRawTx);
    if (memoryTables.stats) {
      memoryTables.stats = {
        ...memoryTables.stats,
        level: params.updatedStats.level,
        current_xp: params.updatedStats.current_xp,
        next_level_xp: params.updatedStats.next_level_xp,
        current_streak: params.updatedStats.current_streak,
        longest_streak: params.updatedStats.longest_streak,
        last_log_date: todayStr,
        wallet_hp_percent: params.updatedStats.wallet_hp_percent,
        shield_percent: params.updatedStats.shield_percent,
        impulse_penalty_percent: params.updatedStats.impulse_penalty_percent,
        daily_tx_xp_count: params.updatedStats.daily_tx_xp_count,
        unlocked_title: params.updatedStats.unlocked_title,
        encrypted_financial_state: encryptedFinState,
        sync_status: 'PENDING',
        updated_at: nowIso,
      };
    }
  }

  return decryptTransactionRow(newRawTx);
}

/**
 * Menambahkan Custom Saving Quest baru (dienkripsi penuh sebelum disimpan ke DB).
 */
export async function insertEncryptedSavingQuest(params: {
  title: string;
  targetAmount: number;
  initialProgress?: number;
  xpReward?: number;
}): Promise<FinancialQuest> {
  const db = await getDb();
  const questId = generateUuidV4();
  const currentProgress = params.initialProgress ?? 0;
  const progressPercent = Math.min(
    100,
    Math.round((currentProgress / Math.max(1, params.targetAmount)) * 100)
  );
  const xpReward = params.xpReward ?? 300;

  const confidentialQuest: ConfidentialQuestPayload = {
    title: params.title,
    target_amount: params.targetAmount,
    current_progress: currentProgress,
  };
  const encryptedQuestPayload = encryptFinancialPayload(confidentialQuest);

  const rawRow: EncryptedQuestRow = {
    quest_id: questId,
    quest_type: 'SAVING_GOAL',
    progress_percent: progressPercent,
    xp_reward: xpReward,
    is_completed: progressPercent >= 100 ? 1 : 0,
    expires_at: null,
    encrypted_quest_payload: encryptedQuestPayload,
    sync_status: 'PENDING',
  };

  if (db) {
    await db.runAsync(
      `INSERT INTO financial_quests (
        quest_id, quest_type, progress_percent, xp_reward,
        is_completed, expires_at, encrypted_quest_payload, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rawRow.quest_id,
        rawRow.quest_type,
        rawRow.progress_percent,
        rawRow.xp_reward,
        rawRow.is_completed,
        rawRow.expires_at,
        rawRow.encrypted_quest_payload,
        rawRow.sync_status,
      ]
    );
  } else {
    memoryTables.quests.push(rawRow);
  }

  return decryptQuestRow(rawRow);
}

/**
 * Mengupdate progres Quest (misalnya saat alokasi tabungan atau klaim Daily Quest)
 * dengan mengenkripsi ulang `encrypted_quest_payload`.
 */
export async function updateEncryptedQuestProgress(params: {
  questId: string;
  title: string;
  targetAmount: number;
  newProgress: number;
  isCompleted: boolean;
  expiresAt?: string;
}): Promise<void> {
  const db = await getDb();
  const progressPercent = Math.min(
    100,
    Math.round((params.newProgress / Math.max(1, params.targetAmount)) * 100)
  );
  const encryptedPayload = encryptFinancialPayload<ConfidentialQuestPayload>({
    title: params.title,
    target_amount: params.targetAmount,
    current_progress: params.newProgress,
  });

  if (db) {
    await db.runAsync(
      `UPDATE financial_quests SET
        progress_percent = ?, is_completed = ?, encrypted_quest_payload = ?,
        expires_at = COALESCE(?, expires_at), sync_status = 'PENDING'
      WHERE quest_id = ?`,
      [
        progressPercent,
        params.isCompleted ? 1 : 0,
        encryptedPayload,
        params.expiresAt ?? null,
        params.questId,
      ]
    );
  } else {
    const idx = memoryTables.quests.findIndex((q) => q.quest_id === params.questId);
    if (idx >= 0) {
      memoryTables.quests[idx] = {
        ...memoryTables.quests[idx],
        progress_percent: progressPercent,
        is_completed: params.isCompleted ? 1 : 0,
        encrypted_quest_payload: encryptedPayload,
        expires_at: params.expiresAt ?? memoryTables.quests[idx].expires_at,
        sync_status: 'PENDING',
      };
    }
  }
}

/**
 * Update kolom RPG publik (tidak ada nominal Rupiah) — dipakai rollover harian & reward quest.
 */
export async function updatePublicPlayerStats(patch: {
  current_streak: number;
  impulse_penalty_percent: number;
  daily_tx_xp_count: number;
  level: number;
  current_xp: number;
  next_level_xp: number;
  unlocked_title: string;
}): Promise<void> {
  const db = await getDb();
  const nowIso = new Date().toISOString();
  if (db) {
    await db.runAsync(
      `UPDATE player_pulse_stats SET
        current_streak = ?, impulse_penalty_percent = ?, daily_tx_xp_count = ?,
        level = ?, current_xp = ?, next_level_xp = ?, unlocked_title = ?,
        sync_status = 'PENDING', updated_at = ?
      WHERE user_id = ?`,
      [
        patch.current_streak,
        patch.impulse_penalty_percent,
        patch.daily_tx_xp_count,
        patch.level,
        patch.current_xp,
        patch.next_level_xp,
        patch.unlocked_title,
        nowIso,
        DEFAULT_USER_ID,
      ]
    );
  } else if (memoryTables.stats) {
    memoryTables.stats = {
      ...memoryTables.stats,
      ...patch,
      sync_status: 'PENDING',
      updated_at: nowIso,
    };
  }
}

/**
 * Mengupdate batas budget bulanan & target shield (dienkripsi penuh dengan AES-256-GCM).
 */
export async function updateEncryptedMonthlyBudget(params: {
  monthlyBudgetLimit: number;
  emergencyShieldTarget: number;
  emergencyShieldSaved: number;
  walletHpPercent: number;
  shieldPercent: number;
  wrappedDek?: string;
  kdfSalt?: string;
}): Promise<void> {
  const db = await getDb();
  const nowIso = new Date().toISOString();

  const encryptedFinState = encryptFinancialPayload<ConfidentialPlayerFinancialState>({
    monthly_budget_limit: params.monthlyBudgetLimit,
    emergency_shield_target: params.emergencyShieldTarget,
    emergency_shield_saved: params.emergencyShieldSaved,
    daily_safe_spend_limit: DAILY_SAFE_BURN_QUEST_LIMIT,
  });

  if (db) {
    if (params.wrappedDek && params.kdfSalt) {
      await db.runAsync(
        `UPDATE player_pulse_stats SET
          encrypted_financial_state = ?, wallet_hp_percent = ?, shield_percent = ?,
          encrypted_dek = ?, kdf_salt = ?, sync_status = 'PENDING', updated_at = ?
        WHERE user_id = ?`,
        [
          encryptedFinState,
          params.walletHpPercent,
          params.shieldPercent,
          params.wrappedDek,
          params.kdfSalt,
          nowIso,
          DEFAULT_USER_ID,
        ]
      );
    } else {
      await db.runAsync(
        `UPDATE player_pulse_stats SET
          encrypted_financial_state = ?, wallet_hp_percent = ?, shield_percent = ?,
          sync_status = 'PENDING', updated_at = ?
        WHERE user_id = ?`,
        [
          encryptedFinState,
          params.walletHpPercent,
          params.shieldPercent,
          nowIso,
          DEFAULT_USER_ID,
        ]
      );
    }
  } else if (memoryTables.stats) {
    memoryTables.stats = {
      ...memoryTables.stats,
      encrypted_financial_state: encryptedFinState,
      wallet_hp_percent: params.walletHpPercent,
      shield_percent: params.shieldPercent,
      encrypted_dek: params.wrappedDek ?? memoryTables.stats.encrypted_dek,
      kdf_salt: params.kdfSalt ?? memoryTables.stats.kdf_salt,
      sync_status: 'PENDING',
      updated_at: nowIso,
    };
  }
}

/**
 * Menandai baris sebagai `SYNCED` HANYA jika:
 * 1. ID-nya dikonfirmasi oleh server (`synced_tx_ids` / `synced_quest_ids`), dan
 * 2. isinya belum berubah sejak snapshot dikirim.
 *
 * Poin 2 penting karena user bisa mencatat transaksi/top-up quest saat request sync masih berjalan.
 * Ciphertext AES-GCM selalu memakai IV acak, jadi kesamaan `encrypted_*` = isi tidak berubah.
 */
export async function markRecordsSynced(params: {
  confirmedTxIds: string[];
  confirmedQuests: Array<{ quest_id: string; encrypted_quest_payload: string; progress_percent: number; is_completed: number }>;
  statsSnapshot: { updated_at: string; encrypted_financial_state: string };
}): Promise<{ txMarked: number; questsMarked: number; statsMarked: boolean }> {
  const db = await getDb();
  let txMarked = 0;
  let questsMarked = 0;
  let statsMarked = false;

  if (db) {
    await db.withTransactionAsync(async () => {
      for (const txId of params.confirmedTxIds) {
        const r = await db.runAsync(
          `UPDATE local_transactions SET sync_status = 'SYNCED' WHERE tx_id = ? AND user_id = ?`,
          [txId, DEFAULT_USER_ID]
        );
        txMarked += r.changes;
      }
      for (const q of params.confirmedQuests) {
        const r = await db.runAsync(
          `UPDATE financial_quests SET sync_status = 'SYNCED'
           WHERE quest_id = ? AND encrypted_quest_payload = ? AND progress_percent = ? AND is_completed = ?`,
          [q.quest_id, q.encrypted_quest_payload, q.progress_percent, q.is_completed]
        );
        questsMarked += r.changes;
      }
      const r = await db.runAsync(
        `UPDATE player_pulse_stats SET sync_status = 'SYNCED'
         WHERE user_id = ? AND updated_at = ? AND encrypted_financial_state = ?`,
        [DEFAULT_USER_ID, params.statsSnapshot.updated_at, params.statsSnapshot.encrypted_financial_state]
      );
      statsMarked = r.changes > 0;
    });
  } else {
    const txSet = new Set(params.confirmedTxIds);
    memoryTables.transactions.forEach((t) => {
      if (txSet.has(t.tx_id)) {
        t.sync_status = 'SYNCED';
        txMarked += 1;
      }
    });
    for (const q of params.confirmedQuests) {
      const row = memoryTables.quests.find((m) => m.quest_id === q.quest_id);
      if (
        row &&
        row.encrypted_quest_payload === q.encrypted_quest_payload &&
        row.progress_percent === q.progress_percent &&
        row.is_completed === q.is_completed
      ) {
        row.sync_status = 'SYNCED';
        questsMarked += 1;
      }
    }
    const st = memoryTables.stats;
    if (
      st &&
      st.updated_at === params.statsSnapshot.updated_at &&
      st.encrypted_financial_state === params.statsSnapshot.encrypted_financial_state
    ) {
      st.sync_status = 'SYNCED';
      statsMarked = true;
    }
  }

  return { txMarked, questsMarked, statsMarked };
}
