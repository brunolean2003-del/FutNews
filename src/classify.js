// Descobre a quais clubes (e, por consequência, a qual série) uma notícia pertence.
// Usa, nesta ordem: trechos da URL, categorias/tags da fonte e o título.

const { CLUBS } = require('./clubs');

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const bySlug = new Map();
const byAlias = new Map();
const byId = new Map();

// O \b do JavaScript não entende letras acentuadas ("Ceará", "Avaí"), então
// trocamos por uma fronteira de palavra que considera qualquer letra Unicode.
const WORD = '[\\p{L}\\p{N}]';
const BOUNDARY = `(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;
const titleRe = new Map();

for (const club of CLUBS) {
  titleRe.set(club.id, new RegExp(club.title.source.replace(/\\b/g, BOUNDARY), 'u'));
  byId.set(club.id, club);
  for (const slug of [club.id, ...club.slugs]) bySlug.set(slug, club.id);
  for (const alias of [club.id, club.name, club.short, ...club.slugs, ...club.aliases]) {
    if (alias) byAlias.set(norm(alias), club.id);
  }
}

function classify({ title, url, categories = [], seriesHint = null, clubHint = null }) {
  const clubs = new Set();
  if (clubHint && byId.has(clubHint)) clubs.add(clubHint);

  try {
    for (const seg of new URL(url).pathname.split('/')) {
      const id = bySlug.get(seg);
      if (id) clubs.add(id);
    }
  } catch { /* URL inválida: ignora */ }

  for (const cat of categories) {
    const id = byAlias.get(norm(cat));
    if (id) clubs.add(id);
  }

  for (const club of CLUBS) {
    if (titleRe.get(club.id).test(title)) clubs.add(club.id);
  }

  const series = new Set([...clubs].map((id) => byId.get(id).series));
  if (series.size === 0 && seriesHint) series.add(seriesHint);

  return { clubs: [...clubs], series: [...series].sort() };
}

// Converte um nome digitado ("Flamengo", "atlético-mg") no id do clube.
const resolveClub = (name) => byAlias.get(norm(name)) || null;

module.exports = { classify, norm, resolveClub };
