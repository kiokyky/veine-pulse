import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePulse } from '../../src/context/PulseContext';
import { HudCard, ProgressBar, SectionTitle } from '../../src/components/HudBars';
import { evaluateMonthEndBossStatus } from '../../src/engine/pulseRpgEngine';
import { formatRupiah, PULSE_THEME } from '../../src/theme/pulseTheme';

const BADGES = [
  { id: 'b1', icon: '🔥', name: '7-Day Overdrive', minLevel: 1, minStreak: 7 },
  { id: 'b2', icon: '🛡', name: 'Shield Builder', minLevel: 5, minStreak: 0 },
  { id: 'b3', icon: '🏹', name: 'Cashflow Ranger', minLevel: 10, minStreak: 0 },
  { id: 'b4', icon: '🔐', name: 'Zero-Knowledge Keeper', minLevel: 1, minStreak: 0 },
  { id: 'b5', icon: '👑', name: 'Sovereign of Cuan', minLevel: 25, minStreak: 0 },
];

export default function QuestsScreen() {
  const { stats, quests, hudMetrics, addSavingQuest, topUpSavingQuest } = usePulse();
  const [newTitle, setNewTitle] = useState('');
  const [newTarget, setNewTarget] = useState('');

  if (!stats || !hudMetrics) return null;

  const boss = evaluateMonthEndBossStatus(hudMetrics.walletHpPercent, stats.level, quests);
  const daily = quests.filter((q) => q.quest_type === 'DAILY');
  const weekly = quests.filter((q) => q.quest_type === 'WEEKLY');
  const goals = quests.filter((q) => q.quest_type === 'SAVING_GOAL');

  const handleCreateQuest = async () => {
    const target = parseInt(newTarget.replace(/\D/g, ''), 10) || 0;
    if (!newTitle.trim() || target <= 0) return;
    await addSavingQuest({ title: newTitle.trim(), targetAmount: target });
    setNewTitle('');
    setNewTarget('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTag}>[03. QUESTS]</Text>

        {/* Month-End Boss */}
        <HudCard style={styles.bossCard}>
          <Text style={styles.bossName}>👹 {boss.bossName}</Text>
          <Text style={styles.bossHpLabel}>BOSS HP {boss.bossHpPercent}%</Text>
          <ProgressBar percent={boss.bossHpPercent} color={PULSE_THEME.colors.criticalRed} height={12} />
          <Text style={styles.bossStatus}>{boss.statusText}</Text>
          <Text style={styles.bossReward}>
            Reward: {boss.seasonBadge} • Next title: {boss.nextTitlePreview}
          </Text>
        </HudCard>

        <SectionTitle right="Reset 00:00">DAILY QUESTS</SectionTitle>
        <HudCard>
          {daily.map((q) => (
            <View key={q.quest_id} style={styles.questItem}>
              <View style={styles.questHead}>
                <Text style={[styles.questTitle, q.is_completed && styles.done]}>
                  {q.is_completed ? '☑' : '☐'} {q.title}
                </Text>
                <Text style={styles.xp}>+{q.xp_reward} XP</Text>
              </View>
            </View>
          ))}
        </HudCard>

        <SectionTitle right="+150 XP">WEEKLY SIDE QUESTS</SectionTitle>
        <HudCard>
          {weekly.map((q) => (
            <View key={q.quest_id} style={styles.questItem}>
              <View style={styles.questHead}>
                <Text style={styles.questTitle}>{q.title}</Text>
                <Text style={styles.xp}>+{q.xp_reward} XP</Text>
              </View>
              <ProgressBar percent={q.progress_percent} style={{ marginTop: 6 }} />
              <Text style={styles.progressText}>
                {q.current_progress} / {q.target_amount} • {q.expires_at ?? ''}
              </Text>
            </View>
          ))}
        </HudCard>

        <SectionTitle right="🔒 Nominal terenkripsi">SAVING GOALS</SectionTitle>
        {goals.map((q) => (
          <HudCard key={q.quest_id}>
            <View style={styles.questHead}>
              <Text style={styles.questTitle}>🎯 {q.title}</Text>
              <Text style={styles.xp}>+{q.xp_reward} XP</Text>
            </View>
            <ProgressBar
              percent={q.progress_percent}
              color={q.is_completed ? PULSE_THEME.colors.syncedGreen : PULSE_THEME.colors.shieldCyan}
              height={10}
              style={{ marginTop: 8 }}
            />
            <Text style={styles.progressText}>
              {formatRupiah(q.current_progress)} / {formatRupiah(q.target_amount)} ({q.progress_percent}%)
            </Text>
            {!q.is_completed ? (
              <View style={styles.topUpRow}>
                {[50000, 100000, 250000].map((amt) => (
                  <Pressable key={amt} style={styles.topUpBtn} onPress={() => topUpSavingQuest(q.quest_id, amt)}>
                    <Text style={styles.topUpText}>+{amt / 1000}K</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.completed}>✔ QUEST COMPLETE</Text>
            )}
          </HudCard>
        ))}

        <HudCard>
          <Text style={styles.formTitle}>+ BUAT SAVING QUEST BARU</Text>
          <TextInput
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="Nama quest (mis: Beli GPU Baru)"
            placeholderTextColor={PULSE_THEME.colors.textMuted}
            style={styles.input}
          />
          <TextInput
            value={newTarget}
            onChangeText={setNewTarget}
            placeholder="Target nominal (Rp)"
            keyboardType="number-pad"
            placeholderTextColor={PULSE_THEME.colors.textMuted}
            style={styles.input}
          />
          <Pressable style={styles.createBtn} onPress={handleCreateQuest}>
            <Text style={styles.createText}>ENCRYPT & CREATE QUEST</Text>
          </Pressable>
        </HudCard>

        <SectionTitle>BADGES & ACHIEVEMENTS</SectionTitle>
        <View style={styles.badgeGrid}>
          {BADGES.map((b) => {
            const unlocked =
              stats.level >= b.minLevel && stats.longest_streak >= b.minStreak;
            return (
              <View key={b.id} style={[styles.badge, !unlocked && styles.badgeLocked]}>
                <Text style={styles.badgeIcon}>{unlocked ? b.icon : '🔒'}</Text>
                <Text style={styles.badgeName}>{b.name}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PULSE_THEME.colors.bgPrimary },
  scroll: { padding: 16, paddingBottom: 40 },
  screenTag: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  bossCard: { borderColor: PULSE_THEME.colors.criticalRed, backgroundColor: '#1A1018' },
  bossName: { color: PULSE_THEME.colors.criticalRed, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  bossHpLabel: { color: PULSE_THEME.colors.textSecondary, fontSize: 11, fontWeight: '800', marginVertical: 6 },
  bossStatus: { color: PULSE_THEME.colors.textPrimary, fontSize: 12, marginTop: 8 },
  bossReward: { color: PULSE_THEME.colors.xpGold, fontSize: 11, marginTop: 4 },
  questItem: { paddingVertical: 6 },
  questHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  questTitle: { flex: 1, color: PULSE_THEME.colors.textPrimary, fontSize: 13, fontWeight: '700' },
  done: { color: PULSE_THEME.colors.textMuted, textDecorationLine: 'line-through' },
  xp: { color: PULSE_THEME.colors.xpGold, fontSize: 11, fontWeight: '900' },
  progressText: { color: PULSE_THEME.colors.textMuted, fontSize: 11, marginTop: 4 },
  topUpRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  topUpBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.shieldCyan,
  },
  topUpText: { color: PULSE_THEME.colors.shieldCyan, fontWeight: '900', fontSize: 12 },
  completed: { color: PULSE_THEME.colors.syncedGreen, fontWeight: '900', marginTop: 8 },
  formTitle: { color: PULSE_THEME.colors.iceAqua, fontWeight: '900', fontSize: 12, marginBottom: 8 },
  input: {
    backgroundColor: PULSE_THEME.colors.bgPrimary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: PULSE_THEME.colors.textPrimary,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
    marginBottom: 8,
  },
  createBtn: {
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  createText: { color: '#FFFFFF', fontWeight: '900', letterSpacing: 0.8 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: {
    width: '31%',
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderActive,
  },
  badgeLocked: { opacity: 0.4 },
  badgeIcon: { fontSize: 24 },
  badgeName: { color: PULSE_THEME.colors.textSecondary, fontSize: 10, fontWeight: '800', textAlign: 'center', marginTop: 4 },
});

