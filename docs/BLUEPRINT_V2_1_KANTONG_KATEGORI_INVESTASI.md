# Blueprint Veine Pulse v2.1 — Kantong, Kategori Dinamis & Portofolio Investasi

**Integrasi Fitur Inti Go Cuan × PULSE RPG Engine × Zero-Knowledge E2EE**

Dokumen ini adalah rancangan arsitektur dan implementasi untuk menambahkan tiga modul penting dari ekosistem **Go Cuan** (`gocuan.veinestudio.my.id`) ke dalam aplikasi mobile **Veine Pulse**:
1. **Kantong (Pockets / Envelopes)** & Transfer Antar-Kantong
2. **Pengeluaran & Manajemen Kategori Dinamis** (Custom Categories + Budget per Kategori + Breakdown Analitik)
3. **Portofolio Investasi & Net Worth Tracker**

Seluruh rancangan tetap mempertahankan tiga pilar utama Veine Pulse v2.0:
- **Zero-Knowledge Privacy (`AES-256-GCM`)**: Nominal Rupiah, nama kantong, nama kategori custom, ticker/unit aset, maupun harga beli **tidak pernah** disimpan dalam plaintext di SQLite maupun PostgreSQL.
- **Offline-First SQLite**: Semua operasi instan tanpa koneksi internet dengan antrean `PENDING -> SYNCED`.
- **Tactical 3-Tap Speed**: Penambahan Kantong, Kategori, dan Investasi tidak boleh memperlambat kecepatan input di [TacticalNumpadModal.tsx](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/components/TacticalNumpadModal.tsx).

---

## 1. Gap Analysis Kondisi Saat Ini (v2.0)

Berdasarkan codebase saat ini:
- **Belum ada entitas Kantong**: Seluruh cashflow bercampur menjadi satu `monthly_budget_limit` dan `emergency_shield_saved` di [src/types/pulse.ts](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/types/pulse.ts#L51-L56). Pengguna belum bisa memisahkan saldo nyata antar pos (mis. *Rekening Utama*, *Uang Makan*, *Tagihan*, *Dana Darurat*, *RDN*).
- **Kategori masih hardcoded**: Daftar kategori saat ini dikunci di `CATEGORIES_BY_MODE` pada [src/components/TacticalNumpadModal.tsx](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/components/TacticalNumpadModal.tsx#L22-L27). Pengguna belum bisa menambah kategori sendiri, mengatur budget per kategori, maupun memfilter/melihat breakdown pengeluaran per kategori di [app/(tabs)/ledger.tsx](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/app/%28tabs%29/ledger.tsx).
- **Investasi masih sebatas label string**: Saat ini investasi hanya berupa kategori `'Investasi Go Cuan'` di mode `SAVING`. Belum ada pencatatan unit/lot, harga beli rata-rata, unrealized P&L, histori beli/jual/dividen, maupun keterkaitannya dengan saldo kantong sumber dana.
- **Batas skema database v2.0**: Kolom `tx_type` di `local_transactions` ([src/db/database.ts](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/db/database.ts#L64)) dan `pulse_transactions` ([docs/BACKEND_GO_REFERENCE.md](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/docs/BACKEND_GO_REFERENCE.md#L30)) dibatasi pada `'EXPENSE' | 'INCOME' | 'SAVING'`.

---

## 2. Arsitektur Data & Zero-Knowledge Encryption

Semua tabel baru mengikuti pola enkripsi yang sudah dipakai di [src/crypto/zeroKnowledgeCrypto.ts](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/crypto/zeroKnowledgeCrypto.ts): setiap record sensitif dienkripsi dengan **DEK 256-bit** milik pengguna menjadi string `vp1:<iv_hex>:<ciphertext_and_tag_hex>`.

### 2.1 Klasifikasi Data (Encrypted vs Readable Metadata)

| Entitas | Kolom Terenkripsi (`vp1:...`) | Metadata Non-Sensitif (DB / Server) |
| --- | --- | --- |
| **Kantong (`pockets`)** | `name`, `icon`, `color`, `balance`, `target_balance`, `include_in_net_worth`, `count_as_spend_budget`, `notes` | `pocket_id`, `user_id`, `pocket_type` (`SPENDING \| SAVING \| INVESTMENT_CASH`), `sort_order`, `is_archived`, `sync_status`, `updated_at`, `deleted_at` |
| **Kategori (`categories`)** | `name`, `icon`, `color`, `monthly_budget_limit`, `default_pocket_id` | `category_id`, `user_id`, `tx_type`, `default_spend_nature`, `sort_order`, `is_archived`, `sync_status`, `updated_at`, `deleted_at` |
| **Transaksi (`local_transactions`)** | `title`, `amount`, `category` (nama), `category_id`, `pocket_id`, `to_pocket_id` (transfer), `asset_id` (investasi), `investment_units`, `investment_unit_price`, `spend_nature`, `notes` | `tx_id`, `user_id`, `tx_type` (`EXPENSE \| INCOME \| SAVING \| TRANSFER \| INVESTMENT`), `tx_date`, `hp_damage_dealt`, `xp_earned`, `sync_status`, `created_at`, `updated_at`, `deleted_at` |
| **Aset Investasi (`investment_assets`)** | `name`, `ticker`, `platform`, `units`, `avg_buy_price`, `total_cost_basis`, `current_unit_price`, `current_value`, `linked_pocket_id`, `price_updated_at`, `notes` | `asset_id`, `user_id`, `asset_class` (`STOCK \| MUTUAL_FUND \| CRYPTO \| GOLD \| DEPOSIT \| OTHER`), `is_archived`, `sync_status`, `updated_at`, `deleted_at` |

> **Prinsip Privasi**: Nama kantong (*"Gaji BCA"*), saldo kantong, nama kategori custom (*"Cicilan Motor"*), serta nama/ticker/jumlah unit aset investasi (*"BBCA 10 lot"*) seluruhnya berada di dalam ciphertext. Server Go/Gin hanya melihat UUID, enum tipe, dan timestamp untuk kebutuhan sinkronisasi.

---

## 3. Desain Detail Tiga Pilar Fitur

### 3.1 Pilar 1 — Kantong (Pockets / Cashflow Envelopes)

#### A. Tipe Kantong & Perilaku Saldo
1. **`SPENDING` (Kantong Operasional)**: Untuk belanja harian, transport, tagihan, jajan. Pengeluaran dari kantong ini mengurangi saldo kantong dan dihitung ke dalam *Monthly Expense* & `Wallet HP %`.
2. **`SAVING` (Kantong Tabungan / Shield)**: Untuk Dana Darurat dan tujuan tabungan. Total saldo seluruh kantong `SAVING` berkontribusi langsung ke **Emergency Shield** di HUD (menggantikan atau melengkapi `emergency_shield_saved` statis).
3. **`INVESTMENT_CASH` (Kantong Dana Investasi / RDN)**: Dana mengendap di RDN/dompet sekuritas sebelum dibelikan aset, atau hasil pencairan/dividen aset. Dihitung ke **Total Net Worth**, tetapi **tidak** mengurangi jatah `Safe Daily Spend` operasional.

#### B. Seed Kantong Default (Saat Registrasi / Migrasi dari v2.0)
Saat user baru mendaftar atau migrasi pertama kali dari v2.0 ke v2.1:
- **Dompet Utama** (`SPENDING`, saldo awal `0` atau hasil rekonsiliasi saldo v2.0)
- **Kebutuhan Harian** (`SPENDING`)
- **Dana Darurat (Shield)** (`SAVING`, otomatis menampung nilai `emergency_shield_saved` lama agar data v2.0 tidak hilang)
- **Dana Investasi (RDN)** (`INVESTMENT_CASH`)

#### C. Operasi pada Kantong
- **CRUD Kantong**: Buat kantong baru, ubah nama/ikon/warna/target saldo, arsipkan kantong (arsip disembunyikan dari picker tapi tetap valid untuk riwayat transaksi lama).
- **Transfer Antar-Kantong (`tx_type = 'TRANSFER'`)**:
  - Memindahkan nominal dari `pocket_id` (sumber) ke `to_pocket_id` (tujuan).
  - **Aturan Penting**: Transfer **tidak** dihitung sebagai `EXPENSE` atau `INCOME` di analitik cashflow bulanan agar pemasukan/pengeluaran tidak terhitung ganda.
  - *Pengecualian RPG*: Jika `pocket_id` bertipe `SPENDING` dan `to_pocket_id` bertipe `SAVING` atau `INVESTMENT_CASH`, sistem tetap memberi **+20 XP Bonus Alokasi** (selama belum melewati batas anti-spam harian).
- **Rekonsiliasi Saldo**: Fitur *"Sesuaikan Saldo"* jika saldo riil di bank/e-wallet berbeda, yang mencatat penyesuaian bersih agar ledger tetap akuntabel.

---

### 3.2 Pilar 2 — Pengeluaran & Manajemen Kategori Dinamis

#### A. Model Kategori (`CategoryItem`)
Setiap kategori memiliki properti:
- `category_id`: UUID v4
- `tx_type`: `'EXPENSE' | 'INCOME' | 'SAVING' | 'INVESTMENT'`
- `name`: String (mis. *"Makan & Minum"*, *"Kopi & Jajan"*, *"Transportasi"*, *"Tagihan & Listrik"*)
- `icon`: Emoji atau Ionicons name
- `color`: Hex accent color (untuk chart & badge)
- `default_spend_nature`: `'ESSENTIAL' | 'IMPULSE'` (berlaku untuk `EXPENSE`)
- `monthly_budget_limit`: `number | null` (opsional batas anggaran bulanan per kategori)
- `default_pocket_id`: `string | null` (opsional auto-pilih kantong saat kategori ini dipilih di numpad)

#### B. Pengalaman Input Cepat (Menjaga Kecepatan 3-Tap di Tactical Numpad)
Di [TacticalNumpadModal.tsx](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/components/TacticalNumpadModal.tsx):
1. Pengguna memilih mode (`EXPENSE` / `INCOME` / `SAVING` / `TRANSFER` / `INVEST`).
2. Di bawah nominal terdapat **baris Pill Kantong** (auto-memilih kantong terakhir dipakai atau `default_pocket_id` dari kategori).
3. Grid **Chip Kategori** dimuat dinamis dari tabel `categories` (termasuk chip **`+ Kategori`** di akhir grid untuk membuat kategori custom via mini-popover tanpa harus keluar dari modal numpad).
4. Saat memilih kategori `EXPENSE`, toggle `ESSENTIAL` vs `IMPULSE` otomatis terisi sesuai `default_spend_nature` kategori tersebut, namun pengguna tetap bisa meng-override dalam 1 tap (mis. kategori *Makan* default `ESSENTIAL`, tapi traktiran impulsif bisa di-tap jadi `IMPULSE`).

#### C. Analitik Pengeluaran per Kategori di `[02. LEDGER]`
- **Filter Multi-Dimensi**: Filter berdasarkan Tipe (`ALL`, `ESSENTIAL`, `IMPULSE`, `INCOME`, `SAVING`, `TRANSFER`, `INVEST`), **Kantong**, dan **Kategori**.
- **Kartu Category Breakdown (Bulan Berjalan)**:
  - Menampilkan daftar kategori pengeluaran diurutkan dari nominal terbesar ke terkecil.
  - Progress bar pemakaian terhadap `monthly_budget_limit` kategori (jika diset):
    - `< 75%`: **Ocean Teal / Ice Aqua**
    - `75% – 99%`: **Pending Amber (`#F59E0B`)**
    - `≥ 100%`: **Critical Red (`#FF3B5C`)** + peringatan *"Overbudget Kategori"* di HUD.
  - Rasio **Essential vs Impulse** bulan ini (mis. `78% Essential • 22% Impulse`).

---

### 3.3 Pilar 3 — Portofolio Investasi & Net Worth

#### A. Kelas Aset & Model Portofolio (`InvestmentAsset`)
Mendukung instrumen umum di ekosistem Go Cuan:
- `STOCK` — Saham (IDX / Global)
- `MUTUAL_FUND` — Reksa Dana (Pasar Uang, Obligasi, Saham)
- `CRYPTO` — Aset Kripto
- `GOLD` — Emas (Antam / Digital)
- `DEPOSIT` — Deposito / SBN / Obligasi
- `OTHER` — Aset Lainnya

Field terenkripsi per aset:
- `name` (mis. *"Bank Central Asia"*, *"Bibit RDPU"*, *"Bitcoin"*)
- `ticker` (mis. *"BBCA"*, *"RDPU"*, *"BTC"*, *"XAU"*)
- `units` (jumlah unit / gram / lembar saham)
- `avg_buy_price` (harga beli rata-rata per unit)
- `total_cost_basis` (`units × avg_buy_price`, modal tertanam)
- `current_unit_price` (harga terbaru per unit)
- `current_value` (`units × current_unit_price`)
- `linked_pocket_id` (kantong sumber/tujuan default, mis. *Dana Investasi / RDN*)
- `price_updated_at` (timestamp update harga terakhir)

#### B. Alur Transaksi Investasi (`investment_action`)
Semua aktivitas investasi dicatat sebagai transaksi `tx_type = 'INVESTMENT'` agar terarsip rapi di Ledger dan langsung mengubah saldo Kantong terkait:
1. **`BUY` (Beli / DCA Aset)**:
   - Input: Aset (pilih atau buat baru), Nominal Rupiah (`amount`), Jumlah Unit (`units`), Kantong sumber (`pocket_id`).
   - Efek: Saldo `pocket_id` berkurang sebesar `amount`; aset bertambah `units` dengan perhitungan *weighted average buy price* baru:
     $$\text{avg\_buy\_price}_{\text{baru}} = \frac{\text{total\_cost\_basis}_{\text{lama}} + \text{amount}}{\text{units}_{\text{lama}} + \text{units}_{\text{beli}}}$$
2. **`SELL` (Jual / Take Profit / Cut Loss)**:
   - Input: Aset, Jumlah Unit dijual, Nominal hasil jual bersih (`amount`), Kantong tujuan (`pocket_id`).
   - Efek: `units` berkurang; `total_cost_basis` berkurang proporsional (`units_jual × avg_buy_price`); selisih `amount - (units_jual × avg_buy_price)` dicatat sebagai *Realized P&L*; saldo Kantong tujuan bertambah `amount`.
3. **`DIVIDEND` (Dividen / Kupon / Bagi Hasil)**:
   - Input: Aset, Nominal diterima (`amount`), Kantong tujuan.
   - Efek: Saldo Kantong tujuan bertambah `amount`, tidak mengubah `units` maupun `cost_basis`, masuk metrik *Passive Income*.
4. **`PRICE_UPDATE` (Update Nilai Pasar)**:
   - Mengubah `current_unit_price` (atau langsung `current_value` untuk instrumen non-unit seperti Reksa Dana/Deposito).
   - **Desain Privasi**: Pada Fase 1, update nilai pasar dilakukan **manual 1-tap oleh user** sehingga klien tidak pernah mengirim daftar ticker yang dimiliki ke API harga publik. Pada Fase 2 (opsional *opt-in*), aplikasi bisa mengambil feed harga publik secara anonim tanpa mengaitkan `user_id` maupun jumlah unit.

#### C. Integrasi ke PULSE RPG Engine & Net Worth
Di [src/engine/pulseRpgEngine.ts](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/engine/pulseRpgEngine.ts):
- **Total Net Worth (Client-Side RAM Only)**:
  $$\text{Net Worth} = \sum \text{Saldo Kantong (included)} + \sum \text{Current Value Aset Investasi}$$
- **Pemisahan Shield vs Growth**:
  - **Emergency Shield**: Tetap dihitung dari kantong `SAVING` (dana likuid darurat).
  - **Investment Portfolio & Unrealized P&L**: Ditampilkan pada kartu portofolio tersendiri beserta persentase alokasi per kelas aset (*Asset Allocation*).
- **Quest & XP Investasi**:
  - Catat `BUY` (DCA) atau `DIVIDEND` → **+25 XP** (atau mengikuti aturan cap harian + Overdrive 1.5x).
  - Quest Mingguan/Bulanan baru: *"Investasi / DCA Minimal 1x Bulan Ini"* dan *"Diversifikasi ≥ 2 Kelas Aset"*.
  - Badge baru: **`💎 Diamond Hand`** (Hold / DCA 3 bulan berturut-turut) dan **`📈 Compound Architect`** (Total nilai investasi ≥ target).

---

## 4. Rencana Perubahan Skema Database & API Sync

### 4.1 SQLite Lokal (`veine_pulse_zk_v2.db` → Migrasi v3)
Di [src/db/database.ts](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/db/database.ts):
1. Tambah tabel metadata versi skema (`schema_migrations`) atau jalankan migrasi idempoten saat `getDb()` dibuka:
   - Membuat tabel baru `pockets`, `categories`, dan `investment_assets`.
   - Meng-upgrade `local_transactions` agar `CHECK(tx_type IN ('EXPENSE', 'INCOME', 'SAVING', 'TRANSFER', 'INVESTMENT'))` serta menambah kolom `updated_at` dan `deleted_at` (untuk mendukung edit/hapus yang tersinkron ke server).
   - Melakukan **auto-seed** kategori default dan kantong default *hanya jika* tabel `pockets`/`categories` masih kosong, serta me-mapping transaksi lama v2.0 secara non-destruktif (transaksi lama tetap terbaca utuh tanpa kehilangan data).

### 4.2 Update Kontrak Go/Gin Backend (`docs/BACKEND_GO_REFERENCE.md`)
Perluas endpoint `POST /api/v1/pulse/sync` dan `GET /api/v1/pulse/profile` di [src/api/pulseApi.ts](file:///Users/talangmas/Documents/kiokyky/private/veine-pulse/src/api/pulseApi.ts) serta skema PostgreSQL:
- Tambah tabel `pulse_pockets`, `pulse_categories`, dan `pulse_investment_assets` di PostgreSQL (semua menyimpan `encrypted_payload` bertipe `vp1:...`).
- Longgarkan constraint `pulse_transactions.tx_type` menjadi `('EXPENSE','INCOME','SAVING','TRANSFER','INVESTMENT')`.
- Payload `/api/v1/pulse/sync` mengirim delta `pending_pockets`, `pending_categories`, `pending_investment_assets` bersama `pending_transactions` dan `quests`, serta menerima perubahan terbaru dari **Go Cuan Web** berdasarkan `last_synced_at` (bi-directional sync).

---

## 5. Rancangan UI & Tata Letak Navigasi

Agar fitur Kantong, Kategori, dan Investasi mudah diakses tanpa membuat bottom bar penuh sesak, berikut dua opsi struktur tab:

### Opsi A — Tetap 4 Tab + FAB `[+ LOG]` (Direkomendasikan)
Memindahkan pengaturan Vault ke **ikon tombol `🔐 VAULT`** di pojok kanan atas HUD (seperti pola *Settings/Profile* pada umumnya), sehingga bottom tab fokus ke 4 aktivitas harian:
1. **`[01. HUD]`**: Kartu Karakter RPG, **Net Worth Summary**, Wallet HP & Shield, *Quick Pocket Strip* (scroll horizontal saldo kantong), Mini Portfolio Card, Active Quests, dan 3 Transaksi Terakhir. *(Pojok kanan atas: tombol `🔐 VAULT`)*
2. **`[02. CASHFLOW]`**: Segmented control di atas layar:
   - **`Ledger`**: Riwayat transaksi + filter Kantong/Kategori/Nature + toggle inspeksi ciphertext.
   - **`Kategori`**: Breakdown pengeluaran bulan ini per kategori + atur limit budget kategori + CRUD kategori.
   - **`Kantong`**: Grid/list semua kantong + tombol `+ Kantong` & `⇄ Transfer`.
3. **`[+ LOG]` (Center FAB)**: Tactical Numpad dengan mode `EXPENSE | INCOME | SAVING | TRANSFER | INVEST`, pilihan Kantong, dan grid Kategori dinamis (+ tambah kategori inline).
4. **`[03. INVEST]`**: Total Portofolio, Modal vs Nilai Pasar, Unrealized & Realized P&L, bar Alokasi Kelas Aset, daftar Aset (tap untuk *Beli / Jual / Update Harga / Catat Dividen*), dan riwayat transaksi investasi.
5. **`[04. QUESTS]`**: Month-End Boss, Daily/Weekly Quests (termasuk Quest Investasi & Budget Kategori), Saving Goals, dan Badges.

### Opsi B — Pertahankan 4 Tab Lama (`HUD`, `LEDGER`, `QUESTS`, `VAULT`)
Jika `04. VAULT` ingin tetap berada di bottom tab:
- `Kantong` & `Investasi` ditaruh sebagai **sub-tab di dalam `[01. HUD]`** atau **`[02. LEDGER]`** (mis. `LEDGER` punya sub-tab `Transaksi | Kategori | Kantong | Investasi`).
- Kelebihan: zero perubahan di `_layout.tsx`. Kekurangan: tab `LEDGER` menampung terlalu banyak sub-halaman sehingga akses ke Portofolio Investasi butuh ekstra tap.

---

## 6. Roadmap Implementasi Bertahap

1. **Tahap 1 — Fondasi Data, Crypto & Migrasi (`v2.0 → v2.1`)**
   - Perbarui `src/types/pulse.ts` (`PocketItem`, `CategoryItem`, `InvestmentAsset`, `TransactionType`).
   - Tambah migrasi SQLite v3 + seed default + CRUD terenkripsi di `src/db/database.ts`.
   - Tambah unit test di `tests/` untuk kalkulasi saldo kantong, weighted average harga beli investasi, P&L, dan migrasi data v2.0.
2. **Tahap 2 — Kantong, Kategori Dinamis & Upgrade Tactical Numpad**
   - Bangun UI kelola Kantong, modal Transfer Antar-Kantong, dan kelola Kategori + budget per kategori.
   - Upgrade `TacticalNumpadModal.tsx` (selector Kantong, Kategori dinamis, mode `TRANSFER`).
   - Tambah Category Breakdown & filter Kantong/Kategori di `ledger.tsx`.
3. **Tahap 3 — Modul Portofolio Investasi & Integrasi RPG**
   - Bangun layar Portofolio Investasi (daftar aset, Buy/Sell/Dividend/Update Price sheet, asset allocation bar).
   - Hubungkan Net Worth, Shield dari kantong `SAVING`, serta XP & Quest Investasi ke `pulseRpgEngine.ts`.
4. **Tahap 4 — Sinkronisasi Backend Go Cuan (`gocuan.veinestudio.my.id`)**
   - Perbarui `docs/BACKEND_GO_REFERENCE.md` dan `src/api/pulseApi.ts` untuk sync `pockets`, `categories`, `investment_assets`, serta pull sync dari Go Cuan Web.

