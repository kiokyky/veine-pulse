import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { usePulse } from '../../src/context/PulseContext';
import { HudCard, SectionTitle } from '../../src/components/HudBars';
import { formatRupiah, PULSE_THEME } from '../../src/theme/pulseTheme';

function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

export default function VaultScreen() {
  const {
    stats,
    transactions,
    rawStatsRow,
    keyFingerprint,
    isBiometricEnabled,
    toggleBiometricLock,
    updateBudgetLimit,
    changePassword,
    forceSyncToCloud,
    lastSync,
    pendingSyncCount,
    lastSyncPayload,
    storedEmail,
    cloudLinkStatus,
    lock,
    logoutAndForgetDevice,
  } = usePulse();

  const [budgetInput, setBudgetInput] = useState('');
  const [shieldInput, setShieldInput] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showRawRow, setShowRawRow] = useState(false);

  if (!stats) return null;

  const handleToggleBiometric = async (enabled: boolean) => {
    if (enabled && Platform.OS !== 'web') {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        notify('Biometrik tidak tersedia', 'Perangkat belum memiliki FaceID / Fingerprint terdaftar.');
        return;
      }
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Aktifkan Vault Lock Veine Pulse',
      });
      if (!res.success) return;
    }
    await toggleBiometricLock(enabled);
  };

  const handleSaveBudget = async () => {
    const budget = parseInt(budgetInput.replace(/\D/g, ''), 10) || stats.monthly_budget_limit;
    const shield = parseInt(shieldInput.replace(/\D/g, ''), 10) || stats.emergency_shield_target;
    await updateBudgetLimit(budget, shield);
    setBudgetInput('');
    setShieldInput('');
    notify('Budget diperbarui', 'Nilai baru dienkripsi AES-256-GCM sebelum disimpan.');
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      notify('Password lama wajib', 'Masukkan password saat ini untuk verifikasi.');
      return;
    }
    if (newPassword.length < 10) {
      notify('Password terlalu pendek', 'Minimal 10 karakter.');
      return;
    }
    setIsChangingPassword(true);
    try {
      const fp = await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      notify(
        'Password diganti',
        `Kunci data dibungkus ulang dengan password baru. Fingerprint tetap: ${fp}\nRiwayat transaksi tidak perlu dienkripsi ulang.`
      );
    } catch (err) {
      const msg =
        err instanceof Error && err.message === 'WRONG_PASSWORD'
          ? 'Password lama salah.'
          : err instanceof Error
          ? `${err.message}\nPassword tidak diganti.`
          : 'Gagal mengganti password.';
      notify('Gagal', msg);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleLogout = () => {
    const doLogout = () => {
      logoutAndForgetDevice();
    };
    const message =
      cloudLinkStatus === 'LINKED'
        ? 'Data lokal & kunci dihapus dari perangkat ini. Transaksi yang belum di-sync akan hilang.'
        : 'Akun ini BELUM terdaftar di Go Cuan Cloud. Semua data akan hilang permanen.';
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(message)) doLogout();
      return;
    }
    Alert.alert('Logout & hapus dari perangkat?', message, [
      { text: 'Batal', style: 'cancel' },
      { text: 'Hapus', style: 'destructive', onPress: doLogout },
    ]);
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    try {
      const res = await forceSyncToCloud();
      notify(
        'Sync selesai',
        res.unconfirmedTxCount > 0
          ? `${res.confirmedTxCount} transaksi dikonfirmasi server, ${res.unconfirmedTxCount} belum — akan dicoba lagi.`
          : `${res.confirmedTxCount} transaksi terenkripsi tersimpan di Go Cuan Cloud.`
      );
    } catch (err) {
      notify('Sync gagal', err instanceof Error ? err.message : 'Data tetap PENDING di perangkat.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleExportCsv = async () => {
    const header = 'tanggal,tipe,sifat,kategori,judul,nominal\n';
    const rows = transactions
      .map((t) =>
        [t.tx_date, t.tx_type, t.spend_nature, t.category, `"${t.title.replace(/"/g, '""')}"`, t.amount].join(',')
      )
      .join('\n');
    const csv = header + rows;

    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'veine-pulse-ledger.csv';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    const file = new File(Paths.cache, 'veine-pulse-ledger.csv');
    file.create({ overwrite: true });
    await file.write(csv);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv' });
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTag}>[04. VAULT]</Text>

        {/* Zero-Knowledge Status */}
        <HudCard style={styles.zkCard}>
          <Text style={styles.zkTitle}>🔐 ZERO-KNOWLEDGE VAULT AKTIF</Text>
          <Text style={styles.zkLine}>Cipher: AES-256-GCM (per-row)</Text>
          <Text style={styles.zkLine}>KDF: PBKDF2-SHA256 → Wrapped DEK</Text>
          <Text style={styles.zkLine}>DEK Fingerprint: {keyFingerprint}</Text>
          <Text style={styles.zkNote}>
            Server Go Cuan hanya menyimpan ciphertext. Admin DB tidak dapat membaca saldo,
            nominal, maupun judul transaksi.
          </Text>
          <Pressable onPress={() => setShowRawRow((v) => !v)}>
            <Text style={styles.zkLink}>
              {showRawRow ? '▲ Sembunyikan' : '▼ Lihat'} baris mentah player_pulse_stats
            </Text>
          </Pressable>
          {showRawRow && rawStatsRow ? (
            <Text style={styles.rawJson}>
              {JSON.stringify(
                {
                  level: rawStatsRow.level,
                  wallet_hp_percent: rawStatsRow.wallet_hp_percent,
                  encrypted_financial_state: rawStatsRow.encrypted_financial_state,
                  encrypted_dek: rawStatsRow.encrypted_dek,
                  kdf_salt: rawStatsRow.kdf_salt,
                },
                null,
                2
              )}
            </Text>
          ) : null}
        </HudCard>

        <SectionTitle>BUDGET BULANAN</SectionTitle>
        <HudCard>
          <Text style={styles.current}>
            Saat ini: {formatRupiah(stats.monthly_budget_limit)} • Shield target{' '}
            {formatRupiah(stats.emergency_shield_target)}
          </Text>
          <TextInput
            value={budgetInput}
            onChangeText={setBudgetInput}
            placeholder="Budget bulanan baru (Rp)"
            keyboardType="number-pad"
            placeholderTextColor={PULSE_THEME.colors.textMuted}
            style={styles.input}
          />
          <TextInput
            value={shieldInput}
            onChangeText={setShieldInput}
            placeholder="Target Emergency Shield (Rp)"
            keyboardType="number-pad"
            placeholderTextColor={PULSE_THEME.colors.textMuted}
            style={styles.input}
          />
          <Pressable style={styles.primaryBtn} onPress={handleSaveBudget}>
            <Text style={styles.primaryText}>SIMPAN & ENKRIPSI</Text>
          </Pressable>
        </HudCard>

        <SectionTitle>KEAMANAN</SectionTitle>
        <HudCard>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>FaceID / Fingerprint Lock</Text>
            <Switch
              value={isBiometricEnabled}
              onValueChange={handleToggleBiometric}
              trackColor={{ true: PULSE_THEME.colors.oceanTeal, false: PULSE_THEME.colors.borderActive }}
            />
          </View>
          <Text style={[styles.current, { marginTop: 12 }]}>Ganti password (kunci data dibungkus ulang)</Text>
          <TextInput
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Password saat ini"
            secureTextEntry
            autoCapitalize="none"
            placeholderTextColor={PULSE_THEME.colors.textMuted}
            style={styles.input}
          />
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Password baru (min. 10 karakter)"
            secureTextEntry
            autoCapitalize="none"
            placeholderTextColor={PULSE_THEME.colors.textMuted}
            style={styles.input}
          />
          <Pressable
            style={styles.secondaryBtn}
            onPress={handleChangePassword}
            disabled={isChangingPassword}
          >
            <Text style={styles.secondaryText}>
              {isChangingPassword ? 'MEMPROSES…' : 'GANTI PASSWORD'}
            </Text>
          </Pressable>
        </HudCard>

        <SectionTitle>AKUN</SectionTitle>
        <HudCard>
          <Text style={styles.current}>{storedEmail ?? '—'}</Text>
          <Text style={styles.current}>
            Go Cuan Cloud:{' '}
            {cloudLinkStatus === 'LINKED'
              ? '🟢 Terhubung'
              : cloudLinkStatus === 'PENDING_REGISTER'
              ? '🟡 Menunggu pendaftaran (offline)'
              : '⚪ Belum login sesi ini'}
          </Text>
          <Pressable style={[styles.secondaryBtn, { marginBottom: 8 }]} onPress={lock}>
            <Text style={styles.secondaryText}>🔒 KUNCI VAULT SEKARANG</Text>
          </Pressable>
          <Pressable style={styles.dangerBtn} onPress={handleLogout}>
            <Text style={styles.dangerText}>LOGOUT & HAPUS DARI PERANGKAT</Text>
          </Pressable>
        </HudCard>

        <SectionTitle right={`${pendingSyncCount} PENDING`}>SINKRONISASI</SectionTitle>
        <HudCard>
          <Pressable style={styles.primaryBtn} onPress={handleForceSync} disabled={isSyncing}>
            <Text style={styles.primaryText}>
              {isSyncing ? 'SYNCING...' : '☁ FORCE SYNC TO GO CUAN CLOUD'}
            </Text>
          </Pressable>
          {lastSync ? (
            <Text style={[styles.current, { marginTop: 8, color: lastSync.ok ? PULSE_THEME.colors.syncedGreen : PULSE_THEME.colors.criticalRed }]}>
              {lastSync.ok
                ? `Terakhir sukses: ${new Date(lastSync.summary.at).toLocaleString('id-ID')}`
                : `Gagal: ${lastSync.error}`}
            </Text>
          ) : null}
          {lastSyncPayload ? (
            <Text style={styles.rawJson} numberOfLines={12}>
              {JSON.stringify(lastSyncPayload.pending_transactions.slice(0, 1), null, 2)}
            </Text>
          ) : null}
        </HudCard>

        <SectionTitle>EKSPOR LAPORAN</SectionTitle>
        <HudCard>
          <Pressable style={styles.secondaryBtn} onPress={handleExportCsv}>
            <Text style={styles.secondaryText}>⬇ EKSPOR CSV (DIDEKRIPSI DI PERANGKAT)</Text>
          </Pressable>
          <Text style={styles.zkNote}>
            Ekspor PDF akan ditambahkan berikutnya. File ekspor berisi plaintext — simpan dengan hati-hati.
          </Text>
        </HudCard>
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
  zkCard: { borderColor: PULSE_THEME.colors.encryptedViolet, backgroundColor: '#150F22' },
  zkTitle: { color: PULSE_THEME.colors.encryptedViolet, fontWeight: '900', fontSize: 13, marginBottom: 6 },
  zkLine: { color: PULSE_THEME.colors.textSecondary, fontSize: 12, marginTop: 2 },
  zkNote: { color: PULSE_THEME.colors.textMuted, fontSize: 11, marginTop: 8 },
  zkLink: { color: PULSE_THEME.colors.iceAqua, fontSize: 12, fontWeight: '800', marginTop: 10 },
  rawJson: {
    color: PULSE_THEME.colors.encryptedViolet,
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 8,
    backgroundColor: PULSE_THEME.colors.bgPrimary,
    padding: 8,
    borderRadius: 8,
  },
  current: { color: PULSE_THEME.colors.textSecondary, fontSize: 12, marginBottom: 8 },
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
  primaryBtn: {
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.iceAqua,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '900', letterSpacing: 0.8 },
  secondaryBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderActive,
    backgroundColor: PULSE_THEME.colors.bgElevated,
  },
  secondaryText: { color: PULSE_THEME.colors.iceAqua, fontWeight: '900', fontSize: 12 },
  dangerBtn: {
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.criticalRed,
    backgroundColor: PULSE_THEME.colors.criticalBg,
  },
  dangerText: { color: PULSE_THEME.colors.criticalRed, fontWeight: '900', fontSize: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { color: PULSE_THEME.colors.textPrimary, fontSize: 13, fontWeight: '700' },
});

