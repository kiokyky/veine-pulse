import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePulse } from '../../src/context/PulseContext';
import {
  HudCard,
  ProgressBar,
  SectionTitle,
  ShieldBar,
  WalletHpBar,
} from '../../src/components/HudBars';
import { TransactionRow } from '../../src/components/TransactionRow';
import { isOverdriveActive } from '../../src/engine/pulseRpgEngine';
import { formatRupiah, PULSE_THEME } from '../../src/theme/pulseTheme';

export default function PulseHudScreen() {
  const { isLoading, stats, transactions, quests, hudMetrics, lastFeedback, keyFingerprint } =
    usePulse();

  if (isLoading || !stats || !hudMetrics) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={PULSE_THEME.colors.iceAqua} />
        <Text style={styles.loadingText}>DECRYPTING VAULT...</Text>
      </View>
    );
  }

  const overdrive = isOverdriveActive(stats.current_streak);
  const isSynced = stats.sync_status === 'SYNCED';
  const dailyQuests = quests.filter((q) => q.quest_type === 'DAILY').slice(0, 2);
  const recentTxs = transactions.slice(0, 3);
  const xpPercent = Math.round((stats.current_xp / stats.next_level_xp) * 100);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTag}>[01. PULSE HUD]</Text>

        {/* Kartu Karakter */}
        <HudCard style={overdrive ? styles.overdriveCard : undefined}>
          <View style={styles.charRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.levelText}>
                LV. {stats.level} // {stats.unlocked_title.toUpperCase()}
              </Text>
              {overdrive ? <Text style={styles.overdriveText}>⚡ OVERDRIVE 1.5x XP</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.streak}>🔥 {stats.current_streak} Hari</Text>
              <Text style={[styles.syncBadge, { color: isSynced ? PULSE_THEME.colors.syncedGreen : PULSE_THEME.colors.pendingAmber }]}>
                {isSynced ? '🟢 SYNCED' : '🟡 PENDING'}
              </Text>
            </View>
          </View>
          <ProgressBar percent={xpPercent} color={PULSE_THEME.colors.xpGold} style={{ marginTop: 10 }} />
          <Text style={styles.xpText}>
            {stats.current_xp} / {stats.next_level_xp} XP
          </Text>
        </HudCard>

        {/* HP & Shield */}
        <HudCard>
          <WalletHpBar
            hpPercent={hudMetrics.walletHpPercent}
            damageSignal={lastFeedback?.isCriticalHit ? lastFeedback.id : 0}
            subtitle={`Sisa budget: ${formatRupiah(hudMetrics.remainingMonthlyBudget)} / ${formatRupiah(stats.monthly_budget_limit)}`}
          />
          <View style={{ height: 14 }} />
          <ShieldBar
            shieldPercent={hudMetrics.shieldPercent}
            subtitle={`Tersimpan: ${formatRupiah(stats.emergency_shield_saved + hudMetrics.totalMonthlySaving)} / ${formatRupiah(stats.emergency_shield_target)}`}
          />
          <View style={styles.safeSpendBox}>
            <Text style={styles.safeSpendLabel}>SAFE DAILY SPEND HARI INI</Text>
            <Text style={styles.safeSpendValue}>{formatRupiah(hudMetrics.safeDailySpend)}</Text>
            <Text style={styles.safeSpendSub}>
              Terpakai hari ini {formatRupiah(hudMetrics.todayExpense)} • {hudMetrics.daysLeftInMonth} hari tersisa
            </Text>
          </View>
        </HudCard>

        {/* Daily Quests */}
        <SectionTitle right="Reset 00:00">ACTIVE DAILY QUESTS</SectionTitle>
        <HudCard>
          {dailyQuests.map((q) => (
            <View key={q.quest_id} style={styles.questRow}>
              <Text style={styles.questCheck}>{q.is_completed ? '☑' : '☐'}</Text>
              <Text style={[styles.questTitle, q.is_completed && styles.questDone]}>{q.title}</Text>
              <Text style={styles.questXp}>+{q.xp_reward} XP</Text>
            </View>
          ))}
        </HudCard>

        {/* Recent Transactions */}
        <SectionTitle right={`🔒 ${keyFingerprint}`}>3 TRANSAKSI TERAKHIR</SectionTitle>
        <HudCard>
          {recentTxs.map((tx) => (
            <TransactionRow key={tx.tx_id} tx={tx} />
          ))}
        </HudCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PULSE_THEME.colors.bgPrimary },
  scroll: { padding: 16, paddingBottom: 40 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PULSE_THEME.colors.bgPrimary,
  },
  loadingText: {
    color: PULSE_THEME.colors.iceAqua,
    marginTop: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  screenTag: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  overdriveCard: {
    borderColor: PULSE_THEME.colors.overdriveBlue,
    backgroundColor: '#0F2230',
    shadowColor: PULSE_THEME.colors.overdriveBlue,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 6,
  },
  charRow: { flexDirection: 'row', alignItems: 'center' },
  levelText: {
    color: PULSE_THEME.colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  overdriveText: {
    color: PULSE_THEME.colors.overdriveBlue,
    fontSize: 11,
    fontWeight: '900',
    marginTop: 3,
    letterSpacing: 1,
  },
  streak: { color: PULSE_THEME.colors.streakFlame, fontSize: 14, fontWeight: '900' },
  syncBadge: { fontSize: 10, fontWeight: '900', marginTop: 3 },
  xpText: { color: PULSE_THEME.colors.textMuted, fontSize: 11, marginTop: 4 },
  safeSpendBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: PULSE_THEME.colors.bgPrimary,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderActive,
  },
  safeSpendLabel: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  safeSpendValue: {
    color: PULSE_THEME.colors.iceAqua,
    fontSize: 24,
    fontWeight: '900',
    marginTop: 2,
  },
  safeSpendSub: { color: PULSE_THEME.colors.textSecondary, fontSize: 11, marginTop: 2 },
  questRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  questCheck: { color: PULSE_THEME.colors.iceAqua, fontSize: 16, marginRight: 8 },
  questTitle: { flex: 1, color: PULSE_THEME.colors.textPrimary, fontSize: 13 },
  questDone: { color: PULSE_THEME.colors.textMuted, textDecorationLine: 'line-through' },
  questXp: { color: PULSE_THEME.colors.xpGold, fontSize: 11, fontWeight: '900' },
});

