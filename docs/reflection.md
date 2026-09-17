# Poin Refleksi: "Jika Diberi Satu Minggu Lagi"

Dashboard saat ini adalah demonstrasi teknis yang berfokus pada logika deteksi status dan visualisasi data historis dalam bentuk single-file, client-side. Untuk membawa solusi ini ke tingkat kematangan produksi di lingkungan operasi hulu migas aktual, tiga area pengembangan berikut menjadi prioritas berikutnya:

## 1. Real-Time Data Streaming & IoT Integration

Dashboard saat ini bekerja dengan data historis statis (upload CSV atau dataset sample). Pada operasi aktual, data sensor rig (WOB, RPM, Torque, SPP, dll.) dihasilkan secara kontinu oleh peralatan **WITSML/Rigsense/Pason** atau sensor IoT di lapangan.

**Rencana pengembangan:** mengintegrasikan **koneksi WebSocket atau protokol MQTT** (standar untuk telemetri IoT industri, ringan dan efisien untuk koneksi lapangan dengan bandwidth terbatas) sebagai lapisan streaming data real-time, menggantikan model "load sekali lalu filter" dengan model **event-driven update** — dashboard menerima dan mengklasifikasikan setiap sampel baru saat data tiba, dengan chart dan status timeline yang ter-update secara live. Ini juga membuka kemungkinan **alert push notification** (misalnya via browser notification atau integrasi ke Slack/WhatsApp) saat status *Critical Anomaly* terdeteksi, alih-alih pengguna harus membuka dashboard dan memfilter data secara manual.

## 2. Machine Learning Anomaly Detection

Engine deteksi status saat ini bersifat **rule-based/threshold** — transparan dan mudah diverifikasi, namun memiliki keterbatasan: hanya dapat mendeteksi pola anomali yang sudah diketahui dan didefinisikan ambang batasnya secara eksplisit, serta rawan terhadap false positive/negative ketika kondisi operasi normal rig bervariasi (misalnya karakteristik formasi atau spesifikasi rig yang berbeda-beda).

**Rencana pengembangan:** melengkapi (bukan menggantikan) rule-based engine dengan **model unsupervised learning** — seperti *Isolation Forest*, *Autoencoder*, atau *DBSCAN* pada representasi multivariat dari parameter sensor — yang dilatih pada data historis operasi normal per rig untuk mempelajari "profil normal"-nya sendiri. Model ini dapat mendeteksi **anomali dini/gradual** yang belum melewati threshold absolut manapun tetapi sudah menunjukkan deviasi signifikan dari pola biasanya (misalnya tren SPP yang naik perlahan menuju kondisi pack-off, bukan lonjakan tiba-tiba) — memberikan **early-warning** sebelum kondisi benar-benar kritikal. Pendekatan hybrid ini (rule-based untuk kasus yang sudah dipahami + ML untuk deteksi dini/kasus baru) umum digunakan dalam predictive maintenance industri migas.

## 3. Enterprise Architecture & Scalability

Arsitektur client-side single-file saat ini optimal untuk demonstrasi dan portabilitas, namun tidak dirancang untuk skala operasi multi-rig, multi-tahun, dan multi-pengguna pada lingkungan enterprise.

**Rencana pengembangan:**
- **Backend time-series database** — memindahkan penyimpanan data dari in-memory JavaScript ke database time-series purpose-built (misalnya **TimescaleDB**, **InfluxDB**, atau **Apache Druid**), yang dioptimalkan untuk write throughput tinggi dari ratusan sensor per rig secara kontinu, serta query agregasi time-window (misalnya KPI bulanan per rig) pada skala data bertahun-tahun tanpa degradasi performa.
- **Layanan API terpusat** — dashboard menjadi thin client yang mengonsumsi REST/GraphQL API dari backend, memungkinkan multi-rig fleet management lintas lokasi/region dikelola dari satu sumber data konsisten.
- **Integrasi keamanan terpusat** — autentikasi & otorisasi melalui **SSO/LDAP/OAuth2** perusahaan (misalnya integrasi dengan sistem identity management Pertamina), role-based access control (RBAC) per rig/region sesuai struktur organisasi, serta audit trail untuk setiap akses/perubahan data — menggantikan model "buka file, semua orang lihat semua data" saat ini yang tidak sesuai untuk data operasional yang sensitif.
