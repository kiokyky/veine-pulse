import * as assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyStreakMultiplier,
  applyXpGain,
  calculateNextLevelXp,
  computeHudMetrics,
  diffDaysBetweenDates,
  evaluateMonthEndBossStatus,
  evaluateTransactionRpgOutcome,
  getEndOfWeekDateString,
  isOverdriveActive,
  planRollover,
  resolveTitleByLevel,
} from '../src/engine/pulseRpgEngine';
import type { FinancialQuest, PlayerPulseStats, TransactionItem } from '../src/types/pulse';

function makeStats(overrides: Partial<PlayerPulseStats> = {}): PlayerPulseStats {
  return {
    user_id: 'usr_test',
    level: 1,
    current_xp: 0,
    next_level_xp: 500,
    current_streak: 0,
    longest_streak: 0,
    last_log_date: null,
    wallet_hp_percent: 100,
    shield_percent: 0,
    impulse_penalty_percent: 0,
    daily_tx_xp_count: 0,
    unlocked_title: 'Rookie Cuan Crafter',
    monthly_budget_limit: 3000000,
    emergency_shield_target: 2000000,
    emergency_shield_saved: 0,
    daily_safe_spend_limit: 75000,
    encrypted_financial_state: 'vp1:00:00',
    encrypted_dek: 'vp1:00:00',
    kdf_salt: '00',
    sync_status: 'PENDING',
    updated_at: '2026-11-11T00:00:00.000Z',
    ...overrides,
  };
}

function makeTx(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    tx_id: 'tx_1',
    user_id: 'usr_test',
    title: 'Makan Siang',
    amount: 30000,
    category: 'Food & Fuel',
    spend_nature: 'ESSENTIAL',
    tx_type: 'EXPENSE',
    tx_date: '2026-11-11',
    hp_damage_dealt: 0,
    xp_earned: 15,
    sync_status: 'PENDING',
    created_at: '2026-11-11T05:00:00.000Z',
    raw_ciphertext_preview: 'vp1:00:00',
    ...overrides,
  };
}

function makeQuest(overrides: Partial<FinancialQuest> = {}): FinancialQuest {
  return {
    quest_id: 'q_daily_log_1',
    quest_type: 'DAILY',
    title: 'Catat minimal 1 transaksi hari ini',
    target_amount: 1,
    current_progress: 0,
    progress_percent: 0,
    xp_reward: 15,
    is_completed: false,
    expires_at: '2026-11-11T23:59:59',
    encrypted_quest_payload: 'vp1:00:00',
    sync_status: 'PENDING',
    ...overrides,
  };
}

test('resolveTitleByLevel maps RPG level brackets accurately', () => {
  assert.equal(resolveTitleByLevel(1), 'Rookie Cuan Crafter');
  assert.equal(resolveTitleByLevel(2), 'Novice Spender');
  assert.equal(resolveTitleByLevel(5), 'Tactical Saver');
  assert.equal(resolveTitleByLevel(10), 'Cashflow Ranger');
  assert.equal(resolveTitleByLevel(24), 'Cashflow Ranger');
  assert.equal(resolveTitleByLevel(25), 'Sovereign of Cuan');
});

test('applyXpGain cascades across multiple levels', () => {
  const res = applyXpGain(1, 400, calculateNextLevelXp(1), 900);
  // Lv1 needs 500 -> remaining 800, Lv2 needs 750 -> remaining 50, Lv3 needs 1000
  assert.equal(res.level, 3);
  assert.equal(res.currentXp, 50);
  assert.equal(res.nextLevelXp, 1000);
  assert.equal(res.title, 'Novice Spender');
  assert.equal(res.leveledUp, true);
});

test('overdrive multiplier activates at 7+ day streak', () => {
  assert.equal(isOverdriveActive(6), false);
  assert.equal(isOverdriveActive(7), true);
  assert.equal(applyStreakMultiplier(15, 6), 15);
  assert.equal(applyStreakMultiplier(15, 7), 23); // round(15 * 1.5)
});

test('diffDaysBetweenDates computes exact calendar day delta', () => {
  assert.equal(diffDaysBetweenDates('2026-11-10', '2026-11-11'), 1);
  assert.equal(diffDaysBetweenDates('2026-11-09', '2026-11-11'), 2);
  assert.equal(diffDaysBetweenDates(null, '2026-11-11'), 999);
});

test('computeHudMetrics calculates HP %, Shield %, and Safe Daily Spend for current month', () => {
  const stats = makeStats({
    monthly_budget_limit: 3000000,
    emergency_shield_target: 1000000,
    emergency_shield_saved: 200000,
    impulse_penalty_percent: 10,
  });
  const now = new Date(2026, 10, 11); // 2026-11-11 -> 20 days left in Nov (30 days)
  const txs = [
    makeTx({ tx_date: '2026-11-11', tx_type: 'EXPENSE', amount: 600000 }),
    makeTx({ tx_id: 'tx_save', tx_date: '2026-11-10', tx_type: 'SAVING', amount: 300000 }),
    // Previous month expense must not affect November metrics
    makeTx({ tx_id: 'tx_old', tx_date: '2026-10-25', tx_type: 'EXPENSE', amount: 2500000 }),
  ];

  const m = computeHudMetrics(stats, txs, now);
  assert.equal(m.totalMonthlyExpense, 600000);
  assert.equal(m.totalMonthlySaving, 300000);
  assert.equal(m.remainingMonthlyBudget, 2400000);
  assert.equal(m.daysLeftInMonth, 20);
  assert.equal(m.safeDailySpend, 120000);
  // 2.4M / 3M = 80%, minus 10% impulse penalty = 70%
  assert.equal(m.walletHpPercent, 70);
  // (200k + 300k) / 1M = 50%
  assert.equal(m.shieldPercent, 50);
});

test('evaluateTransactionRpgOutcome enforces daily 3x XP cap and 1.5x overdrive', () => {
  const stats = makeStats({
    current_streak: 7,
    longest_streak: 7,
    last_log_date: '2026-11-11',
    daily_tx_xp_count: 2,
  });

  // 3rd log today -> still gets XP (15 * 1.5 = 23)
  const third = evaluateTransactionRpgOutcome({
    stats,
    txType: 'EXPENSE',
    spendNature: 'ESSENTIAL',
    amount: 25000,
    todayStr: '2026-11-11',
  });
  assert.equal(third.newDailyTxCount, 3);
  assert.equal(third.xpEarned, 23);
  assert.equal(third.overdriveApplied, true);

  // 4th log today -> anti-spam cap gives 0 XP
  const fourth = evaluateTransactionRpgOutcome({
    stats: { ...stats, daily_tx_xp_count: 3 },
    txType: 'EXPENSE',
    spendNature: 'ESSENTIAL',
    amount: 25000,
    todayStr: '2026-11-11',
  });
  assert.equal(fourth.newDailyTxCount, 4);
  assert.equal(fourth.xpEarned, 0);
});

test('evaluateTransactionRpgOutcome deals -10% Critical Hit on IMPULSE expense (capped at 60%)', () => {
  const res = evaluateTransactionRpgOutcome({
    stats: makeStats({ impulse_penalty_percent: 55, last_log_date: '2026-11-10', current_streak: 2 }),
    txType: 'EXPENSE',
    spendNature: 'IMPULSE',
    amount: 80000,
    todayStr: '2026-11-11',
  });
  assert.equal(res.isCriticalHit, true);
  assert.equal(res.hpDamageDealt, 10);
  assert.equal(res.newImpulsePenaltyPercent, 60);
  assert.equal(res.newStreak, 3);
});

test('evaluateTransactionRpgOutcome gives +35 base XP for SAVING and resets broken streak', () => {
  const res = evaluateTransactionRpgOutcome({
    stats: makeStats({ last_log_date: '2026-11-08', current_streak: 5, longest_streak: 10 }),
    txType: 'SAVING',
    spendNature: 'ESSENTIAL',
    amount: 100000,
    todayStr: '2026-11-11',
  });
  assert.equal(res.newStreak, 1);
  assert.equal(res.newLongestStreak, 10);
  assert.equal(res.xpEarned, 35); // 15 + 20
});

test('planRollover awards XP for expired completed quests, resets streak/monthly penalty, preserves saving goals', () => {
  const stats = makeStats({
    level: 1,
    current_xp: 480,
    next_level_xp: 500,
    current_streak: 6,
    last_log_date: '2026-10-31',
    impulse_penalty_percent: 20,
    daily_tx_xp_count: 3,
  });
  const quests: FinancialQuest[] = [
    makeQuest({ quest_id: 'q_daily_log_1', is_completed: true, xp_reward: 15, expires_at: '2026-10-31T23:59:59' }),
    makeQuest({ quest_id: 'q_daily_burn_75k', is_completed: false, xp_reward: 40, expires_at: '2026-10-31T23:59:59' }),
    makeQuest({ quest_id: 'q_weekly_no_coffee', quest_type: 'WEEKLY', is_completed: true, xp_reward: 150, expires_at: '2026-11-01T23:59:59' }),
    makeQuest({ quest_id: 'q_saving_gpu', quest_type: 'SAVING_GOAL', is_completed: false, xp_reward: 500, expires_at: null }),
  ];

  const now = new Date(2026, 10, 11); // Wednesday 2026-11-11 -> Sunday is 2026-11-15
  const plan = planRollover(stats, quests, now);

  assert.equal(plan.changed, true);
  assert.equal(plan.streakBroken, true);
  assert.equal(plan.monthReset, true);
  assert.equal(plan.statsPatch.current_streak, 0);
  assert.equal(plan.statsPatch.impulse_penalty_percent, 0);
  assert.equal(plan.statsPatch.daily_tx_xp_count, 0);
  assert.equal(plan.xpAwarded, 165); // 15 + 150
  assert.equal(plan.statsPatch.level, 2); // 480 + 165 = 645 -> Lv2 with 145 XP
  assert.equal(plan.statsPatch.current_xp, 145);
  assert.equal(plan.questResets.length, 3);
  assert.equal(plan.questResets[0].new_expires_at, '2026-11-11T23:59:59');
  assert.equal(plan.questResets[2].new_expires_at, `${getEndOfWeekDateString(now)}T23:59:59`);
});

test('evaluateMonthEndBossStatus reflects HP and completed quests', () => {
  const defeated = evaluateMonthEndBossStatus(95, 10, [makeQuest({ is_completed: true })]);
  assert.equal(defeated.isBossDefeated, true);

  const zeroHp = evaluateMonthEndBossStatus(0, 5, []);
  assert.equal(zeroHp.isBossDefeated, false);
  assert.match(zeroHp.statusText, /CRITICAL DEFEAT WARNING/);
});

