import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { usePulse } from '../context/PulseContext';
import { formatRupiah, PULSE_THEME } from '../theme/pulseTheme';
import { SpendNature, TransactionType } from '../types/pulse';

interface TacticalNumpadModalProps {
  visible: boolean;
  onClose: () => void;
}

const CATEGORIES_BY_MODE: Record<string, string[]> = {
  ESSENTIAL_EXPENSE: ['Food & Fuel', 'Transport', 'Productivity', 'Bills & Utilities'],
  IMPULSE_EXPENSE: ['Snacks & Coffee', 'Gacha & Games', 'Midnight Craving', 'Shopping'],
  SAVING: ['Emergency Shield', 'Saving Quest', 'Investasi Go Cuan'],
  INCOME: ['Active Income', 'Freelance & Game Dev', 'Dividen & Bonus'],
};

const NUMPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', '⌫'];

export const TacticalNumpadModal: React.FC<TacticalNumpadModalProps> = ({
  visible,
  onClose,
}) => {
  const { addTransaction, keyFingerprint } = usePulse();

  const [modeKey, setModeKey] = useState<
    'ESSENTIAL_EXPENSE' | 'IMPULSE_EXPENSE' | 'SAVING' | 'INCOME'
  >('ESSENTIAL_EXPENSE');
  const [rawDigits, setRawDigits] = useState<string>('25000');
  const [selectedCategory, setSelectedCategory] = useState<string>('Food & Fuel');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [floatingToast, setFloatingToast] = useState<string | null>(null);
  const [isCriticalToast, setIsCriticalToast] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const triggerHaptic = async (type: 'light' | 'success' | 'warning') => {
    if (Platform.OS === 'web') return;
    try {
      if (type === 'light') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (type === 'success') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch {
      // ignore haptic errors on unsupported devices
    }
  };

  const handleSelectMode = (
    nextMode: 'ESSENTIAL_EXPENSE' | 'IMPULSE_EXPENSE' | 'SAVING' | 'INCOME'
  ) => {
    triggerHaptic('light');
    setModeKey(nextMode);
    setSelectedCategory(CATEGORIES_BY_MODE[nextMode][0]);
  };

  const handleKeyPress = (key: string) => {
    triggerHaptic('light');
    setRawDigits((prev) => {
      if (key === '⌫') {
        const sliced = prev.slice(0, -1);
        return sliced.length === 0 ? '0' : sliced;
      }
      const cleaned = prev === '0' ? '' : prev;
      const next = `${cleaned}${key}`;
      if (next.length > 10) return prev; // Max 9.999.999.999
      return next || '0';
    });
  };

  const handleSaveTransaction = async () => {
    const amountNum = parseInt(rawDigits, 10) || 0;
    if (amountNum <= 0 || isSaving) return;

    setIsSaving(true);
    let txType: TransactionType = 'EXPENSE';
    let spendNature: SpendNature = 'ESSENTIAL';

    if (modeKey === 'IMPULSE_EXPENSE') {
      txType = 'EXPENSE';
      spendNature = 'IMPULSE';
    } else if (modeKey === 'SAVING') {
      txType = 'SAVING';
      spendNature = 'ESSENTIAL';
    } else if (modeKey === 'INCOME') {
      txType = 'INCOME';
      spendNature = 'ESSENTIAL';
    }

    const finalTitle =
      customTitle.trim().length > 0
        ? customTitle.trim()
        : `${selectedCategory} (${txType === 'EXPENSE' ? spendNature : txType})`;

    try {
      const feedback = await addTransaction({
        title: finalTitle,
        amount: amountNum,
        txType,
        category: selectedCategory,
        spendNature,
      });

      setIsCriticalToast(feedback.isCriticalHit);
      setFloatingToast(feedback.bannerText);
      await triggerHaptic(feedback.isCriticalHit ? 'warning' : 'success');

      setTimeout(() => {
        setFloatingToast(null);
        setIsSaving(false);
        setCustomTitle('');
        setRawDigits('25000');
        onClose();
      }, 950);
    } catch {
      setIsSaving(false);
    }
  };

  const numericAmount = parseInt(rawDigits, 10) || 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.headerTag}>[+] TACTICAL NUMPAD // 3-TAP LOGGER</Text>
              <Text style={styles.zkSubtag}>
                🔒 E2EE AES-256-GCM • Key {keyFingerprint}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Floating +XP / Critical Hit Toast */}
          {floatingToast && (
            <View
              style={[
                styles.floatingBanner,
                isCriticalToast ? styles.floatingBannerCrit : styles.floatingBannerXp,
              ]}
            >
              <Text style={styles.floatingBannerText}>{floatingToast}</Text>
              <Text style={styles.floatingBannerSub}>
                Dienkripsi lokal sebelum masuk SQLite & Go Cuan Cloud
              </Text>
            </View>
          )}

          {/* Step 1: Mode Selector */}
          <View style={styles.modeRow}>
            <Pressable
              onPress={() => handleSelectMode('ESSENTIAL_EXPENSE')}
              style={[
                styles.modeChip,
                modeKey === 'ESSENTIAL_EXPENSE' && styles.modeChipEssential,
              ]}
            >
              <Text style={styles.modeChipTitle}>ESSENTIAL</Text>
              <Text style={styles.modeChipSub}>+15 XP Safe</Text>
            </Pressable>

            <Pressable
              onPress={() => handleSelectMode('IMPULSE_EXPENSE')}
              style={[
                styles.modeChip,
                modeKey === 'IMPULSE_EXPENSE' && styles.modeChipImpulse,
              ]}
            >
              <Text style={styles.modeChipTitle}>IMPULSE</Text>
              <Text style={styles.modeChipSub}>-10% HP Crit</Text>
            </Pressable>

            <Pressable
              onPress={() => handleSelectMode('SAVING')}
              style={[styles.modeChip, modeKey === 'SAVING' && styles.modeChipSaving]}
            >
              <Text style={styles.modeChipTitle}>SHIELD+</Text>
              <Text style={styles.modeChipSub}>+35 XP Save</Text>
            </Pressable>

            <Pressable
              onPress={() => handleSelectMode('INCOME')}
              style={[styles.modeChip, modeKey === 'INCOME' && styles.modeChipIncome]}
            >
              <Text style={styles.modeChipTitle}>INCOME</Text>
              <Text style={styles.modeChipSub}>+15 XP Cuan</Text>
            </Pressable>
          </View>

          {/* Amount Display */}
          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>NOMINAL (ZERO-KNOWLEDGE ENCRYPTED):</Text>
            <Text
              style={[
                styles.amountValue,
                modeKey === 'IMPULSE_EXPENSE' && { color: PULSE_THEME.colors.criticalRed },
                modeKey === 'SAVING' && { color: PULSE_THEME.colors.shieldCyan },
                modeKey === 'INCOME' && { color: PULSE_THEME.colors.syncedGreen },
              ]}
            >
              {formatRupiah(numericAmount)}
            </Text>
          </View>

          {/* Step 2: Category Pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryScroll}
            contentContainerStyle={styles.categoryContent}
          >
            {CATEGORIES_BY_MODE[modeKey].map((cat) => {
              const active = selectedCategory === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => {
                    triggerHaptic('light');
                    setSelectedCategory(cat);
                  }}
                  style={[styles.catPill, active && styles.catPillActive]}
                >
                  <Text style={[styles.catPillText, active && styles.catPillTextActive]}>
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Optional Note Input */}
          <TextInput
            value={customTitle}
            onChangeText={setCustomTitle}
            placeholder={`Catatan singkat (opsional, mis: ${selectedCategory})...`}
            placeholderTextColor={PULSE_THEME.colors.textMuted}
            style={styles.noteInput}
          />

          {/* Step 3: Tactical Numpad Grid */}
          <View style={styles.numpadGrid}>
            {NUMPAD_KEYS.map((k) => (
              <Pressable
                key={k}
                onPress={() => handleKeyPress(k)}
                style={({ pressed }) => [
                  styles.numpadKey,
                  pressed && styles.numpadKeyPressed,
                ]}
              >
                <Text style={styles.numpadKeyText}>{k}</Text>
              </Pressable>
            ))}
          </View>

          {/* Save Button */}
          <Pressable
            onPress={handleSaveTransaction}
            disabled={isSaving}
            style={[
              styles.saveBtn,
              modeKey === 'IMPULSE_EXPENSE' && {
                backgroundColor: PULSE_THEME.colors.criticalRed,
              },
              modeKey === 'SAVING' && {
                backgroundColor: PULSE_THEME.colors.shieldCyan,
              },
            ]}
          >
            <Text style={styles.saveBtnText}>
              {isSaving
                ? 'ENCRYPTING & SAVING...'
                : modeKey === 'IMPULSE_EXPENSE'
                ? '⚡ LOG IMPULSE (-10% HP // ENCRYPT)'
                : '⚡ SAVE & ENCRYPT (+XP // ZERO-KNOWLEDGE)'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(4, 8, 14, 0.84)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: PULSE_THEME.colors.bgSecondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1.5,
    borderColor: PULSE_THEME.colors.borderActive,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTag: {
    color: PULSE_THEME.colors.iceAqua,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  zkSubtag: {
    color: PULSE_THEME.colors.encryptedViolet,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PULSE_THEME.colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: PULSE_THEME.colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  floatingBanner: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  floatingBannerXp: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: PULSE_THEME.colors.syncedGreen,
  },
  floatingBannerCrit: {
    backgroundColor: PULSE_THEME.colors.criticalBg,
    borderColor: PULSE_THEME.colors.criticalRed,
  },
  floatingBannerText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  floatingBannerSub: {
    color: PULSE_THEME.colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modeChip: {
    flex: 1,
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
    alignItems: 'center',
  },
  modeChipEssential: {
    borderColor: PULSE_THEME.colors.iceAqua,
    backgroundColor: 'rgba(186, 229, 233, 0.1)',
  },
  modeChipImpulse: {
    borderColor: PULSE_THEME.colors.criticalRed,
    backgroundColor: PULSE_THEME.colors.criticalBg,
  },
  modeChipSaving: {
    borderColor: PULSE_THEME.colors.shieldCyan,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  modeChipIncome: {
    borderColor: PULSE_THEME.colors.syncedGreen,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  modeChipTitle: {
    color: PULSE_THEME.colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  modeChipSub: {
    color: PULSE_THEME.colors.textSecondary,
    fontSize: 9,
    marginTop: 2,
  },
  amountBox: {
    backgroundColor: PULSE_THEME.colors.bgPrimary,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderActive,
    marginBottom: 10,
    alignItems: 'flex-end',
  },
  amountLabel: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  amountValue: {
    color: PULSE_THEME.colors.iceAqua,
    fontSize: 28,
    fontWeight: '900',
    marginTop: 2,
  },
  categoryScroll: {
    maxHeight: 38,
    marginBottom: 10,
  },
  categoryContent: {
    gap: 8,
    alignItems: 'center',
  },
  catPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
  },
  catPillActive: {
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderColor: PULSE_THEME.colors.iceAqua,
  },
  catPillText: {
    color: PULSE_THEME.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  catPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  noteInput: {
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: PULSE_THEME.colors.textPrimary,
    fontSize: 13,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
    marginBottom: 12,
  },
  numpadGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  numpadKey: {
    width: '31.5%',
    height: 48,
    backgroundColor: PULSE_THEME.colors.bgElevated,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
  },
  numpadKeyPressed: {
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderColor: PULSE_THEME.colors.iceAqua,
  },
  numpadKeyText: {
    color: PULSE_THEME.colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  saveBtn: {
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.iceAqua,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.9,
  },
});

