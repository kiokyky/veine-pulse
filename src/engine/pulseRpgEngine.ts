import {
  FinancialQuest,
  PlayerPulseStats,
  SpendNature,
  TransactionItem,
  TransactionType,
} from '../types/pulse';

export const DAILY_SAFE_BURN_QUEST_LIMIT = 75000; // Rp 75.000 sesuai Blueprint
export const MAX_DAILY_TX_XP_LOGS = 3; // Maksimal 3x sehari (+15 XP) anti-spam
export const BASE_TX_XP = 15;
export const NO_IMPULSE_DAY_XP = 50;
export const WEEKLY_QUEST_XP = 150;
export const IMPULSE_CRITICAL_HIT_HP_PENALTY = 10; // -10% HP (Critical Hit)

/**
 * Menentukan Title Class berdasarkan Level sesuai Blueprint v2.0.
 */
export function resolveTitleByLevel(level: number): string {
  if (level >= 25) return 'Sovereign of Cuan';
  if (level >= 10) return 'Cashflow Ranger';
  if (level >= 5) return 'Tactical Saver';
  if (level >= 2) return 'Novice Spender';
  return 'Rookie Cuan Crafter';
}

/**
 * Menghitung kebutuhan XP untuk naik ke level berikutnya.
 */
export function calculateNextLevelXp(level: number): number {
  return 500 + (level - 1) * 250;
}

/**
 * Mengecek apakah user sedang dalam mode OVERDRIVE (Streak >= 7 hari berturut-turut -> 1.5x XP Multiplier).
 */
export function isOverdriveActive(streak: number): boolean {
  return streak >= 7;
}

/**
 * Menghitung XP final dengan memperhitungkan 1.5x Overdrive Multiplier jika Streak >= 7 hari.
 */
export function applyStreakMultiplier(baseXp: number, streak: number): number {
  if (isOverdriveActive(streak)) {
    return Math.round(baseXp * 1.5);
  }
  return baseXp;
}

/**
 * Menghitung tanggal hari ini dalam format YYYY-MM-DD waktu lokal.
 */
export function getTodayDateString(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Menghitung selisih hari kalender antara dua string YYYY-MM-DD.
 */
export function diffDaysBetweenDates(prevDate: string | null, currentDate: string): number {
  if (!prevDate) return 999;
  const [y1, m1, d1] = prevDate.split('-').map(Number);
  const [y2, m2, d2] = currentDate.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((utc2 - utc1) / (1000 * 60 * 60 * 24));
}

/**
 * Menghitung Safe Daily Spend (sisa budget bulanan dibagi sisa hari di bulan berjalan),
 * Wallet HP % (0 - 100%), dan Emergency Shield % (0 - 100%).
 * Semua kalkulasi ini berjalan 100% di sisi Klien (Mobile / Browser) di atas data yang sudah didekripsi.
 */
export function computeHudMetrics(
  stats: PlayerPulseStats,
  transactions: TransactionItem[],
  now = new Date()
): {
  totalMonthlyExpense: number;
  totalMonthlyIncome: number;
  totalMonthlySaving: number;
  todayExpense: number;
  todayImpulseCount: number;
  remainingMonthlyBudget: number;
  safeDailySpend: number;
  walletHpPercent: number;
  shieldPercent: number;
  daysLeftInMonth: number;
} {
  const currentMonthPrefix = getTodayDateString(now).slice(0, 7); // YYYY-MM
  const todayStr = getTodayDateString(now);

  let totalMonthlyExpense = 0;
  let totalMonthlyIncome = 0;
  let totalMonthlySaving = 0;
  let todayExpense = 0;
  let todayImpulseCount = 0;

  for (const tx of transactions) {
    if (!tx.tx_date.startsWith(currentMonthPrefix)) continue;

    if (tx.tx_type === 'EXPENSE') {
      totalMonthlyExpense += tx.amount;
      if (tx.tx_date === todayStr) {
        todayExpense += tx.amount;
        if (tx.spend_nature === 'IMPULSE') {
          todayImpulseCount += 1;
        }
      }
    } else if (tx.tx_type === 'INCOME') {
      totalMonthlyIncome += tx.amount;
    } else if (tx.tx_type === 'SAVING') {
      totalMonthlySaving += tx.amount;
    }
  }

  const budgetLimit = Math.max(1, stats.monthly_budget_limit);
  const remainingMonthlyBudget = Math.max(0, budgetLimit - totalMonthlyExpense);

  // Sisa hari di bulan berjalan (minimal 1 hari)
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeftInMonth = Math.max(1, lastDayOfMonth - now.getDate() + 1);
  const safeDailySpend = Math.floor(remainingMonthlyBudget / daysLeftInMonth);

  // Base HP % dari sisa budget bulanan dikurangi penalti Critical Hit (-10% HP) dari transaksi Impulse
  const rawBudgetHpPercent = (remainingMonthlyBudget / budgetLimit) * 100;
  const walletHpPercent = Math.max(
    0,
    Math.min(100, Math.round(rawBudgetHpPercent - stats.impulse_penalty_percent))
  );

  const shieldTarget = Math.max(1, stats.emergency_shield_target);
  const totalShieldSaved = stats.emergency_shield_saved + totalMonthlySaving;
  const shieldPercent = Math.max(
    0,
    Math.min(100, Math.round((totalShieldSaved / shieldTarget) * 100))
  );

  return {
    totalMonthlyExpense,
    totalMonthlyIncome,
    totalMonthlySaving,
    todayExpense,
    todayImpulseCount,
    remainingMonthlyBudget,
    safeDailySpend,
    walletHpPercent,
    shieldPercent,
    daysLeftInMonth,
  };
}

/**
 * Evaluasi efek RPG saat pengguna mencatat transaksi baru via Tactical Numpad.
 */
export function evaluateTransactionRpgOutcome(params: {
  stats: PlayerPulseStats;
  txType: TransactionType;
  spendNature: SpendNature;
  amount: number;
  todayStr: string;
}): {
  xpEarned: number;
  hpDamageDealt: number;
  newLevel: number;
  newCurrentXp: number;
  newNextLevelXp: number;
  newStreak: number;
  newLongestStreak: number;
  newDailyTxCount: number;
  newImpulsePenaltyPercent: number;
  newUnlockedTitle: string;
  leveledUp: boolean;
  isCriticalHit: boolean;
  overdriveApplied: boolean;
  feedbackBanner: string;
} {
  const { stats, txType, spendNature, amount, todayStr } = params;

  // 1. Evaluasi Streak Harian
  const dayDiff = diffDaysBetweenDates(stats.last_log_date, todayStr);
  let newStreak = stats.current_streak;
  let newDailyTxCount = stats.daily_tx_xp_count;

  if (dayDiff === 0) {
    // Masih di hari yang sama
    newDailyTxCount += 1;
  } else if (dayDiff === 1) {
    // Hari berturut-turut! Streak bertambah
    newStreak += 1;
    newDailyTxCount = 1;
  } else {
    // Lebih dari 1 hari terlewat atau log pertama kali
    newStreak = Math.max(1, stats.current_streak === 0 ? 1 : 1);
    newDailyTxCount = 1;
  }

  const newLongestStreak = Math.max(stats.longest_streak, newStreak);
  const overdriveApplied = isOverdriveActive(newStreak);

  // 2. Hitung XP Transaksi Harian (Maksimal 3x sehari agar tidak di-spam sesuai Blueprint)
  let baseXp = 0;
  if (newDailyTxCount <= MAX_DAILY_TX_XP_LOGS) {
    baseXp += BASE_TX_XP;
  }

  // Bonus XP jika menabung ke Emergency Shield / Saving
  if (txType === 'SAVING') {
    baseXp += 20;
  }

  const xpEarned = applyStreakMultiplier(baseXp, newStreak);

  // 3. Evaluasi Impulse Expense (Overbudget / Impulse Category -> -10% HP Critical Hit)
  let hpDamageDealt = 0;
  let isCriticalHit = false;
  let newImpulsePenaltyPercent = stats.impulse_penalty_percent;

  if (txType === 'EXPENSE' && spendNature === 'IMPULSE') {
    isCriticalHit = true;
    hpDamageDealt = IMPULSE_CRITICAL_HIT_HP_PENALTY;
    newImpulsePenaltyPercent = Math.min(60, stats.impulse_penalty_percent + hpDamageDealt);
  }

  // 4. Evaluasi Level Up & Title Class
  let newLevel = stats.level;
  let newCurrentXp = stats.current_xp + xpEarned;
  let newNextLevelXp = stats.next_level_xp;
  let leveledUp = false;

  while (newCurrentXp >= newNextLevelXp) {
    newCurrentXp -= newNextLevelXp;
    newLevel += 1;
    newNextLevelXp = calculateNextLevelXp(newLevel);
    leveledUp = true;
  }

  const newUnlockedTitle = resolveTitleByLevel(newLevel);

  // 5. Susun pesan floating feedback
  let feedbackBanner = '';
  if (isCriticalHit) {
    feedbackBanner = `CRITICAL HIT! -${hpDamageDealt}% HP${xpEarned > 0 ? `  •  +${xpEarned} XP` : ''}`;
  } else if (xpEarned > 0) {
    feedbackBanner = `+${xpEarned} XP!${overdriveApplied ? ' (1.5x OVERDRIVE!)' : ''}`;
  } else {
    feedbackBanner = 'LOG SAVED (DAILY XP CAP 3/3)';
  }

  return {
    xpEarned,
    hpDamageDealt,
    newLevel,
    newCurrentXp,
    newNextLevelXp,
    newStreak,
    newLongestStreak,
    newDailyTxCount,
    newImpulsePenaltyPercent,
    newUnlockedTitle,
    leveledUp,
    isCriticalHit,
    overdriveApplied,
    feedbackBanner,
  };
}

/**
 * Menambahkan XP dan memproses level up berantai.
 */
export function applyXpGain(
  level: number,
  currentXp: number,
  nextLevelXp: number,
  gain: number
): { level: number; currentXp: number; nextLevelXp: number; title: string; leveledUp: boolean } {
  let lv = level;
  let xp = currentXp + gain;
  let next = nextLevelXp;
  let leveledUp = false;
  while (xp >= next) {
    xp -= next;
    lv += 1;
    next = calculateNextLevelXp(lv);
    leveledUp = true;
  }
  return { level: lv, currentXp: xp, nextLevelXp: next, title: resolveTitleByLevel(lv), leveledUp };
}

/**
 * Tanggal (YYYY-MM-DD) hari Minggu terdekat (hari ini jika hari ini Minggu) — batas Weekly Quest.
 */
export function getEndOfWeekDateString(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return getTodayDateString(d);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export interface RolloverPlan {
  changed: boolean;
  statsPatch: {
    current_streak: number;
    impulse_penalty_percent: number;
    daily_tx_xp_count: number;
    level: number;
    current_xp: number;
    next_level_xp: number;
    unlocked_title: string;
  };
  questResets: Array<{
    quest_id: string;
    title: string;
    target_amount: number;
    new_expires_at: string;
  }>;
  xpAwarded: number;
  awardedQuestTitles: string[];
  streakBroken: boolean;
  monthReset: boolean;
}

/**
 * Rollover harian/mingguan/bulanan. Dijalankan saat vault dibuka & saat app kembali ke foreground.
 * - Daily Quest yang kedaluwarsa direset (reset 00:00). Yang selesai memberi XP sekali saat reset.
 * - Weekly Quest direset tiap Minggu 23:59, XP diberikan jika selesai.
 * - Streak putus jika tidak ada log kemarin.
 * - Penalti Critical Hit (-10% HP) hanya berlaku untuk bulan berjalan.
 */
export function planRollover(
  stats: PlayerPulseStats,
  quests: FinancialQuest[],
  now = new Date()
): RolloverPlan {
  const today = getTodayDateString(now);
  const thisMonth = today.slice(0, 7);
  const endOfWeek = getEndOfWeekDateString(now);

  let changed = false;
  let current_streak = stats.current_streak;
  let impulse_penalty_percent = stats.impulse_penalty_percent;
  let daily_tx_xp_count = stats.daily_tx_xp_count;

  const streakBroken =
    current_streak > 0 && diffDaysBetweenDates(stats.last_log_date, today) > 1;
  if (streakBroken) {
    current_streak = 0;
    changed = true;
  }

  if (stats.last_log_date !== today && daily_tx_xp_count !== 0) {
    daily_tx_xp_count = 0;
    changed = true;
  }

  const monthReset =
    impulse_penalty_percent > 0 &&
    !!stats.last_log_date &&
    stats.last_log_date.slice(0, 7) !== thisMonth;
  if (monthReset) {
    impulse_penalty_percent = 0;
    changed = true;
  }

  const questResets: RolloverPlan['questResets'] = [];
  const awardedQuestTitles: string[] = [];
  let xpAwarded = 0;

  for (const q of quests) {
    if (q.quest_type === 'SAVING_GOAL') continue;
    const expiry = q.expires_at && ISO_DATE_RE.test(q.expires_at) ? q.expires_at.slice(0, 10) : null;
    // Legacy/invalid expiry (mis. "Minggu 23:59") juga dinormalisasi.
    if (expiry && expiry >= today) continue;

    if (q.is_completed && expiry) {
      xpAwarded += q.xp_reward;
      awardedQuestTitles.push(q.title);
    }
    questResets.push({
      quest_id: q.quest_id,
      title: q.title,
      target_amount: q.target_amount,
      new_expires_at: `${q.quest_type === 'DAILY' ? today : endOfWeek}T23:59:59`,
    });
    changed = true;
  }

  const xpResult = applyXpGain(stats.level, stats.current_xp, stats.next_level_xp, xpAwarded);

  return {
    changed,
    statsPatch: {
      current_streak,
      impulse_penalty_percent,
      daily_tx_xp_count,
      level: xpResult.level,
      current_xp: xpResult.currentXp,
      next_level_xp: xpResult.nextLevelXp,
      unlocked_title: xpResult.title,
    },
    questResets,
    xpAwarded,
    awardedQuestTitles,
    streakBroken,
    monthReset,
  };
}

/**
 * Evaluasi status Month-End Boss ("INFLATION TITAN // BONCOS BOSS") sesuai Blueprint 2.C.3.
 */
export function evaluateMonthEndBossStatus(
  walletHpPercent: number,
  level: number,
  quests: FinancialQuest[]
): {
  bossName: string;
  bossHpPercent: number;
  statusText: string;
  seasonBadge: string;
  nextTitlePreview: string;
  isBossDefeated: boolean;
} {
  const completedQuestsCount = quests.filter((q) => q.is_completed).length;
  // Semakin tinggi Wallet HP user dan semakin banyak quest selesai, semakin terkuras HP sang Boss!
  const bossDamageFromDiscipline = Math.min(
    100,
    Math.round(walletHpPercent * 0.75 + completedQuestsCount * 10)
  );
  const bossHpPercent = Math.max(0, 100 - bossDamageFromDiscipline);
  const isBossDefeated = walletHpPercent > 0 && bossHpPercent <= 20;

  let statusText = 'PERTAHANAN STABIL — Jaga HP > 0% hingga akhir bulan!';
  if (walletHpPercent === 0) {
    statusText = 'CRITICAL DEFEAT WARNING — Budget bulan ini jebol (Boncos)!';
  } else if (walletHpPercent >= 80) {
    statusText = 'DOMINATING! Inflation Titan kewalahan menghadapi disiplinmu!';
  } else if (walletHpPercent < 35) {
    statusText = 'DANGER ZONE — Boss melancarkan serangan inflasi, rem pengeluaran Impulse!';
  }

  return {
    bossName: 'INFLATION TITAN // BONCOS BOSS',
    bossHpPercent,
    statusText,
    seasonBadge: 'S2 // ZERO-BONCOS VANGUARD',
    nextTitlePreview: resolveTitleByLevel(Math.max(level + 1, 10)),
    isBossDefeated,
  };
}

