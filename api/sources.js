// Admin feeder. GET ?dossier=id lists sources. POST {action, dossier, ...}
const L = require('./_lib');
const K = require('./_knowledge');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const me = L.whoami(req);
  if (!me) return res.status(401).json({ error: 'Wrong or missing access code' });
  if (!process.env.AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN is not set' });
  try {
    if (req.method === 'GET') {
      const d = L.loadDossier(req.query.dossier);
      const list = me.admin ? await L.listSources(d.id, { fresh: true }) : await L.listSources(d.id, { status: 'Approved' });
      return res.status(200).json({ sources: list });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST' });
    if (!me.admin) return res.status(403).json({ error: 'Only admins can manage sources' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const d = L.loadDossier(b.dossier);
    if ((b.action === 'ingest' || b.action === 'research' || b.action === 'brief') && !process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    switch (b.action) {
      case 'ingest':
        if (!String(b.text || '').trim()) throw new Error('The document is empty');
        return res.status(200).json({ source: await K.ingest(d, b, me.name) });
      case 'research':
        if (!String(b.query || '').trim()) throw new Error('Write what to research');
        return res.status(200).json({ sources: await K.research(d, b.query, me.name) });
      case 'brief':
        return res.status(200).json({ source: await K.brief(d, me.name) });
      case 'approve': return res.status(200).json({ source: await L.updateSource(b.id, { Status: 'Approved' }) });
      case 'archive': return res.status(200).json({ source: await L.updateSource(b.id, { Status: 'Archived' }) });
      case 'edit': return res.status(200).json({ source: await L.updateSource(b.id, { Content: String(b.content || '').slice(0, 90000) }) });
      default: throw new Error('Unknown action');
    }
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Request failed' });
  }
};
