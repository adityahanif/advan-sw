# ADVAN SW (com.crrepa.band.advansw) — CRREPA BLE Protocol Notes

Hasil reverse engineering statis XAPK `com.crrepa.band.advansw_v2.9.24-2.xapk` (Da Fit rebrand, `bizCode=da_fit`).

Tujuan: sinkronisasi jam + ganti watchface/skin dari laptop (Web Bluetooth), tanpa fitur olahraga.

Semua referensi kelas di bawah dari `jadx_sdk\sources\com\android\mltcode\paycertificationapi\` (SDK BLE CRREPA) dan `jadx_sdk\sources\com\crrepa\i\a.java` (implementasi `CRPBleConnection`).

Perangkat uji: ADVAN SW **SE1**, firmware `MOY-8NM4-2.0.1`. Metadata server
(`meta` pada respons v4) menunjukkan `firmware=8NM`, `mcu=339`,
`model=JL7012F6_QFN52`, `platform=杰理` (**JieLi**). Byte `mcuPlatform` BLE
diperkirakan `6` dan belum dikonfirmasi di hardware.

---

## 1. GATT

Service utama: `0000FEEA-0000-1000-8000-00805F9B34FB`

| Char | UUID | Fungsi |
|---|---|---|
| FEE1 | `0000FEE1-…` | notif langkah / dedicated handler |
| FEE2 | `0000FEE2-…` | write command (write with response) — default |
| FEE3 | `0000FEE3-…` | **notif protokol utama** (masuk ke dispatcher `f()`) |
| FEE5 | `0000FEE5-…` | write channel type 1 |
| FEE6 | `0000FEE6-…` | **write bulk file chunk** (write without response) |
| FEE7/FEE8 | | notif ECG |
| FEE9 | `0000FEE9-…` | channel lain |

Service lain yang dibaca app: `180A` → `2A29` (Manufacturer Name = versi protokol), `180F` → `2A19` (battery), `180D` → `2A37` (HR). Ref: `fi8.java`, `te8.java`.

### Handshake / deteksi versi protokol
1. Baca `180A/2A29`:
   - `"MOYOUNG"` → **V1**
   - `"MOYOUNG-V2"` → **V2**
   - `"MOYOUNG-V3"` → **V3**
   Ref: `ds8.java`, `sq8.java`.
2. V2/V3: request MTU 512, lalu state "connected" baru dianggap siap.
3. Ukuran paket write (di-set setelah handshake): `f = ((min(mtu,250) - 3) - (…%4))`; kalau ≤0 → 20. Ref: `zh8.java` (`j()`, `k()`, `l()`, `m()`). Default MTU 23 → 20 byte.
   - App minta MTU 512 tapi kapasitas dihitung dari `min(mtu, 250)`, jadi maksimum efektif 247 → dibulatkan turun ke kelipatan 4 = **244**.
4. Tidak ada auth/binding/pairing code di SDK.

### Format frame
Keluar (`rl8.a(cmd, payload)`):
```
FE EA type lenLow cmd payload...
```
- `type` = `0x10` bila ukuran paket == 20 (MTU 23), `0x20` normal, `0x20 | (len>>8)` bila total > 255.
- `lenLow` = total panjang frame (payload + 5); saat `type == 0x10` gunakan `lenLow` saja, selain itu `((type & 1) << 8) | lenLow`.
Ref: `rl8.java`, `ce8.b2()`/`a(byte,byte)`.

Masuk: frame bisa terpotong jadi beberapa notifikasi — buffer sampai `len` tercapai (ref: `ce8.b2()`).

---

## 2. Sinkronisasi waktu

Dikirim otomatis tiap connect (`vq0.sendConnectMessage()`), dan pada perubahan waktu sistem (`TimeChangeReceiver`).

1. **cmd 0x31 (49)** — payload 5 byte:
   ```
   [epoch BE 4 byte][08]
   ```
   `epoch` = timestamp Unix dari jam lokal **diperlakukan sebagai GMT+8**, yaitu `Date.UTC(localYYYY, localMM-1, localDD, localHH, localMI, localSS)/1000 - 8*3600`.
   Ref: `f19.b()` (`new SimpleDateFormat("yyyy-MM-dd HH:mm:ss")`, lalu timezone `GMT+8`).
   Byte ke-5 = `8` (konstanta, ikut format).
2. **cmd 0xBB (-69)** — payload 6 byte:
   ```
   [07][00][offsetSeconds int32 LE signed]
   ```
   `offsetSeconds` = `TimeZone.getDefault().getOffset(now)/1000` (sudah termasuk DST).
   Ref: `f19.c()`.

Urutan app: `syncTime()` (cmd 49) lalu `sendCurrentTimezone()` (cmd 0xBB). `a.java:3861`, `a.java:2397`.

---

## 3. Ganti watchface bawaan (built-in)

- **Query daftar**: cmd **0x84 (-124)** payload kosong. Ref: `a.java:1812` (`querySupportWatchFace`) & `rx8.e()`.
  - Respons: cmd **41 (0x29)** → payload `[currentIndex BE 2][daftar index 1 byte…]`. Ref: `ce8.e0()`, `l29.i()`.
  - Respons susulan (sub-query lain dari `querySupportWatchFace`): `0xB4` subcmd `0`, `18`, `16`, `32` → kemampuan photo/video/AI face.
- **Index aktif**: cmd **41** payload kosong → respons 1 byte. Ref: `a.java:1200`, `ce8.e0()`.
- **Ganti index**: cmd **0x19 (25)** payload 1 byte index. Ref: `rx8.b(int)` (`a.java` tidak memakai tanda tangan ini langsung, tapi tersedia di `rx8`).
- **Daftar face dengan ID/tipe**: cmd **0x5A (90)** payload `[01]` → `[01][count][ID 1B][tipe 1B][ukuran 2B BE]…`. Ref: `a.java:2014`, `ce8.U1()`, `l29.m()`.
- Info layar (resolusi/radius): cmd **0xB4** subcmd **20** → `[width LE][height LE][radius LE][thumbW LE][thumbH LE]…`. Ref: `a.java:2022`, `l29.n()`.
- Hapus face: cmd **0xB4** subcmd **19** + count + ID (4 byte LE each). Ref: `rx8.a(int[])`.
- Hisilicon: set face ID cmd **0xB4** subcmd **17** + ID 4 byte LE. Ref: `rx8.a(int,boolean)`.

Jadi untuk "ganti skin" cara paling sederhana & aman: `0x84` → pilih index → `0x19`.

---

## 4. Upload watchface custom (file)

Pemilihan jalur berdasarkan platfrom chip (`CustomizeBandModel.mcuPlatform`):

| mcuPlatform | Platform | Jalur face |
|---|---|---|
| 2 | HAN / HsMcu | DEFAULT |
| 3 | RealTek | DEFAULT |
| 4 | Goodix | DEFAULT |
| 5 | Sifli | SIFLI (ZIP 4 file) |
| 6 | JieLi | JIELI (cmd 110, "UBG CODE") |
| 7 | Bluetrum | JIELI |
| 8 | Hisilicon | HISILICON |

Ref: `tz7.java`, `yn8.java`.

Device info: cmd **0xBA (-70)** subcmd **0** → `[00][firmwareType 3 ASCII][mcuPlatform][chipId][feature LE 2]`.
Ref: `a.java:1152`, `ce8.B0()`, `nt8.java`, `CRPDeviceInfo`.

### 4a. Transfer generik (cmd 0x74 = 116, DEFAULT & SIFLI per-file)
1. App kirim cmd **116** + **ukuran total file 4 byte BE** di FEE2.
2. Device minta index: notif cmd **116**, payload `[index BE 2]` (2 byte) — `0xFFFF` = semua terkirim.
3. App kirim potongan di **FEE6** (write without response), chunk index-based: potongan ke-i = `file[i*chunk .. (i+1)*chunk)`.
   - `chunk` = panjang yang dikirim device lewat cmd **0xBA (-70) subcmd 1** → `[01][lenLo][lenHi]` (LE).
   - Fallback bila tidak ada: `zh8` (244 untuk V2) atau 256.
   - Ref: `bl8.java`, `gm8.java`, `nm8.java`, `ye8.java`, `ce8.o0()`/`S1()`.
4. Setelah semua: device kirim **CRC16 LE** (payload 2–4 byte) → app balas cmd **116** payload `4×00` (ok) / `4×FF` (gagal).
   Ref: `bl8.checkFileCRC()`, `jg8`.
5. CRC16: algoritma CCITT modif, init `0xFEEA`, MSB-first, output 2 byte big-endian. Ref: `yj8.java`.
   Untuk V1 chunk dibungkus: `[FE][crcBE][len][data]` / chunk 64 byte pakai `[FF][FF][crcBE][len][data]` (`ho8.java`).

### 4b. JieLi / Bluetrum (cmd 0x6E = 110)
- Container sama seperti DEFAULT (header `"UBG CODE"` atau `"AI CODE:"`, size LE, descriptor 244 byte, image blob RGB707 + padding `0xFF`, CRC16 di akhir). Ref: `de8.java`, `ef8.java`.
- Transfer: cmd **110** + size 4 byte BE, lalu loop index cmd 110, chunk ke FEE6, CRC check, balas cmd 110 `4×00`/`4×FF`.
- Encoding gambar pakai native `libjl_bmp_convert.so` (`BmpConvert.bmpConvert_native`, `bitmapType` 7=background, 8=hand, `format=1`) — belum cukup untuk reimplementasi JS byte-exact; lihat bagian 7.

### 4c. Sifli
- ZIP berisi tepat 4 file, diurutkan ukuran menurun.
- Total: cmd **0xB4 (-76)** payload `[01][total int32 LE][04]`, lalu tiap file via cmd 116 seperti 4a.
- Ref: `gl8.java`.

---

## 5. Command lain yang berguna

| cmd | Arti |
|---|---|
| `0xBA` sub 0 | device info |
| `0xBA` sub 1 | paket length file transfer |
| `0xBA` sub 2 | info JieLi face: `[02][apiVersion][feature]` |
| `0xBA` sub 3 | max panjang nama device |
| `0xB4` sub 1 | transfer file 4 byte-offset (`jg8(bytes, true)`) |
| `0xB4` sub 6 | sisa storage |
| `0xB4` sub 20/21/22/25/26/28/29/32… | info face / layout / display mode |
| `0xB7` | transfer secondary (offset 4 byte) |

Ref: `ce8.f()` (dispatcher besar), `rx8.java`, `jg8.java`.

---

## 6. Batasan Web Bluetooth (Chrome di laptop)

- Tidak ada API MTU → ukuran chunk harus ditebak: pakai 244 (V2/V3 + MTU tinggi) atau isi manual di UI; verifikasi dari log device.
- `writeValueWithoutResponse` di FEE6 perlu dibatasi dengan `writeValue` berurutan atau antrian kecil (device melakukan polling index, jadi aman: kirim hanya saat diminta).
- Notifikasi FEE3 harus di-`startNotifications()` sebelum handshake.
- `2A29` kadang tidak ada di sebagian device → fallback asumsi V2.

---

## 7. Yang belum / perlu device asli

- Model & chip watch belum diketahui → jalur face (JieLi/Sifli/Hisilicon/DEFAULT) belum pasti. Ambil dari cmd `0xBA` sub 0 (mcuPlatform).
- Encoding RGB707 native (`libjl_bmp_convert.so`) belum byte-exact untuk reimplementasi JS → upload foto custom belum dijamin jalan; ganti face bawaan sudah pasti jalan.
- Konfirmasi chunk size & perilaku write FEE6 perlu uji langsung (log paket).
