# Ringkasan Pendekatan & Keputusan Teknis

## 1. Arsitektur & Pilihan Stack

Dashboard dibangun sebagai **single-file, client-side application** (HTML + CSS + vanilla JavaScript, dengan Chart.js v4.4.4 disematkan inline) — tanpa framework, tanpa build step wajib, dan tanpa dependency eksternal apa pun saat runtime.

Pilihan ini didasarkan pada tiga pertimbangan utama sesuai konteks technical test:

- **Kemudahan demonstrasi & evaluasi.** Reviewer dapat langsung membuka `index.html` dengan double-click, tanpa perlu `npm install`, server, atau koneksi internet — menghilangkan friksi "it doesn't run on my machine".
- **Portabilitas.** Satu file HTML dapat dikirim via email/USB/chat dan tetap berfungsi identik di semua platform (Windows/macOS/Linux) dan semua browser modern, relevan untuk lingkungan lapangan migas yang sering memiliki akses internet terbatas.
- **Kecepatan iterasi untuk skala data teknis-test.** Untuk volume data demonstrasi (ribuan baris), pemrosesan di client cukup instan tanpa perlu backend/API — trade-off ini secara eksplisit dibahas sebagai batasan yang perlu diatasi untuk skala produksi pada dokumen [Poin Refleksi](reflection.md#3-enterprise-architecture--scalability).

## 2. Metodologi Deteksi Status (Rule-Based Threshold Engine)

Setiap baris data sensor diklasifikasikan melalui **rangkaian aturan ambang batas berprioritas** (dievaluasi berurutan, berhenti pada kecocokan pertama):

1. **Critical Anomaly** dicek **paling pertama** (prinsip *safety first*) — dipicu oleh SPP ≥ 3500 psi (indikasi kick/pack-off) atau lonjakan Torque ≥ 28 kft-lb bersamaan dengan WOB rendah (indikasi stuck pipe).
2. **Drilling** — kombinasi WOB, RPM, Torque, dan Flow di atas ambang aktif, **dan** posisi bit berada di kedalaman hole (selisih ≤ 3 ft) — membedakan "berputar & menembus formasi" dari "berputar di permukaan".
3. **Circulating** — flow aktif tanpa WOB/RPM signifikan (mud conditioning tanpa penetrasi).
4. **Tripping In/Out** — laju perubahan bit depth melampaui ambang (dinyatakan dalam **ft/jam**, bukan per-sampel, agar tetap valid pada interval logging berapa pun — lihat catatan implementasi di bawah), dengan flow & WOB rendah; arah (in/out) ditentukan dari tanda perubahan kedalaman.
5. **Idle/Standby** — status default ketika tidak ada kondisi di atas terpenuhi.

**Catatan implementasi penting:** interval sampling dataset diinferensikan otomatis dari median selisih timestamp antar baris (`inferIntervalHours`), bukan diasumsikan konstan. Ini memastikan perhitungan KPI (jam operasi, durasi status) dan threshold rate-based (Tripping) tetap akurat baik untuk dataset sample bawaan (interval 15 menit) maupun CSV yang diunggah pengguna dengan frekuensi logging berbeda (1 menit, 1 jam, dst).

Threshold dipilih berdasarkan rentang parameter operasi pemboran yang umum dan dikalibrasi terhadap pola dataset sample; pada implementasi produksi nilai ini sebaiknya dikonfigurasi per rig/formasi menggunakan data historis (lihat matriks lengkap di [README](../README.md#matriks-klasifikasi-status-rig)).

## 3. Optimisasi Performa

Karena seluruh rendering terjadi di client dan chart time-series dapat memuat ribuan titik data, beberapa teknik diterapkan agar UI tetap responsif:

- **Decimation berbasis stride** (`decimate()`) — grafik tren dibatasi maksimum 400 titik yang ditampilkan (memilih titik dengan interval tetap sambil selalu mempertahankan titik awal & akhir), menjaga waktu render Chart.js konstan terlepas dari ukuran dataset yang difilter.
- **Animasi dimatikan** (`animation: false`) pada seluruh konfigurasi chart, menghilangkan overhead re-paint saat data berubah akibat filter.
- **Reuse instance chart**, bukan destroy/recreate — saat filter berubah, chart yang sudah ada di-update via `chart.update("none")` (tanpa animasi transisi), jauh lebih murah dibanding membuat ulang instance Chart.js dan context canvas setiap kali.
- **Debounced re-render** (`debounce(fullRender, 120ms)`) pada seluruh kontrol filter (input tanggal, chip rig/parameter) — mencegah rendering berulang saat pengguna melakukan interaksi cepat berturut-turut (misalnya mengetik tanggal atau meng-klik beberapa chip secara cepat).
- **Normalisasi data pada satu sumbu Y** (0–100%) untuk chart tren gabungan multi-sensor — selain menghindari anti-pattern dual-axis, ini juga menyederhanakan kalkulasi skala per frame render dibanding mengelola beberapa skala sumbu secara paralel.
- **Timeline custom berbasis DOM** (bukan canvas/chart library) untuk swimlane status — pengelompokan status yang berdekatan (`groupConsecutive`) mengurangi jumlah elemen DOM yang perlu dirender secara signifikan dibanding merender satu elemen per baris data mentah.
