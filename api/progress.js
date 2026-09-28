// GET /api/progress[?person=Name]  -> who you are + your stats (admins can view anyone)
const L = require('./_lib');

const EXAM_LEN = 8;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const round = (n) => (n == null ? null : Math.round(n));
function weekStart(iso) {
  const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day); d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const me = L.whoami(req);
  if (!me) return res.status(401).json({ error: 'Wrong or missing access code' });
  const base = { me: me.name, admin: me.admin, people: me.admin ? L.people() : [me.name], tracking: !!process.env.AIRTABLE_TOKEN };
  if (req.query && req.query.whoami) return res.status(200).json(base);

  const person = me.admin && req.query && req.query.person ? String(req.query.person) : me.name;
  if (!base.tracking) return res.status(200).json({ ...base, person, stats: null });

  try {
    const rows = (await L.fetchLog(person)).filter((r) => typeof r.Score === 'number' && r.Date);
    const now = Date.now(), DAY = 864e5;
    const inRange = (r, from, to) => { const t = Date.parse(r.Date); return t >= now - from * DAY && t < now - to * DAY; };
    const last7 = rows.filter((r) => inRange(r, 7, 0)), prev7 = rows.filter((r) => inRange(r, 14, 7));
    const practice = rows.filter((r) => r.Mode !== 'Exam');

    const weeks = {};
    rows.forEach((r) => { const w = weekStart(r.Date); (weeks[w] = weeks[w] || []).push(r.Score); });
    const weekly = Object.keys(weeks).sort().slice(-10).map((w) => ({ week: w, avg: round(mean(weeks[w])), n: weeks[w].length }));

    const exams = {};
    rows.filter((r) => r.Mode === 'Exam' && r['Exam ID']).forEach((r) => {
      const e = (exams[r['Exam ID']] = exams[r['Exam ID']] || { id: r['Exam ID'], date: r.Date, scores: [] });
      e.scores.push(r.Score); if (r.Date < e.date) e.date = r.Date;
    });
    const examList = Object.values(exams).filter((e) => e.scores.length >= EXAM_LEN)
      .map((e) => ({ date: e.date, score: round(mean(e.scores)) })).sort((a, b) => b.date.localeCompare(a.date));

    const byPersona = {};
    rows.forEach((r) => { (byPersona[r.Persona] = byPersona[r.Persona] || []).push(r.Score); });

    const crit = {};
    ['Accuracy', 'Clarity', 'Persuasion', 'Listening'].forEach((k) => { crit[k] = mean(rows.map((r) => r[k]).filter((n) => typeof n === 'number')); });

    return res.status(200).json({
      ...base, person,
      stats: {
        answers: rows.length,
        activeDays: new Set(rows.map((r) => r.Date.slice(0, 10))).size,
        lastActive: rows[0] ? rows[0].Date : null,
        avgAll: round(mean(rows.map((r) => r.Score))),
        avg7: round(mean(last7.map((r) => r.Score))), n7: last7.length,
        avgPrev7: round(mean(prev7.map((r) => r.Score))),
        helpRate: practice.length ? Math.round((practice.filter((r) => r['Help used'] && r['Help used'] !== 'None').length / practice.length) * 100) : null,
        bestExam: examList.length ? Math.max(...examList.map((e) => e.score)) : null,
        exams: examList.slice(0, 12),
        weekly,
        criteria: Object.fromEntries(Object.entries(crit).map(([k, v]) => [k, v == null ? null : Math.round(v * 10) / 10])),
        byPersona: Object.entries(byPersona).map(([p, s]) => ({ persona: p, avg: round(mean(s)), n: s.length })).sort((a, b) => a.avg - b.avg),
        recent: rows.slice(0, 12).map((r) => ({ date: r.Date, mode: r.Mode, persona: r.Persona, score: r.Score, help: r['Help used'], question: r.Question })),
      },
    });
  } catch (e) {
    return res.status(502).json({ error: `Could not read progress from Airtable: ${e.message}` });
  }
};
