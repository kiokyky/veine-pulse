import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatRupiah, PULSE_THEME } from '../theme/pulseTheme';
import { TransactionItem } from '../types/pulse';

export const TransactionRow: React.FC<{ tx: TransactionItem; showCipher?: boolean }> = ({
  tx,
  showCipher = false,
}) => {
  const isExpense = tx.tx_type === 'EXPENSE';
  const isImpulse = isExpense && tx.spend_nature === 'IMPULSE';
  const amountColor =
    tx.tx_type === 'INCOME'
      ? PULSE_THEME.colors.syncedGreen
      : tx.tx_type === 'SAVING'
      ? PULSE_THEME.colors.shieldCyan
      : isImpulse
      ? PULSE_THEME.colors.criticalRed
      : PULSE_THEME.colors.textPrimary;
  const sign = isExpense ? '-' : '+';

  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={styles.title} numberOfLines={1}>
          {tx.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{tx.category}</Text>
          {isExpense ? (
            <Text style={[styles.tag, isImpulse ? styles.tagImpulse : styles.tagEssential]}>
              {isImpulse ? 'IMPULSE' : 'ESSENTIAL'}
            </Text>
          ) : (
            <Text style={[styles.tag, styles.tagNeutral]}>{tx.tx_type}</Text>
          )}
          <Text style={styles.meta}>{tx.sync_status === 'SYNCED' ? '🟢' : '🟡'}</Text>
        </View>
        {showCipher ? (
          <Text style={styles.cipher} numberOfLines={1}>
            🔒 {tx.raw_ciphertext_preview}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.amount, { color: amountColor }]}>
          {sign}
          {formatRupiah(tx.amount)}
        </Text>
        <Text style={styles.reward}>
          {tx.hp_damage_dealt > 0 ? `-${tx.hp_damage_dealt}% HP ` : ''}
          {tx.xp_earned > 0 ? `+${tx.xp_earned} XP` : ''}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: PULSE_THEME.colors.borderSubtle,
  },
  title: {
    color: PULSE_THEME.colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  meta: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 11,
  },
  tag: {
    fontSize: 9,
    fontWeight: '900',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    letterSpacing: 0.6,
  },
  tagEssential: {
    color: PULSE_THEME.colors.iceAqua,
    backgroundColor: 'rgba(186, 229, 233, 0.12)',
  },
  tagImpulse: {
    color: PULSE_THEME.colors.criticalRed,
    backgroundColor: PULSE_THEME.colors.criticalBg,
  },
  tagNeutral: {
    color: PULSE_THEME.colors.shieldCyan,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  cipher: {
    color: PULSE_THEME.colors.encryptedViolet,
    fontSize: 10,
    marginTop: 3,
    fontFamily: 'monospace',
  },
  amount: {
    fontSize: 14,
    fontWeight: '900',
  },
  reward: {
    color: PULSE_THEME.colors.xpGold,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
});

