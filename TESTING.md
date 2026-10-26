# Acceptance test log

Semua pengujian di bawah dijalankan pada **build produksi** di
https://bratgen-gamma.vercel.app (bukan dev server), lewat Chrome sungguhan yang
dikendalikan CDP. Tanggal: 26 Oktober 2026.

## Hasil

| # | Item | Hasil | Bukti |
| --- | --- | --- | --- |
| 1 | Production build | lulus | `npm run build` → `tsc -b && vite build`, 27 modul, bundle 286 kB (89 kB gzip) |
| 2 | Install bersih di CI | lulus | `rm -rf node_modules && npm install` tanpa flag, `.npmrc` `legacy-peer-deps` |
| 3 | Root URL | 200 | `text/html`, `<title>bratgen</title>` |
| 4 | Asset JS/CSS | 200 | `/assets/index-*.js` `application/javascript` 285.987 byte, CSS `text/css` |
| 5 | Worker chunks | 200 | `peaks.worker-*.js` dan `align.worker-*.js` keduanya `application/javascript` |
| 6 | Refresh di URL bersarang | 200 | `/studio/abc` mengembalikan `index.html` yang sama |
| 7 | Rewrite tidak menelan file nyata | lulus | `/assets/nope.js` dan `/assets/model.wasm` → **404 text/plain**, bukan HTML |
| 8 | Import + decode audio | lulus | `jfk.wav` 1,9 MB → panel menampilkan `0:11.00 · 2 ch · 48000 Hz` |
| 9 | Waveform | lulus | canvas 798x96, 14.496 piksel tergambar (bukan kanvas kosong) |
| 10 | Preview render | lulus | canvas 720x1280, 59 warna berbeda, teks brat terlihat pada screenshot |
| 11 | Auto-sync (nyata, bukan simulasi) | lulus | Whisper `Xenova/whisper-tiny` (q8) diunduh dari Hugging Face dengan progress 29% → 61% → selesai, lalu **22 kata terdeteksi** dan **22/22 kata lirik cocok (100%)** |
| 12 | Kualitas timing hasil auto-sync | wajar | baris 0,68–3,74 · 3,78–8,56 · 8,60–11,60 detik untuk audio 11 detik |
| 13 | Batal auto-sync | lulus | tombol batalkan menghentikan run saat unduh model, status kembali, tombol jalan aktif lagi |
| 14 | Edit timing manual | lulus | nudge +50 ms mengubah 0,68 → 0,73; input numerik 3,78 → 3,00 tersimpan |
| 15 | Tap sync | lulus | dengan audio berjalan, tap pada 0,83 s dan 1,65 s menghasilkan start 0,84 / 1,69 dan end baris sebelumnya 0,82 / 1,67 |
| 16 | Export MP4 | lulus | 1.944.454 byte, 10,5 detik untuk 11 detik audio |
| 17 | Isi file MP4 | valid | box `ftyp` (brand `isom`) + `moov` + `mdat`, dua trak `vide` + `soun`, codec `avc1` + `Opus`, 330 sampel video (= 11 s x 30 fps), 551 sampel audio, `mvhd` durasi 11,02 s |
| 18 | File MP4 bisa diputar | lulus | `<video>` memuat 720x1280, duration 11,02, `readyState` 4, tanpa error |
| 19 | Fallback WebM | lulus | 711.752 byte `video/webm`, header EBML `1a 45 df a3`, memutar 720x1280, tanpa error, makan waktu 11,1 detik (realtime) |
| 20 | Project tersimpan di IndexedDB | lulus | setelah reload, dua project muncul kembali sebagai `audio tersimpan` |
| 21 | Restore audio setelah reload | lulus | project dibuka ulang dan audio 11 detik termuat kembali |
| 22 | Blob audio hilang | lulus | audio dihapus dari IndexedDB → muncul peringatan "Pilih ulang file lagunya", lirik dan timing tetap ada |
| 23 | Layout mobile 390x844 | lulus | tanpa overflow horizontal, grid jadi satu kolom, preview 300 px |
| 24 | Tombol kecil di mobile | diperbaiki | target sentuh mini naik dari 28 px ke 38 px setelah perbaikan CSS |
| 25 | Console error | bersih | tidak ada exception aplikasi selama seluruh pengujian; hanya warning Canvas2D `willReadFrequently` dari skrip tes, dan warning autoplay saat audio diputar tanpa gesture |

## Bug yang ditemukan dan diperbaiki saat pengujian

1. **MP4 mati total di Chromium/Linux.** Awalnya MP4 butuh AAC, dan Chromium tidak punya
   encoder AAC, sehingga tombol MP4 nonaktif. Sekarang audio MP4 memakai AAC bila ada, kalau tidak
   memakai Opus dalam MP4. Terverifikasi: `avc1` + `Opus` dalam MP4 yang valid dan bisa diputar.
2. **Fallback WebM selalu gagal.** `makeCanvas` memilih `OffscreenCanvas`, padahal
   `captureStream` hanya ada di canvas DOM, jadi jalur cadangan langsung error di semua browser
   modern. Sekarang WebM memakai canvas DOM. Terverifikasi: 711 kB WebM valid.

## Yang belum bisa diuji di sini (jujur)

- **Safari dan Firefox**: tidak tersedia di lingkungan tes. Opus di dalam MP4 tidak bisa diputar
  di Safari, dan itu sudah ditampilkan sebagai catatan di panel export. Firefox 130+ punya
  WebCodecs, tapi belum diverifikasi langsung.
- **Android nyata**: keterbatasan RAM pada HP hanya diuji lewat emulasi viewport, bukan perangkat
  asli. Export memakai frame streaming (satu frame hidup pada satu waktu), tetapi model
  `whisper-small` tetap berat untuk HP kelas bawah.
- **Vokal bernyanyi**: pengujian auto-sync memakai sampel ucapan (JFK, 11 detik). Whisper memang
  tidak dioptimalkan untuk nyanyian, dan belum ada vocal separation. Akurasi pada lagu asli
  kemungkinan lebih rendah daripada angka 100% di atas.
- **Durasi panjang**: belum diuji lagu 3 sampai 5 menit. Arsitektur export bersifat streaming,
  jadi memori tidak tumbuh mengikuti durasi, tapi waktu render linear terhadap durasi.
- **Audio blob pada mode privat/incognito** dan kuota storage browser tidak diuji.
