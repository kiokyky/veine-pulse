import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PulseProvider, usePulse } from '../src/context/PulseContext';
import { AuthScreen } from '../src/components/AuthScreen';
import { PULSE_THEME } from '../src/theme/pulseTheme';

/**
 * Tidak ada layar data yang dirender sebelum Vault terbuka (DEK ada di memori).
 */
function VaultGate() {
  const { vaultStatus } = usePulse();

  if (vaultStatus === 'CHECKING') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: PULSE_THEME.colors.bgPrimary,
        }}
      >
        <ActivityIndicator color={PULSE_THEME.colors.iceAqua} />
      </View>
    );
  }

  if (vaultStatus !== 'UNLOCKED') {
    return <AuthScreen />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: PULSE_THEME.colors.bgPrimary },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <PulseProvider>
      <StatusBar style="light" />
      <VaultGate />
    </PulseProvider>
  );
}
