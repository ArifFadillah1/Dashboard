# Rig Operational Status Dashboard

Dashboard interaktif untuk mendeteksi dan memvisualisasikan **status operasional rig pemboran hulu migas** dari data sensor pemboran (drilling parameters), menggunakan rule-based logic engine berbasis ambang batas (threshold).

Dibangun sebagai **single-file HTML** yang bisa langsung dibuka di browser tanpa instalasi apa pun.

> Dibuat sebagai bagian dari technical test posisi **Junior Performance Engineer** — Pertamina.

---

## Cara Kerjanya (Ringkas)

Sensor rig mengirim angka setiap beberapa menit — seberapa berat mata bor menekan, seberapa cepat berputar, tekanan di pipa, deras lumpur bor, dan kedalaman saat ini. **Dashboard ini membaca angka-angka itu dan menyimpulkan "rig sekarang lagi ngapain?"** secara otomatis, mengklasifikasikan setiap menit data ke salah satu dari 6 status:

| Ikon | Status | Artinya |
|---|---|---|
| 🔵 | **Drilling** | Mata bor aktif menembus formasi baru — kerja produktif utama |
| 🟢 | **Circulating** | Lumpur bor dipompa berputar untuk membersihkan lubang, belum menembus lapisan baru |
| 🟠 | **Tripping In/Out** | Rangkaian pipa ditarik naik/turun dari sumur (misal ganti mata bor) |
| 🟣 | **Connection** | Jeda singkat untuk menyambung/melepas pipa saat tripping |
| ⚪ | **Idle/Standby** | Tidak ada aktivitas — menunggu atau maintenance |
| 🔴 | **Critical Anomaly** | Tanda bahaya (tekanan/tahanan tidak wajar) — perlu dicek segera |

Dashboard menampilkan ini sebagai grafik tren, timeline Gantt per status, KPI ringkas (jam produktif vs downtime), dan tabel alert — supaya kondisi rig bisa dipahami sekali lihat tanpa membaca data sensor mentah satu per satu.

---

## Dataset

Dataset bawaan (default) adalah **data telemetri riil** dari case-study data pack yang diberikan untuk technical test ini (`realtime_rig_telemetry.csv`), bukan data sintetis. Karena file sumber mencatat pembacaan setiap ~1,5–2 detik (30–50 baris/menit) namun timestamp hanya presisi menit, dashboard me-resample data ke **1 baris per menit** — mengambil pembacaan terakhir dalam menit tersebut sebagai representasi (asumsi: urutan baris dalam satu menit mencerminkan urutan kedatangan data). Identitas rig tidak ada pada file sumber, sehingga ditampilkan sebagai satu label generik.

Anda bisa mengunggah CSV Anda sendiri — lihat format di bawah.

---

## Quick Start

**Tidak perlu instalasi apa pun.**

1. Clone atau unduh repository ini.
2. Buka file [`index.html`](index.html) di browser.
3. Dashboard langsung menampilkan dataset riil bawaan. Gunakan filter tanggal/preset untuk eksplorasi.

### Menggunakan data Anda sendiri

1. Klik **⬆️ Upload CSV** di header dan pilih file CSV Anda.
2. Kolom yang **wajib** ada (nama header fleksibel — alias umum diterima, suffix satuan dalam kurung/`%` diabaikan otomatis):

   | Kolom | Alias yang diterima | Satuan |
   |---|---|---|
   | Timestamp | `date time server`, `timestamp`, `time`, `datetime` | format yang dikenali `Date()` JS |
   | Weight on Bit | `wob`, `weight on bit` | klbs |
   | RPM | `surface rpm`, `rpm` | rpm |
   | Torque | `rotary torque`, `torque` | kft-lb |
   | Standpipe Pressure | `standpipe pressure`, `spp` | psi |
   | Mud Flow In | `mud flow in`, `mud flow rate`, `flow` | gpm |
   | Bit Depth | `bit depth`, `bitdepth` | ft |
   | Hole Depth | `hole depth`, `holedepth` | ft |

   Kolom **opsional** (default 0 jika tidak ada, tidak akan menggagalkan upload): `rig id`, `block position`/`bpos`, `hookload`/`hkla`, `mud flow out`/`mfop`, `rop`. Tanpa `hookload`, status **Connection** tidak akan pernah terdeteksi (fallback aman ke Idle).
3. Klik **⬇️ Unduh Contoh CSV** untuk melihat contoh file dengan format yang benar.
4. Klik **↺ Reset ke Data Sample** kapan saja untuk kembali ke dataset riil bawaan.

---

## Matriks Klasifikasi Status Rig

Engine mengevaluasi setiap baris **secara berurutan sesuai prioritas** (baris pertama yang cocok menentukan status; keselamatan dicek lebih dulu):

| # | Status | Kondisi Pemicu | Interpretasi |
|---|---|---|---|
| 1 | **Critical Anomaly/High Pressure Warning** | `SPP ≥ 3500 psi` **ATAU** (`Torque ≥ 3000 kft-lb` **DAN** `WOB < 2 klbs`) | Indikasi kick/pack-off atau stuck pipe |
| 2 | **Drilling** | `WOB ≥ 2` **DAN** `RPM ≥ 20` **DAN** `Torque ≥ 150` **DAN** `Flow ≥ 200 gpm` **DAN** `|Bit Depth − Hole Depth| ≤ 3 ft` | Bit aktif menembus formasi di kedalaman baru |
| 3 | **Circulating** | `Flow ≥ 200 gpm` **DAN** `WOB < 2` **DAN** `RPM < 20` | Pompa aktif tanpa penetrasi |
| 4 | **Tripping In/Out** | Laju perubahan Bit Depth ≥ `32 ft/jam` **DAN** `WOB < 2` **DAN** `Flow < 200 gpm` | Pipa diturunkan/dinaikkan dari sumur |
| 5 | **Connection** | Bukan Tripping, **DAN** `WOB < 2` **DAN** `Flow < 200` **DAN** perubahan Hookload antar sampel ≥ `5 klbs` | Jeda menyambung/melepas pipa |
| 6 | **Idle/Standby** | *(default)* | Tidak ada aktivitas produktif |

> **Catatan kalibrasi Torque:** header sumber data menyatakan satuan kft-lb, namun rentang nilainya (p50=0, p90≈1690, p99≈4380 pada data mentah) lebih konsisten dengan skala ft-lb saat dibandingkan dengan narasi Daily Drilling Report ("Torque ON/OFF Bottom = 1000/800 ft-lb"). Threshold `TORQUE_ON`/`TORQUE_CRITICAL` di atas dikalibrasikan terhadap skala nilai riil ini (bukan terhadap label satuan), dan didokumentasikan sebagai asumsi eksplisit — bukan konversi satuan yang terverifikasi. Ambang batas lain dipilih dari rentang persentil data riil dan tetap dapat dikonfigurasi ulang per rig/formasi. Matriks yang sama juga ditampilkan di dalam aplikasi (kartu Timeline → "Bagaimana engine menentukan status ini?").

**Di luar cakupan (stretch, belum diimplementasikan):** deteksi stick-slip dari variansi torque intra-menit (variansi ini hilang saat resampling ke 1 menit/baris), overlay batas historis dari `offset_wells_master.csv`, dan korelasi dengan narasi `daily_drilling_reports.csv`. Lihat [docs/reflection.md](docs/reflection.md) untuk rencana pengembangan lanjutan.

---

## Struktur Direktori Proyek

```
rig-status-dashboard/
├── index.html                 # ⭐ DELIVERABLE UTAMA — buka file ini di browser, tanpa instalasi
├── index.template.html        # Template sumber HTML/CSS + 2 placeholder skrip (untuk maintainability)
├── assets/
│   ├── app.src.js             # Sumber JavaScript aplikasi (readable, di-inline ke index.html saat build)
│   └── vendor/
│       └── chart.umd.min.js   # Chart.js v4.4.4 (MIT License) — disematkan inline agar dashboard 100% offline
├── scripts/
│   └── build.py                # Script build: menggabungkan template + app.src.js + chart.umd.min.js → index.html
├── docs/
│   ├── technical-summary.md   # Ringkasan pendekatan & keputusan teknis (deliverable #3)
│   └── reflection.md          # 3 poin refleksi pengembangan lanjutan (deliverable #4)
└── README.md
```

**Untuk pengguna akhir:** cukup gunakan `index.html` — semua kode (CSS, Chart.js, dan logika aplikasi) sudah tergabung di dalamnya, tidak ada dependency eksternal maupun panggilan jaringan.

**Untuk pengembangan lanjutan:** edit `index.template.html` (markup/style) atau `assets/app.src.js` (logika aplikasi), lalu jalankan:

```bash
python3 scripts/build.py
```

untuk meregenerasi `index.html`. Build ini murni bersifat opsional/developer-convenience — tidak diperlukan untuk *menjalankan* dashboard.

---

## Lisensi & Atribusi

- Chart rendering menggunakan [Chart.js](https://www.chartjs.org/) v4.4.4 (MIT License), disematkan langsung di dalam `index.html`.
- Dataset bawaan adalah data telemetri riil dari case-study data pack yang diberikan untuk technical test ini, di-resample ke interval 1 menit untuk keperluan demonstrasi.
