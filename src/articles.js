// Matérias próprias do Apito. Cada arquivo .md em /materias vira uma página
// em /materia/<nome-do-arquivo>. Formato do arquivo:
//
//   titulo: Título da matéria
//   data: 2026-11-14
//   clubes: flamengo, vasco
//   ---
//   Texto em parágrafos. Aceita ## subtítulo, **negrito**, *itálico*,
//   [link](https://...), listas com "- " e citações com "> ".
//
// Arquivos que começam com "_" (como _modelo.md) são ignorados.

const fs = require('node:fs');
const path = require('node:path');
const { CLUBS } = require('./clubs');
const { resolveClub } = require('./classify');

const DIR = path.join(__dirname, '..', 'materias');
const FILE_RE = /^[a-z0-9][a-z0-9-]*\.md$/;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(text) {
  return esc(text)
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, (_, label, url) => {
      const external = /^https?:/.test(url);
      return `<a href="${url}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function markdown(body) {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim());
      if (block.startsWith('### ')) return `<h3>${inline(block.slice(4))}</h3>`;
      if (block.startsWith('## ')) return `<h2>${inline(block.slice(3))}</h2>`;
      if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
      if (lines.every((l) => l.startsWith('>'))) return `<blockquote>${inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}</blockquote>`;
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('\n');
}

const UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => UNESC[e]).replace(/\s+/g, ' ').trim();

function clip(s, max = 190) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,.;:–-]+$/, '') + '…';
}

function parseDate(value, fallback) {
  const v = String(value || '').trim();
  // Só a data: assume meio-dia no horário de Brasília.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00-03:00` : v.replace(' ', 'T');
  const t = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}-03:00`);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

function parseFile(file) {
  const full = path.join(DIR, file);
  const raw = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').replace(/^---\n/, '');
  const split = raw.search(/^---\s*$/m);
  if (split === -1) throw new Error('falta a linha "---" entre o cabeçalho e o texto');

  const meta = {};
  for (const line of raw.slice(0, split).split('\n')) {
    const m = line.match(/^\s*([a-zA-Zçãéí]+)\s*:\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  const body = raw.slice(split).replace(/^---\s*\n?/, '');

  if (!meta.titulo) throw new Error('falta o campo "titulo"');
  if (/^(sim|s|true|1)$/i.test(meta.rascunho || '')) return null;

  const clubs = [...new Set((meta.clubes || '').split(',').map((c) => resolveClub(c)).filter(Boolean))];
  const series = new Set(clubs.map((id) => CLUBS.find((c) => c.id === id).series));
  for (const s of (meta.serie || '').toUpperCase().match(/[AB]/g) || []) series.add(s);

  const html = markdown(body);
  const image = /^(https:\/\/|\/)[^\s"'<>]+$/.test(meta.imagem || '') ? meta.imagem : '';

  return {
    slug: file.replace(/\.md$/, ''),
    title: meta.titulo,
    summary: meta.resumo || clip(plain(html.split('\n').find((b) => b.startsWith('<p>')) || '')),
    publishedAt: parseDate(meta.data, fs.statSync(full).mtime.toISOString()),
    author: meta.autor || 'Redação Apito',
    image,
    clubs,
    series: [...series].sort(),
    html,
  };
}

function loadArticles() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => FILE_RE.test(f)); }
  catch { return []; }

  const articles = [];
  for (const file of files) {
    try {
      const article = parseFile(file);
      if (article) articles.push(article);
    } catch (error) {
      console.warn(`[materias] ${file} ignorada: ${error.message}`);
    }
  }
  return articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

// ───────── página da matéria (HTML pronto, bom para buscadores) ─────────

const dateBR = (iso) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });

function shell({ title, description, head = '', main }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#111111">
  <meta name="description" content="${esc(description)}">
  ${head}
  <title>${esc(title)} — Apito</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23000'/%3E%3Ccircle cx='16' cy='16' r='7' fill='none' stroke='%23f5f5f7' stroke-width='3'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="gnav">
    <div class="wrap gnav-inner">
      <a class="brand" href="/" aria-label="Apito — início">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        Apito
      </a>
      <nav class="gnav-links" aria-label="Navegação principal">
        <a href="/">Início</a>
        <a href="/#/serie-a">Série A</a>
        <a href="/#/serie-b">Série B</a>
        <a href="/#/apito">Do Apito</a>
      </nav>
    </div>
  </header>
  <nav class="lnav" aria-label="Seção">
    <div class="wrap lnav-inner"><a class="lnav-title" href="/#/apito">Do Apito</a></div>
  </nav>
  <main>${main}</main>
  <footer class="footer">
    <div class="wrap"><p class="legal">Apito — notícias das Séries A e B do Brasileirão. Texto de autoria do Apito.</p></div>
  </footer>
</body>
</html>`;
}

function renderArticlePage(article, baseUrl) {
  const url = `${baseUrl}/materia/${article.slug}`;
  const clubs = article.clubs.map((id) => CLUBS.find((c) => c.id === id));
  const image = article.image && (article.image.startsWith('/') ? baseUrl + article.image : article.image);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.summary,
    datePublished: article.publishedAt,
    author: { '@type': 'Person', name: article.author },
    publisher: { '@type': 'Organization', name: 'Apito' },
    mainEntityOfPage: url,
    ...(image ? { image: [image] } : {}),
  };

  const head = `<link rel="canonical" href="${esc(url)}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:title" content="${esc(article.title)}">
  <meta property="og:description" content="${esc(article.summary)}">
  <meta property="og:url" content="${esc(url)}">
  ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

  const main = `
    <article class="article">
      <header class="article-hero">
        <div class="article-wrap">
          <p class="lockup">${esc(clubs.map((c) => c.short || c.name).join(' · ') || 'Brasileirão')}</p>
          <h1>${esc(article.title)}</h1>
          <p class="article-lead">${esc(article.summary)}</p>
          <p class="article-meta">Por ${esc(article.author)} · <time datetime="${esc(article.publishedAt)}">${dateBR(article.publishedAt)}</time></p>
        </div>
      </header>
      ${article.image ? `<figure class="article-figure"><img src="${esc(article.image)}" alt="" referrerpolicy="no-referrer"></figure>` : ''}
      <div class="article-wrap article-body">
        ${article.html}
      </div>
      <div class="article-wrap article-foot">
        <ul class="chips">
          ${clubs.map((c) => `<li><a class="chip" href="/#/serie-${c.series.toLowerCase()}/${c.id}"><i style="background:${esc(c.color)}"></i>Mais sobre ${esc(c.short || c.name)}</a></li>`).join('')}
          <li><a class="chip" href="/#/apito">Todas as matérias do Apito</a></li>
        </ul>
      </div>
    </article>`;

  return shell({ title: article.title, description: article.summary, head, main });
}

function renderNotFound() {
  return shell({
    title: 'Matéria não encontrada',
    description: 'Esta matéria não existe ou foi removida.',
    head: '<meta name="robots" content="noindex">',
    main: '<section class="state"><h2>Matéria não encontrada.</h2><p><a class="pill lg" href="/">Voltar ao início</a></p></section>',
  });
}

function renderSitemap(articles, baseUrl) {
  const urls = [
    `<url><loc>${baseUrl}/</loc></url>`,
    ...articles.map((a) => `<url><loc>${baseUrl}/materia/${a.slug}</loc><lastmod>${a.publishedAt}</lastmod></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

module.exports = { loadArticles, renderArticlePage, renderNotFound, renderSitemap };
