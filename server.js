// Apito — agregador de notícias das Séries A e B do Brasileirão.
// Servidor sem dependências: coleta as fontes a cada 10 min, classifica por
// série/clube e serve a interface em /public e os dados em /api/news.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const { CLUBS } = require('./src/clubs');
const { SOURCES, FETCHERS } = require('./src/sources');
const { classify } = require('./src/classify');
const { loadArticles, renderArticlePage, renderNotFound, renderSitemap } = require('./src/articles');

const PORT = Number(process.env.PORT) || 3000;
const REFRESH_MS = 10 * 60 * 1000;
const KEEP_MS = 5 * 24 * 60 * 60 * 1000; // guarda 5 dias de notícias
const MAX_ITEMS = 3000;

// Os clubes também aparecem em notícias de outras modalidades; ficamos só com futebol.
const OTHER_SPORTS = /v[oô]lei|basquete|\bNBB\b|futsal|superliga|e-?sports|handebol|\bUFC\b|\/lutas\/|nata[cç][aã]o|atletismo/i;

const PUBLIC_DIR = path.join(__dirname, 'public');
// DATA_DIR permite apontar para um disco persistente na hospedagem (opcional).
const DATA_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'news.json');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const store = new Map(); // url -> item
const status = {}; // fonte -> { ok, count, error, at }
let updatedAt = null;
let refreshing = null;
let articles = loadArticles(); // matérias próprias, lidas de /materias

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const item of saved.items || []) store.set(item.url, item);
    updatedAt = saved.updatedAt || null;
    console.log(`[cache] ${store.size} notícias carregadas do disco`);
  } catch { /* primeira execução */ }
}

function save() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ updatedAt, items: [...store.values()] }));
  } catch (error) {
    console.warn('[cache] não foi possível salvar:', error.message);
  }
}

async function refreshSource(key) {
  const now = new Date().toISOString();
  try {
    const raw = await FETCHERS[key]();
    let count = 0;
    for (const r of raw) {
      if (!r.title || !/^https?:\/\//.test(r.url)) continue;
      if (OTHER_SPORTS.test(r.url) || OTHER_SPORTS.test(r.title)) continue;
      if (r.publishedAt && Date.parse(r.publishedAt) < Date.now() - KEEP_MS) continue;
      const { clubs, series } = classify(r);
      if (series.length === 0) continue; // não é de Série A nem B
      const previous = store.get(r.url);
      store.set(r.url, {
        url: r.url,
        source: r.source,
        title: r.title,
        summary: r.summary || previous?.summary || '',
        image: /^https?:\/\//.test(r.image) ? r.image : previous?.image || '',
        publishedAt: r.publishedAt || previous?.publishedAt || now,
        clubs: [...new Set([...(previous?.clubs || []), ...clubs])],
        series: [...new Set([...(previous?.series || []), ...series])].sort(),
      });
      count++;
    }
    status[key] = { ok: true, count, error: null, at: now };
    console.log(`[${key}] ${count} notícias classificadas (de ${raw.length})`);
  } catch (error) {
    status[key] = { ok: false, count: 0, error: error.message, at: now };
    console.warn(`[${key}] falhou: ${error.message}`);
  }
}

function prune() {
  const limit = Date.now() - KEEP_MS;
  for (const [url, item] of store) {
    if (Date.parse(item.publishedAt) < limit) store.delete(url);
  }
  if (store.size > MAX_ITEMS) {
    const sorted = [...store.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    for (const item of sorted.slice(MAX_ITEMS)) store.delete(item.url);
  }
}

function refresh() {
  refreshing ??= Promise.all(Object.keys(FETCHERS).map(refreshSource))
    .then(() => {
      prune();
      updatedAt = new Date().toISOString();
      articles = loadArticles();
      cached = null;
      save();
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

function payload() {
  return {
    updatedAt,
    sources: Object.entries(SOURCES).map(([id, s]) => ({ id, ...s, status: status[id] || null })),
    clubs: CLUBS.map(({ id, name, short, series, color }) => ({ id, name, short: short || name, series, color })),
    articles: articles.map(({ html, ...rest }) => rest),
    items: [...store.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// A resposta da API é montada e comprimida uma vez por coleta, não a cada visita.
let cached = null;
function apiResponse() {
  if (!cached) {
    const json = Buffer.from(JSON.stringify(payload()));
    cached = { json, gzip: zlib.gzipSync(json), etag: `"${crypto.createHash('sha1').update(json).digest('base64url')}"` };
  }
  return cached;
}

function send(req, res, code, headers, body) {
  res.writeHead(code, { ...SECURITY_HEADERS, ...headers });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(req, res, 405, { ...TEXT, Allow: 'GET, HEAD' }, 'Método não permitido');
    }

    const { pathname } = new URL(req.url, 'http://localhost');
    const gzipOk = /\bgzip\b/.test(req.headers['accept-encoding'] || '');

    if (pathname === '/healthz') return send(req, res, 200, TEXT, 'ok');

    if (pathname === '/api/news') {
      if (store.size === 0 && refreshing) await refreshing; // primeira carga
      const api = apiResponse();
      const headers = { 'Content-Type': MIME['.json'], 'Cache-Control': 'public, max-age=60', ETag: api.etag, Vary: 'Accept-Encoding' };
      if (req.headers['if-none-match'] === api.etag) return send(req, res, 304, headers);
      if (gzipOk) return send(req, res, 200, { ...headers, 'Content-Encoding': 'gzip' }, api.gzip);
      return send(req, res, 200, headers, api.json);
    }

    const host = /^[a-z0-9.:-]+$/i.test(req.headers.host || '') ? req.headers.host : 'localhost';
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const baseUrl = `${proto}://${host}`;
    const HTML = { 'Content-Type': MIME['.html'], 'Cache-Control': 'public, max-age=300' };

    const materia = pathname.match(/^\/materia\/([a-z0-9-]+)\/?$/);
    if (materia) {
      const article = articles.find((a) => a.slug === materia[1]);
      if (!article) return send(req, res, 404, HTML, renderNotFound());
      return send(req, res, 200, HTML, renderArticlePage(article, baseUrl));
    }

    if (pathname === '/sitemap.xml') {
      return send(req, res, 200, { 'Content-Type': 'application/xml; charset=utf-8' }, renderSitemap(articles, baseUrl));
    }

    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(req, res, 403, TEXT, 'Proibido');

    let data;
    try { data = await fs.promises.readFile(file); }
    catch { return send(req, res, 404, TEXT, 'Não encontrado'); }

    const type = MIME[path.extname(file)] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'public, max-age=300', Vary: 'Accept-Encoding' };
    if (gzipOk && /^(text|application\/json|image\/svg)/.test(type)) {
      return send(req, res, 200, { ...headers, 'Content-Encoding': 'gzip' }, zlib.gzipSync(data));
    }
    send(req, res, 200, headers, data);
  } catch (error) {
    console.error('[http]', error);
    if (!res.headersSent) send(req, res, 400, TEXT, 'Requisição inválida');
    else res.end();
  }
});

load();
refresh();
setInterval(refresh, REFRESH_MS);
server.listen(PORT, () => console.log(`Apito no ar: http://localhost:${PORT}`));

// A hospedagem envia SIGTERM ao reiniciar: fecha as conexões e sai limpo.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
