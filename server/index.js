import express from 'express';
import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { domainToASCII, URL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* .env is optional */ }

const port = Number(process.env.PORT || 3001);
const dbPath = resolve(ROOT, process.env.DATABASE_PATH || './data/knowledge.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('note','url')),
    source_url TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    content TEXT NOT NULL, ordinal INTEGER NOT NULL, embedding TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chunks_item_id_idx ON chunks(item_id);
`);

const log = (level, event, fields = {}) => console.log(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
const apiKey = () => process.env.OPENAI_API_KEY;
const normalize = (vector) => { const magnitude = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1; return vector.map((x) => x / magnitude); };
function localEmbedding(text) {
  const vector = Array(384).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  const add = (token, weight) => {
    let hash = 2166136261;
    for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    vector[(hash >>> 0) % vector.length] += (hash & 0x80000000 ? -1 : 1) * weight;
  };
  for (const word of words) {
    add(`w:${word}`, 1);
    const padded = `^${word}$`;
    for (let i = 0; i < padded.length - 2; i++) add(`c:${padded.slice(i, i + 3)}`, 0.22);
  }
  return normalize(vector);
}
async function embed(texts) {
  if (!apiKey()) return texts.map(localEmbedding);
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small', input: texts }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Embedding provider returned ${response.status}`);
  const result = await response.json();
  return result.data.sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
}
function chunkText(text, size = 900, overlap = 140) {
  const clean = text.replace(/\s+/g, ' ').trim(); const parts = [];
  for (let start = 0; start < clean.length;) {
    let end = Math.min(start + size, clean.length);
    const boundary = clean.lastIndexOf(' ', end);
    if (end < clean.length && boundary > start + size * 0.65) end = boundary;
    const piece = clean.slice(start, end).trim(); if (piece) parts.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return parts;
}
function htmlToText(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim();
  const content = html.replace(/<(script|style|noscript|svg|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*/g, '\n').trim();
  return { title, content };
}
function publicHostname(host) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const [a, b] = value.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}
async function fetchPage(input) {
  let address = input;
  for (let redirect = 0; redirect <= 4; redirect++) {
    let parsed;
    try { parsed = new URL(address); } catch { throw Object.assign(new Error('Enter a valid URL.'), { status: 400 }); }
    const host = domainToASCII(parsed.hostname) || parsed.hostname;
    if (!['http:', 'https:'].includes(parsed.protocol) || !publicHostname(host)) throw Object.assign(new Error('Only public HTTP and HTTPS pages can be saved.'), { status: 400 });
    const response = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Stillnote/1.0 page importer' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === 4) throw Object.assign(new Error('This page redirected too many times.'), { status: 422 });
      address = new URL(response.headers.get('location'), parsed).toString(); continue;
    }
    if (!response.ok) throw Object.assign(new Error(`The page returned HTTP ${response.status}.`), { status: 422 });
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('text/plain')) throw Object.assign(new Error('That URL did not return a readable web page.'), { status: 422 });
    const raw = await response.text();
    if (raw.length > 3_000_000) throw Object.assign(new Error('That page is too large to import (3 MB limit).'), { status: 413 });
    return { url: parsed.toString(), ...(type.includes('text/html') ? htmlToText(raw) : { content: raw.trim() }) };
  }
}
const saveItem = db.transaction((item, chunks, vectors) => {
  db.prepare('INSERT INTO items (id,title,content,source_type,source_url,created_at) VALUES (@id,@title,@content,@source_type,@source_url,@created_at)').run(item);
  const addChunk = db.prepare('INSERT INTO chunks (id,item_id,content,ordinal,embedding) VALUES (?,?,?,?,?)');
  chunks.forEach((content, ordinal) => addChunk.run(randomUUID(), item.id, content, ordinal, JSON.stringify(vectors[ordinal])));
});

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok', ai: apiKey() ? 'openai' : 'local' }));
app.get('/items', (_req, res) => {
  const items = db.prepare(`SELECT i.id,i.title,i.source_type,i.source_url,i.created_at,substr(i.content,1,220) AS preview,
    (SELECT COUNT(*) FROM chunks c WHERE c.item_id=i.id) AS chunk_count FROM items i ORDER BY i.created_at DESC`).all();
  res.json({ items });
});
app.post('/ingest', async (req, res, next) => {
  try {
    const { type, text, url } = req.body || {};
    if (!['note', 'url'].includes(type)) return res.status(400).json({ error: 'Choose a note or URL to save.' });
    let content; let title; let sourceUrl = null;
    if (type === 'note') {
      if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: 'Write a note before saving.' });
      if (text.length > 100000) return res.status(413).json({ error: 'Notes must be under 100,000 characters.' });
      content = text.trim(); title = String(req.body.title || content.split(/\r?\n/)[0]).trim().slice(0, 120) || 'Untitled note';
    } else {
      if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'Add a URL before saving.' });
      const page = await fetchPage(url.trim()); content = page.content; sourceUrl = page.url;
      title = page.title || new URL(page.url).hostname;
      if (!content) return res.status(422).json({ error: 'No readable text was found on that page.' });
      content = content.slice(0, 100000);
    }
    const chunks = chunkText(content); const vectors = await embed(chunks);
    const item = { id: randomUUID(), title, content, source_type: type, source_url: sourceUrl, created_at: new Date().toISOString() };
    saveItem(item, chunks, vectors);
    log('info', 'item_ingested', { itemId: item.id, sourceType: type, chunks: chunks.length });
    res.status(201).json({ item: { id: item.id, title, source_type: type, source_url: sourceUrl, created_at: item.created_at, preview: content.slice(0, 220), chunk_count: chunks.length } });
  } catch (error) { next(error); }
});
app.post('/query', async (req, res, next) => {
  const started = Date.now();
  try {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) return res.status(400).json({ error: 'Enter a question to search your inbox.' });
    if (question.length > 2000) return res.status(413).json({ error: 'Questions must be under 2,000 characters.' });
    const count = db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count;
    if (!count) return res.status(422).json({ error: 'Save a note or URL first, then ask a question.' });
    const [queryVector] = await embed([question]);
    const candidates = db.prepare(`SELECT c.id,c.item_id,c.content,c.embedding,i.title,i.source_type,i.source_url FROM chunks c JOIN items i ON i.id=c.item_id`).all();
    const ranked = candidates.map((row) => {
      const vector = JSON.parse(row.embedding);
      let score = -1;
      if (vector.length === queryVector.length) score = vector.reduce((sum, value, i) => sum + value * queryVector[i], 0);
      return { ...row, score };
    }).sort((a, b) => b.score - a.score).slice(0, 5);
    const sources = ranked.map((row, i) => ({ id: i + 1, item_id: row.item_id, title: row.title, source_type: row.source_type,
      source_url: row.source_url, snippet: row.content.slice(0, 420), score: Number(row.score.toFixed(3)) }));
    let answer;
    if (apiKey()) {
      const context = ranked.map((row, i) => `[${i + 1}] ${row.title}\n${row.content}`).join('\n\n');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini', temperature: 0.2, messages: [
          { role: 'system', content: 'Answer using only the supplied saved content. Cite factual claims with source numbers like [1]. If the answer is absent, say so plainly. Keep it concise.' },
          { role: 'user', content: `Saved content:\n${context}\n\nQuestion: ${question}` },
        ] }), signal: AbortSignal.timeout(40000),
      });
      if (!response.ok) throw new Error(`Answer provider returned ${response.status}`);
      answer = (await response.json()).choices?.[0]?.message?.content?.trim();
      if (!answer) throw new Error('Answer provider returned an empty response');
    } else {
      const best = ranked[0];
      answer = best.score > 0.08
        ? `The closest match in your saved content says: “${best.content.slice(0, 360).trim()}${best.content.length > 360 ? '…' : ''}” [1]\n\nThis is a locally generated excerpt. Add an OpenAI API key for a synthesized answer.`
        : 'I could not find a close match in your saved content. Try different wording or save another note or page.';
    }
    log('info', 'question_answered', { chunksSearched: count, sources: sources.length, durationMs: Date.now() - started, ai: apiKey() ? 'openai' : 'local' });
    res.json({ answer, sources, mode: apiKey() ? 'openai' : 'local' });
  } catch (error) { next(error); }
});
app.use((error, _req, res, _next) => {
  const status = error.status || (error.name === 'TimeoutError' ? 504 : 502);
  log('error', 'request_failed', { message: error.message, status });
  res.status(status).json({ error: error.name === 'TimeoutError' ? 'That request took too long. Please try again.' : error.status ? error.message : 'The request could not be completed. Please try again.' });
});
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve(ROOT, 'dist')));
  app.get('*path', (_req, res) => res.sendFile(resolve(ROOT, 'dist/index.html')));
}
app.listen(port, () => log('info', 'server_started', { port, ai: apiKey() ? 'openai' : 'local', database: dbPath }));
