# Claude X v0.2.0

Rilis ini fokus pada perbaikan koneksi chat (Agent SDK) dan kemudahan update.

## ✨ Baru
- **Auto-cek update saat aplikasi dibuka.** Jika ada versi baru, muncul jendela berisi versi sekarang vs versi baru, tanggal rilis, catatan rilis, dan tombol **Update** (unduh + pasang + restart otomatis).
- **Pengaturan Node.js (Settings → Node.js Runtime).** Aplikasi otomatis mendeteksi semua versi Node.js yang terpasang, menampilkan versi yang sedang dipakai, dan kamu bisa memilih versi tertentu atau **Auto** (pilih versi terbaru otomatis). Versi < 18 ditandai dan dinonaktifkan.

## 🐛 Perbaikan
- **Memperbaiki error "object not disposable" / chat gagal terhubung** saat aplikasi dibuka dari hasil install DMG. Penyebabnya aplikasi memilih Node.js lama (mis. v16) yang tidak didukung Agent SDK. Sekarang aplikasi selalu memilih Node.js versi terbaru yang **≥ 18**.

## 🧹 Pemeliharaan
- Membersihkan kode lama sebelum migrasi Claude Agent SDK (jalur proses lama dihapus sepenuhnya).

---
Catatan: chat menggunakan login **subscription (OAuth/ClaudeMax)**, bukan API key.
