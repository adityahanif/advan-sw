// proxy.mjs — proxy CORS kecil untuk katalog watchface (tanpa dependensi).
// Jalankan: node web/proxy.mjs
// Lalu isi "Proxy CORS" di Pengaturan katalog dengan http://localhost:8787
//
// Hanya meneruskan ke host katalog/ CDN Moyoung. Tidak ada data akun.

import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const API = 'https://api.moyoung.com';
const ALLOWED = new Set([
  'api.moyoung.com',
  'api-cdn.moyoung.com',
  'qn-hscdn2.moyoung.com',
]);

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Accept-Language, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const here = new URL(req.url, 'http://localhost');

  if (here.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  try {
    const raw = here.searchParams.get('url');
    let target;
    if (raw) {
      target = new URL(raw);
      if (!ALLOWED.has(target.host)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('host not allowed');
      }
    } else {
      target = new URL(API + req.url);
    }

    const headers = {};
    if (target.host === 'api.moyoung.com' || target.host === 'api-cdn.moyoung.com') {
      headers['Accept-Language'] = req.headers['accept-language'] || 'en';
    }

    const r = await fetch(target, { headers });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('proxy error: ' + e.message);
  }
}).listen(PORT, () => {
  console.log('Proxy CORS aktif di http://localhost:' + PORT);
  console.log('Isi alamat itu di "Proxy CORS" pada Pengaturan katalog, lalu klik Terapkan.');
});
