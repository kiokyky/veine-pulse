import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TacticalNumpadModal } from '../../src/components/TacticalNumpadModal';
import { PULSE_THEME } from '../../src/theme/pulseTheme';

export default function TabsLayout() {
  const [numpadOpen, setNumpadOpen] = useState(false);

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: PULSE_THEME.colors.iceAqua,
          tabBarInactiveTintColor: PULSE_THEME.colors.textMuted,
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: '01. HUD',
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name="pulse"
                size={size}
                color={typeof color === 'string' ? color : PULSE_THEME.colors.textMuted}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="ledger"
          options={{
            title: '02. LEDGER',
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name="list"
                size={size}
                color={typeof color === 'string' ? color : PULSE_THEME.colors.textMuted}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="numpad-trigger"
          options={{
            title: '',
            tabBarButton: () => (
              <View style={styles.fabWrapper}>
                <Pressable
                  onPress={() => setNumpadOpen(true)}
                  style={({ pressed }) => [
                    styles.fabButton,
                    pressed && styles.fabButtonPressed,
                  ]}
                >
                  <Text style={styles.fabPlus}>+</Text>
                  <Text style={styles.fabSub}>LOG</Text>
                </Pressable>
              </View>
            ),
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              setNumpadOpen(true);
            },
          }}
        />
        <Tabs.Screen
          name="quests"
          options={{
            title: '03. QUESTS',
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name="trophy"
                size={size}
                color={typeof color === 'string' ? color : PULSE_THEME.colors.textMuted}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="vault"
          options={{
            title: '04. VAULT',
            tabBarIcon: ({ color, size }) => (
              <Ionicons
                name="shield-checkmark"
                size={size}
                color={typeof color === 'string' ? color : PULSE_THEME.colors.textMuted}
              />
            ),
          }}
        />
      </Tabs>

      <TacticalNumpadModal visible={numpadOpen} onClose={() => setNumpadOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PULSE_THEME.colors.bgPrimary,
  },
  tabBar: {
    backgroundColor: PULSE_THEME.colors.bgSecondary,
    borderTopColor: PULSE_THEME.colors.borderActive,
    borderTopWidth: 1,
    height: 70,
    paddingBottom: 10,
    paddingTop: 8,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  fabWrapper: {
    width: 74,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: PULSE_THEME.colors.oceanTeal,
    borderWidth: 2,
    borderColor: PULSE_THEME.colors.iceAqua,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -24,
    shadowColor: PULSE_THEME.colors.overdriveBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
  },
  fabButtonPressed: {
    transform: [{ scale: 0.94 }],
    backgroundColor: PULSE_THEME.colors.iceAqua,
  },
  fabPlus: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 24,
  },
  fabSub: {
    color: PULSE_THEME.colors.iceAqua,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
});

