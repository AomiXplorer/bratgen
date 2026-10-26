# bratgen

Studio video lirik gaya **brat** yang berjalan sepenuhnya di browser. Import lagu, tempel lirik,
jalankan auto-sync, koreksi timing, lalu export MP4. Audio tidak pernah dikirim ke server.

- Production: https://bratgen.vercel.app
- Stack: Vite + React + TypeScript, tanpa backend, tanpa API route, tanpa database.

## Kenapa local-first

Semua fungsi inti berjalan di perangkat pengguna:

| Tahap | Implementasi |
| --- | --- |
| Import + decode audio | `AudioContext.decodeAudioData` |
| Waveform | `computePeaks` di Web Worker (`src/workers/peaks.worker.ts`) |
| Auto-sync | Whisper (transformers.js, WASM) di Web Worker, word-level timestamps |
| Edit timestamp | panel timing + tap sync (spasi/enter) |
| Live preview | canvas, jalur render yang sama dengan exporter |
| Render frame | `drawFrame` di `src/lib/render.ts` |
| Encode + mux MP4 | WebCodecs (H.264 + AAC) + `mp4-muxer` |
| Fallback | `MediaRecorder` WebM (realtime) |
| Penyimpanan project | IndexedDB (`bratgen` / `projects`) |

Tidak ada upload lagu, tidak ada Vercel Function untuk audio, tidak ada secret di frontend.

## Menjalankan lokal

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build  -> dist/
npm run preview  # cek hasil build
```

`.npmrc` memakai `legacy-peer-deps=true` karena resolver npm 10 gagal (`edgesOut`) pada kombinasi
React 19 + Vite 8. Vercel memakai file yang sama.

## Deployment Vercel

Proyek ini statis murni (SPA). Pengaturan yang dipakai ada di `vercel.json`:

```json
{
  "framework": "vite",
  "installCommand": "npm install",
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

Isi `vercel.json` hanya tiga hal yang benar-benar dibutuhkan: framework, perintah build, dan satu
rewrite SPA yang **mengecualikan** `assets/`, `workers/`, dan semua ekstensi file statis
(`js, css, wasm, json, gambar, font, media`). Vercel tetap memeriksa filesystem lebih dulu, jadi file
nyata selalu dikirim langsung dan tidak ditelan rewrite.

Catatan konfigurasi lain:

- `base: '/'` di `vite.config.ts`. Base relatif akan rusak pada URL bersarang, karena aset harus
  tetap diambil dari `/assets`.
- Worker di-emit sebagai chunk terpisah dan dirujuk lewat path absolut `/assets/*.worker-*.js`
  (lihat `dist` setelah build).
- **Tidak ada header COOP/COEP.** Jalur MP4 memakai WebCodecs + `mp4-muxer` yang tidak butuh
  `SharedArrayBuffer`, jadi cross-origin isolation tidak diperlukan dan aset eksternal (model
  Hugging Face, CDN transformers) tidak ikut rusak. `ffmpeg.wasm` tidak dipakai.
- Content-Type untuk WASM/model tidak dikonfigurasi karena aplikasi tidak menyajikan file WASM
  sendiri: WASM onnxruntime dan bobot model diambil dari CDN pihak ketiga saat auto-sync dipakai.

## Auto-sync, apa adanya

1. Audio di-mixdown ke mono 16 kHz dan ditransfer ke Web Worker.
2. Worker memuat `@huggingface/transformers` dari CDN (jsdelivr, fallback esm.sh) lalu mengunduh
   model Whisper dari Hugging Face Hub saat pertama dipakai. Ada progress download, tombol batal
   (worker di-terminate, memori model dibebaskan), dan cache HTTP browser untuk pemakaian berikutnya.
3. Whisper mengembalikan timestamp per kata. Kata-kata itu dicocokkan berurutan (Levenshtein) ke kata
   pada lirik yang kamu tempel.
4. Baris yang tidak punya kata cocok diinterpolasi di antara tetangganya, bukan diberi timestamp acak.
5. Panel menampilkan berapa kata yang berhasil dicocokkan (persentase keyakinan).

Batasan yang jujur:

- Whisper dilatih untuk ucapan, bukan nyanyian. Pada campuran musik penuh akurasinya turun, kadang
  turun banyak. Belum ada vocal separation (Demucs) di build ini.
- Model `tiny`/`base` (default q8, sekitar 40 sampai 45 MB) cepat tapi kasar. `small` lebih akurat
  tapi berat untuk HP.
- Kalau model gagal diunduh (offline, CDN diblokir), auto-sync menampilkan error dan timing manual
  (tap sync atau edit angka) tetap berfungsi penuh.

## Export MP4

- Jalur utama: `VideoEncoder` (AVC) + `AudioEncoder` (AAC, atau Opus kalau AAC tidak ada) +
  `mp4-muxer`, muxing `fastStart`.
  Frame dirender satu per satu ke `OffscreenCanvas`, langsung `close()`, dengan backpressure dari
  `encodeQueueSize`, sehingga memori tidak tumbuh mengikuti durasi lagu.
- Kemampuan browser diperiksa dulu (`probeCapabilities`), bukan diasumsikan. Panel export menampilkan
  status MP4, codec AVC yang terpilih, AAC, dan WebM.
- Audio MP4 memakai AAC bila encoder-nya ada. Chrome di Linux/Chromium sering tidak punya encoder
  AAC; untuk kasus itu MP4 tetap dibuat dengan audio **Opus** (`mp4a` track diganti `Opus`), jadi
  file masih MP4 valid dengan video dan audio. Konsekuensinya Safari tidak bisa memutar Opus dalam
  MP4, dan itu ditampilkan sebagai catatan di panel export.
- Kalau tidak ada encoder video maupun audio sama sekali, tombol MP4 dinonaktifkan dan pesan
  penyebabnya ditampilkan. Jalur yang berfungsi tetap ditawarkan (WebM), file tidak pernah hanya
  diganti ekstensinya.
- WebM memakai `MediaRecorder` dan merekam realtime, jadi butuh waktu selama durasi lagu.

## Penyimpanan project

- IndexedDB menyimpan konfigurasi gaya, lirik, timing, metadata audio, dan blob audio (kalau browser
  mengizinkannya).
- Tidak ada audio/video besar di localStorage, cookie, environment variable, atau repo.
- Kalau file audio sudah tidak tersedia, aplikasi meminta memilih ulang file. Desain dan timing tetap
  utuh.

## Lisensi dan dependensi

- Kode proyek: MIT (lihat `LICENSE`).
- `mp4-muxer` (MIT) dipakai untuk muxing. Pustaka ini sudah ditandai superseded oleh Mediabunny;
  migrasi bisa dilakukan nanti tanpa mengubah alur render.
- `@huggingface/transformers` dan bobot Whisper dimuat runtime dari CDN, tidak dibundel.
- `ffmpeg.wasm` sengaja tidak dipakai: core dengan libx264 berlisensi GPL dan build MT-nya menuntut
  `SharedArrayBuffer`.
