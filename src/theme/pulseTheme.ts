export const PULSE_THEME = {
  colors: {
    bgPrimary: '#070B10',
    bgSecondary: '#0D141D',
    bgCard: '#111B27',
    bgElevated: '#172434',
    borderSubtle: '#1E2F42',
    borderActive: '#2A435E',

    // Blueprint RPG HUD Colors
    iceAqua: '#BAE5E9',      // 80% - 100% HP: OPTIMAL PULSE
    oceanTeal: '#0E7E8E',    // 35% - 79% HP: STABLE PULSE
    criticalRed: '#FF3B5C',  // < 35% HP: CRITICAL WARNING
    criticalBg: 'rgba(255, 59, 92, 0.14)',

    // Shield & Overdrive
    shieldCyan: '#38BDF8',
    shieldIndigo: '#6366F1',
    overdriveBlue: '#00F0FF',
    overdriveGlow: 'rgba(0, 240, 255, 0.18)',

    // Gamification Accents
    xpGold: '#FBBF24',
    streakFlame: '#FB923C',
    syncedGreen: '#10B981',
    pendingAmber: '#F59E0B',
    encryptedViolet: '#A855F7',

    // Text
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
  },
};

export type HpStatusTier = 'OPTIMAL PULSE' | 'STABLE PULSE' | 'CRITICAL PULSE';

export function getHpBarSpec(hpPercent: number): {
  color: string;
  status: HpStatusTier;
  isCritical: boolean;
} {
  if (hpPercent >= 80) {
    return {
      color: PULSE_THEME.colors.iceAqua,
      status: 'OPTIMAL PULSE',
      isCritical: false,
    };
  }
  if (hpPercent >= 35) {
    return {
      color: PULSE_THEME.colors.oceanTeal,
      status: 'STABLE PULSE',
      isCritical: false,
    };
  }
  return {
    color: PULSE_THEME.colors.criticalRed,
    status: 'CRITICAL PULSE',
    isCritical: true,
  };
}

export function formatRupiah(amount: number, maskIfLocked = false): string {
  if (maskIfLocked) {
    return 'Rp ••••••••';
  }
  const absVal = Math.abs(Math.round(amount));
  const formatted = absVal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return amount < 0 ? `-Rp ${formatted}` : `Rp ${formatted}`;
}

