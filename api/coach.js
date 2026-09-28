// POST /api/coach  { action, dossier, persona, lang, ... }
const L = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  const me = L.whoami(req);
  if (!me) return res.status(401).json({ error: 'Wrong or missing access code' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });

  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const d = L.loadDossier(b.dossier);
    const persona = (d.personas || []).find((p) => p.id === b.persona);
    if (!persona) throw new Error('Unknown persona');
    const lang = L.LANGS[b.lang] ? b.lang : 'en';
    if (b.action === 'cheat' && b.mode === 'exam') throw new Error('No crib sheets during an exam');

    let src = [];
    try { src = await L.approvedContext(d.id); } catch (e) { src = []; }
    const out = await L.askClaude(L.contextText(d, src), `${L.personaBlock(persona, lang)}\n\n${L.task(b.action, b)}`);

    if (b.action === 'evaluate') {
      const score = L.score100(out.scores);
      out.score = score;
      const mode = { study: 'Study', rehearse: 'Rehearse', exam: 'Exam' }[b.mode] || 'Rehearse';
      const help = { hints: 'Hints', answer: 'Answer' }[b.help] || 'None';
      const examId = /^[a-z0-9-]{6,40}$/i.test(b.examId || '') ? b.examId : '';
      try {
        out.logged = await L.logAttempt({
          Entry: `${me.name}, ${mode}, ${persona.name}, ${score}`,
          Person: me.name,
          Date: new Date().toISOString(),
          Mode: mode,
          Dossier: d.id,
          Persona: persona.name,
          Score: score,
          Accuracy: Number(out.scores.accuracy) || 1,
          Clarity: Number(out.scores.clarity) || 1,
          Persuasion: Number(out.scores.persuasion) || 1,
          Listening: Number(out.scores.listening) || 1,
          'Help used': mode === 'Exam' ? 'None' : help,
          'Exam ID': examId,
          Question: String(b.question || '').slice(0, 1000),
          Answer: String(b.answer || '').slice(0, 4000),
          Verdict: String(out.verdict || ''),
        });
      } catch (e) {
        out.logged = false;
        out.logError = e.message;
      }
      // Self-improvement: strong answers are proposed as house lines for the admin to approve.
      if (score >= 85 && process.env.AIRTABLE_TOKEN) {
        try {
          await L.createSources([{
            Title: String(b.question || '').slice(0, 120),
            Dossier: d.id, Kind: 'House line', Status: 'Pending',
            Summary: `Scored ${score} by ${me.name} (${mode}, ${persona.name})`,
            Content: `Q (${persona.name}): ${String(b.question || '').slice(0, 1000)}\nA: ${String(b.answer || '').slice(0, 3000)}`,
            'Added by': me.name, Date: new Date().toISOString(),
          }]);
          out.proposed = true;
        } catch (e) { /* non-blocking */ }
      }
    }
    return res.status(200).json(out);
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Request failed' });
  }
};
