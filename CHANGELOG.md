# Catatan Perubahan

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/). Tanggal dalam format TAHUN-BULAN-HARI.

## [0.4.0] — 2026-11-13

### Ditambahkan
- **Tingkat kelurahan/desa** (`kecamatan.html`): klik dua kali sebuah kecamatan untuk melihat kelurahan/desanya. Total 83.760 kelurahan/desa (83.764 menurut tabel README sumbernya; 4 tidak ada di sumber).
- Data `assets/data/kelurahan/<kode kab/kota>.json`, satu file per kabupaten/kota, disaring ke kecamatan terpilih saat dibuka.
- Skrip `tools/build_kelurahan.py` untuk membuat ulang data kelurahan/desa, dengan parameter tingkat penyederhanaan batas.

### Diubah
- Mesin peta kini mendukung empat tingkat lewat `<body data-level="prov|kab|kec|kel">`.
- Tombol kembali "←" membawa pengguna naik satu tingkat dan mengingat nama wilayah induk.

### Diperbaiki
- Pembaca data SQL melewatkan 149 desa di Papua Barat karena format spasi yang berbeda; kini terbaca semua.

## [0.3.0] — 2026-11-12

### Ditambahkan
- **Tingkat kabupaten/kota** (`provinsi.html`) dan **tingkat kecamatan** (`kabupaten.html`), dibuka dengan klik dua kali atau tombol di kartu info.
- **Data sepenuhnya offline** di `assets/data/` (provinsi, 514 kabupaten/kota, 7.285 kecamatan); tidak lagi bergantung pada API eksternal.
- Skrip pembuat data: `tools/build_data.py` (provinsi) dan `tools/build_wilayah.py` (kabupaten/kota dan kecamatan).
- Tombol "← Semua provinsi" untuk kembali ke peta utama.

### Diubah
- **Rendering dipindah ke WebGL** (GPU): geometri dibangun sekali lalu di-upload ke GPU, geser/zoom hanya mengubah posisi kamera. Isi poligon memakai stencil buffer (even-odd). Canvas 2D tetap ada sebagai cadangan otomatis bila WebGL tidak tersedia; modenya tampil di kiri bawah peta.
- Render digabung dengan `requestAnimationFrame` (maksimal sekali per frame); titik garis yang terlalu rapat disederhanakan saat dimuat.
- Efek blur (`backdrop-filter`) di atas peta dimatikan agar geser/zoom ringan.
- Pemilihan wilayah lewat klik memakai uji titik-dalam-poligon langsung pada data, tidak lagi membangun ulang path tiap frame.
- Label wilayah diletakkan di daratan terbesar tiap wilayah, ukurannya ikut zoom, dan label yang bertabrakan disembunyikan (wilayah besar didahulukan).
- Kabupaten/kota diambil dari sumber yang lengkap (514 dari 514), sehingga Kota Magelang, Kota Mojokerto, dan Kepulauan Seribu yang sebelumnya kosong kini ada.
- Kode provinsi Papua memakai kode resmi 91 sampai 96.

### Diperbaiki
- Wilayah tampil "Wilayah tanpa nama" karena nama field dari API tidak cocok; pencarian nama kini mencari di beberapa lokasi dan nama field.

## [0.2.0] — sebelum 2026-11-12

### Ditambahkan
- Peta 38 provinsi bergaya flat-isometric subtle (Canvas 2D), data dari API `wilayah-id-api`.
- Geser/drag, zoom (scroll dan tombol +/−), klik untuk memilih provinsi, kartu info, pencarian nama, tombol label `Aa`, dan tombol reset.
