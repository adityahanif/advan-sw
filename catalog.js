/*
 * catalog.js — klien katalog watchface moyoung/ADVAN SW.
 *
 * Hanya endpoint watchface yang dipakai:
 *   GET /faces/v4/tag-list, /faces/v4/list, /faces/v4/face-detail   (aplikasi versi ini)
 *   GET /faces/v3/tag-list, /faces/v3/list, /faces/v3/face-detail   (fallback yang terverifikasi)
 *   GET /faces/new/tag-face-list, /faces/new/face-list, /faces/new/face-detail   (JieLi)
 *   GET /faces/sifli/tag-list, /faces/sifli, /faces/sifli/{id}                   (Sifli)
 *
 * Tidak ada token, tanda tangan, atau data akun. Header hanya Accept-Language.
 * Server API tidak mengirim Access-Control-Allow-Origin, jadi fetch langsung
 * diblokir browser. Isi proxy CORS lewat setProxy(); lihat CATATAN_API.md.
 */
window.Catalog = (function () {
  'use strict';

  var ORIGIN = 'https://api.moyoung.com';
  var CACHE_PREFIX = 'advan.catalog.v3.';
  var CACHE_TTL = 6 * 60 * 60 * 1000;
  var FALLBACK_FV = '2023-01-01';   // diterima endpoint v3; lihat CATATAN_API.md

  var EP = {
    v4:     { tags: '/faces/v4/tag-list',       list: '/faces/v4/list',       detail: '/faces/v4/face-detail' },
    v3:     { tags: '/faces/v3/tag-list',       list: '/faces/v3/list',       detail: '/faces/v3/face-detail' },
    jieli:  { tags: '/faces/new/tag-face-list', list: '/faces/new/face-list', detail: '/faces/new/face-detail' },
    sifli:  { tags: '/faces/sifli/tag-list',    list: '/faces/sifli',         detail: null }
  };

  var proxy = '';
  try { proxy = localStorage.getItem('advan.catalog.proxy') || ''; } catch (e) { /* private mode */ }

  function setProxy(url) {
    proxy = String(url || '').trim().replace(/\/+$/, '');
    try {
      if (proxy) localStorage.setItem('advan.catalog.proxy', proxy);
      else localStorage.removeItem('advan.catalog.proxy');
    } catch (e) { /* ignore */ }
    return proxy;
  }

  function getProxy() { return proxy; }

  function clearCache() {
    try {
      Object.keys(localStorage)
        .filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0; })
        .forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  function cacheGet(key) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.t || Date.now() - o.t > CACHE_TTL) return null;
      return o.v;
    } catch (e) { return null; }
  }

  function cacheSet(key, value) {
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value })); }
    catch (e) { /* quota / private mode */ }
  }

  function request(path, params) {
    var qs = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) qs.set(k, String(params[k]));
    });
    var url = (proxy || ORIGIN) + path + '?' + qs.toString();

    return fetch(url, {
      headers: { 'Accept-Language': params.lang || 'en' },
      cache: 'no-store'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }, function () {
      var e = new Error(proxy
        ? 'Proxy CORS tidak bisa dihubungi di ' + proxy +
          '. Jalankan "node web/proxy.mjs", lalu coba lagi.'
        : 'Katalog diblokir CORS. Jalankan "node web/proxy.mjs", isi Proxy CORS ' +
          'http://localhost:8787, lalu klik Terapkan.');
      e.cors = true;
      throw e;
    }).then(function (text) {
      var json;
      try { json = JSON.parse(text); }
      catch (e) { throw new Error('Respons katalog bukan JSON.'); }
      if (json.code !== 0) {
        var err = new Error(json.message || ('kode ' + json.code));
        err.apiCode = json.code;
        throw err;
      }
      return json;
    });
  }

  function paramsFor(mode, o, extra) {
    var p = {
      lang: o.lang || 'en',
      tpls: o.tpls || '1',
      fv: o.fv || '',
      p: 1,
      per_page: 20,
      max_size: o.maxSize || 8000000,
      tested: 'yes'
    };
    if (mode === 'v3' || mode === 'sifli') p.ver = '';
    if (mode === 'sifli') p.key = '';
    if (mode === 'jieli') {
      p.api_ver = o.apiVer != null ? o.apiVer : 0;
      p.func_ver = o.funcVer != null ? o.funcVer : 0;
    }
    return Object.assign(p, extra || {});
  }

  function normalizeTags(json) {
    var data = json.data;
    var arr = Array.isArray(data) ? data : (data && Array.isArray(data.faces) ? data.faces : []);
    return arr.map(function (t) {
      return {
        id: t.id,
        name: t.tag_name || t.name || ('Tag ' + t.id),
        premium: !!t.is_premium,
        faces: Array.isArray(t.faces)
          ? t.faces.map(function (f) { return { id: f.id, size: Number(f.size) || 0 }; })
          : []
      };
    });
  }

  function normalizeFaces(json) {
    var data = json.data;
    var arr = Array.isArray(data) ? data :
              Array.isArray(json.faces) ? json.faces :
              (data && Array.isArray(data.faces)) ? data.faces : [];
    return arr.map(function (f) {
      return {
        id: f.id,
        name: f.name || ('Face ' + f.id),
        preview: f.preview || '',
        file: f.file || '',
        size: Number(f.size) || 0,
        download: Number(f.download) || 0,
        tpls: f.tpls || null
      };
    });
  }

  function fetchTags(mode, o) {
    var key = ['tags', mode, o.tpls, o.fv, o.lang, o.maxSize, o.apiVer, o.funcVer].join('|');
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
    return request(EP[mode].tags, paramsFor(mode, o, { p: 1, per_page: 50 }))
      .then(function (json) {
        var out = { tags: normalizeTags(json), meta: json.meta || null };
        if (out.tags.length) cacheSet(key, out);
        return out;
      });
  }

  /**
   * Pilih mode API yang bisa dipakai, lalu ambil daftar tag.
   * @returns {{mode:string, fv:string, tags:Array, meta:Object|null, fallback:boolean}}
   */
  function open(o) {
    var modes = (o.platform === 5) ? ['sifli'] :
                (o.platform === 6 || o.platform === 7) ? ['v4', 'jieli', 'v3'] :
                ['v4', 'v3'];
    var fvs = [];
    if (o.fv) fvs.push(o.fv);
    if (fvs.indexOf(FALLBACK_FV) < 0) fvs.push(FALLBACK_FV);

    var lastErr = null;
    var metaSeen = null;

    function nextMode(mi) {
      if (mi >= modes.length) {
        throw lastErr || new Error('Katalog tidak tersedia.');
      }
      var mode = modes[mi];

      function nextFv(fi) {
        if (fi >= fvs.length) return nextMode(mi + 1);
        var fv = fvs[fi];
        if (mode === 'v4' && !o.fv) return nextFv(fi + 1); // v4 wajib fv perangkat
        var opt = Object.assign({}, o, { fv: fv });
        return fetchTags(mode, opt).then(function (r) {
          if (r.meta) metaSeen = r.meta;
          if (r.tags.length) {
            return {
              mode: mode, fv: fv, tags: r.tags, meta: r.meta || metaSeen,
              fallback: fv !== o.fv
            };
          }
          return nextFv(fi + 1);
        }, function (err) {
          lastErr = err;
          if (err.cors) throw err;
          // kode -2 (format fv) / -6 (mapping firmware) / -4 (tag) => coba berikutnya
          return nextFv(fi + 1);
        });
      }

      return nextFv(0);
    }

    return Promise.resolve().then(function () { return nextMode(0); });
  }

  /**
   * Ambil satu halaman face untuk tag tertentu.
   * @returns {Promise<{faces:Array, total:number, more:boolean}>}
   */
  function faces(o) {
    var page = o.page || 1;
    var mode = o.mode;
    var key = ['list', mode, o.tpls, o.fv, o.lang, o.maxSize, o.apiVer, o.funcVer, o.tagId, page].join('|');
    var hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);

    if (!EP[mode] || !EP[mode].list) return Promise.reject(new Error('Mode katalog tidak dikenal: ' + mode));

    return request(EP[mode].list, paramsFor(mode, o, {
      tag_id: o.tagId,
      p: page,
      per_page: 20
    })).then(function (json) {
      var list = normalizeFaces(json);
      var total = Number(json.total) || 0;
      var out = {
        faces: list,
        total: total,
        more: list.length >= 20 && (total === 0 || page * 20 < total)
      };
      cacheSet(key, out);
      return out;
    });
  }

  function detailFile(face, o) {
    var ep = EP[o.mode];
    if (!ep) return Promise.reject(new Error('Mode katalog tidak dikenal.'));
    if (o.mode === 'sifli') {
      return request('/faces/sifli/' + face.id, paramsFor('sifli', o, {})).then(function (json) {
        if (!json.data || !json.data.file) throw new Error('File face tidak ada di detail.');
        return json.data.file;
      });
    }
    if (!ep.detail) throw new Error('Detail face tidak tersedia.');
    return request(ep.detail, paramsFor(o.mode, o, { id: face.id })).then(function (json) {
      if (!json.data || !json.data.file) throw new Error('File face tidak ada di detail.');
      return json.data.file;
    });
  }

  function readWithProgress(res, onProgress) {
    var total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !res.body.getReader || !onProgress) {
      return res.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    var reader = res.body.getReader();
    var chunks = [];
    var got = 0;
    return (function pump() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(got);
          var at = 0;
          chunks.forEach(function (c) { out.set(c, at); at += c.length; });
          return out;
        }
        chunks.push(r.value);
        got += r.value.length;
        onProgress(total ? got / total : 0, got, total);
        return pump();
      });
    })();
  }

  /**
   * Unduh file face. File berasal dari CDN. `.bin`/gambar mengirim CORS `*`,
   * tetapi `.zip` Sifli tidak; bila fetch langsung gagal dan proxy diisi,
   * coba lewat proxy (`?url=`).
   * @returns {Promise<Uint8Array>}
   */
  function download(face, o) {
    var chain = face.file ? Promise.resolve(face.file) : detailFile(face, o);
    return chain.then(function (url) {
      function viaProxy() {
        if (!proxy) throw new Error('Unduh diblokir (CORS) dan proxy belum diisi.');
        return fetch(proxy + '?url=' + encodeURIComponent(url), { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('Unduh lewat proxy gagal: HTTP ' + res.status);
            return readWithProgress(res, o.onProgress);
          });
      }
      var isZip = /\.zip(\?|$)/i.test(url);
      if (isZip && proxy) return viaProxy();
      return fetch(url, { cache: 'force-cache' })
        .then(function (res) {
          if (!res.ok) throw new Error('Unduh gagal: HTTP ' + res.status);
          return readWithProgress(res, o.onProgress);
        }, viaProxy);
    });
  }

  function modeForPlatform(platform) {
    if (platform === 5) return 'sifli';
    if (platform === 6 || platform === 7) return 'jieli';
    return 'v3';
  }

  return {
    setProxy: setProxy,
    getProxy: getProxy,
    clearCache: clearCache,
    open: open,
    faces: faces,
    download: download,
    modeForPlatform: modeForPlatform,
    FALLBACK_FV: FALLBACK_FV
  };
})();
