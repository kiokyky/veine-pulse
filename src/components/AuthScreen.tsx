import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthApiError } from '../api/authApi';
import { usePulse } from '../context/PulseContext';
import { PULSE_THEME } from '../theme/pulseTheme';

type Mode = 'UNLOCK' | 'REGISTER' | 'CLOUD_LOGIN';

const MIN_PASSWORD_LENGTH = 10;

function describeError(err: unknown): string {
  if (err instanceof AuthApiError) return err.message;
  if (err instanceof Error && err.message === 'WRONG_PASSWORD') return 'Password salah.';
  if (err instanceof Error) return err.message;
  return 'Terjadi kesalahan.';
}

/**
 * Gerbang Vault: muncul sebelum data apa pun didekripsi.
 * - Belum ada vault  -> Buat akun (password = kunci enkripsi) atau Login dari Go Cuan Cloud
 * - Vault terkunci   -> Buka dengan password atau FaceID/Fingerprint
 */
export const AuthScreen: React.FC = () => {
  const {
    vaultStatus,
    storedEmail,
    canUseBiometricUnlock,
    createAccount,
    unlockWithPassword,
    unlockWithBiometric,
    loginFromCloud,
    logoutAndForgetDevice,
  } = usePulse();

  const [mode, setMode] = useState<Mode>(vaultStatus === 'LOCKED' ? 'UNLOCK' : 'REGISTER');
  const [email, setEmail] = useState(storedEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setMode(vaultStatus === 'LOCKED' ? 'UNLOCK' : 'REGISTER');
  }, [vaultStatus]);

  // Tawarkan biometrik otomatis sekali saat layar kunci muncul.
  useEffect(() => {
    if (vaultStatus === 'LOCKED' && canUseBiometricUnlock) {
      unlockWithBiometric().catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultStatus, canUseBiometricUnlock]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = () =>
    run(async () => {
      const cleanEmail = email.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Format email tidak valid.');
      if (password.length < MIN_PASSWORD_LENGTH)
        throw new Error(`Password minimal ${MIN_PASSWORD_LENGTH} karakter.`);
      if (password !== confirm) throw new Error('Konfirmasi password tidak sama.');
      const res = await createAccount(cleanEmail, password);
      if (!res.registeredOnCloud) {
        setInfo('Vault dibuat di perangkat. Akun akan didaftarkan ke Go Cuan Cloud saat online.');
      }
    });

  const handleUnlock = () =>
    run(async () => {
      if (!password) throw new Error('Masukkan password.');
      await unlockWithPassword(password);
    });

  const handleCloudLogin = () =>
    run(async () => {
      const cleanEmail = email.trim().toLowerCase();
      if (!cleanEmail || !password) throw new Error('Email dan password wajib diisi.');
      await loginFromCloud(cleanEmail, password);
    });

  const isLocked = vaultStatus === 'LOCKED';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>VEINE PULSE</Text>
          <Text style={styles.tagline}>Fintech × RPG • Zero-Knowledge Vault</Text>

          <View style={styles.card}>
            {mode === 'UNLOCK' && (
              <>
                <Text style={styles.title}>🔒 VAULT TERKUNCI</Text>
                {storedEmail ? <Text style={styles.sub}>{storedEmail}</Text> : null}
                {canUseBiometricUnlock ? (
                  <Pressable
                    style={styles.secondaryBtn}
                    disabled={busy}
                    onPress={() => run(async () => void (await unlockWithBiometric()))}
                  >
                    <Text style={styles.secondaryText}>BUKA DENGAN FACEID / FINGERPRINT</Text>
                  </Pressable>
                ) : null}
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  onSubmitEditing={handleUnlock}
                  placeholderTextColor={PULSE_THEME.colors.textMuted}
                  style={styles.input}
                />
                <Pressable style={styles.primaryBtn} disabled={busy} onPress={handleUnlock}>
                  <Text style={styles.primaryText}>BUKA VAULT</Text>
                </Pressable>
              </>
            )}

            {mode === 'REGISTER' && (
              <>
                <Text style={styles.title}>BUAT AKUN BARU</Text>
                <Text style={styles.sub}>
                  Password ini sekaligus kunci enkripsi datamu. Tidak ada yang bisa membukanya
                  tanpa password ini — termasuk admin Go Cuan.
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholderTextColor={PULSE_THEME.colors.textMuted}
                  style={styles.input}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder={`Password (min. ${MIN_PASSWORD_LENGTH} karakter)`}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholderTextColor={PULSE_THEME.colors.textMuted}
                  style={styles.input}
                />
                <TextInput
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Ulangi password"
                  secureTextEntry
                  autoCapitalize="none"
                  placeholderTextColor={PULSE_THEME.colors.textMuted}
                  style={styles.input}
                />
                <View style={styles.warnBox}>
                  <Text style={styles.warnText}>
                    ⚠ Jika password lupa, data TIDAK bisa dipulihkan. Simpan di password manager.
                  </Text>
                </View>
                <Pressable style={styles.primaryBtn} disabled={busy} onPress={handleRegister}>
                  <Text style={styles.primaryText}>BUAT VAULT</Text>
                </Pressable>
              </>
            )}

            {mode === 'CLOUD_LOGIN' && (
              <>
                <Text style={styles.title}>LOGIN DARI GO CUAN CLOUD</Text>
                <Text style={styles.sub}>
                  Untuk akun yang sudah dibuat di perangkat lain / Go Cuan Web.
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholderTextColor={PULSE_THEME.colors.textMuted}
                  style={styles.input}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Password"
                  secureTextEntry
                  autoCapitalize="none"
                  placeholderTextColor={PULSE_THEME.colors.textMuted}
                  style={styles.input}
                />
                <Pressable style={styles.primaryBtn} disabled={busy} onPress={handleCloudLogin}>
                  <Text style={styles.primaryText}>LOGIN & BUKA VAULT</Text>
                </Pressable>
              </>
            )}

            {busy ? (
              <View style={styles.busyRow}>
                <ActivityIndicator color={PULSE_THEME.colors.iceAqua} />
                <Text style={styles.busyText}>Menurunkan kunci (PBKDF2)…</Text>
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {info ? <Text style={styles.info}>{info}</Text> : null}
          </View>

          {/* Mode switches */}
          {!isLocked && mode !== 'REGISTER' && (
            <Pressable onPress={() => setMode('REGISTER')}>
              <Text style={styles.link}>Belum punya akun? Buat vault baru</Text>
            </Pressable>
          )}
          {!isLocked && mode !== 'CLOUD_LOGIN' && (
            <Pressable onPress={() => setMode('CLOUD_LOGIN')}>
              <Text style={styles.link}>Sudah punya akun Go Cuan? Login</Text>
            </Pressable>
          )}
          {isLocked && (
            <Pressable
              onPress={() =>
                run(async () => {
                  await logoutAndForgetDevice();
                })
              }
            >
              <Text style={[styles.link, { color: PULSE_THEME.colors.criticalRed }]}>
                Bukan akun kamu? Hapus vault dari perangkat ini
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PULSE_THEME.colors.bgPrimary },
  scroll: { padding: 20, paddingTop: 60, flexGrow: 1 },
  brand: {
    color: PULSE_THEME.colors.iceAqua,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
    textAlign: 'center',
  },
  tagline: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 28,
  },
  card: {
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderActive,
    padding: 18,
  },
  title: {
    color: PULSE_THEME.colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  sub: { color: PULSE_THEME.colors.textSecondary, fontSize: 12, marginBottom: 14, lineHeight: 17 },
  input: {
    backgroundColor: PULSE_THEME.colors.bgPrimary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: PULSE_THEME.colors.textPrimary,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
    marginBottom: 10,
  },
  warnBox: {
    backgroundColor: PULSE_THEME.colors.criticalBg,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  warnText: { color: PULSE_THEME.colors.criticalRed, fontSize: 11, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.iceAqua,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '900', letterSpacing: 1 },
  secondaryBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderActive,
    backgroundColor: PULSE_THEME.colors.bgElevated,
    marginBottom: 12,
  },
  secondaryText: { color: PULSE_THEME.colors.iceAqua, fontWeight: '900', fontSize: 12 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  busyText: { color: PULSE_THEME.colors.textSecondary, fontSize: 12 },
  error: { color: PULSE_THEME.colors.criticalRed, fontSize: 12, fontWeight: '700', marginTop: 12 },
  info: { color: PULSE_THEME.colors.pendingAmber, fontSize: 12, marginTop: 12 },
  link: {
    color: PULSE_THEME.colors.iceAqua,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 18,
  },
});

