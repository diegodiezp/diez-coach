// Knowledge feeder: ingest documents, research the web, build the briefing.
const L = require('./_lib');

const NO_DASH = 'Never use em dashes.';

async function ingest(d, { title, text, kind }, who) {
  const src = await L.approvedContext(d.id);
  const prompt = `A gallery admin is feeding a new ${kind === 'Note' ? 'note' : 'document'} into the rehearsal tool: "${String(title).slice(0, 200)}".

<document>
${String(text).slice(0, 120000)}
</document>

Act as the knowledge editor. Extract everything useful for gallery staff speaking about this artist at the fair: facts (titles, dates, materials, dimensions, prices, editions, availability, exhibitions, press), the artist's own language and key phrases, stories, positioning arguments, and anything a visitor might ask about. Write compact bullet notes in English, each self-contained, no fluff.
Remove all personal data (home addresses, phone numbers, emails, birth dates beyond the year, passwords, private links) and anything that looks confidential (funding applications, amounts from co-producers, unannounced projects): list what you removed in "removed" and mark confidential-but-useful context as "INTERNAL:" in the notes.
Compare with the current ground truth and list real contradictions in "conflicts" (quote both versions briefly). ${NO_DASH}

Return ONLY JSON: {"title": "short title", "summary": "one or two sentences", "notes": "- bullet\\n- bullet", "conflicts": ["..."], "removed": ["..."]}`;
  const out = await L.askClaude(L.contextText(d, src), prompt, { maxTokens: 4000 });
  const [rec] = await L.createSources([{
    Title: out.title || title, Dossier: d.id, Kind: kind === 'Note' ? 'Note' : 'File', Status: 'Pending',
    Summary: `${out.summary || ''}${out.removed && out.removed.length ? `\nRemoved: ${out.removed.join('; ')}` : ''}`,
    Content: out.notes || '', Conflicts: (out.conflicts || []).join('\n'),
    'Added by': who, Date: new Date().toISOString(),
  }]);
  return rec;
}

async function research(d, query, who) {
  const src = await L.approvedContext(d.id);
  const prompt = `Research the web for the gallery team preparing for this fair. Query: "${String(query).slice(0, 300)}".
Look for what would make staff sound current and informed at the booth: press or reviews about the artist, recent and upcoming exhibitions with related themes, relevant artists and references, news about the fair and the market for this kind of work.
Use several searches. Prefer reputable sources (institutions, established art press). Write every finding in your own words, never quote more than a few words. Skip anything already in the ground truth. ${NO_DASH}

Return ONLY JSON: {"findings": [{"title": "...", "summary": "2 to 4 sentences, in your own words, on what it is and how staff could use it in conversation", "url": "https://..."}]} with at most 6 findings.`;
  const out = await L.askClaude(L.contextText(d, src), prompt, { maxTokens: 3000, web: 6 });
  const findings = (out.findings || []).filter((f) => f && f.title && f.summary).slice(0, 6);
  if (!findings.length) return [];
  return L.createSources(findings.map((f) => ({
    Title: String(f.title).slice(0, 200), Dossier: d.id, Kind: 'Web', Status: 'Pending',
    Summary: `Research: ${String(query).slice(0, 200)}`, Content: f.summary,
    URL: /^https?:\/\//.test(f.url || '') ? f.url : undefined,
    'Added by': who, Date: new Date().toISOString(),
  })));
}

async function brief(d, who) {
  const all = await L.listSources(d.id, { status: 'Approved', fresh: true });
  const src = all.filter((x) => x.Kind !== 'Briefing');
  const prompt = `Rebuild the booth briefing from the dossier and every verified source. Resolve overlaps; where sources contradict, prefer the most recent and flag it in "gaps". Web context may inform "context" only. ${NO_DASH}

Return ONLY JSON:
{"keyMessages": ["5 to 7 lines staff should be able to say"],
 "facts": ["essential facts: works, materials, dates, exhibitions, press"],
 "prices": ["every price and availability line"],
 "language": ["phrases to use and phrases to avoid"],
 "context": ["current art-world context worth mentioning, from web sources"],
 "doNotSay": ["..."],
 "gaps": ["what is still unconfirmed"]}`;
  const out = await L.askClaude(L.contextText(d, src), prompt, { maxTokens: 4000 });
  const content = JSON.stringify(out, null, 1);
  const old = all.filter((x) => x.Kind === 'Briefing');
  for (const o of old) await L.updateSource(o.id, { Status: 'Archived' });
  const [rec] = await L.createSources([{
    Title: `Briefing ${new Date().toISOString().slice(0, 10)}`, Dossier: d.id, Kind: 'Briefing', Status: 'Approved',
    Summary: `Built from ${src.length} approved sources`, Content: content, 'Added by': who, Date: new Date().toISOString(),
  }]);
  return rec;
}

module.exports = { ingest, research, brief };
