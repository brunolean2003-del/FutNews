// Interface do Apito. Rotas por hash:
//   #/                 início (destaques das duas séries)
//   #/serie-a          todas as notícias da Série A
//   #/serie-a/flamengo notícias de um clube

const PAGE = 30;
const HOME_COUNT = 7;
const REFETCH_MS = 5 * 60 * 1000;

const app = document.getElementById('app');
const lnavTitle = document.getElementById('lnav-title');
const sourceFilter = document.getElementById('source-filter');
const sourceList = document.getElementById('source-list');
const updated = document.getElementById('updated');
const search = document.getElementById('search');

const state = { data: null, error: null, source: 'all', q: '', limit: PAGE };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const num = (n) => n.toLocaleString('pt-BR');

function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

function route() {
  const [, s, club] = location.hash.match(/^#\/serie-([ab])(?:\/([a-z0-9-]+))?/) || [];
  return { series: s ? s.toUpperCase() : null, club: club || null };
}

const seriesPath = (s) => `#/serie-${s.toLowerCase()}`;
const clubById = (id) => state.data.clubs.find((c) => c.id === id);
const sourceName = (id) => state.data.sources.find((s) => s.id === id)?.name || id;

function select({ series, club, ignoreSource = false }) {
  const q = fold(state.q.trim());
  return state.data.items.filter(
    (i) =>
      (!series || i.series.includes(series)) &&
      (!club || i.clubs.includes(club)) &&
      (ignoreSource || state.source === 'all' || i.source === state.source) &&
      (!q || fold(i.title).includes(q))
  );
}

// ───────── peças ─────────

function tile(item, featured = false) {
  const src = sourceName(item.source);
  const clubs = item.clubs.map((id) => clubById(id)?.short).filter(Boolean);
  const isNew = Date.now() - Date.parse(item.publishedAt) < 60 * 60 * 1000;
  const mono = esc((clubs[0] || src).slice(0, 3));
  const media = item.image
    ? `<img src="${esc(item.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-mono="${mono}">`
    : `<span class="mono">${mono}</span>`;
  return `
    <a class="tile${featured ? ' featured' : ''}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">
      <div class="tile-media">${media}</div>
      <div class="tile-body">
        <div class="tile-meta">
          <span class="src">${esc(src)}</span>
          <time datetime="${esc(item.publishedAt)}">${ago(item.publishedAt)}</time>
          ${isNew ? '<span class="badge">Novo</span>' : ''}
        </div>
        <h3>${esc(item.title)}</h3>
        ${item.summary ? `<p>${esc(item.summary)}</p>` : ''}
        <div class="tile-foot">
          <span class="tile-clubs">${esc(clubs.join(' · ') || 'Geral')}</span>
          <span class="pill">Ler no ${esc(src)}</span>
        </div>
      </div>
    </a>`;
}

function chips(series, activeClub) {
  const counts = {};
  for (const item of select({ series })) for (const id of item.clubs) counts[id] = (counts[id] || 0) + 1;
  const list = state.data.clubs.filter((c) => c.series === series);
  return `
    <ul class="chips" aria-label="Clubes da Série ${series}">
      <li><a class="chip" href="${seriesPath(series)}" ${activeClub ? '' : 'aria-current="page"'}>Todos</a></li>
      ${list
        .map(
          (c) => `
        <li><a class="chip" href="${seriesPath(series)}/${c.id}" ${c.id === activeClub ? 'aria-current="page"' : ''}>
          <i style="background:${esc(c.color)}"></i>${esc(c.short)}<small>${counts[c.id] || 0}</small>
        </a></li>`
        )
        .join('')}
    </ul>`;
}

function grid(items, { featured = true } = {}) {
  if (items.length === 0) {
    const why = state.q ? `Nada encontrado para “${esc(state.q)}”.` : 'Nenhuma notícia por aqui nos últimos dias.';
    return `<div class="grid"><div class="empty">${why}</div></div>`;
  }
  // O destaque precisa de imagem; se a primeira não tiver, segue tudo em grade.
  const lead = featured && items[0].image;
  return `<div class="grid">${items.map((it, i) => tile(it, lead && i === 0)).join('')}</div>`;
}

// ───────── telas ─────────

function home() {
  const total = state.data.items.length;
  const sections = ['A', 'B']
    .map((s) => {
      const items = select({ series: s });
      return `
      <section class="section">
        <div class="wrap">
          <div class="section-head">
            <div>
              <h2>Série ${s}.</h2>
              <p class="section-count"><b>${num(items.length)}</b> notícias de 20 clubes</p>
            </div>
            <a class="pill lg" href="${seriesPath(s)}">Ver todas da Série ${s}</a>
          </div>
          ${chips(s, null)}
          ${grid(items.slice(0, HOME_COUNT))}
        </div>
      </section>`;
    })
    .join('');

  return `
    <section class="hero">
      <div class="wrap">
        <p class="lockup">Brasileirão 2026</p>
        <h1>Tudo do seu clube. Um só lugar.</h1>
        <p class="hero-sub">As manchetes de ge, Lance!, ESPN, Gazeta Esportiva e Bolavip, separadas por série e por clube.</p>
        <ul class="metrics">
          <li class="live"><b>${num(total)}</b><span>notícias agora</span></li>
          <li><b>${state.data.clubs.length}</b><span>clubes</span></li>
          <li><b>${state.data.sources.length}</b><span>fontes</span></li>
        </ul>
        <div class="hero-cta">
          <a class="pill lg" href="#/serie-a">Série A</a>
          <a class="pill lg" href="#/serie-b">Série B</a>
        </div>
      </div>
    </section>
    ${sections}`;
}

function listing({ series, club }) {
  const c = club ? clubById(club) : null;
  if (club && (!c || c.series !== series)) {
    return `<section class="state"><h2>Clube não encontrado.</h2><p><a class="pill lg" href="${seriesPath(series)}">Voltar à Série ${series}</a></p></section>`;
  }
  const items = select({ series, club });
  const shown = items.slice(0, state.limit);
  return `
    <section class="section">
      <div class="wrap">
        <div class="section-head">
          <div>
            ${c ? `<a class="crumb" href="${seriesPath(series)}">‹ Série ${series}</a>` : '<a class="crumb" href="#/">‹ Início</a>'}
            <h2>${esc(c ? c.name : `Série ${series}`)}.</h2>
            <p class="section-count"><b>${num(items.length)}</b> ${items.length === 1 ? 'notícia' : 'notícias'}${state.source !== 'all' ? ` no ${esc(sourceName(state.source))}` : ''}</p>
          </div>
        </div>
        ${chips(series, club)}
        ${grid(shown)}
        ${items.length > shown.length ? `<div class="more"><button class="pill lg" id="more">Mostrar mais ${Math.min(PAGE, items.length - shown.length)}</button></div>` : ''}
      </div>
    </section>`;
}

function renderChrome(r) {
  const c = r.club && clubById(r.club);
  lnavTitle.textContent = c ? c.name : r.series ? `Série ${r.series}` : 'Brasileirão';
  lnavTitle.href = r.series ? seriesPath(r.series) : '#/';
  document.title = `${c ? c.name : r.series ? `Série ${r.series}` : 'Brasileirão Séries A e B'} — Apito`;

  const options = [{ id: 'all', name: 'Todas as fontes' }, ...state.data.sources];
  sourceFilter.innerHTML = options
    .map((s) => `<button type="button" data-source="${s.id}" aria-pressed="${state.source === s.id}">${esc(s.name)}</button>`)
    .join('');

  updated.textContent = state.data.updatedAt ? `Atualizado ${ago(state.data.updatedAt)}` : 'Atualizando…';

  sourceList.innerHTML = state.data.sources
    .map((s) => {
      const count = state.data.items.filter((i) => i.source === s.id).length;
      const down = s.status && !s.status.ok;
      return `<li>
        <strong>${esc(s.name)}</strong>
        <span class="${down ? 'down' : ''}">${down ? 'Indisponível na última coleta' : `${num(count)} notícias`}</span>
        <a href="${esc(s.site)}" target="_blank" rel="noopener noreferrer">Visitar site ›</a>
      </li>`;
    })
    .join('');
}

function render() {
  if (!state.data) {
    if (state.error) {
      app.innerHTML = `<section class="state"><h2>Não deu para carregar as notícias.</h2><p>Confira se o servidor está rodando (<code>npm start</code>) e recarregue a página.</p></section>`;
    }
    return;
  }
  const r = route();
  renderChrome(r);
  app.innerHTML = r.series ? listing(r) : home();
}

// ───────── eventos ─────────

window.addEventListener('hashchange', () => {
  if (location.hash === '#fontes') return; // âncora do rodapé, não é rota
  state.limit = PAGE;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
});

sourceFilter.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-source]');
  if (!btn) return;
  state.source = btn.dataset.source;
  state.limit = PAGE;
  render();
});

search.addEventListener('input', () => {
  state.q = search.value;
  state.limit = PAGE;
  render();
});

app.addEventListener('click', (e) => {
  if (e.target.closest('#more')) {
    state.limit += PAGE;
    render();
  }
});

// Imagem quebrada: troca pelo monograma do clube.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.closest('.tile-media')) return;
    const span = document.createElement('span');
    span.className = 'mono';
    span.textContent = img.dataset.mono || '';
    img.replaceWith(span);
  },
  true
);

async function loadNews() {
  try {
    const res = await fetch('/api/news');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.data = await res.json();
    state.error = null;
  } catch (error) {
    state.error = error;
  }
  render();
}

loadNews();
setInterval(loadNews, REFETCH_MS);
