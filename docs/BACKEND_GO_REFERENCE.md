# Backend Go/Gin — Pulse Endpoints (Reference)

Referensi untuk ditambahkan ke backend **Go Cuan** (`gocuan.veinestudio.my.id`).
Prinsip utama: **server tidak pernah menerima/menyimpan nominal Rupiah atau judul transaksi dalam plaintext.**

## Skema PostgreSQL

```sql
-- Kolom auth/kunci di tabel users: lihat bagian "Endpoint auth" di bawah.
CREATE TABLE IF NOT EXISTS player_pulse_stats (
  user_id                   TEXT PRIMARY KEY REFERENCES users(id),
  level                     INT  NOT NULL DEFAULT 1,
  current_xp                INT  NOT NULL DEFAULT 0,
  next_level_xp             INT  NOT NULL DEFAULT 500,
  current_streak            INT  NOT NULL DEFAULT 0,
  longest_streak            INT  NOT NULL DEFAULT 0,
  last_log_date             DATE,
  wallet_hp_percent         SMALLINT NOT NULL DEFAULT 100 CHECK (wallet_hp_percent BETWEEN 0 AND 100),
  shield_percent            SMALLINT NOT NULL DEFAULT 0   CHECK (shield_percent BETWEEN 0 AND 100),
  impulse_penalty_percent   SMALLINT NOT NULL DEFAULT 0,
  daily_tx_xp_count         SMALLINT NOT NULL DEFAULT 0,
  unlocked_title            TEXT NOT NULL DEFAULT 'Rookie Cuan Crafter',
  encrypted_financial_state TEXT NOT NULL,   -- vp1:<iv>:<ct+tag>
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pulse_transactions (
  tx_id             UUID PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  tx_type           TEXT NOT NULL CHECK (tx_type IN ('EXPENSE','INCOME','SAVING')),
  tx_date           DATE NOT NULL,
  encrypted_payload TEXT NOT NULL,           -- { title, amount, category, spend_nature, notes }
  hp_damage_dealt   SMALLINT NOT NULL DEFAULT 0,
  xp_earned         INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pulse_tx_user_date ON pulse_transactions(user_id, tx_date);

CREATE TABLE IF NOT EXISTS financial_quests (
  quest_id                UUID PRIMARY KEY,
  user_id                 TEXT NOT NULL REFERENCES users(id),
  quest_type              TEXT NOT NULL CHECK (quest_type IN ('DAILY','WEEKLY','SAVING_GOAL')),
  progress_percent        SMALLINT NOT NULL DEFAULT 0,
  xp_reward               INT NOT NULL,
  is_completed            BOOLEAN NOT NULL DEFAULT false,
  expires_at              TEXT,
  encrypted_quest_payload TEXT NOT NULL      -- { title, target_amount, current_progress }
);
```

## Router Gin

```go
pulse := r.Group("/api/v1/pulse", AuthMiddleware())
{
    pulse.POST("/sync", h.PulseSync)
    pulse.GET("/profile", h.PulseProfile)
    pulse.POST("/quests", h.CreateQuest)
}
```

## Validasi server-side (tanpa melihat nominal)

Server tetap bisa menjaga integritas RPG **tanpa mendekripsi apa pun**:

| Aturan | Cara cek di server |
| --- | --- |
| +15 XP maks 3x/hari | `COUNT(*) WHERE user_id=? AND tx_date=? AND xp_earned>0` ≤ 3 |
| Streak | Bandingkan `tx_date` berturut-turut di `pulse_transactions` |
| Overdrive 1.5x | `streak >= 7` → `xp_earned` maks `round(base*1.5)` |
| Critical Hit | `hp_damage_dealt ∈ {0, 10}` |
| Format ciphertext | `encrypted_payload` harus match `^vp1:[0-9a-f]{24}:[0-9a-f]+$` |
| Ownership | `user_id` dari JWT, **bukan** dari body |

> Catatan: `wallet_hp_percent` dihitung di klien (karena butuh nominal). Server hanya bisa
> memastikan rentangnya 0–100, bukan kebenarannya. Ini trade-off yang disengaja dari Zero-Knowledge.

## Login lintas platform (Mobile ↔ Go Cuan Web)

Password **tidak pernah** dikirim ke server. Klien menurunkan dua kunci dari password:

```
masterKey = PBKDF2-SHA256(password, kdf_salt, 100000 iter, 32 byte)
auth_hash = HMAC-SHA256(masterKey, "veine-pulse-auth-v2")   -> dikirim ke server
KEK       = HMAC-SHA256(masterKey, "veine-pulse-kek-v2")    -> TIDAK PERNAH keluar dari klien
encrypted_dek = AES-256-GCM(KEK, DEK)                       -> disimpan di server
```

Go Cuan Web **wajib** memakai parameter yang persis sama (iterasi, label HMAC, format `vp1:<iv>:<ct>`).

### Endpoint auth

| Method | Endpoint | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/prelogin?email=` | – | `{ kdf_salt }` |
| POST | `/api/v1/auth/register` | `{ email, auth_hash, kdf_salt, encrypted_dek }` | `{ token, user_id }` · 409 jika email sudah ada |
| POST | `/api/v1/auth/login` | `{ email, auth_hash }` | `{ token, user_id, encrypted_dek, kdf_salt }` · 401 jika salah |
| POST | `/api/v1/auth/password` (auth) | `{ new_auth_hash, new_kdf_salt, new_encrypted_dek }` | 200 |

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_hash_bcrypt TEXT,  -- bcrypt(auth_hash), BUKAN auth_hash mentah
  ADD COLUMN IF NOT EXISTS encrypted_dek TEXT,
  ADD COLUMN IF NOT EXISTS kdf_salt TEXT;
```

### Aturan wajib di server

- Simpan `bcrypt(auth_hash)`, bukan `auth_hash` mentah. Kalau DB bocor, `auth_hash` mentah bisa dipakai login.
- `prelogin` untuk email yang **tidak terdaftar** harus tetap mengembalikan salt palsu yang
  deterministik (mis. `HMAC(server_secret, email)[:16]`) agar tidak bisa dipakai menebak email terdaftar.
- Rate-limit `prelogin` dan `login` per IP + per email.
- `/auth/password` harus mengganti `auth_hash_bcrypt`, `kdf_salt`, dan `encrypted_dek` dalam **satu transaksi**.
- Tidak ada endpoint "reset password" yang bisa memulihkan data: tanpa password lama, DEK tidak bisa dibuka.
  Reset hanya bisa berarti "hapus akun & mulai dari nol".

