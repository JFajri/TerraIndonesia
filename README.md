# Terra Indonesia — Frontend

Peta interaktif Indonesia bergaya **flat isometric subtle**, dari provinsi sampai kelurahan/desa, berjalan **sepenuhnya offline** di browser. Tidak membutuhkan XAMPP, PHP, database, Node.js, atau proses build.

Versi saat ini: **0.4.0** — lihat [CHANGELOG.md](CHANGELOG.md).

## Fitur yang tersedia

- **Empat tingkat wilayah**: provinsi → kabupaten/kota → kecamatan → kelurahan/desa. Klik dua kali (atau tombol di kartu info) untuk turun satu tingkat, tombol "←" untuk naik.
- **Cakupan data**: 38 provinsi, 514 kabupaten/kota, 7.285 kecamatan, 83.760 kelurahan/desa.
- **Rendering GPU (WebGL)** dengan cadangan otomatis ke Canvas 2D; geser dan zoom tetap lancar walau ribuan poligon.
- **Offline penuh**: semua batas wilayah dibaca dari file JSON lokal, tanpa API dan tanpa database.
- **Interaksi**: geser/drag, zoom dengan scroll atau tombol +/−, klik untuk memilih wilayah dan melihat nama serta kodenya, pencarian nama wilayah, tombol `Aa` untuk label, tombol reset.
- **Label cerdas**: diletakkan di daratan terbesar tiap wilayah, ukurannya ikut zoom, dan yang bertabrakan disembunyikan.
- **Skrip pembuat data** di `tools/` untuk membuat ulang semua file data dari sumbernya.

## Menjalankan

1. Clone repositori ini: `git clone https://github.com/JFajri/TerraIndonesia.git`
2. Buka folder tersebut di VS Code.
3. Jalankan `index.html` dengan ekstensi **Live Server** (wajib; membuka file langsung dari disk akan diblokir browser karena memakai `fetch`).
4. Font diambil dari Google Fonts; tanpa internet tampilan memakai font cadangan, sedangkan peta tetap jalan karena datanya lokal.

## Teknologi

- HTML, CSS, JavaScript murni.
- **WebGL (dirender GPU)** untuk daratan, garis pantai, dan efek sisi pulau. Geometri dibangun sekali lalu di-upload ke GPU; geser/zoom hanya mengubah uniform kamera, tanpa menghitung ulang titik di CPU. Isi poligon memakai stencil buffer (even-odd), jadi tanpa library triangulasi.
- Canvas 2D ringan hanya untuk label dan hiasan, sekaligus **fallback otomatis** bila WebGL tidak tersedia (tulisan "GPU (WebGL)" / "Canvas 2D" tampil di kiri bawah peta).
- Render digabung dengan `requestAnimationFrame` (maksimal 1x per frame) dan titik garis yang terlalu rapat disederhanakan saat dimuat.
- GeoJSON lokal di `assets/data/` (lihat bagian Data).
- Tidak menggunakan tile map atau library peta berat.

## Empat tingkat peta

| Halaman | Isi | Cara membuka |
|---|---|---|
| `index.html` | 38 provinsi | — |
| `provinsi.html?kode=13` | kabupaten/kota dalam satu provinsi | klik dua kali provinsi, atau tombol **Buka peta kabupaten/kota** |
| `kabupaten.html?kode=13.77` | kecamatan dalam satu kabupaten/kota | klik dua kali kabupaten/kota, atau tombol **Buka peta kecamatan** |
| `kecamatan.html?kode=13.77.01` | kelurahan/desa dalam satu kecamatan | klik dua kali kecamatan, atau tombol **Buka peta kelurahan/desa** |

Keempatnya memakai satu mesin peta (`assets/js/app.js`); tingkatnya dipilih lewat `<body data-level="prov|kab|kec|kel">`. Tombol "←" di kiri atas kembali satu tingkat.

## Data (sepenuhnya offline)

Semua data dibaca dari file lokal, tanpa API dan tanpa database:

- `assets/data/provinsi.json` — 38 provinsi (properti: `code`, `name`).
- `assets/data/kabupaten/<kode provinsi>.json` — 514 kabupaten/kota, mis. `13.json` = Sumatera Barat.
- `assets/data/kecamatan/<kode kab/kota>.json` — 7.285 kecamatan, mis. `13.77.json` = Kota Pariaman.
- `assets/data/kelurahan/<kode kab/kota>.json` — 83.760 kelurahan/desa (satu file per kabupaten/kota; halaman kecamatan memuat file itu lalu menyaring ke kecamatan yang dipilih).

Karena memakai `fetch` ke file lokal, **buka lewat Live Server** (atau server statis lain). Membuka `index.html` langsung (`file://`) akan diblokir browser.

### Asal data & cara membuat ulang

- Provinsi: batas BIG via repo `ardian28/GeoJson-Indonesia-38-Provinsi`, dengan kode provinsi resmi (Papua 91, Papua Barat 92, Papua Selatan 93, Papua Tengah 94, Papua Pegunungan 95, Papua Barat Daya 96). Skrip: `tools/build_data.py`.
- Kabupaten/kota dan kecamatan: repo `cahyadsn/wilayah_boundaries` (lisensi MIT; data sesuai Kepmendagri No 300.2.2-2430 Tahun 2025). Jumlahnya sudah dicocokkan dengan tabel di README sumbernya: 514 kabupaten/kota dan 7.285 kecamatan, tanpa yang hilang. Skrip: `tools/build_wilayah.py` (kabupaten/kota, kecamatan) dan `tools/build_kelurahan.py` (kelurahan/desa).
- Semua skrip hanya butuh Python 3 (tanpa library tambahan); petunjuk ada di bagian atas tiap skrip.

### Catatan data

- Batas wilayah sudah disederhanakan oleh sumbernya dan dibulatkan ke 4 desimal, jadi cocok untuk tampilan peta, bukan untuk pengukuran.
- Batas provinsi (BIG) dan batas kabupaten/kecamatan berasal dari dua sumber berbeda, sehingga tepinya bisa sedikit tidak persis sama.
- Kelurahan/desa: 83.760 dari 83.764 menurut tabel README sumbernya (4 tidak ada di sumber: 3 di Sulawesi Tenggara, 1 di Papua Barat Daya). Batasnya disederhanakan lebih jauh (± 33 m) agar ukurannya kecil: ± 93 MB mentah, ± 20 MB di dalam zip. Desa yang sangat kecil bisa tampak kasar saat di-zoom dalam. Skrip: `tools/build_kelurahan.py` (parameter ketiga mengatur tingkat penyederhanaan; makin kecil makin halus tapi makin besar).

## Interaksi

- Geser/drag untuk memindahkan peta.
- Scroll mouse atau tombol +/- untuk zoom.
- Klik provinsi untuk memilih.
- Cari nama provinsi melalui kolom pencarian.
- Tombol `Aa` untuk menampilkan atau menyembunyikan label.
- Tombol reset untuk mengembalikan tampilan awal.

## Catatan data

Bentuk wilayah menggunakan batas administrasi dari layanan wilayah-id yang menyatakan geometri bersumber dari Badan Informasi Geospasial (BIG), edisi 12 Juni 2026. Cantumkan atribusi BIG dan layanan data saat memublikasikan atau mendistribusikan ulang data.

**Warna medan pada versi ini masih ilustratif.** Warna hijau/cokelat bukan hasil pengukuran ketinggian. Untuk pewarnaan elevasi yang benar, tahap berikutnya adalah menambahkan sumber data DEM dan mengolahnya menjadi kelas elevasi.

## Batasan saat ini

- Efek isometric adalah transformasi proyeksi ringan, bukan model 3D.

## Lisensi dan atribusi

Kode aplikasi: MIT (lihat [LICENSE](LICENSE)).

Data batas wilayah berasal dari sumber pihak ketiga; cantumkan atribusinya saat memublikasikan atau mendistribusikan ulang:

- Kabupaten/kota, kecamatan, kelurahan/desa: [cahyadsn/wilayah_boundaries](https://github.com/cahyadsn/wilayah_boundaries) (MIT; sesuai Kepmendagri No 300.2.2-2430 Tahun 2025).
- Provinsi: [ardian28/GeoJson-Indonesia-38-Provinsi](https://github.com/ardian28/GeoJson-Indonesia-38-Provinsi), yang menyatakan sumber data dari Badan Informasi Geospasial (BIG).
