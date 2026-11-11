import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePulse } from '../../src/context/PulseContext';
import { TransactionRow } from '../../src/components/TransactionRow';
import { formatRupiah, PULSE_THEME } from '../../src/theme/pulseTheme';

type LedgerFilter = 'ALL' | 'ESSENTIAL' | 'IMPULSE' | 'INCOME' | 'SAVING';
const FILTERS: LedgerFilter[] = ['ALL', 'ESSENTIAL', 'IMPULSE', 'INCOME', 'SAVING'];

export default function LedgerScreen() {
  const { transactions, hudMetrics } = usePulse();
  const [filter, setFilter] = useState<LedgerFilter>('ALL');
  const [showCipher, setShowCipher] = useState(false);

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      switch (filter) {
        case 'ESSENTIAL':
          return tx.tx_type === 'EXPENSE' && tx.spend_nature === 'ESSENTIAL';
        case 'IMPULSE':
          return tx.tx_type === 'EXPENSE' && tx.spend_nature === 'IMPULSE';
        case 'INCOME':
          return tx.tx_type === 'INCOME';
        case 'SAVING':
          return tx.tx_type === 'SAVING';
        default:
          return true;
      }
    });
  }, [transactions, filter]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.screenTag}>[02. LEDGER]</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>PEMASUKAN</Text>
            <Text style={[styles.summaryValue, { color: PULSE_THEME.colors.syncedGreen }]}>
              {formatRupiah(hudMetrics?.totalMonthlyIncome ?? 0)}
            </Text>
          </View>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryLabel}>PENGELUARAN</Text>
            <Text style={[styles.summaryValue, { color: PULSE_THEME.colors.criticalRed }]}>
              {formatRupiah(hudMetrics?.totalMonthlyExpense ?? 0)}
            </Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.cipherToggle}>
          <Text style={styles.cipherLabel}>🔒 Tampilkan ciphertext mentah (isi DB)</Text>
          <Switch
            value={showCipher}
            onValueChange={setShowCipher}
            trackColor={{ true: PULSE_THEME.colors.encryptedViolet, false: PULSE_THEME.colors.borderActive }}
          />
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.tx_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <TransactionRow tx={item} showCipher={showCipher} />}
        ListEmptyComponent={<Text style={styles.empty}>Belum ada transaksi di filter ini.</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PULSE_THEME.colors.bgPrimary },
  header: { paddingHorizontal: 16, paddingTop: 16 },
  screenTag: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 10,
  },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryBox: {
    flex: 1,
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
  },
  summaryLabel: { color: PULSE_THEME.colors.textMuted, fontSize: 10, fontWeight: '900' },
  summaryValue: { fontSize: 15, fontWeight: '900', marginTop: 3 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
  },
  filterChipActive: {
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderColor: PULSE_THEME.colors.iceAqua,
  },
  filterText: { color: PULSE_THEME.colors.textSecondary, fontSize: 11, fontWeight: '800' },
  filterTextActive: { color: '#FFFFFF' },
  cipherToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  cipherLabel: { color: PULSE_THEME.colors.encryptedViolet, fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  empty: { color: PULSE_THEME.colors.textMuted, textAlign: 'center', marginTop: 30 },
});

