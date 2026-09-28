// POST /api/batch: many questions or many evaluations in ONE call to Claude (cheaper than one by one).
// { action: 'cards', dossier, personas: [id...], seen, focus, exam }  -> { cards: [...] }
// { action: 'evaluate', dossier, mode, examId, items: [{persona, question, answer, help}] } -> { results: [...] }
const L = require('./_lib');

const MAX = 10;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const me = L.whoami(req);
  if (!me) return res.status(401).json({ error: 'Wrong or missing access code' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const d = L.loadDossier(b.dossier);
    const byId = Object.fromEntries((d.personas || []).map((p) => [p.id, p]));
    const lang = L.LANGS[b.lang] ? b.lang : 'en';
    let src = [];
    try { src = await L.approvedContext(d.id); } catch (e) { src = []; }
    const ctx = L.contextText(d, src);
    const cast = (ids) => [...new Set(ids)].map((id) => `- ${id}: ${byId[id].name}. ${byId[id].brief}`).join('\n');

    if (b.action === 'cards') {
      const ids = (b.personas || []).slice(0, MAX);
      if (!ids.length || ids.some((id) => !byId[id])) throw new Error('Unknown persona');
      const seen = Array.isArray(b.seen) ? b.seen.slice(-30).map((x) => String(x).slice(0, 200)) : [];
      const fields = b.exam
        ? '{"persona": "id", "q": "the question, 1 to 3 spoken sentences", "intent": "what it tests"}'
        : '{"persona": "id", "q": "the question, 1 to 2 spoken sentences", "intent": "what it tests", "keyPoints": ["3 to 5 short points"], "answer": "strong spoken answer, first person, 50 to 110 words, [brackets] for anything unconfirmed", "avoid": "one sentence on the trap"}';
      const prompt = `Output language: ${L.LANGS[lang]}.
Visitors in this set:
${cast(ids)}

Write a set of ${ids.length} questions, one per visitor in exactly this order: ${JSON.stringify(ids)}. Each sounds like that real person at the booth. Vary the angles across the set (the work, the artist, meaning and lineage, the story, market and price, practicalities, objections) and make the set build naturally, from easier to harder. Every question must differ from the others and from these already studied: ${JSON.stringify(seen)}.
${b.focus ? `The trainee is currently weakest at: ${String(b.focus).slice(0, 200)}. Include at least two questions that exercise that.\n` : ''}${b.exam ? 'This is an exam: questions only, no crib sheets.\n' : ''}
Return ONLY JSON: {"cards": [${fields}]}`;
      const out = await L.askClaude(ctx, prompt, { maxTokens: b.exam ? 1500 : 5000 });
      const cards = (out.cards || []).slice(0, ids.length).map((c, i) => ({ ...c, persona: byId[c.persona] ? c.persona : ids[i] }));
      return res.status(200).json({ cards });
    }

    if (b.action === 'evaluate') {
      const items = (b.items || []).slice(0, MAX).filter((x) => x && byId[x.persona] && String(x.answer || '').trim());
      if (!items.length) throw new Error('Nothing to score: write at least one answer');
      const list = items.map((x, i) => `#${i} VISITOR (${x.persona}): "${String(x.question).slice(0, 800)}"\nGALLERY ANSWER: "${String(x.answer).slice(0, 3000)}"`).join('\n\n');
      const prompt = `Output language: ${L.LANGS[lang]}.
Visitors:
${cast(items.map((x) => x.persona))}

Act as a demanding but fair sales coach for a top-tier art fair. Score each answer below against the ground truth and that visitor's profile. Be calibrated: 3 is competent, 4 strong, 5 exceptional and rare; empty, evasive or off-topic answers score 1.
Criteria, 1 to 5: accuracy (facts match, nothing invented, unconfirmed items handled honestly), clarity (concrete, right length), persuasion (builds desire and trust, moves to a next step), listening (answers what was asked, in the visitor's register).

${list}

Keep each evaluation tight. Return ONLY JSON:
{"results": [{"i": 0, "scores": {"accuracy": n, "clarity": n, "persuasion": n, "listening": n}, "verdict": "one sentence", "worked": ["max 2"], "missing": ["max 2"], "factcheck": ["wrong or unsupported claims, empty if none"], "stronger": "a stronger spoken version, 40 to 90 words, [brackets] for unconfirmed"}]}`;
      const out = await L.askClaude(ctx, prompt, { maxTokens: 900 * items.length + 500 });
      const mode = { study: 'Study', rehearse: 'Rehearse', exam: 'Exam' }[b.mode] || 'Study';
      const examId = /^[a-z0-9-]{6,40}$/i.test(b.examId || '') ? b.examId : '';
      const now = new Date().toISOString();
      const results = items.map((x, i) => {
        const r = (out.results || []).find((y) => Number(y.i) === i) || (out.results || [])[i] || {};
        const scores = r.scores || {};
        return { ...r, i, scores, score: L.score100(scores), persona: x.persona, question: x.question, answer: x.answer, help: x.help };
      });
      let logged = false, logError = '';
      try {
        logged = await L.logMany(results.map((r) => ({
          Entry: `${me.name}, ${mode}, ${byId[r.persona].name}, ${r.score}`,
          Person: me.name, Date: now, Mode: mode, Dossier: d.id, Persona: byId[r.persona].name, Score: r.score,
          Accuracy: Number(r.scores.accuracy) || 1, Clarity: Number(r.scores.clarity) || 1,
          Persuasion: Number(r.scores.persuasion) || 1, Listening: Number(r.scores.listening) || 1,
          'Help used': mode === 'Exam' ? 'None' : ({ hints: 'Hints', answer: 'Answer' }[r.help] || 'None'),
          'Exam ID': examId, Question: String(r.question || '').slice(0, 1000), Answer: String(r.answer || '').slice(0, 4000), Verdict: String(r.verdict || ''),
        })));
      } catch (e) { logError = e.message; }
      const strong = results.filter((r) => r.score >= 85);
      if (strong.length && process.env.AIRTABLE_TOKEN) {
        try {
          await L.createSources(strong.map((r) => ({
            Title: String(r.question).slice(0, 120), Dossier: d.id, Kind: 'House line', Status: 'Pending',
            Summary: `Scored ${r.score} by ${me.name} (${mode}, ${byId[r.persona].name})`,
            Content: `Q (${byId[r.persona].name}): ${r.question}\nA: ${r.answer}`, 'Added by': me.name, Date: now,
          })));
        } catch (e) { /* non-blocking */ }
      }
      return res.status(200).json({ results, logged, logError, proposed: strong.length });
    }
    throw new Error('Unknown action');
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Request failed' });
  }
};
