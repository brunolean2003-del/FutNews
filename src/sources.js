// Coleta das cinco fontes. Cada coletor devolve itens "crus":
//   { source, title, summary, url, image, publishedAt, categories, seriesHint }
// Guardamos só manchete, resumo curto, miniatura e link — a leitura é sempre na fonte.

const { CLUBS } = require('./clubs');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const SOURCES = {
  ge: { name: 'ge', site: 'https://ge.globo.com' },
  lance: { name: 'Lance!', site: 'https://www.lance.com.br' },
  espn: { name: 'ESPN', site: 'https://www.espn.com.br' },
  gazeta: { name: 'Gazeta Esportiva', site: 'https://www.gazetaesportiva.com' },
  bolavip: { name: 'Bolavip', site: 'https://br.bolavip.com' },
};

// ───────────── utilidades ─────────────

async function get(url, { json = false } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return json ? res.json() : res.text();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const cdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const text = (s) => decode(decode(cdata(s)).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function tags(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function attr(xml, tagName, attrName) {
  const m = xml.match(new RegExp(`<${tagName}\\s[^>]*?${attrName}=["']([^"']+)["']`));
  return m ? decode(m[1]) : '';
}

function clip(s, max = 190) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,.;:–-]+$/, '') + '…';
}

function toISO(s) {
  const t = Date.parse(String(s || '').trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const rssItems = (xml) => xml.match(/<item[\s>][\s\S]*?<\/item>/g) || [];

async function pool(tasks, limit) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < tasks.length) {
        const idx = i++;
        try { results[idx] = { ok: true, value: await tasks[idx]() }; }
        catch (error) { results[idx] = { ok: false, error }; }
      }
    })
  );
  return results;
}

// ───────────── ge ─────────────
// Feeds RSS das duas séries + feed de cada clube.

function parseGe(xml, seriesHint) {
  return rssItems(xml).map((it) => {
    const desc = tag(it, 'description');
    return {
      source: 'ge',
      title: text(tag(it, 'title')),
      summary: clip(text(tag(it, 'atom:subtitle'))),
      url: text(tag(it, 'link')),
      image: attr(cdata(desc), 'img', 'src') || attr(it, 'media:content', 'url'),
      publishedAt: toISO(tag(it, 'pubDate')),
      categories: [],
      seriesHint,
    };
  });
}

async function fetchGe() {
  const feeds = [
    { path: 'futebol/brasileirao-serie-a', hint: 'A' },
    { path: 'futebol/brasileirao-serie-b', hint: 'B' },
    // Feeds de clube não forçam série: a notícia só entra se a URL/título citar o clube.
    ...CLUBS.filter((c) => c.ge).map((c) => ({ path: c.ge, hint: null })),
  ];
  const results = await pool(
    feeds.map((f) => async () => parseGe(await get(`https://ge.globo.com/rss/ge/${f.path}/`), f.hint)),
    6
  );
  if (!results[0].ok && !results[1].ok) throw results[0].error;
  return results.filter((r) => r.ok).flatMap((r) => r.value);
}

// ───────────── Lance! ─────────────
// Não tem RSS público: usamos o sitemap de notícias do dia (título, data, imagem).

async function fetchLance() {
  const xml = await get('https://www.lance.com.br/sitemap/news/today.xml');
  return (xml.match(/<url>[\s\S]*?<\/url>/g) || []).map((u) => ({
    source: 'lance',
    title: text(tag(u, 'news:title')),
    summary: '',
    url: text(tag(u, 'loc')),
    image: text(tag(u, 'image:loc')),
    publishedAt: toISO(tag(u, 'news:publication_date')) || toISO(tag(u, 'lastmod')),
    categories: [],
    seriesHint: null,
  }));
}

// ───────────── ESPN ─────────────
// API pública de notícias por liga (bra.1 = Série A, bra.2 = Série B).

async function fetchEspn() {
  const leagues = [['bra.1', 'A'], ['bra.2', 'B']];
  const results = await pool(
    leagues.map(([league, hint]) => async () => {
      const data = await get(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/news?lang=pt&region=br&limit=50`,
        { json: true }
      );
      return (data.articles || []).map((a) => ({
        source: 'espn',
        title: text(a.headline),
        summary: clip(text(a.description)),
        url: a.links?.web?.href || '',
        image: a.images?.[0]?.url || '',
        publishedAt: toISO(a.published),
        categories: (a.categories || []).filter((c) => c.type === 'team').map((c) => c.description),
        seriesHint: hint,
      }));
    }),
    2
  );
  if (results.every((r) => !r.ok)) throw results[0].error;
  return results.filter((r) => r.ok).flatMap((r) => r.value);
}

// ───────────── Gazeta Esportiva ─────────────

function parseGazeta(xml, seriesHint) {
  return rssItems(xml).map((it) => {
    const desc = text(tag(it, 'description')).split(/\s*O post /)[0].split(/\s*Veja também:/)[0];
    return {
      source: 'gazeta',
      title: text(tag(it, 'title')),
      summary: clip(desc),
      url: text(tag(it, 'link')),
      image: attr(it, 'media:thumbnail', 'url') || attr(it, 'media:content', 'url') || attr(it, 'enclosure', 'url'),
      publishedAt: toISO(tag(it, 'pubDate')),
      categories: tags(it, 'category').map(text),
      seriesHint,
    };
  });
}

async function fetchGazeta() {
  const feeds = [
    ['https://www.gazetaesportiva.com/campeonatos/brasileiro-serie-a/feed/', 'A'],
    ['https://www.gazetaesportiva.com/campeonatos/brasileiro-serie-b/feed/', 'B'],
    ['https://www.gazetaesportiva.com/feed/', null],
  ];
  const results = await pool(feeds.map(([url, hint]) => async () => parseGazeta(await get(url), hint)), 3);
  if (results.every((r) => !r.ok)) throw results[0].error;
  return results.filter((r) => r.ok).flatMap((r) => r.value);
}

// ───────────── Bolavip ─────────────

async function fetchBolavip() {
  const xml = await get('https://br.bolavip.com/rss/feed');
  return rssItems(xml).map((it) => {
    const desc = cdata(tag(it, 'description'));
    return {
      source: 'bolavip',
      title: text(tag(it, 'title')),
      summary: clip(text(desc.split(/<p[\s>]/)[0])),
      url: text(tag(it, 'link')) || text(tag(it, 'guid')),
      image: attr(it, 'media:content', 'url') || attr(it, 'enclosure', 'url'),
      publishedAt: toISO(tag(it, 'pubDate')),
      categories: [],
      seriesHint: null,
    };
  });
}

const FETCHERS = { ge: fetchGe, lance: fetchLance, espn: fetchEspn, gazeta: fetchGazeta, bolavip: fetchBolavip };

module.exports = { SOURCES, FETCHERS };
