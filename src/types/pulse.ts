export type SyncStatus = 'PENDING' | 'SYNCED';
export type TransactionType = 'EXPENSE' | 'INCOME' | 'SAVING';
export type SpendNature = 'ESSENTIAL' | 'IMPULSE';
export type QuestType = 'DAILY' | 'WEEKLY' | 'SAVING_GOAL';

/**
 * Sensitive financial fields inside `local_transactions.encrypted_payload` (AES-256-GCM).
 * Neither SQLite nor PostgreSQL stores these in plaintext.
 */
export interface ConfidentialTransactionPayload {
  title: string;
  amount: number;
  category: string;
  spend_nature: SpendNature;
  notes?: string;
}

/**
 * Raw row stored in SQLite `local_transactions` and sent to PostgreSQL `/api/v1/pulse/sync`.
 */
export interface EncryptedTransactionRow {
  tx_id: string;
  user_id: string;
  tx_type: TransactionType;
  tx_date: string; // YYYY-MM-DD (used for daily streak & chronological sorting)
  encrypted_payload: string; // vp1:<iv_hex>:<ciphertext_and_tag_hex>
  hp_damage_dealt: number; // % HP impact (0 or 10% critical hit), no Rupiah exposed
  xp_earned: number;
  sync_status: SyncStatus;
  created_at: string;
}

/**
 * Decrypted transaction object used purely in client memory (Mobile & Go Cuan Web).
 */
export interface TransactionItem extends ConfidentialTransactionPayload {
  tx_id: string;
  user_id: string;
  tx_type: TransactionType;
  tx_date: string;
  hp_damage_dealt: number;
  xp_earned: number;
  sync_status: SyncStatus;
  created_at: string;
  raw_ciphertext_preview: string;
}

/**
 * Sensitive budget & balance numbers inside `player_pulse_stats.encrypted_financial_state`.
 */
export interface ConfidentialPlayerFinancialState {
  monthly_budget_limit: number;
  emergency_shield_target: number;
  emergency_shield_saved: number;
  daily_safe_spend_limit: number;
}

/**
 * Raw row in `player_pulse_stats` (SQLite & PostgreSQL).
 * RPG stats (Level, XP, Streak, HP %, Shield %) remain readable for RPG HUD / Leaderboards,
 * while all Rupiah limits/balances are encrypted inside `encrypted_financial_state`.
 */
export interface EncryptedPlayerStatsRow {
  user_id: string;
  level: number;
  current_xp: number;
  next_level_xp: number;
  current_streak: number;
  longest_streak: number;
  last_log_date: string | null;
  wallet_hp_percent: number; // 0 - 100 (Public RPG HUD % without revealing Rupiah!)
  shield_percent: number; // 0 - 100
  impulse_penalty_percent: number; // Accumulated critical hit -10% HP penalties this month
  daily_tx_xp_count: number; // Max 3x/day anti-spam counter
  unlocked_title: string;
  encrypted_financial_state: string; // AES-256-GCM ciphertext of ConfidentialPlayerFinancialState
  encrypted_dek: string; // Wrapped 256-bit DEK (encrypted with KEK derived from user password)
  kdf_salt: string;
  sync_status: SyncStatus;
  updated_at: string;
}

/**
 * Decrypted player profile in client memory.
 */
export interface PlayerPulseStats extends ConfidentialPlayerFinancialState {
  user_id: string;
  level: number;
  current_xp: number;
  next_level_xp: number;
  current_streak: number;
  longest_streak: number;
  last_log_date: string | null;
  wallet_hp_percent: number;
  shield_percent: number;
  impulse_penalty_percent: number;
  daily_tx_xp_count: number;
  unlocked_title: string;
  encrypted_financial_state: string;
  encrypted_dek: string;
  kdf_salt: string;
  sync_status: SyncStatus;
  updated_at: string;
}

/**
 * Sensitive quest nominal targets inside `financial_quests.encrypted_quest_payload`.
 */
export interface ConfidentialQuestPayload {
  title: string;
  target_amount: number;
  current_progress: number;
}

/**
 * Raw row in `financial_quests` (SQLite & PostgreSQL).
 */
export interface EncryptedQuestRow {
  quest_id: string;
  quest_type: QuestType;
  progress_percent: number; // 0 - 100% visible for RPG progress without exposing Rupiah
  xp_reward: number;
  is_completed: number; // 0 or 1
  expires_at: string | null;
  encrypted_quest_payload: string; // AES-256-GCM ciphertext of ConfidentialQuestPayload
  sync_status: SyncStatus;
}

/**
 * Decrypted Quest object in client memory.
 */
export interface FinancialQuest extends ConfidentialQuestPayload {
  quest_id: string;
  quest_type: QuestType;
  progress_percent: number;
  xp_reward: number;
  is_completed: boolean;
  expires_at: string | null;
  encrypted_quest_payload: string;
  sync_status: SyncStatus;
}

/**
 * Contract for Go/Gin Backend `/api/v1/pulse/sync`
 * Notice that the backend receives ONLY `encrypted_payload`, `encrypted_financial_state`,
 * and `encrypted_quest_payload` along with public RPG percentages/XP!
 */
export interface PulseSyncRequest {
  client_version: string;
  // user_id is taken from the JWT on the server, never trusted from the body.
  // encrypted_dek / kdf_salt are intentionally excluded: key changes go through /auth/password only.
  player_stats: Omit<EncryptedPlayerStatsRow, 'sync_status' | 'encrypted_dek' | 'kdf_salt'>;
  pending_transactions: Omit<EncryptedTransactionRow, 'sync_status'>[];
  quests: Omit<EncryptedQuestRow, 'sync_status'>[];
}

export interface PulseSyncResponse {
  status: 'OK';
  synced_at: string;
  server_verified_level: number;
  server_verified_xp: number;
  server_verified_streak: number;
  unlocked_title: string;
  synced_tx_ids: string[];
  synced_quest_ids: string[];
}

