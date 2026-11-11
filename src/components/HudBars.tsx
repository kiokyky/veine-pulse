import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { getHpBarSpec, PULSE_THEME } from '../theme/pulseTheme';

/**
 * Wallet HP Bar dengan warna dinamis sesuai Blueprint:
 * 80-100% Ice Aqua (OPTIMAL), 35-79% Ocean Teal (STABLE), <35% Critical + heartbeat.
 * `damageSignal` berubah setiap kali terjadi Critical Hit -> memicu damage shake.
 */
export const WalletHpBar: React.FC<{
  hpPercent: number;
  damageSignal?: number;
  subtitle?: string;
}> = ({ hpPercent, damageSignal = 0, subtitle }) => {
  const spec = getHpBarSpec(hpPercent);
  const widthAnim = useRef(new Animated.Value(hpPercent)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: hpPercent,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [hpPercent, widthAnim]);

  // Damage shake saat Critical Hit (-10% HP)
  useEffect(() => {
    if (!damageSignal) return;
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [damageSignal, shakeAnim]);

  // Low-health heartbeat halus saat HP < 35%
  useEffect(() => {
    if (!spec.isCritical) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.55, duration: 420, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 620, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [spec.isCritical, pulseAnim]);

  const widthInterpolated = widthAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View style={{ transform: [{ translateX: shakeAnim }] }}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>❤ WALLET HP</Text>
        <Text style={[styles.status, { color: spec.color }]}>
          {spec.status} • {hpPercent}%
        </Text>
      </View>
      <Animated.View style={[styles.track, { opacity: pulseAnim }]}>
        <Animated.View
          style={[styles.fill, { width: widthInterpolated, backgroundColor: spec.color }]}
        />
      </Animated.View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </Animated.View>
  );
};

export const ShieldBar: React.FC<{ shieldPercent: number; subtitle?: string }> = ({
  shieldPercent,
  subtitle,
}) => (
  <View>
    <View style={styles.labelRow}>
      <Text style={styles.label}>🛡 EMERGENCY SHIELD</Text>
      <Text style={[styles.status, { color: PULSE_THEME.colors.shieldCyan }]}>
        {shieldPercent}%
      </Text>
    </View>
    <View style={styles.track}>
      <View
        style={[
          styles.fill,
          {
            width: `${Math.min(100, shieldPercent)}%`,
            backgroundColor: PULSE_THEME.colors.shieldCyan,
          },
        ]}
      />
    </View>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </View>
);

export const ProgressBar: React.FC<{
  percent: number;
  color?: string;
  height?: number;
  style?: ViewStyle;
}> = ({ percent, color = PULSE_THEME.colors.oceanTeal, height = 8, style }) => (
  <View style={[styles.track, { height }, style]}>
    <View
      style={[
        styles.fill,
        { width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: color },
      ]}
    />
  </View>
);

export const HudCard: React.FC<{ children: React.ReactNode; style?: ViewStyle }> = ({
  children,
  style,
}) => <View style={[styles.card, style]}>{children}</View>;

export const SectionTitle: React.FC<{ children: React.ReactNode; right?: string }> = ({
  children,
  right,
}) => (
  <View style={styles.sectionRow}>
    <Text style={styles.sectionTitle}>{children}</Text>
    {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: PULSE_THEME.colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  status: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  track: {
    height: 14,
    borderRadius: 7,
    backgroundColor: PULSE_THEME.colors.bgPrimary,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 7,
  },
  subtitle: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 11,
    marginTop: 5,
  },
  card: {
    backgroundColor: PULSE_THEME.colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PULSE_THEME.colors.borderSubtle,
    padding: 14,
    marginBottom: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    color: PULSE_THEME.colors.iceAqua,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  sectionRight: {
    color: PULSE_THEME.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
});

