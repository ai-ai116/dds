// api/pair.js — forwards one pairing request to the target server.
// NO database, NO storage. Works even if MongoDB is down/offline.
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const { server, path, number, session } = req.body || {};
  if (!server || !number) return res.status(400).json({ error: 'server and number are required' });

  const base = String(server).trim().replace(/\/+$/, '');
  const clean = String(number).replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(clean)) return res.status(400).json({ error: 'invalid number format' });

  const route = (path && String(path).trim()) || '/pair';
  const sep = route.includes('?') ? '&' : '?';
  const url = `${base}${route}${sep}number=${encodeURIComponent(clean)}`;

  const started = Date.now();
  let status = 'unknown', message = '', code = null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let resp;
    try {
      resp = await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    const text = (await resp.text()).slice(0, 500);
    status = resp.ok ? 'success' : 'http_' + resp.status;
    message = text;
    try {
      const j = JSON.parse(text);
      code = j.code || j.pairingCode || j.pair_code || j.pairing_code || j.pairCode || null;
    } catch (_) { /* not JSON */ }
  } catch (e) {
    status = 'error';
    message = e.name === 'AbortError' ? 'timeout (>15s)' : e.message;
  }

  return res.status(200).json({
    server: base, number: clean, status, code,
    ms: Date.now() - started, raw: message
  });
};

module.exports.config = { maxDuration: 60 };
