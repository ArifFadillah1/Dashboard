# Rig Operational Status Dashboard

Dashboard interaktif untuk mendeteksi dan memvisualisasikan **status operasional rig pemboran hulu migas** secara real-time berdasarkan data sensor pemboran (drilling parameters), menggunakan rule-based logic engine berbasis ambang batas (threshold).

Dibangun sebagai **single-file HTML** yang dapat dijalankan langsung di browser tanpa instalasi apa pun — cocok untuk demonstrasi cepat, evaluasi teknis, maupun distribusi ke pengguna non-teknis di lapangan.

> Dibuat sebagai bagian dari technical test posisi **Junior Performance Engineer** — Pertamina.

---

## Fitur Utama

- **Dataset sample realistis** — 3 rig sintetis (`RIG-01`, `RIG-02`, `RIG-03`), ±150 jam data per rig pada interval 15 menit, disimulasikan melalui siklus fase operasi (idle → trip in → drilling → circulating → drilling → trip out) dengan parameter sensor yang realistis per fase, termasuk 2 skenario anomali kritikal yang disisipkan (SPP spike & Torque spike).
- **Upload CSV kustom** — unggah data lapangan/simulasi Anda sendiri (lihat format kolom di bawah); interval sampling dideteksi otomatis dari timestamp sehingga tetap akurat pada frekuensi logging berapa pun (1 menit, 15 menit, 1 jam, dst).
- **Rule-based detection engine** — mengklasifikasikan setiap baris data ke dalam 5 status operasional (lihat [Matriks Klasifikasi](#matriks-klasifikasi-status-rig) di bawah).
- **Filter interaktif** — filter berdasarkan Rig ID (multi-select chip) dan rentang waktu (date range + preset 24 Jam/3 Hari/7 Hari/Semua).
- **Panel KPI** — Total Jam Operasi, Jumlah Rig Aktif, Efisiensi Operasional Armada (%), dan Downtime (jam Idle + Critical).
- **Grafik tren gabungan sensor** — WOB, RPM, Torque, SPP, Mud Flow, Bit/Hole Depth dalam satu chart (dinormalisasi 0–100% agar dapat dibandingkan tanpa dual-axis), dengan tooltip nilai asli.
- **Distribusi status (donut chart)** — proporsi jam operasi per status, dengan toggle ke tampilan tabel.
- **Timeline status per rig** — swimlane Gantt-style yang menunjukkan urutan status dari waktu ke waktu per rig, dengan tooltip interaktif.
- **Tabel Alert & Log anomali** — daftar seluruh kejadian *Critical Anomaly/High Pressure Warning*, lengkap dengan durasi, nilai peak SPP/Torque, minimum WOB, dan kemungkinan penyebab (kick/pack-off vs. stuck pipe), dapat diurutkan per kolom.
- **Dark mode** — otomatis mengikuti preferensi sistem, dengan toggle manual.
- **Export data sample** — unduh dataset sample sebagai CSV untuk keperluan pengujian format upload.

---

## Quick Start

**Tidak perlu instalasi apa pun.**

1. Clone atau unduh repository ini.
2. Klik dua kali (double-click) file [`index.html`](index.html) — akan terbuka langsung di browser default Anda.
3. Dashboard langsung menampilkan data sample sintetis. Gunakan filter Rig ID / rentang tanggal / preset untuk eksplorasi.

### Menggunakan data Anda sendiri

1. Klik **⬆️ Upload CSV** di header dan pilih file CSV Anda.
2. Format kolom yang diperlukan (nama header bersifat fleksibel — beberapa alias umum diterima, case-insensitive):

   | Kolom | Alias yang diterima | Satuan |
   |---|---|---|
   | Timestamp | `timestamp`, `time`, `datetime` | ISO 8601 / format yang dikenali `Date()` JS |
   | Rig ID | `rig id`, `rig_id`, `rig` | teks bebas |
   | Weight on Bit | `weight on bit`, `wob` | klbs |
   | RPM | `rpm` | rpm |
   | Torque | `torque` | kft-lb |
   | Standpipe Pressure | `standpipe pressure`, `spp` | psi |
   | Mud Flow Rate | `mud flow rate`, `flow` | gpm |
   | Bit Depth | `bit depth`, `bitdepth` | ft |
   | Hole Depth | `hole depth`, `holedepth` | ft |

3. Klik **⬇️ Unduh Contoh CSV** untuk mendapatkan contoh file dengan format yang benar.
4. Klik **↺ Reset ke Data Sample** kapan saja untuk kembali ke dataset sintetis bawaan.

---

## Matriks Klasifikasi Status Rig

Engine mengevaluasi setiap baris data **secara berurutan sesuai prioritas berikut** (baris pertama yang cocok akan menentukan status; keselamatan/anomali dicek lebih dulu):

| # | Status | Kondisi Pemicu (rule) | Interpretasi Operasional |
|---|---|---|---|
| 1 | **Critical Anomaly/High Pressure Warning** | `SPP ≥ 3500 psi` **ATAU** (`Torque ≥ 28 kft-lb` **DAN** `WOB < 2 klbs`) | Indikasi kick / pack-off (lonjakan SPP) atau stuck pipe (lonjakan torque saat WOB rendah) — butuh perhatian segera |
| 2 | **Drilling** | `WOB ≥ 2` **DAN** `RPM ≥ 20` **DAN** `Torque ≥ 3` **DAN** `Flow ≥ 200 gpm` **DAN** `|Bit Depth − Hole Depth| ≤ 3 ft` | Bit aktif memotong formasi di kedalaman baru |
| 3 | **Circulating** | `Flow ≥ 200 gpm` **DAN** `WOB < 2` **DAN** `RPM < 20` | Pompa lumpur aktif, tidak ada penetrasi (misal: kondisioning lumpur) |
| 4 | **Tripping In/Out** | Perubahan Bit Depth ≥ `32 ft/jam` (skala sesuai interval sampling) **DAN** `WOB < 2` **DAN** `Flow < 200 gpm` | Rangkaian pipa diturunkan (in) atau dinaikkan (out) dari sumur |
| 5 | **Idle/Standby** | *(default — tidak ada kondisi di atas yang terpenuhi)* | Rig tidak dalam aktivitas produktif (menunggu, maintenance, dll.) |

> Catatan: threshold ambang batas ditentukan berdasarkan rentang nilai umum pada operasi pemboran normal, dikalibrasikan agar sesuai dengan pola dataset sample sintetis pada dashboard ini. Pada implementasi produksi, nilai ini idealnya dikonfigurasi per rig/formasi berdasarkan data historis aktual. Matriks yang sama juga ditampilkan langsung di dalam aplikasi (bagian "Bagaimana engine menentukan status ini?" di kartu Timeline).

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
- Seluruh data pada dashboard ini (kecuali saat pengguna mengunggah CSV sendiri) adalah **data sample sintetis** untuk keperluan demonstrasi teknis, bukan data lapangan aktual PDSI/Pertamina.
