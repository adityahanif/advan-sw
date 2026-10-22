/*
 * app.js — ADVAN SW (CRREPA BLE) : sync waktu + manajemen watchface.
 *
 * Hanya command yang ada di INSTRUKSI_AGENT_ADVAN_SW.md:
 *   0x31 waktu, 0xBB zona waktu, 0xBA info, 0xB4 layar/storage,
 *   0xA6 / 0x29 / 0x19 / 0x84 face bawaan, 116/110/0xB7 transfer file.     
 * Notifikasi command lain diabaikan diam-diam.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var SVC_FEEA = '0000feea-0000-1000-8000-00805f9b34fb';
  var SVC_180A = '0000180a-0000-1000-8000-00805f9b34fb';
  var PLATFORM = {
    2: 'HAN/HsMcu', 3: 'RealTek', 4: 'Goodix',
    5: 'Sifli', 6: 'JieLi', 7: 'Bluetrum', 8: 'Hisilicon'
  };

  function u128(id) {
    return '0000' + ('000' + id.toString(16)).slice(-4) + '-0000-1000-8000-00805f9b34fb';
  }

  // ---------------------------------------------------------------- helpers

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function concat(a, b) {
    var o = new Uint8Array(a.length + b.length);
    o.set(a, 0); o.set(b, a.length);
    return o;
  }

  function u16be(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32le(b, o) {
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }
  function u32beBytes(n) {
    return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  }
  function u32leBytes(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }

  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function hex(bytes, max) {
    var n = Math.min(bytes.length, max || 96);
    var parts = [];
    for (var i = 0; i < n; i++) parts.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
    return parts.join(' ') + (bytes.length > n ? ' …' : '');
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  // ---------------------------------------------------------------- state

  var st = {
    device: null, server: null, ch: {}, connected: false,
    version: 'V2', mfr: '', fwVersion: '', pktSize: 244,
    platform: null, firmwareType: '', chipId: null, feature: 0,
    screen: null, storage: null, devicePacketLen: 0,
    jieliApi: null, jieliFunc: null, faceMax: null, faceTypes: [],
    faces: [], currentFace: null, faceIds: [], tpls: '',
    rxBuf: new Uint8Array(0), waiters: [],
    transfer: null, sifli: null, lastSync: null,
    catalog: null, catPage: 1, catSizes: {},
    installBaseline: null, newFaceIndex: null,
  };

  // ---------------------------------------------------------------- log

  var logEl = $('log');
  var logCount = 0;

  function log(text, cls) {
    if (logCount > 1400) { logEl.textContent = ''; logCount = 0; }
    var s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text + '\n';
    logEl.appendChild(s);
    logCount++;
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---------------------------------------------------------------- framing

  function buildFrame(cmd, payload) {
    var p = payload || new Uint8Array(0);
    var total = p.length + 5;
    var type;
    if (st.pktSize === 20) type = 0x10;
    else if (total > 255) type = 0x20 + (total >> 8);
    else type = 0x20;
    var f = new Uint8Array(total);
    f[0] = 0xfe; f[1] = 0xea; f[2] = type; f[3] = total & 0xff; f[4] = cmd & 0xff;
    f.set(p, 5);
    return f;
  }

  function onNotify(ev) {
    var v = ev.target.value;
    var chunk = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    log('RX ' + hex(chunk, 64), 'rx');

    st.rxBuf = concat(st.rxBuf, chunk);
    if (st.rxBuf.length > 8192) st.rxBuf = new Uint8Array(0);

    while (st.rxBuf.length >= 5) {
      if (!(st.rxBuf[0] === 0xfe && st.rxBuf[1] === 0xea)) {
        var s = 1;
        while (s + 1 < st.rxBuf.length && !(st.rxBuf[s] === 0xfe && st.rxBuf[s + 1] === 0xea)) s++;
        st.rxBuf = st.rxBuf.subarray(s);
        if (st.rxBuf.length < 5) return;
        if (!(st.rxBuf[0] === 0xfe && st.rxBuf[1] === 0xea)) { st.rxBuf = st.rxBuf.subarray(1); continue; }
      }
      var type = st.rxBuf[2];
      var low = st.rxBuf[3];
      var len = type === 0x10 ? low : (((type & 1) << 8) | low);
      if (len < 5 || len > 1024) { st.rxBuf = st.rxBuf.subarray(1); continue; }
      if (st.rxBuf.length < len) return;
      var frame = st.rxBuf.slice(0, len);
      st.rxBuf = st.rxBuf.subarray(len);
      handleFrame(frame);
    }
  }

  function handleFrame(f) {
    var cmd = f[4];
    var p = f.subarray(5);
    resolveWaiters(cmd, p);

    switch (cmd) {
      case 0xba: onDeviceInfo(p); break;    // -70
      case 0xb4: onWatchFaceMeta(p); break; // -76
      case 0x84: onFaceSupport(p); break;   // -124
      case 0x29: onCurrentFace(p); break;   // 41
      case 0xa6: onFaceList(p); break;      // -90: daftar face terpasang
      case 0x5a: onFaceList(p); break;      // 90: varian firmware lama
      case 0x74: onTransfer(116, p); break; // 116
      case 0x6e: onTransfer(110, p); break; // 110
      case 0xf3: onTransfer(110, p); break; // polling index JieLi
      case 0xb7: onSifliIndex(p); break;    // -73
      default: break;                       // command lain: abaikan
    }
  }

  // ---------------------------------------------------------------- waiters

  function waitFor(cmd, pred, ms) {
    return new Promise(function (resolve) {
      var w = { cmd: cmd, pred: pred || function () { return true; }, resolve: resolve, done: false };
      w.timer = setTimeout(function () { finishWaiter(w, null); }, ms || 1200);
      st.waiters.push(w);
    });
  }

  function finishWaiter(w, val) {
    if (w.done) return;
    w.done = true;
    clearTimeout(w.timer);
    var i = st.waiters.indexOf(w);
    if (i >= 0) st.waiters.splice(i, 1);
    w.resolve(val);
  }

  function resolveWaiters(cmd, p) {
    st.waiters.slice().forEach(function (w) {
      if (w.cmd === cmd && w.pred(p)) finishWaiter(w, p);
    });
  }

  // ---------------------------------------------------------------- TX

  async function send(cmd, payload) {
    if (!st.ch.FEE2) throw new Error('FEE2 belum siap.');
    var frame = buildFrame(cmd, payload);
    log('TX ' + hex(frame, 96), 'tx');
    var ch = st.ch.FEE2;
    var props = ch.properties || {};
    if (props.write && ch.writeValueWithResponse) await ch.writeValueWithResponse(frame);
    else if (props.writeWithoutResponse && ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(frame);
    else await ch.writeValue(frame);
  }

  async function writeRaw(ch, bytes) {
    var props = ch.properties || {};
    if (props.writeWithoutResponse && ch.writeValueWithoutResponse) {
      await ch.writeValueWithoutResponse(bytes);
    } else if (props.write && ch.writeValueWithResponse) {
      await ch.writeValueWithResponse(bytes);
    } else {
      await ch.writeValue(bytes);
    }
  }

  // ---------------------------------------------------------------- inbound handlers

  function onDeviceInfo(p) {
    if (!p.length) return;
    if (p[0] === 0) {
      if (p.length < 6) return;
      var ft = '';
      for (var i = 1; i <= 3 && i < p.length; i++) ft += String.fromCharCode(p[i]);
      st.firmwareType = ft.replace(/\0/g, '').trim();
      st.platform = p[4];
      st.chipId = p[5];
      st.feature = p.length > 7 ? (p[6] | (p[7] << 8)) : (p[6] || 0);
      renderDevice();
      log('Info perangkat: ' + st.firmwareType + ' · platform ' + st.platform +
        ' (' + (PLATFORM[st.platform] || 'tidak dikenal') + ') · chip ' + st.chipId +
        ' · fitur 0x' + st.feature.toString(16), 'info');
    } else if (p[0] === 1) {
      if (p.length < 3) return;
      st.devicePacketLen = u16le(p, 1);
      log('Panjang chunk perangkat (0xBA/1): ' + st.devicePacketLen, 'info');
      // gm8 (JieLi) memakai nilai ini bila jam mengirimnya setelah start 116.
      // Batas ikut 8192→65536: SE1 (JL7012F6) menjawab 0x2800 = 10240 byte;
      // jika diabaikan, jam menunggu chunk 10240 yang tak pernah penuh → "Memuat" bertahan.
      var t = st.transfer;
      if (t && t.sent === 0 && st.devicePacketLen >= 20 && st.devicePacketLen <= 65536) {
        t.chunk = st.devicePacketLen;
        log('Chunk upload disesuaikan ke ' + t.chunk + ' byte.', 'info');
      }
    } else if (p[0] === 2) {
      if (p.length < 3) return;
      st.jieliApi = p[1];
      st.jieliFunc = p[2];
      log('Face JieLi: api_ver ' + st.jieliApi + ' · func_ver 0x' +
        st.jieliFunc.toString(16), 'info');
    }
  }

  function onWatchFaceMeta(p) {
    if (!p.length) return;
    if (p[0] === 20 && p.length >= 13) {
      st.screen = {
        w: u16le(p, 1), h: u16le(p, 3),
        radius: u16le(p, 5),
        thumbW: u16le(p, 7), thumbH: u16le(p, 9)
      };
      renderDevice();
      log('Layar: ' + st.screen.w + '×' + st.screen.h + ' px' +
        (st.screen.radius ? ' · radius ' + st.screen.radius : ''), 'info');
    } else if (p[0] === 6) {
      if (p.length >= 5) st.storage = u32le(p, 1);
      else if (p.length >= 3) st.storage = u16le(p, 1);
      else return;
      renderDevice();
      log('Storage dilaporkan: ' + fmtBytes(st.storage), 'info');
    } else if (p[0] === 16 && p.length >= 9) {
      var display = u32le(p, 1);
      st.faceMax = u32le(p, 5);
      st.faceTypes = Array.prototype.slice.call(p.slice(9));
      if (st.faceTypes.length) {
        st.tpls = st.faceTypes.join(',');
        if (!$('catTpls').value) $('catTpls').value = st.tpls;
      }
      if (st.storage == null) st.storage = st.faceMax;
      renderDevice();
      log('Face JieLi (0xB4/16): tampil ' + (display > 0 ? display : '—') +
        ' · storage ' + fmtBytes(st.faceMax) + ' · tipe ' + (st.tpls || '—'), 'info');
    }
  }

  function onFaceSupport(p) {
    if (p.length < 2) {
      log('0x84 dijawab' + (p.length ? ' dengan ' + p.length + ' byte' : ' kosong') +
        ' — daftar face belum terbaca.', 'dim');
      return;
    }
    st.currentFace = u16be(p, 0);
    st.faces = Array.prototype.slice.call(p.slice(2));
    st.tpls = st.faces.join(',');
    if (!st.tpls) st.tpls = '1';
    if (!$('catTpls').value) $('catTpls').value = st.tpls;
    renderFaces();
    log('Face didukung: ' + st.faces.length + ' · index aktif ' + st.currentFace, 'info');
  }

  function onCurrentFace(p) {
    if (!p.length) return;
    st.currentFace = p[0];
    renderFaces();
  }

  function onFaceList(p) {
    if (p.length < 2 || p[0] !== 1) return;
    var count = p[1];
    var rows = [];
    for (var i = 2; i + 3 < p.length && rows.length < count; i += 4) {
      rows.push({ id: p[i], type: p[i + 1], size: u16be(p, i + 2) });
    }
    st.faceIds = rows;
    renderFaceIds();
    log('Daftar face terpasang (0xA6): ' + rows.length + ' entri', 'info');
  }

  // ---------------------------------------------------------------- render

  function renderDevice() {
    $('iName').textContent = st.device && st.device.name ? st.device.name : '—';
    $('iProto').textContent = st.version + (st.mfr ? ' · ' + st.mfr : ' · 2A29 tidak terbaca');
    $('iChip').textContent = st.platform == null
      ? '—'
      : (PLATFORM[st.platform] || 'tidak dikenal') + ' · platform ' + st.platform + ' · chip ' + st.chipId;
    $('iFw').textContent = [st.firmwareType, st.fwVersion].filter(Boolean).join(' · ') || '—';
    $('iScreen').textContent = st.screen
      ? st.screen.w + '×' + st.screen.h + ' px' + (st.screen.radius ? ' · radius ' + st.screen.radius : '')
      : '—';
    $('iStorage').textContent = st.storage != null ? fmtBytes(st.storage) : 'tidak dilaporkan';
  }

  function renderFaces() {
    var grid = $('faceGrid');
    grid.textContent = '';
    if (!st.faces.length) {
      var h = document.createElement('p');
      h.className = 'hint';
      h.textContent = 'Belum ada data. Klik "Muat ulang".';
      grid.appendChild(h);
    } else {
      st.faces.forEach(function (type, i) {
        var row = document.createElement('div');
        row.className = 'face' + (st.currentFace === i ? ' active' : '');
        var name = document.createElement('span');
        name.className = 'name';
        var big = document.createElement('b');
        big.textContent = '#' + i;
        var small = document.createElement('small');
        small.textContent = 'tipe ' + type;
        name.appendChild(big); name.appendChild(small);
        row.appendChild(name);
        if (st.currentFace === i) {
          var badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = 'AKTIF';
          row.appendChild(badge);
        }
        var b = document.createElement('button');
        b.className = 'small';
        b.textContent = 'Pakai';
        b.onclick = function () { switchFace(i); };
        row.appendChild(b);
        grid.appendChild(row);
      });
    }
    $('faceNow').textContent = st.currentFace != null
      ? 'Index aktif: #' + st.currentFace + ' · klik kartu untuk memakai'
      : 'Index aktif belum dibaca.';
  }

  function renderFaceIds() {
    var box = $('faceIdsBox');
    var body = $('faceIdsBody');
    body.textContent = '';
    if (!st.faceIds.length) { box.hidden = true; return; }
    st.faceIds.forEach(function (r) {
      var tr = document.createElement('tr');
      var td1 = document.createElement('td'); td1.textContent = r.id;
      var td2 = document.createElement('td');
      td2.textContent = (r.type >= 32 && r.type < 127) ? String.fromCharCode(r.type) : '0x' + r.type.toString(16);
      var td3 = document.createElement('td'); td3.className = 'num'; td3.textContent = fmtBytes(r.size);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      body.appendChild(tr);
    });
    box.hidden = false;
  }

  function setStatus(kind, text) {
    var el = $('status');
    el.className = 'pill' + (kind ? ' ' + kind : '');
    el.lastElementChild.textContent = text;
  }

  // ---------------------------------------------------------------- connect

  async function connect() {
    if (st.connected) return;
    if (!navigator.bluetooth) {
      setStatus('err', 'Web Bluetooth tidak tersedia');
      log('Browser ini tidak mendukung Web Bluetooth. Pakai Chrome/Edge.', 'err');
      return;
    }
    try {
      setStatus('busy', 'Memilih perangkat…');
      var device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [SVC_FEEA, SVC_180A]
      });

      st.device = device;
      device.addEventListener('gattserverdisconnected', onDisconnected);
      $('iName').textContent = device.name || '(tanpa nama)';

      setStatus('busy', 'Menyambung…');
      st.server = await device.gatt.connect();

      try {
        var info = await st.server.getPrimaryService(SVC_180A);
        try {
          var c29 = await info.getCharacteristic(u128(0x2a29));
          st.mfr = (new TextDecoder().decode(await c29.readValue()) || '').trim();
        } catch (e) { /* opsional */ }
        try {
          var c28 = await info.getCharacteristic(u128(0x2a28));
          st.fwVersion = (new TextDecoder().decode(await c28.readValue()) || '').trim();
          if (st.fwVersion) $('catFv').value = st.fwVersion;
        } catch (e) { /* opsional */ }
      } catch (e) {
        log('Service 180A tidak tersedia.', 'dim');
      }

      var svc = await st.server.getPrimaryService(SVC_FEEA);
      var wanted = { FEE1: 0xfee1, FEE2: 0xfee2, FEE3: 0xfee3, FEE6: 0xfee6, FEE9: 0xfee9 };
      await Promise.all(Object.keys(wanted).map(async function (key) {
        try { st.ch[key] = await svc.getCharacteristic(u128(wanted[key])); } catch (e) { /* opsional */ }
      }));

      if (!st.ch.FEE2 || !st.ch.FEE3) throw new Error('FEE2/FEE3 tidak ditemukan di service FEEA.');

      await st.ch.FEE3.startNotifications();
      st.ch.FEE3.addEventListener('characteristicvaluechanged', onNotify);

      var m = st.mfr.toUpperCase();
      st.version = m.indexOf('V3') >= 0 ? 'V3' : m.indexOf('V2') >= 0 ? 'V2' : (m === 'MOYOUNG' ? 'V1' : 'V2');
      st.pktSize = st.version === 'V1' ? 20 : 244;

      st.connected = true;
      enableUI(true);
      setStatus('on', 'Terhubung — ' + (device.name || 'perangkat'));
      renderDevice();
      log('Terhubung. Protokol ' + st.version + (st.mfr ? ' (' + st.mfr + ')' : '') +
        ', ukuran paket ' + st.pktSize, 'info');

      await sleep(250);
      await syncTime(true);
      await queryAll();
    } catch (e) {
      log('Connect gagal: ' + e.message, 'err');
      setStatus('err', 'Gagal: ' + e.message);
      cleanupDisconnected();
      try { if (st.device && st.device.gatt.connected) st.device.gatt.disconnect(); } catch (x) { /* ignore */ }
    }
  }

  function cleanupDisconnected() {
    st.connected = false;
    st.server = null;
    st.ch = {};
    st.rxBuf = new Uint8Array(0);
    st.waiters.length = 0;
    st.transfer = null;
    st.sifli = null;
    st.faces = [];
    st.currentFace = null;
    st.faceIds = [];
    st.screen = null;
    st.storage = null;
    st.platform = null;
    st.devicePacketLen = 0;
    st.jieliApi = null;
    st.jieliFunc = null;
    st.faceMax = null;
    st.faceTypes = [];
    st.catalog = null;
    enableUI(false);
    $('faceGrid').textContent = '';
    $('faceIdsBox').hidden = true;
    $('newFaceOffer').hidden = true;
    st.newFaceIndex = null;
    st.installBaseline = null;
    $('catGrid').textContent = '';
    $('catTag').textContent = '';
    $('btnCatMore').hidden = true;
    $('upBarBox').hidden = true;
    $('upMsg').textContent = '';
    $('fileInfo').textContent = '—';
  }

  function onDisconnected() {
    var was = st.connected;
    cleanupDisconnected();
    setStatus('', 'Terputus');
    if (was) log('Koneksi terputus.', 'err');
  }

  function enableUI(on) {
    $('btnConnect').disabled = on;
    $('btnDisconnect').disabled = !on;
    ['btnSync', 'btnFacesReload', 'btnFaceNow', 'btnCatalogReload', 'btnFaceGallery'].forEach(function (id) {
      $(id).disabled = !on;
    });
    $('btnFaceGallery').hidden = !on;
    $('deviceCard').hidden = !on;
    $('timeCard').hidden = !on;
    $('facesCard').hidden = !on;
    $('catalogCard').hidden = !on;
    $('uploadCard').hidden = !on;
    updateUploadButton();
  }

  // ---------------------------------------------------------------- time

  async function syncTime(quiet) {
    if (!st.connected) return;
    var now = new Date();
    var epoch = Math.floor(Date.UTC(
      now.getFullYear(), now.getMonth(), now.getDate(),
      now.getHours(), now.getMinutes(), now.getSeconds()
    ) / 1000) - 8 * 3600;

    var p = new Uint8Array(5);
    p[0] = (epoch >>> 24) & 255;
    p[1] = (epoch >>> 16) & 255;
    p[2] = (epoch >>> 8) & 255;
    p[3] = epoch & 255;
    p[4] = 8;
    await send(0x31, p);

    var off = -now.getTimezoneOffset() * 60;
    var tz = new Uint8Array(6);
    tz[0] = 7; tz[1] = 0;
    tz[2] = off & 255;
    tz[3] = (off >> 8) & 255;
    tz[4] = (off >> 16) & 255;
    tz[5] = (off >> 24) & 255;
    await send(0xbb, tz);

    st.lastSync = now;
    $('syncInfo').textContent = 'Terakhir: ' + now.toLocaleString() +
      ' · zona waktu ' + (off / 3600).toFixed(1) + ' jam';
    if (!quiet) log('Waktu disinkronkan: ' + now.toLocaleString() +
      ' (offset ' + off + ' dtk)', 'info');
  }

  // ---------------------------------------------------------------- queries

  async function queryAll() {
    await queryDeviceInfo();
    await queryJieli();
    await queryPacketLen();
    await queryScreen();
    await queryStorage();
    await queryFaces();
    await queryFaceIds();
  }

  async function queryDeviceInfo() {
    var w = waitFor(0xba, function (p) { return p.length && p[0] === 0; }, 1600);
    await send(0xba, Uint8Array.of(0));
    await w;
  }

  async function queryJieli() {
    if (st.platform !== 6) return;
    var wApi = waitFor(0xba, function (p) { return p.length >= 3 && p[0] === 2; }, 1200);
    await send(0xba, Uint8Array.of(2));
    await wApi;
    var wFace = waitFor(0xb4, function (p) { return p.length >= 9 && p[0] === 16; }, 1200);
    await send(0xb4, Uint8Array.of(16));
    await wFace;
  }

  async function queryPacketLen() {
    var w = waitFor(0xba, function (p) { return p.length >= 3 && p[0] === 1; }, 1200);
    await send(0xba, Uint8Array.of(1));
    await w;
  }

  async function queryScreen() {
    var w = waitFor(0xb4, function (p) { return p.length >= 13 && p[0] === 20; }, 1500);
    await send(0xb4, Uint8Array.of(20));
    await w;
  }

  async function queryStorage() {
    var w = waitFor(0xb4, function (p) { return p.length >= 2 && p[0] === 6; }, 1200);
    await send(0xb4, Uint8Array.of(6));
    var p = await w;
    if (!p) log('Sisa storage tidak dilaporkan jam (0xB4/6 tidak dijawab).', 'dim');
  }

  async function queryFaces() {
    var w = waitFor(0x84, function () { return true; }, 1500);
    await send(0x84, null);
    await w;
  }

  async function queryFaceIds() {
    var w = waitFor(0xa6, function (p) { return p.length >= 2 && p[0] === 1; }, 1500);
    await send(0xa6, Uint8Array.of(1));
    await w;
  }

  async function queryCurrentFace() {
    var w = waitFor(0x29, function () { return true; }, 1200);
    await send(0x29, null);
    await w;
  }

  async function switchFace(i) {
    if (!st.connected || !st.ch.FEE2) return;
    try {
      var w = waitFor(0x29, function () { return true; }, 1500);
      await send(0x19, Uint8Array.of(i & 0xff));
      var p = await w;
      if (p) log('Face #' + i + ' dipakai.', 'info');
      await sleep(350);
      await queryCurrentFace();
    } catch (e) {
      log('Ganti face gagal: ' + e.message, 'err');
    }
  }

  // ---------------------------------------------------------------- CRC16

  function crc16(bytes) {
    var crc = 0xfeea;
    for (var i = 0; i < bytes.length; i++) {
      var a = ((((crc & 0xff) << 8) | ((crc >>> 8) & 0xff)) ^ bytes[i]) & 0xffff;
      var b = a ^ ((a & 0xff) >> 4);
      var c = b ^ ((b & 0xff) << 12);
      crc = (c ^ ((c & 0xff) << 5)) & 0xffff;
    }
    return crc;
  }

  // ---------------------------------------------------------------- transfer generic

  function armWatchdog() {
    var t = st.transfer;
    if (!t) return;
    clearTimeout(t.timer);
    t.timer = setTimeout(function () {
      if (st.transfer === t) {
        log('Upload timeout: perangkat tidak meminta chunk. File ' + fmtBytes(t.data.length) +
          (st.faceMax ? ' / batas face ' + fmtBytes(st.faceMax) : '') +
          ' · tipe face ' + (st.tpls || '—') + '.', 'err');
        st.transfer = null;
        showUploadMsg('Timeout. Perangkat tidak meminta data. Coba face lebih kecil ' +
          'atau cek tipe face jam.', true);
        updateUploadButton();
      }
    }, 25000);
  }

  function onTransfer(cmd, p) {
    var t = st.transfer;
    if (!t || t.cmd !== cmd || p.length < 2) return;
    armWatchdog();

    if (p[0] === 0xff && p[1] === 0xff) {
      var devCrc = p.length >= 4 ? u16be(p, 2) : ((p[1] << 8) | p[0]);
      var ok = devCrc === t.crc;
      var reply = new Uint8Array(4);
      if (!ok) reply.fill(0xff);
      send(cmd, reply).catch(function (e) { log('Gagal kirim hasil CRC: ' + e.message, 'err'); });
      finishTransfer(ok, devCrc);
      return;
    }

    var idx = u16be(p, 0);
    log('Jam minta chunk ' + idx + '.', 'rx');
    if (t.busy) { t.pending = idx; return; }
    runChunk(idx);
  }

  function runChunk(idx) {
    var t = st.transfer;
    if (!t) return;
    t.busy = true;
    sendChunk(idx)
      .catch(function (e) {
        log('Chunk gagal: ' + e.message, 'err');
        abortTransfer(e.message);
      })
      .then(function () {
        if (st.transfer !== t) return;
        t.busy = false;
        if (t.pending != null) {
          var next = t.pending;
          t.pending = null;
          runChunk(next);
        }
      });
  }

  async function sendChunk(idx) {
    var t = st.transfer;
    if (!t) return;
    var start = idx * t.chunk;
    if (start >= t.data.length) throw new Error('index chunk ' + idx + ' di luar file');

    var part = t.data.subarray(start, Math.min(start + t.chunk, t.data.length));
    var ch = st.ch.FEE6 || st.ch.FEE2;
    if (!ch) throw new Error('FEE6/FEE2 tidak tersedia');

    var ws = t.writeSize;
    var wCount = 0;
    for (var o = 0; o < part.length; o += ws) {
      await writeRaw(ch, part.subarray(o, Math.min(o + ws, part.length)));
      wCount++;
      if ((o / ws) % 16 === 15) await sleep(1);
    }
    t.sent = start + part.length;
    showProgress(t.sent / t.data.length);
    log('TX chunk ' + idx + ': ' + part.length + ' B → ' + (st.ch.FEE6 ? 'FEE6' : 'FEE2') +
      ' (' + wCount + ' tulis)', 'tx');
  }

  function finishTransfer(ok, devCrc) {
    var t = st.transfer;
    if (!t) return;
    clearTimeout(t.timer);
    st.transfer = null;
    var msg = 'Upload selesai. CRC jam 0x' + hex4(devCrc) + ', lokal 0x' + hex4(t.crc) +
      ' → ' + (ok ? 'OK' : 'TIDAK COCOK');
    log(msg, ok ? 'info' : 'err');
    showUploadMsg(ok ? 'Selesai. CRC cocok.' : 'Selesai, tetapi CRC tidak cocok.', !ok);
    updateUploadButton();
    if (!ok) return;
    // Face custom tidak masuk daftar 0x84/0xA6 — tersimpan di slot galeri dan
    // harus diaktifkan dengan [0x19][0x0D] (SET_DISPLAY_WATCH_FACE, slot 13),
    // sesuai dawfu/dafit-canvas (APPLY_FACE_GALLERY).
    send(0x19, Uint8Array.of(0x0d))
      .then(function () {
        log('Perintah pakai face galeri (0x19/13) dikirim.', 'info');
      }, function (e) {
        log('Gagal kirim 0x19 (pakai face): ' + e.message, 'err');
      })
      .then(function () { refreshAfterInstall(); });
  }

  function abortTransfer(reason) {
    var t = st.transfer;
    if (t) clearTimeout(t.timer);
    st.transfer = null;
    if (st.sifli) { clearTimeout(st.sifli.timer); st.sifli = null; }
    showUploadMsg('Upload gagal: ' + reason, true);
    updateUploadButton();
  }

  function hex4(n) {
    return ('0000' + (n & 0xffff).toString(16)).slice(-4);
  }

  // ---------------------------------------------------------------- upload entry

  var uploadBytes = null;

  function showProgress(p) {
    $('upBarBox').hidden = false;
    $('upBar').style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
  }

  function showUploadMsg(text, isErr) {
    var el = $('upMsg');
    el.textContent = text || '';
    el.style.color = isErr ? 'var(--err)' : '';
  }

  function updateUploadButton() {
    $('btnUpload').disabled = !(st.connected && uploadBytes && uploadBytes.length &&
      !st.transfer && !st.sifli);
  }

  function resolveMode() {
    var v = $('upMode').value;
    if (v === 'auto') {
      if (st.platform === 8) throw new Error('Jalur Hisilicon belum didukung.');
      if (st.platform === 5) return 'sifli';
      return '116';
    }
    return v;
  }

  async function runInstall(bytes, label, mode) {
    if (!bytes || !bytes.length) throw new Error('File kosong.');
    if (st.transfer || st.sifli) throw new Error('Masih ada transfer berjalan.');
    if (st.version === 'V1') throw new Error('Upload pada protokol V1 belum didukung.');

    st.installBaseline = st.faces.length;
    st.newFaceIndex = null;
    $('newFaceOffer').hidden = true;

    if (st.faceMax != null && st.faceMax > 0 && bytes.length > st.faceMax) {
      throw new Error('File ' + fmtBytes(bytes.length) + ' melebihi batas face jam (' +
        fmtBytes(st.faceMax) + '). Pilih face yang lebih kecil.');
    }

    var chunk = clamp(Number($('chunkSize').value) || 244, 20, 8192);
    var ws = clamp(Number($('writeSize').value) || 20, 1, 512);

    if (st.storage != null && bytes.length > st.storage) {
      log('Peringatan: file ' + fmtBytes(bytes.length) + ' melebihi storage yang dilaporkan (' +
        fmtBytes(st.storage) + ').', 'err');
    }

    // Jalur JieLi (gm8) tidak mengirim 0xBA/1 sebelum start; query itu hanya
    // dipakai jalur generic (ue8). Nilai dari connect tetap dipakai bila ada.
    if (st.platform === 6) {
      if (st.devicePacketLen >= 20 && st.devicePacketLen <= 65536) chunk = st.devicePacketLen;
    } else {
      try {
        var w = waitFor(0xba, function (p) { return p.length >= 3 && p[0] === 1; }, 2000);
        await send(0xba, Uint8Array.of(1));
        var rep = await w;
        if (rep) {
          var n = u16le(rep, 1);
          if (n >= 20 && n <= 65536) chunk = n;
        }
      } catch (e) { /* lanjut dengan input manual */ }
    }

    showProgress(0);
    showUploadMsg('Mengirim ' + (label || 'file') + ' …', false);

    if (mode === 'sifli') { await startSifli(bytes, ws); return; }

    var cmd = mode === '110' ? 110 : 116;
    st.transfer = {
      cmd: cmd, data: bytes, chunk: chunk, writeSize: ws,
      sent: 0, crc: crc16(bytes), timer: null,
      busy: false, pending: null
    };
    armWatchdog();
    log('Upload "' + (label || 'file') + '": ' + fmtBytes(bytes.length) +
      ' · cmd ' + cmd + ' · chunk ' + chunk + ' · tulis ' + ws + ' byte', 'info');
    await send(cmd, u32beBytes(bytes.length));
    updateUploadButton();
  }

  async function startUpload() {
    var mode;
    try { mode = resolveMode(); }
    catch (e) { showUploadMsg(e.message, true); return; }
    try {
      await runInstall(uploadBytes, $('fileInput').files[0] ? $('fileInput').files[0].name : 'file', mode);
    } catch (e) {
      log('Upload gagal: ' + e.message, 'err');
      showUploadMsg('Upload gagal: ' + e.message, true);
      abortTransfer(e.message);
    }
  }

  async function refreshAfterInstall() {
    await sleep(800);
    if (!st.connected) return;
    // Jam baru selesai CRC saat ditanya; flash bisa belum selesai ditulis,
    // jadi daftar face di-poll berkala hingga muncul (maks ~15 dtk).
    var registered = st.installBaseline != null && st.faces.length > st.installBaseline;
    for (var attempt = 1; !registered && attempt <= 5 && st.connected; attempt++) {
      log('Cek daftar face (percobaan ' + attempt + '/5)…', 'dim');
      try { await queryFaces(); } catch (e) { break; }
      await sleep(300);
      try { await queryFaceIds(); } catch (e) { /* 0xA6 boleh tidak dijawab */ }
      registered = st.installBaseline != null && st.faces.length > st.installBaseline;
      if (!registered && attempt < 5) await sleep(2000);
    }
    if (registered) {
      st.newFaceIndex = st.faces.length - 1;
      $('newFaceText').textContent = 'Face baru terpasang di index #' + st.newFaceIndex + '.';
      $('newFaceOffer').hidden = false;
    } else if (st.connected) {
      log('CRC OK tetapi face belum terdaftar di daftar. Tunggu ~1 menit lalu klik ' +
        '"Muat ulang", atau nyalakan ulang jam lalu cek galeri di jam. Bila tetap ' +
        'tidak muncul, format face kemungkinan tidak cocok dengan firmware ini.', 'dim');
    }
    log('Daftar face dimuat ulang. Pilih face dari kartu "Face bawaan".', 'info');
  }

  // ---------------------------------------------------------------- Sifli

  async function startSifli(bytes, ws) {
    if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('Jalur Sifli membutuhkan file ZIP.');
    var files = await unzip(bytes);
    if (files.length !== 4) throw new Error('ZIP Sifli harus berisi tepat 4 file (ditemukan ' + files.length + ').');
    files.sort(function (a, b) { return b.data.length - a.data.length; });

    var total = files.reduce(function (n, f) { return n + f.data.length; }, 0);
    var p = new Uint8Array(6);
    p[0] = 1;
    p.set(u32leBytes(total), 1);
    p[5] = 4;

    st.sifli = { files: files, index: 0, file: null, writeSize: ws, timer: null };
    log('Sifli: 4 file, total ' + fmtBytes(total) + '.', 'info');
    await send(0xb4, p);
    await sifliNext();
  }

  function armSifliWatchdog() {
    var s = st.sifli;
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(function () {
      if (st.sifli === s) {
        log('Sifli timeout: perangkat tidak meminta data.', 'err');
        st.sifli = null;
        showUploadMsg('Timeout pada jalur Sifli.', true);
        updateUploadButton();
      }
    }, 25000);
  }

  async function sifliNext() {
    var s = st.sifli;
    if (!s) return;
    if (s.index >= s.files.length) { finishSifli(); return; }

    s.file = s.files[s.index];
    armSifliWatchdog();

    var name = new TextEncoder().encode(s.file.name);
    var p = new Uint8Array(7 + name.length);
    p[0] = 0; p[1] = 3;
    p.set(u32leBytes(s.file.data.length), 2);
    p.set(name, 6);            // byte terakhir = 0 (terminator, sesuai SDK)
    log('Sifli file ' + (s.index + 1) + '/4: ' + s.file.name +
      ' (' + fmtBytes(s.file.data.length) + ')', 'info');
    await send(0xb7, p);
  }

  async function onSifliIndex(p) {
    var s = st.sifli;
    if (!s || !s.file || !p.length) return;
    armSifliWatchdog();

    var sub = p[0];
    var body = p.subarray(1);

    // [01][offset LE4] = perangkat minta data pada offset itu
    if (sub === 1) {
      if (body.length < 4) return;
      var off = u32le(body, 0);
      if (off >= s.file.data.length) {
        st.sifli = null;
        showUploadMsg('Sifli: offset di luar ukuran file.', true);
        updateUploadButton();
        return;
      }
      await writeSifliChunk(s, off);
      return;
    }

    // [02][crc...] = file selesai. 2 byte -> CRC LE, 4 byte -> CRC BE di byte 2-3.
    if (sub === 2) {
      var devCrc = null;
      if (body.length === 4) devCrc = (body[2] << 8) | body[3];
      else if (body.length >= 2) devCrc = (body[1] << 8) | body[0];

      var local = crc16(s.file.data);
      var ok = devCrc == null || devCrc === local;
      await send(0xb7, Uint8Array.of(ok ? 3 : 4));
      log('Sifli ' + s.file.name + ': ' + (ok ? 'CRC OK' : 'CRC beda') +
        (devCrc == null ? ' (tanpa CRC)' : ' (0x' + hex4(devCrc) + '/0x' + hex4(local) + ')'),
        ok ? 'info' : 'err');

      if (!ok) {
        st.sifli = null;
        showUploadMsg('Sifli: CRC tidak cocok.', true);
        updateUploadButton();
        return;
      }

      s.index++;
      s.file = null;
      await sleep(700);
      await sifliNext();
      return;
    }

    // [05] = perangkat membatalkan transfer
    if (sub === 5) {
      st.sifli = null;
      showUploadMsg('Sifli: dibatalkan oleh perangkat.', true);
      updateUploadButton();
    }
  }

  async function writeSifliChunk(s, off) {
    var end = Math.min(off + 8192, s.file.data.length);
    var part = s.file.data.subarray(off, end);
    var ch = st.ch.FEE6 || st.ch.FEE2;
    if (!ch) throw new Error('FEE6/FEE2 tidak tersedia');
    for (var o = 0; o < part.length; o += s.writeSize) {
      await writeRaw(ch, part.subarray(o, Math.min(o + s.writeSize, part.length)));
      if ((o / s.writeSize) % 16 === 15) await sleep(1);
    }
    var done = s.index + (end / s.file.data.length);
    showProgress(done / s.files.length);
  }

  function finishSifli() {
    if (st.sifli) clearTimeout(st.sifli.timer);
    st.sifli = null;
    showProgress(1);
    showUploadMsg('Sifli: 4 file terkirim.', false);
    log('Sifli: semua file terkirim.', 'info');
    updateUploadButton();
    refreshAfterInstall();
  }

  // ---------------------------------------------------------------- ZIP (Sifli)

  async function unzip(bytes) {
    if (bytes.length < 22) throw new Error('ZIP terlalu kecil.');
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var eocd = -1;
    var min = Math.max(0, bytes.length - 22 - 65535);
    for (var i = bytes.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP tidak valid (EOCD tidak ditemukan).');

    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    var out = [];

    for (var n = 0; n < count; n++) {
      if (off + 46 > bytes.length || dv.getUint32(off, true) !== 0x02014b50) throw new Error('Struktur ZIP rusak.');
      var method = dv.getUint16(off + 10, true);
      var csize = dv.getUint32(off + 20, true);
      var nlen = dv.getUint16(off + 28, true);
      var elen = dv.getUint16(off + 30, true);
      var clen = dv.getUint16(off + 32, true);
      var loff = dv.getUint32(off + 42, true);
      var name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nlen));

      if (name.charAt(name.length - 1) !== '/') {
        var lnlen = dv.getUint16(loff + 26, true);
        var lelen = dv.getUint16(loff + 28, true);
        var start = loff + 30 + lnlen + lelen;
        var raw = bytes.subarray(start, start + csize);
        if (method === 0) out.push({ name: name, data: raw.slice() });
        else if (method === 8) out.push({ name: name, data: await inflateRaw(raw) });
        else throw new Error('ZIP memakai metode kompresi ' + method + ' yang tidak didukung.');
      }
      off += 46 + nlen + elen + clen;
    }
    return out;
  }

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Browser tidak mendukung DecompressionStream.');
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  // ---------------------------------------------------------------- catalog UI

  function catNotice(msg, isErr) {
    var el = $('catNotice');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = msg;
    el.className = 'notice' + (isErr ? ' err' : '');
  }

  function catMeta(text) { $('catMeta').textContent = text; }

  async function loadCatalog() {
    if (!st.connected) return;
    window.Catalog.setProxy($('catProxy').value);
    var tpls = $('catTpls').value.trim() || st.tpls || '1';
    var fv = $('catFv').value.trim();
    catNotice('');
    catMeta('Memuat katalog…');
    $('catGrid').textContent = '';
    $('btnCatMore').hidden = true;

    try {
      var res = await window.Catalog.open({
        platform: st.platform,
        tpls: tpls,
        fv: fv,
        lang: 'en',
        maxSize: st.faceMax || st.storage || 8000000,
        apiVer: st.jieliApi,
        funcVer: st.jieliFunc
      });
      st.catalog = res;
      st.catPage = 1;
      st.catSizes = {};
      if (res.meta && (res.meta.model || res.meta.firmware)) {
        log('Katalog firmware: ' + [res.meta.firmware, res.meta.model].filter(Boolean).join(' · '), 'info');
      }
      res.tags.forEach(function (t) {
        (t.faces || []).forEach(function (f) {
          if (f.size) st.catSizes[f.id] = f.size;
        });
      });

      var sel = $('catTag');
      sel.textContent = '';
      res.tags.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name;
        sel.appendChild(o);
      });

      catMeta('mode ' + res.mode + ' · fv ' + res.fv + ' · tpls ' + tpls);
      if (res.fallback) {
        catNotice('fv perangkat ' + (fv ? '"' + fv + '" ' : '') + 'tidak dipakai server; katalog memakai fv ' +
          res.fv + '. Filter tpls tetap memakai tipe face jam.', false);
      }
      await loadCatPage(1, true);
    } catch (e) {
      st.catalog = null;
      catMeta('—');
      if (e.cors) {
        catNotice(e.message, true);
      } else {
        catNotice('Katalog gagal dimuat: ' + e.message, true);
      }
      log('Katalog gagal: ' + e.message, 'err');
    }
  }

  async function loadCatPage(page, reset) {
    if (!st.catalog) return;
    var tpls = $('catTpls').value.trim() || st.tpls || '1';
    var tagId = Number($('catTag').value);
    $('btnCatMore').hidden = true;

    try {
      var res = await window.Catalog.faces({
        mode: st.catalog.mode,
        fv: st.catalog.fv,
        tpls: tpls,
        lang: 'en',
        maxSize: st.faceMax || st.storage || 8000000,
        apiVer: st.jieliApi,
        funcVer: st.jieliFunc,
        tagId: tagId,
        page: page
      });
      if (reset) $('catGrid').textContent = '';
      res.faces.forEach(function (f) {
        if (!f.size && st.catSizes) f.size = st.catSizes[f.id] || 0;
      });
      if (!res.faces.length && reset) {
        catNotice('Tidak ada face pada tag ini untuk filter perangkat.', false);
      }
      res.faces.forEach(function (f) { $('catGrid').appendChild(catCard(f)); });
      st.catPage = page;
      $('btnCatMore').hidden = !res.more;
      if (res.total) catMeta(catMetaText(res.total, tpls));
    } catch (e) {
      catNotice('Gagal memuat daftar face: ' + e.message, true);
      log('Daftar katalog gagal: ' + e.message, 'err');
    }
  }

  function catMetaText(total, tpls) {
    var c = st.catalog;
    return 'mode ' + c.mode + ' · fv ' + c.fv + ' · tpls ' + tpls + ' · ' + total + ' face';
  }

  function catCard(face) {
    var card = document.createElement('article');
    card.className = 'cat';

    var img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    if (face.preview) img.src = face.preview;
    else { img.style.background = '#eef0f3'; }
    card.appendChild(img);

    var body = document.createElement('div');
    body.className = 'body';

    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = face.name;
    body.appendChild(name);

    var meta = document.createElement('div');
    meta.className = 'meta';
    var s1 = document.createElement('span'); s1.textContent = face.size ? fmtBytes(face.size) : '—';
    var s2 = document.createElement('span'); s2.textContent = face.download ? face.download + ' unduh' : '';
    meta.appendChild(s1); meta.appendChild(s2);
    body.appendChild(meta);

    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.hidden = true;
    var fill = document.createElement('i');
    bar.appendChild(fill);
    body.appendChild(bar);

    var btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = 'Pasang';
    btn.onclick = function () { installCatalogFace(face, card, btn, bar, fill); };
    body.appendChild(btn);

    card.appendChild(body);
    return card;
  }

  async function installCatalogFace(face, card, btn, bar, fill) {
    if (!st.connected || st.transfer || st.sifli) return;
    btn.disabled = true;
    btn.textContent = 'Mengunduh…';
    bar.hidden = false;

    try {
      var bytes = await window.Catalog.download(face, {
        mode: st.catalog.mode,
        fv: st.catalog.fv,
        tpls: $('catTpls').value.trim() || st.tpls || '1',
        lang: 'en',
        apiVer: st.jieliApi,
        funcVer: st.jieliFunc,
        onProgress: function (p) { fill.style.width = Math.round(p * 100) + '%'; }
      });
      if (!bytes || !bytes.length) throw new Error('file kosong');
      if (face.size && Math.abs(bytes.length - face.size) > 16) {
        log('Ukuran file ' + fmtBytes(bytes.length) + ' berbeda dari metadata ' + fmtBytes(face.size) + '.', 'dim');
      }
      fill.style.width = '100%';
      btn.textContent = 'Memasang…';
      await runInstall(bytes, face.name, 'auto');
      btn.textContent = 'Terpasang';
    } catch (e) {
      log('Pasang face gagal: ' + e.message, 'err');
      showUploadMsg('Pasang gagal: ' + e.message, true);
      btn.textContent = 'Coba lagi';
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------- events

  $('btnConnect').onclick = connect;

  $('btnDisconnect').onclick = function () {
    try { if (st.device && st.device.gatt.connected) st.device.gatt.disconnect(); }
    catch (e) { /* ignore */ }
  };

  $('btnSync').onclick = function () {
    syncTime(false).catch(function (e) { log('Sync gagal: ' + e.message, 'err'); });
  };

  $('btnFacesReload').onclick = function () {
    queryFaces().catch(function (e) { log('Muat face gagal: ' + e.message, 'err'); });
  };

  $('btnFaceNow').onclick = function () {
    queryCurrentFace().catch(function (e) { log('Baca index gagal: ' + e.message, 'err'); });
  };

  $('btnFaceGallery').onclick = async function () {
    if (!st.connected) return;
    try {
      await send(0x19, Uint8Array.of(0x0d));
      log('Perintah pakai face galeri (0x19/13) dikirim. Bila jam punya galeri ' +
        'face bawaan sendiri yang berisi face unduhan, akan tampil sekarang.', 'info');
      await sleep(500);
      await queryCurrentFace();
    } catch (e) {
      log('Gagal pakai face galeri: ' + e.message, 'err');
    }
  };

  $('btnUseNew').onclick = function () {
    if (st.newFaceIndex == null) return;
    $('newFaceOffer').hidden = true;
    switchFace(st.newFaceIndex);
  };

  $('btnCatalogReload').onclick = loadCatalog;

  $('catTag').onchange = function () { loadCatPage(1, true); };

  $('btnCatMore').onclick = function () { loadCatPage(st.catPage + 1, false); };

  $('btnCatApply').onclick = function () {
    window.Catalog.setProxy($('catProxy').value);
    log('Proxy katalog: ' + (window.Catalog.getProxy() || 'langsung'), 'info');
    loadCatalog();
  };

  $('fileInput').onchange = async function () {
    var f = this.files && this.files[0];
    uploadBytes = null;
    updateUploadButton();
    if (!f) { $('fileInfo').textContent = '—'; return; }
    $('fileInfo').textContent = f.name + ' · ' + fmtBytes(f.size) + ' (membaca…)';
    try {
      uploadBytes = new Uint8Array(await f.arrayBuffer());
      $('fileInfo').textContent = f.name + ' · ' + fmtBytes(uploadBytes.length);
    } catch (e) {
      $('fileInfo').textContent = 'Gagal membaca file: ' + e.message;
    }
    updateUploadButton();
  };

  $('btnUpload').onclick = startUpload;

  $('btnLogClear').onclick = function () { logEl.textContent = ''; logCount = 0; };

  $('btnLogCopy').onclick = function () {
    var text = logEl.innerText;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        $('btnLogCopy').textContent = 'Tersalin';
        setTimeout(function () { $('btnLogCopy').textContent = 'Salin'; }, 1200);
      }, function () { log('Gagal menyalin log.', 'err'); });
    } else {
      var r = document.createRange();
      r.selectNodeContents(logEl);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      sel.removeAllRanges();
    }
  };

  // ---------------------------------------------------------------- init

  $('catProxy').value = window.Catalog.getProxy() || 'http://localhost:8787';
  setStatus('', 'Terputus');
  enableUI(false);
  log('Siap. Klik Connect, lalu pilih jam ADVAN SW.', 'dim');
})();
