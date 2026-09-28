// Weekly automatic research (Vercel Cron). Results land as Pending sources for the admin to approve.
const fs = require('fs');
const path = require('path');
const L = require('./_lib');
const K = require('./_knowledge');

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const ids = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'index.json'), 'utf8'));
  const report = {};
  for (const id of ids) {
    try {
      const d = L.loadDossier(id);
      const q = d.autoResearch || `Latest news, reviews and exhibitions about the artist ${d.artist.name} in the past month, plus notable related exhibitions and art-world news relevant to: ${d.context}`;
      report[id] = (await K.research(d, q, 'Weekly research')).length;
    } catch (e) { report[id] = e.message; }
  }
  return res.status(200).json({ ok: true, report });
};
