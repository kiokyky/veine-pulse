<div align="center">

# ⚡ VEINE PULSE // MOBILE v2.0

**Fintech × RPG Gamification • Offline-First • Zero-Knowledge End-to-End Encrypted**

Satu codebase **React Native (Expo SDK 58 + TypeScript)** untuk **Android & iOS**, terintegrasi dengan ekosistem **Go Cuan Web** (`gocuan.veinestudio.my.id`).

[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2058-000020?style=flat-square&logo=expo)](https://expo.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Encryption](https://img.shields.io/badge/E2EE-AES--256--GCM-A855F7?style=flat-square)](./src/crypto/zeroKnowledgeCrypto.ts)
[![License](https://img.shields.io/badge/License-MIT-10B981?style=flat-square)](./LICENSE)

</div>

---

## 🎯 Filosofi & Konsep

**Veine Pulse** menggabungkan DNA game development **Veine Studio** ke dalam pencatatan keuangan pribadi agar pengguna disiplin menjaga cashflow dan terhindar dari *boncos*:

- **Zero-Knowledge Privacy**: Seluruh nominal Rupiah, batas budget bulanan, nama transaksi, dan target tabungan dienkripsi di sisi klien dengan **AES-256-GCM** sebelum masuk ke SQLite lokal maupun dikirim ke backend Go/PostgreSQL. Admin database sekalipun tidak bisa membaca saldo pengguna.
- **Offline-First SQLite**: Aplikasi tetap instan tanpa internet; data lokal ditandai `PENDING` hingga benar-benar terkonfirmasi oleh server saat sinkronisasi.
- **PULSE RPG Engine**: Disiplin finansial memberi feedback instan berupa XP, Level, Combo Streak, Shield, dan pertarungan melawan *Month-End Boss*.

---

## 🔐 Arsitektur Zero-Knowledge E2EE

```text
Password Login Pengguna (tidak pernah dikirim ke server)
  │
  ▼  PBKDF2-SHA256 (100.000 iterasi + salt 128-bit)
Master Key (256-bit)
  ├──► HMAC-SHA256("veine-pulse-auth-v2") ──► auth_hash ──► Server (disimpan sebagai bcrypt)
  └──► HMAC-SHA256("veine-pulse-kek-v2")  ──► KEK (hanya di RAM perangkat)
                                                │
                                                ▼ unwrap / wrap
                                              DEK 256-bit (disimpan di iOS Keychain / Android Keystore)
                                                │
                                                ▼ AES-256-GCM ("vp1:<iv_hex>:<ciphertext+tag>")
                              Payload Finansial (SQLite & PostgreSQL)
```

| Komponen Data | Status di DB (SQLite & PostgreSQL) | Penjelasan |
| --- | --- | --- |
| Nominal transaksi, judul, kategori, catatan | 🔒 **Ciphertext `vp1:...`** | Dienkripsi per baris di `local_transactions.encrypted_payload` |
| Budget bulanan, target & saldo shield | 🔒 **Ciphertext `vp1:...`** | Dienkripsi di `player_pulse_stats.encrypted_financial_state` |
| Target & progres nominal quest | 🔒 **Ciphertext `vp1:...`** | Dienkripsi di `financial_quests.encrypted_quest_payload` |
| Level, XP, Streak, % Wallet HP, % Shield | 📖 **Readable (non-nominal)** | Mendukung RPG HUD & validasi server tanpa membocorkan nominal Rupiah |

> **Penting**: Karena pendekatan *Zero-Knowledge*, lupa password berarti data terenkripsi tidak dapat dipulihkan. Penggantian password cukup me-rotate pembungkus DEK (`rotateLoginPasswordKek`) tanpa perlu mengenkripsi ulang seluruh histori transaksi.

---

## 🎮 Mekanik "PULSE RPG ENGINE"

### 1. Wallet HP & Emergency Shield
- **Wallet HP Bar (`0% – 100%`)** mencerminkan sisa batas pengeluaran bulanan dikurangi penalti *Critical Hit*:
  - `80% – 100%` (**Ice Aqua `#BAE5E9`**) — `OPTIMAL PULSE`
  - `35% – 79%` (**Ocean Teal `#0E7E8E`**) — `STABLE PULSE`
  - `< 35%` (**Critical Red `#FF3B5C`**) — `CRITICAL PULSE` + animasi *low-health heartbeat*
- **Emergency Shield Bar**: Bertambah setiap kali pengguna mengalokasikan dana ke kategori **Saving / Shield+**.

### 2. XP, Level, Streak & Penalti
| Aksi Pengguna | Efek RPG | Aturan |
| --- | --- | --- |
| Catat transaksi harian | **+15 XP** | Maks. **3x/hari** (anti-spam) + haptic feedback |
| Alokasi **Shield+ / Saving** | **+35 XP** | +15 XP log + 20 XP bonus tabungan + naikkan Shield |
| **Daily Streak ≥ 7 Hari** | **1.5x XP Multiplier** | Mengaktifkan efek visual **Overdrive** pada HUD |
| Pengeluaran **IMPULSE** | **-10% HP (Critical Hit)** | Animasi *damage shake* pada HP Bar (reset tiap ganti bulan) |
| Rollover & Saving Goal | **+15 / +40 / +150 / +300+ XP** | Daily Quest reset `00:00`, Weekly Quest tiap Minggu |

### 3. Month-End Boss Battle
Di akhir bulan, **`INFLATION TITAN // BONCOS BOSS`** mengevaluasi sisa `Wallet HP` dan quest yang diselesaikan untuk menentukan *Season Badge* dan kenaikan Title Class (*Rookie Cuan Crafter* → *Novice Spender* → *Tactical Saver* → *Cashflow Ranger* → *Sovereign of Cuan*).

---

## 📱 Navigasi Layar (4 Tab + Center FAB)

1. **`[01. HUD]`** (`app/(tabs)/index.tsx`) — Kartu karakter (Level, Title, Streak 🔥, Overdrive, Sync badge), Wallet HP & Shield Bar, *Safe Daily Spend*, Active Daily Quests, dan 3 transaksi terakhir.
2. **`[02. LEDGER]`** (`app/(tabs)/ledger.tsx`) — Riwayat & filter (`ALL`, `ESSENTIAL`, `IMPULSE`, `INCOME`, `SAVING`) + toggle inspeksi ciphertext mentah di DB.
3. **`[+ LOG]` Tactical Numpad** (`src/components/TacticalNumpadModal.tsx`) — Bottom sheet input cepat 3 ketukan dengan haptic feedback dan toast `+XP` / `CRITICAL HIT`.
4. **`[03. QUESTS]`** (`app/(tabs)/quests.tsx`) — *Month-End Boss*, Daily & Weekly Quests, Custom Saving Goals dengan top-up cepat, dan koleksi Badge.
5. **`[04. VAULT]`** (`app/(tabs)/vault.tsx`) — Fingerprint kunci DEK, inspeksi baris mentah DB, ubah budget bulanan, toggle FaceID/Fingerprint, ganti password (rotasi KEK), Force Sync ke Go Cuan Cloud, dan ekspor CSV terdekripsi.

---

## 🗂️ Struktur Proyek

```text
veine-pulse/
├── app/
│   ├── _layout.tsx                     # Root provider + VaultGate (blok akses sebelum unlock)
│   └── (tabs)/
│       ├── _layout.tsx                 # Bottom tabs + center Tactical Numpad FAB
│       ├── index.tsx                   # [01. HUD]
│       ├── ledger.tsx                  # [02. LEDGER]
│       ├── quests.tsx                  # [03. QUESTS]
│       └── vault.tsx                   # [04. VAULT]
├── src/
│   ├── api/
│   │   ├── authApi.ts                  # Zero-Knowledge auth client (prelogin, register, login, password)
│   │   ├── config.ts                   # Base URL Go Cuan API
│   │   └── pulseApi.ts                 # Sync, profile & quests client (tanpa plaintext nominal)
│   ├── components/
│   │   ├── AuthScreen.tsx              # Register, Password/Biometric Unlock, Cloud Login
│   │   ├── HudBars.tsx                 # WalletHpBar (heartbeat & shake), ShieldBar, ProgressBar
│   │   ├── TacticalNumpadModal.tsx     # 3-tap logger bottom sheet
│   │   └── TransactionRow.tsx          # Baris transaksi + preview ciphertext opsional
│   ├── context/
│   │   └── PulseContext.tsx            # State global, rollover otomatis, auto-lock background 30s
│   ├── crypto/
│   │   ├── cryptoPrimitives.ts         # PBKDF2-SHA256, AES-256-GCM vp1 envelope, key fingerprint
│   │   └── zeroKnowledgeCrypto.ts      # Manajemen DEK, SecureStore Keychain/Keystore, lock/wipe
│   ├── db/
│   │   └── database.ts                 # Skema SQLite offline-first + enkripsi/dekripsi per baris
│   ├── engine/
│   │   └── pulseRpgEngine.ts           # Kalkulasi HP, Shield, XP, Streak, Rollover & Boss Battle
│   ├── theme/
│   │   └── pulseTheme.ts               # Palet warna HUD & formatter Rupiah
│   └── types/
│       └── pulse.ts                    # Kontrak TypeScript (Encrypted*Row vs Decrypted client models)
├── tests/
│   ├── pulseRpgEngine.test.ts          # Unit test mesin RPG & rollover
│   └── zeroKnowledgeCrypto.test.ts     # Unit test kriptografi & lifecycle Vault
└── docs/
    └── BACKEND_GO_REFERENCE.md         # Referensi skema PostgreSQL & endpoint Go/Gin
```

---

## 🚀 Menjalankan Proyek

### Prasyarat
- Node.js 20+ (diverifikasi di Node v24.5.0)
- Aplikasi **Expo Go** (Android/iOS) atau Xcode / Android Studio

### Instalasi & Dev Server
```bash
npm install
npx expo start
```

### Verifikasi & Pengujian
```bash
# TypeScript typecheck
npm run typecheck

# Unit test (Zero-Knowledge Crypto + Pulse RPG Engine)
npm test

# Verifikasi bundling Metro iOS
npx expo export --platform ios --output-dir .expo-check
```

---

## 🌐 Integrasi Backend Go/Gin

Kontrak endpoint dan skema PostgreSQL lengkap tersedia di [docs/BACKEND_GO_REFERENCE.md](./docs/BACKEND_GO_REFERENCE.md):

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/v1/auth/prelogin` | Mengambil `kdf_salt` user sebelum derivasi kunci |
| `POST` | `/api/v1/auth/register` | Registrasi dengan `auth_hash`, `kdf_salt`, dan `encrypted_dek` |
| `POST` | `/api/v1/auth/login` | Login dengan `auth_hash` & mengembalikan `encrypted_dek` |
| `POST` | `/api/v1/auth/password` | Rotasi `auth_hash`, `kdf_salt`, dan `encrypted_dek` secara atomik |
| `POST` | `/api/v1/pulse/sync` | Sinkronisasi batch transaksi & quest terenkripsi |
| `GET` | `/api/v1/pulse/profile` | Mengambil state RPG & `encrypted_financial_state` |
| `POST` | `/api/v1/pulse/quests` | Membuat Custom Saving Quest terenkripsi baru |

---

<div align="center">
<sub>Built by <b>Veine Studio</b> • Lisensi <a href="./LICENSE">MIT</a></sub>
</div>

