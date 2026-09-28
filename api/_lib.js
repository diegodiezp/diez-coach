// Shared helpers for diez coach. Files starting with "_" are not exposed as routes by Vercel.
const fs = require('fs');
const path = require('path');

const MODEL = process.env.COACH_MODEL || 'claude-sonnet-5';
const AT_BASE = process.env.AIRTABLE_BASE || 'appkTmFvjmDLOQS4p';
const AT_TABLE = process.env.AIRTABLE_TABLE || 'tblUMrtgTPggOg5he';
const AT_SOURCES = process.env.AIRTABLE_SOURCES || 'tblbkhS1k6fXWiN5Z';
const LANGS = { en: 'English', es: 'Spanish' };

// TEAM="Diego:code-1,Laura:code-2"  ADMINS="Diego"
function team() {
  const out = {};
  (process.env.TEAM || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((pair) => {
    const i = pair.lastIndexOf(':');
    if (i > 0) out[pair.slice(i + 1).trim()] = pair.slice(0, i).trim();
  });
  if (!Object.keys(out).length && process.env.ACCESS_CODE) out[process.env.ACCESS_CODE] = 'Team';
  return out;
}
function whoami(req) {
  const code = String(req.headers['x-access-code'] || '');
  const name = code && team()[code];
  if (!name) return null;
  const admins = (process.env.ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { name, admin: admins.includes(name.toLowerCase()) };
}
function people() { return [...new Set(Object.values(team()))]; }

function loadDossier(id) {
  if (!/^[a-z0-9-]{1,60}$/.test(id || '')) throw new Error('Invalid dossier id');
  const d = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', `${id}.json`), 'utf8'));
  // Optional knowledge file prepared outside the app (no API cost to add it): data/<id>.knowledge.md
  const k = path.join(process.cwd(), 'data', `${id}.knowledge.md`);
  d.notes = fs.existsSync(k) ? fs.readFileSync(k, 'utf8') : '';
  return d;
}

function contextText(d, src) {
  const copy = { ...d };
  delete copy.personas;
  delete copy.notes;
  const verified = src.filter((x) => x.Kind !== 'Web' && x.Kind !== 'Briefing');
  const web = src.filter((x) => x.Kind === 'Web');
  const brief = src.find((x) => x.Kind === 'Briefing');
  return `You power a private rehearsal tool for diez, a contemporary art gallery in Amsterdam, training its team for conversations at the following occasion: ${d.context}

GROUND TRUTH about the artist, works, prices and gallery = the dossier + the gallery notes + the latest briefing + the verified sources below. Where they disagree, the most recent wins (briefing and sources are dated; gallery notes state their own date). Rules:
- Never invent facts, prices, collectors, editions, dimensions, dates or institutions.
- Text in [square brackets] and anything under "gaps" is unconfirmed. A good gallery answer flags it or promises to confirm in writing; it never makes it up.
- Items under "doNotSay" must never be stated as fact. Follow the "language" rules.
- The "bank" and house lines are the gallery's reference answers: use them for tone and facts, never copy questions verbatim.
- WEB CONTEXT is background about the art world (exhibitions, trends, news). Visitors may bring it up, and a strong answer can use it, but it never overrides ground truth about the artist.
- Never use em dashes.

<dossier>
${JSON.stringify(copy)}
</dossier>
${d.notes ? `\n<gallery_notes>\n${d.notes}\n</gallery_notes>\n` : ''}${brief ? `\n<briefing updated="${brief.Date || ''}">\n${brief.Content}\n</briefing>\n` : ''}
<verified_sources>
${verified.map((x) => `## ${x.Kind}: ${x.Title}\n${x.Content}`).join('\n\n') || '(none yet)'}
</verified_sources>

<web_context>
${web.map((x) => `## ${x.Title}${x.URL ? ` (${x.URL})` : ''}\n${x.Content}`).join('\n\n') || '(none yet)'}
</web_context>`;
}

function personaBlock(persona, lang) {
  return `Output language: ${LANGS[lang] || 'English'}.
The visitor persona in this rehearsal:
Name: ${persona.name}
Profile: ${persona.brief}
Difficulty: ${persona.difficulty} of 3. Play it with the texture of a real person at a fair: specific, sometimes distracted, sometimes charming, never a quiz master. You may bring up something from the web context if it fits this person.`;
}

function transcript(history) {
  if (!Array.isArray(history) || !history.length) return '(no conversation yet)';
  return history.slice(-16)
    .map((t) => `${t.role === 'visitor' ? 'VISITOR' : 'GALLERY'}: ${String(t.text || '').slice(0, 2000)}`)
    .join('\n');
}

function task(action, b) {
  const q = String(b.question || '').slice(0, 1000);
  const a = String(b.answer || '').slice(0, 4000);
  const seen = Array.isArray(b.seen) ? b.seen.slice(-25).map((s) => String(s).slice(0, 200)) : [];
  if (action === 'question') {
    return `Conversation so far:
${transcript(b.history)}

Stay fully in character as the visitor. ${b.history && b.history.length
      ? 'React to what the gallery just said, then ask your next question. Push where the answer was weak or vague. Do not repeat earlier questions.'
      : `Open the conversation as you would arriving at the booth.${seen.length ? ` Avoid these angles, already covered: ${JSON.stringify(seen)}` : ''}`}
One question or remark, 1 to 3 spoken sentences, natural and specific to this artist.

Return ONLY a JSON object, no markdown:
{"question": "...", "intent": "one short sentence, in the output language, naming what you are really testing"}`;
  }
  if (action === 'card') {
    return `Invent one fresh, realistic question this visitor would ask at the booth, and its crib sheet. It must be different in angle from all of these already studied: ${JSON.stringify(seen)}.
${b.focus ? `The trainee is currently weakest at: ${String(b.focus).slice(0, 200)}. Make the question exercise that.\n` : ''}Rotate between angles: the work itself, the artist's biography, meaning and lineage, the story behind the work, market and price, practicalities (installation, conservation, shipping), objections and doubts.

Return ONLY a JSON object, no markdown:
{"q": "the question, 1 to 2 spoken sentences", "intent": "what it tests", "keyPoints": ["3 to 5 short points"], "answer": "a strong spoken answer, first person, 50 to 110 words, [brackets] for anything unconfirmed", "avoid": "one sentence on the trap to avoid"}`;
  }
  if (action === 'cheat') {
    return `Conversation so far:
${transcript(b.history)}

The visitor asked: "${q}"

Write the crib sheet: what an excellent gallerist would answer to this exact question, for this visitor. Spoken, first person, 50 to 110 words. Keep [brackets] for anything unconfirmed.

Return ONLY a JSON object, no markdown:
{"keyPoints": ["3 to 5 short points"], "answer": "...", "avoid": "one sentence on the trap to avoid"}`;
  }
  if (action === 'evaluate') {
    return `Conversation so far:
${transcript(b.history)}

The visitor asked: "${q}"
The gallery team member answered: "${a}"

Act as a demanding but fair sales coach for a top-tier art fair. Judge the answer against the dossier and the visitor's profile. Be calibrated: 3 is a competent answer, 4 is strong, 5 is exceptional and rare. Empty, evasive or off-topic answers score 1.
Score 1 to 5 each:
- accuracy: facts match the dossier, nothing invented, unconfirmed items handled honestly
- clarity: concrete, well structured, right length for this visitor
- persuasion: builds desire and trust, moves toward a next step
- listening: answers what was actually asked, in the visitor's register

Then write a stronger version in the speaker's own voice, spoken, 50 to 110 words, keeping [brackets] for anything unconfirmed. Finally, stay in character as the visitor and give your natural follow-up.

Return ONLY a JSON object, no markdown:
{"scores": {"accuracy": n, "clarity": n, "persuasion": n, "listening": n},
 "verdict": "one sentence",
 "worked": ["..."],
 "missing": ["..."],
 "factcheck": ["claims that are wrong or not supported by the dossier; empty array if none"],
 "stronger": "...",
 "next": "the visitor's follow-up question or remark",
 "nextIntent": "what that follow-up is testing"}`;
  }
  throw new Error('Unknown action');
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, '');
  return JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
}

async function askClaude(context, user, opts = {}) {
  const body = {
    model: MODEL,
    max_tokens: opts.maxTokens || 1500,
    system: [{ type: 'text', text: context, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
  };
  if (opts.web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: opts.web }];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data.error && data.error.message) || 'Anthropic API error');
  const blocks = data.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const urls = [];
  blocks.filter((b) => b.type === 'web_search_tool_result' && Array.isArray(b.content))
    .forEach((b) => b.content.forEach((c) => c.url && urls.push({ url: c.url, title: c.title })));
  const out = parseJSON(text);
  if (opts.web) out._urls = urls;
  return out;
}

function score100(s) {
  const v = ['accuracy', 'clarity', 'persuasion', 'listening'].map((k) => Math.max(1, Math.min(5, Number(s && s[k]) || 1)));
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 20);
}

async function airtable(pathAndQuery, opts = {}, table = AT_TABLE) {
  const r = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${table}${pathAndQuery}`, {
    ...opts,
    headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`, 'content-type': 'application/json' },
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error.type)) || 'Airtable error');
  return j;
}

async function logAttempt(f) {
  if (!process.env.AIRTABLE_TOKEN) return false;
  await airtable('', {
    method: 'POST',
    body: JSON.stringify({ typecast: true, records: [{ fields: f }] }),
  });
  return true;
}

async function logMany(list) {
  if (!process.env.AIRTABLE_TOKEN || !list.length) return false;
  for (let i = 0; i < list.length; i += 10) {
    await airtable('', { method: 'POST', body: JSON.stringify({ typecast: true, records: list.slice(i, i + 10).map((fields) => ({ fields })) }) });
  }
  return true;
}

async function fetchLog(person) {
  const esc = person.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const fields = ['Person', 'Date', 'Mode', 'Dossier', 'Persona', 'Score', 'Accuracy', 'Clarity', 'Persuasion', 'Listening', 'Help used', 'Exam ID', 'Question'];
  const base = `?pageSize=100&filterByFormula=${encodeURIComponent(`{Person}='${esc}'`)}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc` +
    fields.map((f) => `&fields%5B%5D=${encodeURIComponent(f)}`).join('');
  let out = [], offset = '';
  for (let i = 0; i < 20; i++) {
    const j = await airtable(base + (offset ? `&offset=${offset}` : ''));
    out = out.concat(j.records.map((r) => r.fields));
    if (!j.offset) break;
    offset = j.offset;
  }
  return out;
}

// ---------- Sources ----------
const cache = {};
async function listSources(dossier, { status, fresh } = {}) {
  if (!process.env.AIRTABLE_TOKEN) return [];
  const key = `${dossier}:${status || 'all'}`;
  if (!fresh && cache[key] && Date.now() - cache[key].t < 60000) return cache[key].v;
  const f = status ? `AND({Dossier}='${dossier}',{Status}='${status}')` : `AND({Dossier}='${dossier}',{Status}!='Archived')`;
  let out = [], offset = '';
  for (let i = 0; i < 10; i++) {
    const j = await airtable(`?pageSize=100&filterByFormula=${encodeURIComponent(f)}&sort%5B0%5D%5Bfield%5D=Date&sort%5B0%5D%5Bdirection%5D=desc${offset ? `&offset=${offset}` : ''}`, {}, AT_SOURCES);
    out = out.concat(j.records.map((r) => ({ id: r.id, ...r.fields })));
    if (!j.offset) break;
    offset = j.offset;
  }
  cache[key] = { t: Date.now(), v: out };
  return out;
}
async function approvedContext(dossier) {
  const all = await listSources(dossier, { status: 'Approved' });
  const brief = all.find((x) => x.Kind === 'Briefing');
  if (!brief) return all;
  // The briefing already contains everything approved before it: send only what came after, to avoid paying twice.
  const since = Date.parse(brief.Date || 0) || 0;
  return all.filter((x) => x.Kind !== 'Briefing' && (!x.Date || Date.parse(x.Date) > since)).concat([brief]);
}
async function createSources(records) {
  if (!process.env.AIRTABLE_TOKEN) throw new Error('AIRTABLE_TOKEN is not set');
  const out = [];
  for (let i = 0; i < records.length; i += 10) {
    const j = await airtable('', { method: 'POST', body: JSON.stringify({ typecast: true, records: records.slice(i, i + 10).map((fields) => ({ fields })) }) }, AT_SOURCES);
    out.push(...j.records.map((r) => ({ id: r.id, ...r.fields })));
  }
  Object.keys(cache).forEach((k) => delete cache[k]);
  return out;
}
async function updateSource(id, fields) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(id || '')) throw new Error('Invalid record id');
  const j = await airtable(`/${id}`, { method: 'PATCH', body: JSON.stringify({ typecast: true, fields }) }, AT_SOURCES);
  Object.keys(cache).forEach((k) => delete cache[k]);
  return { id: j.id, ...j.fields };
}

module.exports = { contextText, personaBlock, listSources, approvedContext, createSources, updateSource, LANGS, whoami, people, loadDossier, task, askClaude, score100, logAttempt, logMany, fetchLog };
