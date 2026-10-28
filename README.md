🇮🇩 Bahasa Indonesia (halaman ini) | 🇬🇧 [English](README.en.md)

# Rig Operational Status Dashboard

Dashboard interaktif untuk mendeteksi dan memvisualisasikan **status operasional rig pemboran hulu migas** dari data sensor pemboran (drilling parameters), menggunakan rule-based logic engine berbasis ambang batas (threshold).

Dibangun sebagai **single-file HTML** yang bisa langsung dibuka di browser tanpa instalasi apa pun.

---

## Cara Kerjanya (Ringkas)

Sensor rig mengirim angka setiap beberapa detik/menit — seberapa berat mata bor menekan, seberapa cepat berputar, tekanan di pipa, deras lumpur bor, dan kedalaman saat ini. **Dashboard ini membaca angka-angka itu dan menyimpulkan "rig sekarang lagi ngapain?"** secara otomatis, mengklasifikasikan setiap baris data ke salah satu dari 6 status:

| Ikon | Status | Artinya |
|---|---|---|
| 🔵 | **Drilling** | Mata bor aktif menembus formasi baru — kerja produktif utama |
| 🟢 | **Circulating** | Lumpur bor dipompa berputar untuk membersihkan lubang, belum menembus lapisan baru |
| 🟠 | **Tripping In/Out** | Rangkaian pipa ditarik naik/turun dari sumur (misal ganti mata bor) |
| 🟣 | **Connection** | Jeda singkat untuk menyambung/melepas pipa saat tripping |
| ⚪ | **Idle/Standby** | Tidak ada aktivitas — menunggu atau maintenance |
| 🔴 | **Critical Anomaly** | Tanda bahaya (tekanan/tahanan tidak wajar) — perlu dicek segera |

### Kemampuan saat ini

- **Klasifikasi status otomatis** per baris data, per rig, berbasis rule engine ambang batas (lihat matriks di bawah).
- **Panel KPI**: Total Jam Termonitor, Active Rig Count, Fleet Operational Efficiency (% waktu produktif), dan Downtime (Idle + Anomaly).
- **Grafik tren multi-sensor** (Chart.js) untuk satu rig fokus, dengan 11 parameter yang bisa di-toggle dan dinormalisasi 0–100% ke satu sumbu Y agar satuan berbeda tetap sebanding; otomatis di-*downsample* maksimum 400 titik.
- **Donut distribusi status** + legenda dan tabel jam/persentase yang bisa dibuka-tutup.
- **Timeline Gantt per rig** (DOM murni, tanpa chart library) dengan tooltip durasi; segmen dipecah bila ada lubang data.
- **Tabel alert anomali kritikal** yang bisa diurutkan per kolom dan difilter berdasarkan penyebab (SPP / Torque-Stuck Pipe), lengkap dengan peak SPP, peak Torque, dan min WOB per kejadian.
- **Filter** rig (chip multi-pilih), rentang tanggal, dan preset 1/3/7 hari atau semua data.
- **Upload CSV** milik Anda sendiri, **unduh contoh CSV**, dan reset kembali ke dataset bawaan.
- **Dwibahasa (ID/EN)** dengan pilihan bahasa tersimpan di `localStorage`, serta **tema terang/gelap**.

---

## Arsitektur & Proses Build

Aplikasi yang dikirim ke pengguna adalah **satu file `index.html` tanpa dependency apa pun** — tidak ada `package.json`, tidak ada `node_modules`, tidak ada panggilan jaringan, dan **tidak perlu build step untuk *menjalankan*-nya**.

File tunggal itu **bukan file yang diedit manual**, melainkan **artefak hasil generate**:

```
index.template.html            (markup + CSS + 3 marker <script>)
  ├── /*__CHARTJS_INLINE__*/  ← assets/vendor/chart.umd.min.js
  ├── /*__ENGINE_JS__*/       ← assets/engine.js
  └── /*__APP_JS__*/          ← assets/app.src.js
                                   └── __SAMPLE_CSV__ ← assets/sample-data.csv
                        │
                        ▼  python3 scripts/build.py
                   index.html   (artefak, jangan diedit manual)
```

`scripts/build.py` menyalin isi tiap file sumber ke posisi marker-nya di `index.template.html` (CSV disisipkan lebih dulu ke dalam `app.src.js`), lalu menulis hasilnya ke `index.html`.

> ⚠️ **Jangan pernah mengedit `index.html` secara manual.** Setiap perubahan pada `index.template.html` atau file di `assets/` **wajib** diikuti dengan menjalankan ulang `python3 scripts/build.py`, jika tidak `index.html` akan basi (stale) dan perubahan Anda hilang pada build berikutnya.

Pemisahan kode murni (`assets/engine.js`) dari kode UI (`assets/app.src.js`) membuat logika klasifikasi dan parsing CSV tetap dapat dibaca, di-*diff*, dan dipakai ulang di luar browser (lihat [API Publik](#api-publik-assetsenginejs)).

---

## Dataset

Dataset bawaan (default) adalah **data telemetri riil** (`assets/sample-data.csv`, 7.330 baris data), bukan data sintetis. Karena file sumber mencatat pembacaan setiap ~1,5–2 detik (30–50 baris/menit) namun timestamp hanya presisi menit, engine me-resample data ke **1 baris per menit** — mengambil pembacaan terakhir dalam menit tersebut sebagai representasi (asumsi: urutan baris dalam satu menit mencerminkan urutan kedatangan data). Identitas rig tidak ada pada file sumber, sehingga ditampilkan sebagai satu label generik ("Rig (Data Riil)").

Anda bisa mengunggah CSV Anda sendiri — lihat format di bawah.

> **Batasan teknis `assets/sample-data.csv`:** isi file ini disisipkan ke dalam sebuah *template literal* JavaScript saat build, sehingga **tidak boleh mengandung karakter backtick (`` ` ``), urutan `${`, maupun backslash (`\`)**. `scripts/build.py` memeriksa ketiganya dengan `assert` dan akan gagal (bukan menghasilkan file rusak) bila ditemukan.

---

## Quick Start

**Tidak perlu instalasi apa pun.**

1. Clone atau unduh repository ini.
2. Buka file [`index.html`](index.html) di browser (cukup double-click).
3. Dashboard langsung menampilkan dataset riil bawaan. Gunakan filter tanggal/preset untuk eksplorasi.

### Rebuild (hanya untuk pengembangan)

Diperlukan `python3` (tanpa dependency pihak ketiga):

```bash
python3 scripts/build.py           # regenerasi index.html dari template + assets
python3 scripts/build.py --check   # verifikasi index.html tidak basi; exit code 1 + pesan "STALE" bila basi
```

`--check` tidak menulis apa pun — cocok untuk pre-commit hook: jalankan setelah mengubah `index.template.html`, `assets/engine.js`, `assets/app.src.js`, `assets/sample-data.csv`, atau `assets/vendor/chart.umd.min.js`.

### Menggunakan data Anda sendiri

1. Klik **⬆️ Upload CSV** di header dan pilih file CSV Anda.
2. Baris pertama harus berupa header. Pencocokan nama kolom bersifat *case-insensitive*, dan suffix satuan dalam kurung atau tanda `%` diabaikan otomatis (`Bit Depth (ftMD)` → `bit depth`).

   Kolom yang **wajib** ada:

   | Kolom | Alias yang diterima | Satuan |
   |---|---|---|
   | Timestamp | `date time server`, `timestamp`, `time`, `datetime`, `date time` | format apa pun yang dikenali `Date()` JS |
   | Weight on Bit | `wob`, `weight on bit` | klbs |
   | RPM | `surface rpm`, `rpm` | rpm |
   | Torque | `rotary torque`, `torque` | kft-lb |
   | Standpipe Pressure | `standpipe pressure`, `spp` | psi |
   | Mud Flow In | `mud flow in`, `mud flow rate`, `flow`, `mudflow` | gpm |
   | Bit Depth | `bit depth`, `bitdepth` | ft |
   | Hole Depth | `hole depth`, `holedepth` | ft |

   Kolom **opsional** (default `0`, atau nama file untuk rig, bila tidak ada — tidak akan menggagalkan upload):

   | Kolom | Alias yang diterima | Satuan |
   |---|---|---|
   | Rig ID | `rig id`, `rig_id`, `rigid`, `rig` | teks |
   | Block Position | `block position`, `bpos` | ft |
   | Hookload | `hookload`, `hkla` | klbs |
   | Mud Flow Out | `mud flow out`, `mfop` | % |
   | ROP | `rop` | ft/h |

   Tanpa kolom `hookload`, status **Connection** tidak akan pernah terdeteksi (fallback aman ke Idle/Standby). Bila kolom `rig id` tidak ada, seluruh baris diberi label dari nama file yang diunggah.
3. Baris yang timestamp-nya tidak valid akan **dilewati** (jumlahnya dilaporkan pada banner setelah upload), bukan menggagalkan seluruh file.
4. Urutan kolom bebas — pencocokan dilakukan berdasarkan nama header, bukan posisi.

Header persis yang dipakai dataset bawaan (dan yang dihasilkan tombol **⬇️ Unduh Contoh CSV**) adalah:

```csv
Date time server,Bit Depth (ftMD),Hole Depth (ftMD),Block Position (ft),ROP (ft/h),Hookload (klb),WOB (klb),Rotary Torque (kft-lb),Surface RPM,Standpipe Pressure (psi),Mud Flow Out %,Mud Flow In (gpm)
2026-09-09T03:00:00,526.42,794.79,65.79,2.7,21.32,0,0,0,0,0,0
```

---

## Matriks Klasifikasi Status Rig

Engine mengevaluasi setiap baris **secara berurutan sesuai prioritas** (baris pertama yang cocok menentukan status; keselamatan dicek lebih dulu). Nilai ambang batas di bawah adalah nilai sebenarnya pada konstanta `THRESH` di `assets/engine.js`:

| # | Status | Kondisi Pemicu | Interpretasi |
|---|---|---|---|
| 1 | **Critical Anomaly/High Pressure Warning** | `SPP ≥ 3500 psi` **ATAU** (`Torque ≥ 3000 kft-lb` **DAN** `WOB < 2 klbs`) | Indikasi kick/pack-off atau stuck pipe |
| 2 | **Drilling** | `WOB ≥ 2` **DAN** `RPM ≥ 20` **DAN** `Torque ≥ 150` **DAN** `Flow ≥ 200 gpm` **DAN** `|Bit Depth − Hole Depth| ≤ 3 ft` | Bit aktif menembus formasi di kedalaman baru |
| 3 | **Circulating** | `Flow ≥ 200 gpm` **DAN** `WOB < 2` **DAN** `RPM < 20` | Pompa aktif tanpa penetrasi |
| 4 | **Tripping In/Out** | `|ΔBit Depth| ≥ 32 ft/jam × interval sampling` **DAN** `WOB < 2` **DAN** `Flow < 200 gpm` | Pipa diturunkan/dinaikkan dari sumur (arah `in`/`out` dari tanda Δ) |
| 5 | **Connection** | Bukan Tripping, **DAN** `WOB < 2` **DAN** `Flow < 200` **DAN** perubahan Hookload antar sampel ≥ `5 klbs` | Jeda menyambung/melepas pipa |
| 6 | **Idle/Standby** | *(default)* | Tidak ada aktivitas produktif |

Konstanta lengkap (`RigEngine.THRESH`):

| Konstanta | Nilai | Satuan | Peran |
|---|---|---|---|
| `WOB_ON` | 2 | klbs | Batas minimum WOB yang dianggap kontak bit/formasi |
| `RPM_ON` | 20 | rpm | Batas minimum putaran yang dianggap "berputar" |
| `TORQUE_ON` | 150 | kft-lb | Batas minimum torque yang dianggap "terbebani" |
| `FLOW_ON` | 200 | gpm | Batas minimum flow yang dianggap "pompa menyala" |
| `SPP_CRITICAL` | 3500 | psi | Ambang kritikal standpipe pressure |
| `TORQUE_CRITICAL` | 3000 | kft-lb | Ambang kritikal torque (bersamaan WOB rendah) |
| `DEPTH_EPS` | 3 | ft | Toleransi "bit di dasar lubang" |
| `TRIP_MIN_RATE_FT_PER_HR` | 32 | ft/jam | Laju minimum gerak bit depth untuk disebut tripping |
| `CONNECTION_HKLD_DELTA` | 5 | klbs | Ayunan hookload minimum antar sampel untuk disebut connection |

Ambang Tripping dinyatakan sebagai **laju (ft/jam)**, lalu dikalikan interval sampling yang diinferensikan dari data (`inferIntervalHours`) — sehingga tetap valid untuk CSV dengan frekuensi logging berapa pun.

> **Catatan kalibrasi Torque:** header sumber data menyatakan satuan kft-lb, namun rentang nilainya (p50=0, p90≈1690, p99≈4380 pada data mentah) lebih konsisten dengan skala ft-lb saat dibandingkan dengan narasi Daily Drilling Report ("Torque ON/OFF Bottom = 1000/800 ft-lb"). Threshold `TORQUE_ON`/`TORQUE_CRITICAL` di atas dikalibrasikan terhadap skala nilai riil ini (bukan terhadap label satuan), dan didokumentasikan sebagai asumsi eksplisit — bukan konversi satuan yang terverifikasi. Ambang batas lain dipilih dari rentang persentil data riil dan tetap dapat dikonfigurasi ulang per rig/formasi. Matriks yang sama juga ditampilkan di dalam aplikasi (kartu Timeline → "Bagaimana engine menentukan status ini?").

---

## API Publik `assets/engine.js`

`assets/engine.js` adalah modul murni (tanpa DOM, tanpa state UI). Di Node ia diekspor lewat `module.exports`; di browser ia dipasang sebagai global **`RigEngine`**.

**Bentuk baris data** yang dipakai seluruh fungsi di bawah:
`{ ts: Date, rig: string, wob, rpm, torque, spp, flow, bitDepth, holeDepth, blockPosition, hookload, flowOutPct, rop: number }` — setelah klasifikasi, tiap baris juga memperoleh `status` (dan `reason`/`direction` bila ada).

### Impor/ekspor CSV

#### `parseCsv(text, defaultRig)`
- **Tujuan:** pipeline lengkap dari teks CSV mentah menjadi baris data yang sudah terklasifikasi — parsing header + baris, resampling ke 1 baris/menit, pengurutan kronologis, inferensi interval, lalu klasifikasi status.
- **Parameter:** `text` (string isi CSV), `defaultRig` (string label rig yang dipakai bila kolom rig tidak ada/kosong).
- **Return:** array baris data yang sudah terurut dan terklasifikasi, dengan properti tambahan `rows.skippedRows` (jumlah baris yang dibuang karena timestamp tidak valid).
- **Efek samping:** memodifikasi objek baris yang dibuatnya (menulis `status`, `reason`, `direction`, serta membulatkan `ts` ke menit).
- **Error:** melempar `Error` yang membawa properti `i18n = { id, en }` berisi pesan dwibahasa, untuk tiga kondisi: file kosong/tanpa baris data, kolom wajib tidak ditemukan, dan tidak ada baris data valid.

#### `serializeCsv(rows)`
- **Tujuan:** mengubah array baris kembali menjadi teks CSV memakai urutan kolom `CSV_HEADERS` (dipakai tombol "Unduh Contoh CSV").
- **Parameter:** `rows` (array baris data).
- **Return:** string CSV (timestamp dalam format ISO, nilai numerik dibulatkan per kolom).
- **Efek samping / error:** tidak ada.

#### `parseCsvLine(line)`
- **Tujuan:** memecah satu baris CSV, menghormati tanda kutip ganda dan escape `""`.
- **Parameter:** `line` (string).
- **Return:** array string yang sudah di-`trim()`.
- **Efek samping / error:** tidak ada.

#### `normalizeHeader(h)`
- **Tujuan:** menormalkan nama header agar cocok dengan tabel alias (huruf kecil, buang `(...)` dan `%`, rapikan spasi).
- **Parameter:** `h` (string header).
- **Return:** string ternormalisasi.
- **Efek samping / error:** tidak ada.

#### `bucketToMinute(rows)`
- **Tujuan:** resampling ke satu baris per (rig, menit) dengan mempertahankan pembacaan **terakhir** pada menit tersebut.
- **Parameter:** `rows` (array baris data).
- **Return:** array baris hasil resampling (urutan belum dijamin kronologis).
- **Efek samping:** memodifikasi `r.ts` menjadi awal menit.
- **Error:** tidak ada.

### Engine deteksi

#### `classify(curr, prev, intervalHours)`
- **Tujuan:** menentukan status satu baris data menurut matriks prioritas di atas.
- **Parameter:** `curr` (baris saat ini), `prev` (baris sebelumnya pada rig yang sama, boleh `null`), `intervalHours` (interval sampling dalam jam).
- **Return:** `{ status }`, ditambah `reason` (`"spp"` atau `"torque"`) untuk Critical Anomaly, atau `direction` (`"in"`/`"out"`) untuk Tripping.
- **Efek samping / error:** tidak ada (fungsi murni).

#### `classifySeries(rows, intervalHours)`
- **Tujuan:** menjalankan `classify` pada seluruh baris, dikelompokkan dan diurutkan per rig agar `prev` selalu merupakan sampel sebelumnya pada rig yang sama.
- **Parameter:** `rows` (array baris), `intervalHours` (number).
- **Return:** array `rows` yang sama (bukan salinan).
- **Efek samping:** **memodifikasi baris di tempat** — menulis `status`, `direction`, `reason`, serta mengurutkan baris tiap rig berdasarkan `ts`.
- **Error:** tidak ada.

#### `inferIntervalHours(rows)`
- **Tujuan:** menginferensikan interval sampling dominan dari median selisih timestamp antar baris pada rig yang sama.
- **Parameter:** `rows` (array baris).
- **Return:** number (jam); `1` bila selisih tidak dapat dihitung.
- **Efek samping / error:** tidak ada.

### Utilitas

#### `parseInputDate(value)`
- **Tujuan:** mem-parse nilai `<input type="date">` (`"YYYY-MM-DD"`) sebagai **tengah malam waktu lokal**, menghindari pergeseran zona waktu dari `new Date("YYYY-MM-DD")` yang di-parse sebagai UTC.
- **Parameter:** `value` (string `"YYYY-MM-DD"`). **Return:** `Date`. **Efek samping / error:** tidak ada.

#### `decimate(rows, maxPoints)`
- **Tujuan:** penjarangan berbasis stride agar jumlah titik chart tetap terbatas, sambil mempertahankan titik pertama & terakhir.
- **Parameter:** `rows` (array), `maxPoints` (number). **Return:** `{ rows, step }` (`step = 1` bila tidak dijarangkan). **Efek samping / error:** tidak ada.

#### `tsExtent(rows)`
- **Tujuan:** mencari timestamp minimum & maksimum dalam satu lintasan (menghindari stack overflow `Math.min(...arr)` pada dataset besar).
- **Parameter:** `rows` (array). **Return:** `{ min, max }` dalam epoch milidetik (`Infinity`/`-Infinity` bila array kosong). **Efek samping / error:** tidak ada.

#### `groupConsecutive(rows, keyFn, maxGapMs)`
- **Tujuan:** menggabungkan baris berurutan yang memiliki kunci sama menjadi segmen — dipakai timeline status dan tabel log anomali.
- **Parameter:** `rows` (array terurut per rig), `keyFn` (fungsi `row -> key`), `maxGapMs` (opsional; segmen baru dimulai bila jeda waktu melebihi nilai ini, `null`/tidak diisi = tanpa pemecahan).
- **Return:** array segmen `{ key, rig, start, end, rows }`. **Efek samping / error:** tidak ada.

### Konstanta yang diekspor

| Nama | Isi |
|---|---|
| `THRESH` | Seluruh ambang batas rule engine (tabel di atas) |
| `STATUS_LIST` | Keenam nama status, dalam urutan tampilan |
| `CSV_HEADERS` | 12 nama kolom yang dipakai `serializeCsv` |
| `HEADER_ALIASES` | Alias header untuk kolom wajib |
| `OPTIONAL_HEADER_ALIASES` | Alias header untuk kolom opsional |

---

## Struktur Direktori Proyek

```
rig-status-dashboard/
├── index.html                 # ⭐ FILE UTAMA — buka di browser. ARTEFAK HASIL GENERATE, jangan diedit manual
├── index.template.html        # Template sumber HTML/CSS + marker penyisipan skrip
├── assets/
│   ├── engine.js              # Engine murni: klasifikasi status + parsing/serialisasi CSV + utilitas
│   ├── app.src.js             # Sumber JavaScript UI aplikasi (chart, timeline, KPI, filter, i18n)
│   ├── sample-data.csv        # Dataset sampel telemetri riil (di-inline ke index.html saat build)
│   └── vendor/
│       └── chart.umd.min.js   # Chart.js v4.4.4 (MIT License) — disematkan inline agar dashboard 100% offline
├── scripts/
│   └── build.py               # Script build: template + Chart.js + engine + app + sample CSV → index.html
├── docs/
│   ├── technical-summary.md   # Ringkasan pendekatan & keputusan teknis
│   └── reflection.md          # Poin refleksi pengembangan lanjutan
├── README.md                  # Dokumentasi (Bahasa Indonesia — halaman ini)
└── README.en.md               # Dokumentasi (English)
```

**Untuk pengguna akhir:** cukup gunakan `index.html` — semua kode (CSS, Chart.js, logika aplikasi, dan dataset sampel) sudah tergabung di dalamnya, tidak ada dependency eksternal maupun panggilan jaringan.

**Untuk pengembangan lanjutan:** edit `index.template.html` (markup/style), `assets/engine.js` (logika klasifikasi/CSV), atau `assets/app.src.js` (logika UI), lalu jalankan `python3 scripts/build.py`. Build ini hanya diperlukan untuk **meregenerasi** `index.html`, bukan untuk *menjalankan* dashboard.

---

## Dependencies

- **[Chart.js](https://www.chartjs.org/) v4.4.4** (MIT License) — satu-satunya dependency pihak ketiga, di-*vendor* sebagai `assets/vendor/chart.umd.min.js` dan disematkan inline ke `index.html`. Dipakai untuk grafik tren garis dan donut distribusi status. Karena disematkan, dashboard berjalan sepenuhnya offline tanpa CDN.
- **Timeline Gantt dibuat dengan DOM biasa**, bukan chart library.
- **Build-time:** hanya `python3` dari standard library (`argparse`, `pathlib`, `sys`). Tidak ada `package.json`, `node_modules`, maupun package manager.

---

## Batasan yang Diketahui

- **Hanya data historis.** Dashboard memuat data sekali (dataset bawaan atau upload) lalu memfilternya; tidak ada streaming real-time.
- **Seluruh pemrosesan di memori browser.** Dataset sangat besar dibatasi oleh memori tab; chart dijarangkan ke 400 titik, namun parsing & klasifikasi tetap menyentuh seluruh baris.
- **Resampling 1 baris/menit menghilangkan variansi intra-menit** — sinyal yang dibutuhkan untuk deteksi stick-slip dari torque tidak lagi tersedia.
- **Threshold bersifat global dan statis**, dikalibrasi terhadap satu dataset riil; rig/formasi berbeda kemungkinan memerlukan kalibrasi ulang (lihat catatan kalibrasi Torque di atas).
- **Status Connection bergantung pada kolom Hookload**; tanpa kolom tersebut status ini tidak pernah muncul.
- **Identitas rig** tidak ada pada data sumber; CSV tanpa kolom rig diperlakukan sebagai satu rig dengan label dari nama file.
- **Parsing timestamp mengandalkan `Date()` JavaScript** sehingga bergantung pada zona waktu lokal browser, dan format yang tidak dikenali menyebabkan baris dilewati.
- **Tidak ada persistensi**: hanya preferensi bahasa yang disimpan di `localStorage`; data upload hilang saat halaman dimuat ulang.
- **Di luar cakupan (stretch, belum diimplementasikan):** deteksi stick-slip dari variansi torque intra-menit, overlay batas historis dari `offset_wells_master.csv`, dan korelasi dengan narasi `daily_drilling_reports.csv`. Lihat [docs/reflection.md](docs/reflection.md) untuk rencana pengembangan lanjutan.

---

## Lisensi & Atribusi

- Chart rendering menggunakan [Chart.js](https://www.chartjs.org/) v4.4.4 (MIT License), disematkan langsung di dalam `index.html`.
- Dataset bawaan adalah data telemetri riil, di-resample ke interval 1 menit untuk keperluan demonstrasi.
