import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { SyncError, syncWithGoCuanBackend } from '../api/pulseApi';
import {
  AuthApiError,
  clearPendingRegistration,
  clearSessionToken,
  flushPendingRegistration,
  getSessionToken,
  loginAccount,
  prelogin,
  queuePendingRegistration,
  registerAccount,
  setSessionToken,
  updatePasswordOnServer,
} from '../api/authApi';
import {
  createVault,
  deriveKeysFromPassword,
  getKeyFingerprint,
  getStoredVaultMeta,
  hasCachedDek,
  lockVault,
  restoreVaultMeta,
  rotateLoginPasswordKek,
  unlockVaultFromCache,
  unlockVaultWithDerivedKeys,
  unlockVaultWithPassword,
  wipeVaultFromDevice,
} from '../crypto/zeroKnowledgeCrypto';
import {
  initializePulseDatabase,
  insertEncryptedSavingQuest,
  insertEncryptedTransaction,
  loadDecryptedPulseState,
  markRecordsSynced,
  resetLocalDatabase,
  updateEncryptedMonthlyBudget,
  updateEncryptedQuestProgress,
  updatePublicPlayerStats,
} from '../db/database';
import {
  applyXpGain,
  computeHudMetrics,
  DAILY_SAFE_BURN_QUEST_LIMIT,
  evaluateTransactionRpgOutcome,
  getTodayDateString,
  planRollover,
} from '../engine/pulseRpgEngine';
import {
  EncryptedPlayerStatsRow,
  EncryptedQuestRow,
  EncryptedTransactionRow,
  FinancialQuest,
  PlayerPulseStats,
  PulseSyncRequest,
  SpendNature,
  TransactionItem,
  TransactionType,
} from '../types/pulse';

interface LastRpgFeedback {
  id: number;
  bannerText: string;
  xpEarned: number;
  hpDamageDealt: number;
  isCriticalHit: boolean;
  leveledUp: boolean;
}

/**
 * - CHECKING: reading storage on startup
 * - NO_VAULT: no account on this device -> show register / login-from-cloud
 * - LOCKED:   vault exists but DEK not in memory -> show password / biometric unlock
 * - UNLOCKED: DEK in memory, data decrypted
 */
export type VaultStatus = 'CHECKING' | 'NO_VAULT' | 'LOCKED' | 'UNLOCKED';

/**
 * - LINKED:           has session token for Go Cuan Cloud
 * - PENDING_REGISTER: vault created offline, registration queued
 * - LOCAL_ONLY:       no token (e.g. web reload, or token expired)
 */
export type CloudLinkStatus = 'LINKED' | 'PENDING_REGISTER' | 'LOCAL_ONLY';

export interface SyncSummary {
  at: string;
  sentTxCount: number;
  confirmedTxCount: number;
  unconfirmedTxCount: number;
  questsMarked: number;
  statsMarked: boolean;
}

export type LastSyncResult =
  | { ok: true; summary: SyncSummary }
  | { ok: false; error: string; at: string };

const KEY_BIOMETRIC_PREF = 'veine_pulse_biometric_pref_v1';

interface PulseContextValue {
  vaultStatus: VaultStatus;
  storedEmail: string | null;
  canUseBiometricUnlock: boolean;
  cloudLinkStatus: CloudLinkStatus;
  createAccount: (email: string, password: string) => Promise<{ registeredOnCloud: boolean }>;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithBiometric: () => Promise<boolean>;
  loginFromCloud: (email: string, password: string) => Promise<void>;
  lock: () => Promise<void>;
  logoutAndForgetDevice: () => Promise<void>;

  isLoading: boolean;
  stats: PlayerPulseStats | null;
  transactions: TransactionItem[];
  quests: FinancialQuest[];
  rawStatsRow: EncryptedPlayerStatsRow | null;
  rawTransactionRows: EncryptedTransactionRow[];
  rawQuestRows: EncryptedQuestRow[];
  keyFingerprint: string;
  isBiometricEnabled: boolean;
  lastFeedback: LastRpgFeedback | null;
  lastSyncPayload: PulseSyncRequest | null;
  lastSync: LastSyncResult | null;
  pendingSyncCount: number;
  hudMetrics: ReturnType<typeof computeHudMetrics> | null;
  toggleBiometricLock: (enabled: boolean) => Promise<void>;
  addTransaction: (input: {
    title: string;
    amount: number;
    txType: TransactionType;
    category: string;
    spendNature: SpendNature;
    notes?: string;
  }) => Promise<LastRpgFeedback>;
  addSavingQuest: (input: {
    title: string;
    targetAmount: number;
    initialProgress?: number;
  }) => Promise<void>;
  topUpSavingQuest: (questId: string, topUpAmount: number) => Promise<void>;
  updateBudgetLimit: (newMonthlyBudget: number, newShieldTarget: number) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>;
  /** Throws SyncError / Error on failure; local data stays PENDING. */
  forceSyncToCloud: () => Promise<SyncSummary>;
}

const PulseContext = createContext<PulseContextValue | undefined>(undefined);

async function readBiometricPref(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await SecureStore.getItemAsync(KEY_BIOMETRIC_PREF)) !== '0';
  } catch {
    return true;
  }
}

export const PulseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>('CHECKING');
  const [storedEmail, setStoredEmail] = useState<string | null>(null);
  const [hasCachedKey, setHasCachedKey] = useState(false);
  const [cloudLinkStatus, setCloudLinkStatus] = useState<CloudLinkStatus>('LOCAL_ONLY');

  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<PlayerPulseStats | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [quests, setQuests] = useState<FinancialQuest[]>([]);
  const [rawStatsRow, setRawStatsRow] = useState<EncryptedPlayerStatsRow | null>(null);
  const [rawTransactionRows, setRawTransactionRows] = useState<EncryptedTransactionRow[]>([]);
  const [rawQuestRows, setRawQuestRows] = useState<EncryptedQuestRow[]>([]);
  const [keyFingerprint, setKeyFingerprint] = useState<string>('LOCKED');
  const [isBiometricEnabled, setIsBiometricEnabled] = useState<boolean>(false);
  const [lastFeedback, setLastFeedback] = useState<LastRpgFeedback | null>(null);
  const [lastSyncPayload, setLastSyncPayload] = useState<PulseSyncRequest | null>(null);
  const [lastSync, setLastSync] = useState<LastSyncResult | null>(null);

  const clearDecryptedState = useCallback(() => {
    setStats(null);
    setTransactions([]);
    setQuests([]);
    setRawStatsRow(null);
    setRawTransactionRows([]);
    setRawQuestRows([]);
    setKeyFingerprint('LOCKED');
    setLastFeedback(null);
    setLastSyncPayload(null);
  }, []);

  const refreshCloudLinkStatus = useCallback(async (pendingRegister = false) => {
    if (pendingRegister) {
      setCloudLinkStatus('PENDING_REGISTER');
      return;
    }
    setCloudLinkStatus((await getSessionToken()) ? 'LINKED' : 'LOCAL_ONLY');
  }, []);

  const refreshAllState = useCallback(async () => {
    setKeyFingerprint(getKeyFingerprint());
    let loaded = await loadDecryptedPulseState();

    // Jalankan rollover harian/mingguan/bulanan jika hari/minggu/bulan berganti
    const rollover = planRollover(loaded.stats, loaded.quests);
    if (rollover.changed) {
      const prevLevel = loaded.stats.level;
      for (const q of rollover.questResets) {
        await updateEncryptedQuestProgress({
          questId: q.quest_id,
          title: q.title,
          targetAmount: q.target_amount,
          newProgress: 0,
          isCompleted: false,
          expiresAt: q.new_expires_at,
        });
      }
      await updatePublicPlayerStats(rollover.statsPatch);
      loaded = await loadDecryptedPulseState();
      if (rollover.xpAwarded > 0) {
        setLastFeedback({
          id: Date.now(),
          bannerText: `QUEST REWARD +${rollover.xpAwarded} XP!`,
          xpEarned: rollover.xpAwarded,
          hpDamageDealt: 0,
          isCriticalHit: false,
          leveledUp: rollover.statsPatch.level > prevLevel,
        });
      }
    }

    setStats(loaded.stats);
    setTransactions(loaded.transactions);
    setQuests(loaded.quests);
    setRawStatsRow(loaded.rawStatsRow);
    setRawTransactionRows(loaded.rawTransactionRows);
    setRawQuestRows(loaded.rawQuestRows);
    setIsLoading(false);
  }, []);

  /** Called after any successful unlock path. */
  const onUnlocked = useCallback(
    async (vault: { wrappedDek: string; kdfSalt: string }) => {
      await initializePulseDatabase(vault);
      await refreshAllState();
      setHasCachedKey(await hasCachedDek());
      setVaultStatus('UNLOCKED');
    },
    [refreshAllState]
  );

  // Startup: decide which gate to show. Never auto-unlocks without user action.
  useEffect(() => {
    (async () => {
      const [meta, cached, bioPref] = await Promise.all([
        getStoredVaultMeta(),
        hasCachedDek(),
        readBiometricPref(),
      ]);
      setIsBiometricEnabled(bioPref);
      setHasCachedKey(cached);
      await refreshCloudLinkStatus();
      if (!meta) {
        setVaultStatus('NO_VAULT');
        return;
      }
      setStoredEmail(meta.email);
      setVaultStatus('LOCKED');
    })();
  }, [refreshCloudLinkStatus]);

  // ---------------------------------------------------------------------------
  // Account / vault actions
  // ---------------------------------------------------------------------------

  const createAccount = useCallback(
    async (email: string, password: string) => {
      // Any rows left on this device were encrypted with another DEK and can never be read again.
      await resetLocalDatabase();
      const vault = await createVault(email, password);
      const registration = {
        email,
        auth_hash: vault.authHashHex,
        kdf_salt: vault.kdfSalt,
        encrypted_dek: vault.wrappedDek,
      };

      let registeredOnCloud = false;
      try {
        const res = await registerAccount(registration);
        await setSessionToken(res.token);
        registeredOnCloud = true;
      } catch (err) {
        if (err instanceof AuthApiError && err.code === 'CONFLICT') {
          await wipeVaultFromDevice();
          throw err;
        }
        // Offline / backend not deployed yet: keep the vault local and register later.
        await queuePendingRegistration(registration);
      }

      setStoredEmail(email);
      await refreshCloudLinkStatus(!registeredOnCloud);
      await onUnlocked(vault);
      return { registeredOnCloud };
    },
    [onUnlocked, refreshCloudLinkStatus]
  );

  const unlockWithPassword = useCallback(
    async (password: string) => {
      const meta = await getStoredVaultMeta();
      if (!meta) throw new Error('Belum ada vault di perangkat ini.');
      // Throws Error('WRONG_PASSWORD') on bad password.
      const vault = await unlockVaultWithPassword(password, meta.kdfSalt, meta.wrappedDek);

      // Best-effort: refresh the session token, never block the local unlock on it.
      if (meta.email) {
        loginAccount({ email: meta.email, auth_hash: vault.authHashHex })
          .then((res) => setSessionToken(res.token))
          .then(() => refreshCloudLinkStatus())
          .catch(() => undefined);
      }
      await onUnlocked(vault);
    },
    [onUnlocked, refreshCloudLinkStatus]
  );

  const unlockWithBiometric = useCallback(async () => {
    if (Platform.OS === 'web') return false;
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Buka Vault Veine Pulse',
      cancelLabel: 'Pakai password',
      disableDeviceFallback: false,
    });
    if (!res.success) return false;
    const ok = await unlockVaultFromCache();
    if (!ok) return false;
    const meta = await getStoredVaultMeta();
    if (!meta) return false;
    await onUnlocked(meta);
    return true;
  }, [onUnlocked]);

  const loginFromCloud = useCallback(
    async (email: string, password: string) => {
      const { kdf_salt } = await prelogin(email);
      const keys = await deriveKeysFromPassword(password, kdf_salt);
      const res = await loginAccount({ email, auth_hash: keys.authHashHex });
      await setSessionToken(res.token);
      await clearPendingRegistration();

      // Different account (or fresh device): local rows can't be decrypted with this DEK.
      const meta = await getStoredVaultMeta();
      if (!meta || meta.email !== email) {
        await resetLocalDatabase();
      }

      const vault = await unlockVaultWithDerivedKeys(keys, res.kdf_salt, res.encrypted_dek, email);
      setStoredEmail(email);
      await refreshCloudLinkStatus();
      await onUnlocked(vault);
    },
    [onUnlocked, refreshCloudLinkStatus]
  );

  const lock = useCallback(async () => {
    await lockVault(false);
    clearDecryptedState();
    setVaultStatus('LOCKED');
  }, [clearDecryptedState]);

  // Auto-lock setelah >30 detik di background (mobile), dan refresh rollover saat kembali aktif.
  const backgroundedAtRef = useRef<number | null>(null);
  const appStateRef = useRef<string>(AppState.currentState ?? 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'background') {
        backgroundedAtRef.current = Date.now();
        return;
      }

      if (prevState !== 'active' && nextState === 'active' && vaultStatus === 'UNLOCKED') {
        const bgAt = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (Platform.OS !== 'web' && bgAt && Date.now() - bgAt > 30_000) {
          lock();
        } else {
          refreshAllState().catch(() => undefined);
        }
      }
    });
    return () => sub.remove();
  }, [vaultStatus, lock, refreshAllState]);

  const logoutAndForgetDevice = useCallback(async () => {
    await wipeVaultFromDevice();
    await clearSessionToken();
    await clearPendingRegistration();
    await resetLocalDatabase();
    clearDecryptedState();
    setStoredEmail(null);
    setHasCachedKey(false);
    setCloudLinkStatus('LOCAL_ONLY');
    setVaultStatus('NO_VAULT');
  }, [clearDecryptedState]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<string> => {
      const meta = await getStoredVaultMeta();
      if (!meta) throw new Error('Belum ada vault di perangkat ini.');
      // Verify the current password first (throws WRONG_PASSWORD).
      await unlockVaultWithPassword(currentPassword, meta.kdfSalt, meta.wrappedDek);

      const rotated = await rotateLoginPasswordKek(newPassword);

      if (cloudLinkStatus === 'PENDING_REGISTER' && meta.email) {
        await queuePendingRegistration({
          email: meta.email,
          auth_hash: rotated.authHashHex,
          kdf_salt: rotated.kdfSalt,
          encrypted_dek: rotated.wrappedDek,
        });
      } else if (await getSessionToken()) {
        try {
          await updatePasswordOnServer({
            new_auth_hash: rotated.authHashHex,
            new_kdf_salt: rotated.kdfSalt,
            new_encrypted_dek: rotated.wrappedDek,
          });
        } catch (err) {
          // Keep device and server consistent: the old password must keep working everywhere
          // until the server accepts the new one.
          await restoreVaultMeta(meta.kdfSalt, meta.wrappedDek);
          throw err;
        }
      }

      if (stats) {
        await updateEncryptedMonthlyBudget({
          monthlyBudgetLimit: stats.monthly_budget_limit,
          emergencyShieldTarget: stats.emergency_shield_target,
          emergencyShieldSaved: stats.emergency_shield_saved,
          walletHpPercent: stats.wallet_hp_percent,
          shieldPercent: stats.shield_percent,
          wrappedDek: rotated.wrappedDek,
          kdfSalt: rotated.kdfSalt,
        });
      }
      await refreshAllState();
      return rotated.keyFingerprint;
    },
    [cloudLinkStatus, stats, refreshAllState]
  );

  const toggleBiometricLock = useCallback(async (enabled: boolean) => {
    setIsBiometricEnabled(enabled);
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync(KEY_BIOMETRIC_PREF, enabled ? '1' : '0');
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Data actions
  // ---------------------------------------------------------------------------

  const hudMetrics = React.useMemo(() => {
    if (!stats) return null;
    return computeHudMetrics(stats, transactions);
  }, [stats, transactions]);

  const addTransaction = useCallback(
    async (input: {
      title: string;
      amount: number;
      txType: TransactionType;
      category: string;
      spendNature: SpendNature;
      notes?: string;
    }): Promise<LastRpgFeedback> => {
      if (!stats) {
        throw new Error('State karakter belum siap.');
      }

      const todayStr = getTodayDateString();
      const outcome = evaluateTransactionRpgOutcome({
        stats,
        txType: input.txType,
        spendNature: input.spendNature,
        amount: input.amount,
        todayStr,
      });

      const provisionalStats: PlayerPulseStats = {
        ...stats,
        level: outcome.newLevel,
        current_xp: outcome.newCurrentXp,
        next_level_xp: outcome.newNextLevelXp,
        current_streak: outcome.newStreak,
        longest_streak: outcome.newLongestStreak,
        last_log_date: todayStr,
        impulse_penalty_percent: outcome.newImpulsePenaltyPercent,
        daily_tx_xp_count: outcome.newDailyTxCount,
        unlocked_title: outcome.newUnlockedTitle,
        sync_status: 'PENDING',
      };

      const tempTx: TransactionItem = {
        tx_id: 'temp',
        user_id: stats.user_id,
        title: input.title,
        amount: input.amount,
        tx_type: input.txType,
        category: input.category,
        spend_nature: input.spendNature,
        tx_date: todayStr,
        hp_damage_dealt: outcome.hpDamageDealt,
        xp_earned: outcome.xpEarned,
        sync_status: 'PENDING',
        created_at: new Date().toISOString(),
        raw_ciphertext_preview: '',
      };

      const nextMetrics = computeHudMetrics(provisionalStats, [tempTx, ...transactions]);
      provisionalStats.wallet_hp_percent = nextMetrics.walletHpPercent;
      provisionalStats.shield_percent = nextMetrics.shieldPercent;

      await insertEncryptedTransaction({
        title: input.title,
        amount: input.amount,
        txType: input.txType,
        category: input.category,
        spendNature: input.spendNature,
        notes: input.notes,
        updatedStats: provisionalStats,
        hpDamageDealt: outcome.hpDamageDealt,
        xpEarned: outcome.xpEarned,
      });

      const dailyLogQuest = quests.find((q) => q.quest_id === 'q_daily_log_1');
      if (dailyLogQuest && !dailyLogQuest.is_completed) {
        await updateEncryptedQuestProgress({
          questId: dailyLogQuest.quest_id,
          title: dailyLogQuest.title,
          targetAmount: 1,
          newProgress: 1,
          isCompleted: true,
        });
      }

      const dailyBurnQuest = quests.find((q) => q.quest_id === 'q_daily_burn_75k');
      if (dailyBurnQuest) {
        const underLimit = nextMetrics.todayExpense <= DAILY_SAFE_BURN_QUEST_LIMIT;
        await updateEncryptedQuestProgress({
          questId: dailyBurnQuest.quest_id,
          title: dailyBurnQuest.title,
          targetAmount: DAILY_SAFE_BURN_QUEST_LIMIT,
          newProgress: nextMetrics.todayExpense,
          isCompleted: underLimit && nextMetrics.todayExpense > 0,
        });
      }

      const feedback: LastRpgFeedback = {
        id: Date.now(),
        bannerText: outcome.feedbackBanner,
        xpEarned: outcome.xpEarned,
        hpDamageDealt: outcome.hpDamageDealt,
        isCriticalHit: outcome.isCriticalHit,
        leveledUp: outcome.leveledUp,
      };
      setLastFeedback(feedback);
      await refreshAllState();
      return feedback;
    },
    [stats, transactions, quests, refreshAllState]
  );

  const addSavingQuest = useCallback(
    async (input: { title: string; targetAmount: number; initialProgress?: number }) => {
      await insertEncryptedSavingQuest(input);
      await refreshAllState();
    },
    [refreshAllState]
  );

  const topUpSavingQuest = useCallback(
    async (questId: string, topUpAmount: number) => {
      const targetQuest = quests.find((q) => q.quest_id === questId);
      if (!targetQuest) return;
      const wasCompleted = targetQuest.is_completed;
      const newProgress = Math.min(
        targetQuest.target_amount,
        targetQuest.current_progress + topUpAmount
      );
      const isCompleted = newProgress >= targetQuest.target_amount;

      await updateEncryptedQuestProgress({
        questId: targetQuest.quest_id,
        title: targetQuest.title,
        targetAmount: targetQuest.target_amount,
        newProgress,
        isCompleted,
      });

      await addTransaction({
        title: `Quest Top-Up: ${targetQuest.title}`,
        amount: topUpAmount,
        txType: 'SAVING',
        category: 'Saving Quest',
        spendNature: 'ESSENTIAL',
      });

      // Berikan XP hadiah quest jika baru selesai pada top-up ini
      if (!wasCompleted && isCompleted && targetQuest.xp_reward > 0) {
        const latest = await loadDecryptedPulseState();
        const xpGain = applyXpGain(
          latest.stats.level,
          latest.stats.current_xp,
          latest.stats.next_level_xp,
          targetQuest.xp_reward
        );
        await updatePublicPlayerStats({
          current_streak: latest.stats.current_streak,
          impulse_penalty_percent: latest.stats.impulse_penalty_percent,
          daily_tx_xp_count: latest.stats.daily_tx_xp_count,
          level: xpGain.level,
          current_xp: xpGain.currentXp,
          next_level_xp: xpGain.nextLevelXp,
          unlocked_title: xpGain.title,
        });
        setLastFeedback({
          id: Date.now(),
          bannerText: `SAVING QUEST COMPLETE! +${targetQuest.xp_reward} XP`,
          xpEarned: targetQuest.xp_reward,
          hpDamageDealt: 0,
          isCriticalHit: false,
          leveledUp: xpGain.leveledUp,
        });
        await refreshAllState();
      }
    },
    [quests, addTransaction, refreshAllState]
  );

  const updateBudgetLimit = useCallback(
    async (newMonthlyBudget: number, newShieldTarget: number) => {
      if (!stats) return;
      const tempStats: PlayerPulseStats = {
        ...stats,
        monthly_budget_limit: newMonthlyBudget,
        emergency_shield_target: newShieldTarget,
      };
      const nextMetrics = computeHudMetrics(tempStats, transactions);
      await updateEncryptedMonthlyBudget({
        monthlyBudgetLimit: newMonthlyBudget,
        emergencyShieldTarget: newShieldTarget,
        emergencyShieldSaved: stats.emergency_shield_saved,
        walletHpPercent: nextMetrics.walletHpPercent,
        shieldPercent: nextMetrics.shieldPercent,
      });
      await refreshAllState();
    },
    [stats, transactions, refreshAllState]
  );

  const forceSyncToCloud = useCallback(async () => {
    if (!rawStatsRow) {
      throw new Error('Data belum siap untuk disinkronkan.');
    }
    // Vault dibuat offline? Daftarkan dulu supaya sync punya sesi.
    if (cloudLinkStatus === 'PENDING_REGISTER') {
      try {
        await flushPendingRegistration();
        await refreshCloudLinkStatus();
      } catch (err) {
        if (err instanceof AuthApiError && err.code === 'CONFLICT') {
          throw new Error('Email ini sudah terdaftar di Go Cuan Cloud oleh akun lain.');
        }
        throw new SyncError('NETWORK', 'Go Cuan Cloud tidak dapat dihubungi. Data tetap PENDING.');
      }
    }

    // Snapshot yang dikirim — dipakai untuk memastikan hanya baris yang tidak berubah yang ditandai SYNCED.
    const statsSnapshot = {
      updated_at: rawStatsRow.updated_at,
      encrypted_financial_state: rawStatsRow.encrypted_financial_state,
    };
    const sentQuests = rawQuestRows.filter((q) => q.sync_status === 'PENDING');

    try {
      const result = await syncWithGoCuanBackend({
        rawStats: rawStatsRow,
        rawTransactions: rawTransactionRows,
        rawQuests: rawQuestRows,
      });
      setLastSyncPayload(result.payloadPreview);

      const confirmedQuestIds = new Set(result.response.synced_quest_ids);
      const marked = await markRecordsSynced({
        confirmedTxIds: result.response.synced_tx_ids,
        confirmedQuests: sentQuests
          .filter((q) => confirmedQuestIds.has(q.quest_id))
          .map((q) => ({
            quest_id: q.quest_id,
            encrypted_quest_payload: q.encrypted_quest_payload,
            progress_percent: q.progress_percent,
            is_completed: q.is_completed,
          })),
        statsSnapshot,
      });

      const sentTxCount = result.payloadPreview.pending_transactions.length;
      const summary: SyncSummary = {
        at: result.response.synced_at,
        sentTxCount,
        confirmedTxCount: marked.txMarked,
        unconfirmedTxCount: Math.max(0, sentTxCount - marked.txMarked),
        questsMarked: marked.questsMarked,
        statsMarked: marked.statsMarked,
      };
      setLastSync({ ok: true, summary });
      await refreshAllState();
      return summary;
    } catch (err) {
      if (err instanceof SyncError && err.code === 'UNAUTHORIZED') {
        await clearSessionToken();
        await refreshCloudLinkStatus();
      }
      const message = err instanceof Error ? err.message : 'Sync gagal.';
      setLastSync({ ok: false, error: message, at: new Date().toISOString() });
      throw err;
    }
  }, [
    rawStatsRow,
    rawTransactionRows,
    rawQuestRows,
    cloudLinkStatus,
    refreshAllState,
    refreshCloudLinkStatus,
  ]);

  const pendingSyncCount = React.useMemo(
    () =>
      rawTransactionRows.filter((t) => t.sync_status === 'PENDING').length +
      rawQuestRows.filter((q) => q.sync_status === 'PENDING').length +
      (rawStatsRow?.sync_status === 'PENDING' ? 1 : 0),
    [rawTransactionRows, rawQuestRows, rawStatsRow]
  );

  return (
    <PulseContext.Provider
      value={{
        vaultStatus,
        storedEmail,
        canUseBiometricUnlock: isBiometricEnabled && hasCachedKey && Platform.OS !== 'web',
        cloudLinkStatus,
        createAccount,
        unlockWithPassword,
        unlockWithBiometric,
        loginFromCloud,
        lock,
        logoutAndForgetDevice,
        isLoading,
        stats,
        transactions,
        quests,
        rawStatsRow,
        rawTransactionRows,
        rawQuestRows,
        keyFingerprint,
        isBiometricEnabled,
        lastFeedback,
        lastSyncPayload,
        lastSync,
        pendingSyncCount,
        hudMetrics,
        toggleBiometricLock,
        addTransaction,
        addSavingQuest,
        topUpSavingQuest,
        updateBudgetLimit,
        changePassword,
        forceSyncToCloud,
      }}
    >
      {children}
    </PulseContext.Provider>
  );
};

export function usePulse(): PulseContextValue {
  const ctx = useContext(PulseContext);
  if (!ctx) {
    throw new Error('usePulse harus digunakan di dalam PulseProvider');
  }
  return ctx;
}
