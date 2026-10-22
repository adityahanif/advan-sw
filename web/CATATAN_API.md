# CATATAN_API — Katalog Watchface ADVAN SW

Catatan hasil pembacaan APK `com.crrepa.band.advansw` v2.9.24 (base Da Fit,
`bizCode=da_fit`) dan uji langsung ke server pada 21 Oktober 2026.

Ruang lingkup: **hanya endpoint watchface**. Tidak ada endpoint akun, kesehatan,
olahraga, cloud sync, analitik, atau iklan yang dipakai.

---

## 1. Ringkasan

| Item | Hasil |
|---|---|
| Host API | `https://api.moyoung.com` (mirror: `https://api-cdn.moyoung.com`) |
| Auth | Tidak ada. Tanpa token, tanpa tanda tangan, tanpa `device_id`. |
| Header | Hanya `Accept-Language`. |
| Versi API yang dipakai aplikasi | `faces/v4/*` |
| Versi yang berhasil diuji tanpa jam fisik | `faces/v3/*` (dengan `fv=2023-01-01`) |
| Format file face | `.bin` (generic), `.zip` 4 file (Sifli) |
| CORS | API **tidak** mengirim `Access-Control-Allow-Origin`; file/gambar di CDN **mengirim** `*`. |
| Jam contoh | ADVAN SW **SE1**, firmware `MOY-8NM4-2.0.1` → **JieLi JL7012F6** (dari `meta` v4) |

Katalog web app memakai urutan: **v4 → (v3 / new / sifli sesuai chip)**. v4 hanya
dicoba bila `fv` perangkat tersedia dan dikenali server. Bila gagal, turun ke
endpoint yang terverifikasi (v3).

---

## 2. Endpoint

### 2.1 v4 (dipakai aplikasi versi ini)

```
GET /faces/v4/tag-list
GET /faces/v4/list
GET /faces/v4/face-detail
```

### 2.2 v3 (terverifikasi bekerja)

```
GET /faces/v3/tag-list
GET /faces/v3/list
GET /faces/v3/face-detail
```

### 2.3 JieLi

```
GET /faces/new/tag-face-list
GET /faces/new/face-list
GET /faces/new/face-detail
```

### 2.4 Sifli

```
GET /faces/sifli/tag-list
GET /faces/sifli
GET /faces/sifli/{id}
```

Endpoint lain yang ditemukan di kode tapi **tidak dipakai**: `faces/v3/list`
varian premium, `v2/faces` (lama), check-update aplikasi, weather, customer
service, dan seluruh endpoint `com.crrepa.*` non-watchface.

---

## 3. Parameter

Parameter yang sama untuk `tag-list` dan `list`:

| Parameter | Nilai | Keterangan |
|---|---|---|
| `lang` | `en`, `id`, … | bahasa nama/remark |
| `tpls` | mis. `1` atau `1,2,3` | daftar tipe face yang didukung jam |
| `fv` | `YYYY-MM-DD` atau `MOY-8NM4-2.0.1` | versi firmware untuk pemetaan server (lihat §5) |
| `p` | `1..n` | halaman |
| `per_page` | `20` / `50` | jumlah per halaman |
| `max_size` | byte | batas ukuran file yang ditampilkan |
| `tested` | `yes` | hanya face yang sudah diuji |
| `ver` | `` (kosong) | dipakai v3 / Sifli |
| `key` | `` (kosong) | khusus Sifli |
| `api_ver` | angka | khusus JieLi |
| `func_ver` | angka | khusus JieLi |

`list` juga membutuhkan:

| Parameter | Nilai |
|---|---|
| `tag_id` | id dari `tag-list` |

Contoh yang terbukti bekerja:

```
https://api.moyoung.com/faces/v3/tag-list?lang=en&tpls=1&fv=2023-01-01&p=1&per_page=50&max_size=1000000&tested=yes&ver=

https://api.moyoung.com/faces/v3/list?lang=en&tpls=1&fv=2023-01-01&p=1&per_page=20&max_size=1000000&tested=yes&ver=&tag_id=1
```

Contoh dengan `fv` asli jam SE1:

```
https://api.moyoung.com/faces/v4/tag-list?lang=en&tpls=1&fv=MOY-8NM4-2.0.1&p=1&per_page=50&max_size=1000000&tested=yes&ver=
→ {"code":0,"data":[],"message":"ok","meta":{"firmware":"8NM","mcu":339,"platform":"杰理","model":"JL7012F6_QFN52","source":"new"}}

https://api.moyoung.com/faces/v3/tag-list?lang=en&tpls=1&fv=MOY-8NM4-2.0.1&p=1&per_page=50&max_size=1000000&tested=yes&ver=
→ 7 tag, 184 face
```

Tanpa `tag_id`, `v3/list` menjawab:

```json
{"code":-4,"message":"Tag is required"}
```

---

## 4. Bentuk respons

### 4.1 `v3/tag-list`

```json
{
  "code": 0,
  "data": [
    { "id": 1, "tag_name": "New Watch Faces", "faces": [ { "id": 1479, "name": "Sports wallpaper", "preview": "...", "size": 117222 } ] },
    { "id": 2, "tag_name": "Recommended", "faces": [] }
  ],
  "total": 7
}
```

Tujuh tag yang muncul: `1 New`, `2 Recommended`, `8 Activity`, `7 Classic`,
`6 Modern`, `3 Art`, `4 Funny`.

### 4.2 `v3/list`

```json
{
  "code": 0,
  "data": {
    "count": 184,
    "faces": [
      {
        "id": 1479,
        "name": "Sports wallpaper",
        "preview": "https://qn-hscdn2.moyoung.com/images/....png",
        "file": "https://qn-hscdn2.moyoung.com/files/....bin",
        "download": 866,
        "tpls": [1]
      }
    ]
  },
  "total": 184
}
```

Catatan: `size` tidak ada di `v3/list` (0 di klien). Ukuran sebenarnya bisa
dibaca dari `Content-Length` saat unduh, atau dari `v3/face-detail`.

### 4.3 `v4/list`

```json
{ "code": 0, "data": [ { "id": 1, "name": "...", "preview": "...", "file": "...", "size": 123 } ], "total": 100, "meta": {} }
```

`v4/tag-list` mengembalikan array tag di `data` seperti v3. Respons juga membawa
`meta` hasil pemetaan firmware di server, misalnya untuk jam SE1:

```json
{
  "code": 0,
  "data": [],
  "message": "ok",
  "meta": {
    "firmware": "8NM",
    "mcu": 339,
    "platform": "??",
    "model": "JL7012F6_QFN52",
    "source": "new"
  }
}
```

`meta.model` adalah nama chip/modul (di sini **JieLi JL7012F6, QFN52**).
`meta.source` menunjukkan katalog mana yang dipakai server untuk firmware itu
(`new` = endpoint JieLi). `data: []` berarti firmware dikenali tetapi tidak ada
tag/face di katalog v4 untuk firmware tersebut.

### 4.4 Sifli

```json
{ "code": 0, "faces": [ { "id": 1072, "name": "...", "preview": "...", "file": "https://qn-hscdn2.moyoung.com/files/....zip" } ], "total": 21 }
```

Perhatikan `faces` ada di level atas, bukan di `data`.

### 4.5 JieLi (`new/*`)

`new/tag-face-list` menerima parameter `api_ver` dan `func_ver` dari jam
(command `0xBA` sub 2), plus `tpls`, `fv`, `max_size`, `tested`.

Untuk SE1 (`fv=MOY-8NM4-2.0.1`) endpoint ini mengembalikan `data: []` untuk
semua kombinasi `api_ver` 0–4, `func_ver` 0–8, dan `tpls` 1–12 yang dicoba.
Artinya server mengenali firmware-nya (`meta.source = "new"`), tetapi belum ada
isi katalog untuk firmware itu. App tetap mencoba jalur ini lalu turun ke v3.

Respons `new/face-detail` dan `new/face-list` memakai bentuk yang sama dengan
`v4` (`data.file`, `data.name`, `total`).

---

## 5. Soal `fv` (pemetaan firmware)

`fv` tidak harus tanggal. Server menerima dua bentuk:

| Nilai `fv` | Hasil v4 |
|---|---|
| `2023-01-01` | format valid, tetapi `{"code":-6,"message":"Firmware mapping not found"}` |
| `MOY-8NM4-2.0.1` | **dikenali**; `meta` berisi `firmware/model/mcu/source` |
| `MOY-8NM4` | format valid, `code:-6` (belum dipetakan) |
| `8NM4` | `{"code":-2,"message":"Firmware Version parameter error"}` |

Jadi aturan format tampaknya: string firmware lengkap dengan pemisah `-`
(minimal `PREFIX-PROJECT-VERSION`), bukan potongan kode proyek. `v3/*` menerima
tanggal maupun string firmware dan tidak memakai pemetaan.

`v4` tidak bisa ditebak tanpa jam fisik. App memakai `fv` dari karakteristik
**2A28** (Software Revision) bila ada, lalu jatuh ke `2023-01-01` untuk v3.
Nilai yang dipakai selalu ditampilkan di UI.

**Konsekuensi:** daftar face dari v3 belum tentu 100% cocok dengan jam. Filter
yang benar-benar mengikat adalah `tpls` (tipe face yang dilaporkan jam lewat
command `0x84` / `0xB4` sub 16), bukan `fv`.

`tpls` diambil dari byte-byte setelah 2 byte pertama respons `0x84`. Untuk
JieLi, `0xB4` sub 16 lebih akurat: 8 byte pertama berisi `displayWatchFace`
(LE4) dan `watchFaceMaxSize`/sisa storage (LE4), sisanya daftar tipe face
(1 byte per tipe). Bila `0x84` tidak dijawab, UI memakai `1` sebagai default dan
nilai bisa diubah manual di Pengaturan katalog.

---

## 6. CORS dan proxy

Diuji dengan header `Origin`:

| Host | CORS |
|---|---|
| `api.moyoung.com` | tidak ada `Access-Control-Allow-Origin` (GET maupun OPTIONS) |
| `api-cdn.moyoung.com` | tidak ada |
| `qn-hscdn2.moyoung.com` gambar & `.bin` | `Access-Control-Allow-Origin: *` |
| `qn-hscdn2.moyoung.com` `.zip` (Sifli) | **tidak ada** header CORS |

Artinya: JSON katalog dan file `.zip` Sifli tidak bisa di-fetch langsung dari
browser. Gambar dan file `.bin` bisa. App mencoba fetch langsung; untuk `.zip`
app langsung memakai proxy bila proxy diisi, dan untuk request lain yang
diblokir app mencoba ulang lewat proxy.

Isi kolom **Proxy CORS** di Pengaturan katalog dengan salah satu di bawah ini.

### 6.1 Proxy Node (tanpa dependensi)

Versi siap pakai ada di **`web/proxy.mjs`**. Jalankan dari folder proyek:

```
node web/proxy.mjs
```

Lalu isi `http://localhost:8787` di Pengaturan katalog (kolom ini sudah terisi
default; klik **Terapkan**). Cek proxy hidup dengan membuka
`http://localhost:8787/health`.

Kode lengkapnya juga disalin di bawah untuk referensi.

```js
import http from 'node:http';

const PORT = 8787;
const API = 'https://api.moyoung.com';
const ALLOWED = new Set(['api.moyoung.com', 'qn-hscdn2.moyoung.com', 'api-cdn.moyoung.com']);

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Accept-Language');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    const here = new URL(req.url, 'http://localhost');
    const raw = here.searchParams.get('url');   // dipakai untuk file .zip
    let target;
    if (raw) {
      target = new URL(raw);
      if (!ALLOWED.has(target.host)) { res.writeHead(403); return res.end('host not allowed'); }
    } else {
      target = new URL(API + req.url);          // /faces/...
    }

    const headers = {};
    if (target.host !== 'qn-hscdn2.moyoung.com') {
      headers['Accept-Language'] = req.headers['accept-language'] || 'en';
    }
    const r = await fetch(target, { headers });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': body.length
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('proxy error: ' + e.message);
  }
}).listen(PORT, () => console.log('proxy http://localhost:' + PORT));
```

Proxy hanya meneruskan path `/faces/...` ke `api.moyoung.com`, dan `?url=`
untuk tiga host di atas. Jangan dipakai sebagai open proxy.

### 6.2 Cloudflare Worker

```js
export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Accept-Language'
        }
      });
    }

    const raw = url.searchParams.get('url');
    let target;
    if (raw) {
      const u = new URL(raw);
      if (!['api.moyoung.com', 'qn-hscdn2.moyoung.com', 'api-cdn.moyoung.com'].includes(u.host)) {
        return new Response('host not allowed', { status: 403 });
      }
      target = u.toString();
    } else {
      target = 'https://api.moyoung.com' + url.pathname + url.search;
    }

    const r = await fetch(target, {
      headers: target.includes('qn-hscdn2')
        ? {}
        : { 'Accept-Language': req.headers.get('Accept-Language') || 'en' }
    });
    const out = new Response(r.body, r);
    out.headers.set('Access-Control-Allow-Origin', '*');
    return out;
  }
};
```

---

## 7. Jalur pemasangan face di jam

Ditentukan dari `mcuPlatform` pada respons command `0xBA` sub 0
(`[0][firmwareType 3][platform][chipId][feature LE2]`).

| Platform | Chip | Jalur | Command |
|---|---|---|---|
| 2 | HAN / HsMcu | generic | **116 (0x74)** |
| 3 | RealTek | generic | **116** |
| 4 | Goodix | generic | **116** |
| 6 | JieLi | generic | **116** |
| 7 | Bluetrum | generic | **116** |
| 5 | Sifli | ZIP 4 file | **0xB4** lalu **0xB7** |
| 8 | Hisilicon | belum didukung | — |

### 7.1 Generic 116

1. `[116][ukuran file BE4]` dikirim ke FEE2.
2. Jam meminta chunk ke-`i` dengan payload 2 byte BE (index, bukan offset).
3. Kirim `file[i × chunk .. +chunk]` mentah ke **FEE6** (tanpa header frame),
   dipecah menjadi tulisan sebesar MTU.
4. Selesai: jam mengirim `[FF FF][CRC16 BE2]`.
5. Bandingkan dengan CRC lokal; balas 4 byte `00 00 00 00` (cocok) atau
   `FF FF FF FF` (tidak cocok) memakai command 116.
6. Setelah CRC cocok, kirim **`[0x19][0x0D]`** (`SET_DISPLAY_WATCH_FACE`, slot
   galeri 13) untuk **mengaktifkan** face yang baru dipasang — face custom
   tidak ditambahkan ke daftar `0x84`/`0xA6`, tetapi masuk slot galeri.
   Sumber: `dawfu`/`dafit-canvas` (`APPLY_FACE_GALLERY = fe ea 20 06 19 0d`).

CRC16: init `0xFEEA`, varian nibble-XOR (lihat `yj8`), output big-endian.

`chunk` diambil dari `0xBA` sub 1 bila jam menjawab (nilainya bisa besar — SE1 /
JL7012F6 menjawab `0x2800` = 10240 byte, dan jam menunggu sebanyak itu per
permintaan index sebelum meminta chunk berikutnya); jika tidak dijawab, dari
input UI (default 244).

### 7.2 JieLi 110

Dipakai **hanya untuk paket foto/AI** (header `UBG CODE` / `AI CODE:`), bukan
untuk face katalog. Alur sama dengan 116, tetapi polling index datang lewat
command **`0xF3` (-13)** dan balasan CRC memakai command 110.

Face katalog JieLi tetap memakai 116. Membuat paket 110 dari gambar butuh
encoder RGB565+RLE native (`libjl_bmp_convert.so`) yang belum direimplementasi.

### 7.3 Sifli

1. ZIP harus berisi **tepat 4 file**; urutkan dari yang terbesar.
2. `[0xB4][01][total LE4][04]`.
3. Per file: `[0xB7][00][03][ukuran LE4][nama file UTF-8][00]`.
4. Jam minta data: `[0xB7][01][offset LE4]`. Kirim **8192 byte** mulai offset itu
   (dipecah sesuai MTU). Offset adalah posisi byte absolut, bukan index chunk.
5. Saat file selesai, jam mengirim `[0xB7][02][crc…]` (CRC 2 byte little-endian,
   atau 4 byte dengan CRC big-endian di byte 2–3). Balas `[0xB7][03]` bila CRC
   cocok, `[0xB7][04]` bila tidak. `[0xB7][05]` dari jam = transfer dibatalkan.

Jalur ini belum diuji dengan jam fisik.

### 7.4 Query tambahan khusus JieLi

Bila `mcuPlatform` = 6, app mengirim dua query sebelum operasi face:

| Query | Respons | Isi |
|---|---|---|
| `0xBA` `[02]` | `0xBA` `[02][api_ver][func_ver]` | versi API dan bit fitur face |
| `0xB4` `[16]` | `0xB4` `[16][display LE4][maxSize LE4][tipe…]` | face aktif, sisa storage face, daftar tipe face |

`api_ver`/`func_ver` dikirim ke katalog `new/*`. `maxSize` dipakai sebagai
`max_size`. Daftar tipe face dari `0xB4` sub 16 menggantikan `tpls` dari `0x84`
karena lebih akurat untuk JieLi.

`0xB4` sub 18 mengembalikan daftar ID face yang pernah diunduh (LE4 per ID),
dipakai aplikasi asli untuk layar edit unduhan; app ini tidak memakainya karena
daftar terpasang sudah diambil dari `0xA6`.

---

## 8. Selisih antara spesifikasi dan kode SDK

| Spesifikasi | Kenyataan di SDK | Yang dipakai app |
|---|---|---|
| `0xB4` sub 6 = sisa storage | tidak ada handler sub 6 di `ce8`; storage memakai `0x5A` sub 8 / `0xB7` sub 6 | tetap mengirim `0xB4/6`; bila tidak dijawab, storage ditampilkan "tidak dilaporkan" dan upload tidak diblokir |
| Sifli: ZIP 4 file, "cmd 116 per file" | per file memakai **`0xB7` (-73)**; `0xB4` hanya untuk total | `0xB7` |
| JieLi upload = cmd 110 | 110 hanya untuk foto/AI; face katalog memakai `ue8` → **116** | 116 (auto), 110 tersedia manual |
| `0x84` dijawab cmd `0x29` | `0x84` dijawab **cmd `0x84`** (`ce8.G1`); cmd `0x29`/41 hanya untuk query index aktif (`ce8.e0`) | dua handler terpisah, sesuai SDK |
| `0x5A` [01] = daftar face terpasang | daftar face memakai **`0xA6`** (-90) payload `[01]`; respons `[01][count][id,tipe,size BE2]…`. `0x5A` (90) dipakai untuk storage sub 8 | app mengirim `0xA6`, tetap menerima `0x5A` sub 1 sebagai cadangan |
| `0x5A` = current index + daftar index | 2 byte pertama `0x84` = index aktif; byte sisanya = **tipe** face per index | ditampilkan sebagai `#index (tipe t)` |
| `0x29` = index aktif 1 byte | benar | benar |

---

## 9. Batasan

- Chip jam fisik sudah teridentifikasi dari `meta` server: SE1 memakai **JieLi
  JL7012F6**. Namun `mcuPlatform` dari command `0xBA` belum dikonfirmasi dan
  transfer belum diuji end-to-end; byte platform diperkirakan `6`.
- Katalog `new/*` (JieLi) kosong untuk firmware `MOY-8NM4-2.0.1`, sehingga app
  memakai v3. File v3 adalah `.bin` generic; kompatibilitas dengan format face
  JieLi belum dibuktikan di jam fisik.
- Web Bluetooth tidak bisa membaca/menyetel MTU. Ukuran tulisan BLE dibuat
  manual (default 20 byte); bila gagal, naikkan/turunkan di UI.
- V1 (firmware lama): sinkronisasi waktu dan ganti face tetap jalan, tetapi
  upload file belum didukung (pembungkusan chunk V1 belum diverifikasi).
- Hisilicon belum diimplementasikan.
- `fv` fallback berarti katalog v3 bisa menampilkan face yang tidak cocok
  secara grafis. `tpls` tetap menjadi filter utama.
- Thumbnail memakai cache HTTP browser (CDN mengirim cache header); daftar
  tag/face di-cache di `localStorage` selama 6 jam.
- File `.zip` Sifli tidak punya header CORS, jadi unduhannya otomatis lewat
  proxy bila proxy diisi (file `.bin` tetap langsung dari CDN).
- File besar diunduh penuh sebelum dikirim ke jam (tidak ada streaming ke
  BLE). Setelah CRC cocok, app memuat ulang `0x84`/`0xA6` dan menawarkan
  tombol "Pakai" untuk index face baru.

---

## 10. Menjalankan app

1. Buka `web/index.html` di Chrome/Edge desktop (atau Chrome Android).
   Jika Web Bluetooth tidak muncul dari `file://`, sajikan lewat localhost.
2. Klik **Connect**, pilih jam (nama biasanya berawalan `SW`).
3. Waktu dikirim otomatis; tombol **Sinkronkan waktu** untuk mengulang.
4. Tab **Face bawaan** menampilkan index dari `0x84`; klik untuk memakai.
5. Tab **Katalog** memuat tag + face. Bila muncul pesan CORS, jalankan
   `node web/proxy.mjs`, pastikan kolom **Proxy CORS** berisi
   `http://localhost:8787`, lalu klik **Terapkan**.
6. Tab **Upload** menerima `.bin` (generic/JieLi) atau `.zip` (Sifli).
7. Panel **Log paket** menampilkan hex TX/RX; tombol **Salin** untuk laporan.

Tidak ada data akun yang dikirim. Satu-satunya header tambahan adalah
`Accept-Language`, dan hanya endpoint `/faces/*` yang dipanggil.
