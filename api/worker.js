// api/worker.js — called by cron-job.org every minute.
// If the bot is running, it sends pairing requests to ALL servers in parallel
// until its 50-second time budget ends. Progress is saved to MongoDB, so even
// a killed run resumes on the next cron tick.
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const BUDGET_MS = 50000; // stay under Vercel Hobby's 60s function limit

let cached = globalThis._mongo;
if (!cached) cached = globalThis._mongo = { client: null, db: null };

async function getDb() {
  if (cached.db) return cached.db;
  if (!MONGODB_URI) return null;
  cached.client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await cached.client.connect();
  cached.db = cached.client.db('pair_bot');
  return cached.db;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomNumber() {
  const prefixes = ['92', '91', '1', '44', '61', '971', '966', '90'];
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  let n = p;
  for (let i = 0; i < 10 - p.length; i++) n += Math.floor(Math.random() * 10);
  return n;
}

async function hit(server, number, path) {
  const t0 = Date.now();
  const route = (path || '/pair').trim();
  const sep = route.includes('?') ? '&' : '?';
  const url = `${server}${route}${sep}number=${encodeURIComponent(number)}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let resp;
    try {
      resp = await fetch(url, { signal: ctrl.signal });
    } finally { clearTimeout(timer); }
    const text = (await resp.text()).slice(0, 300);
    const status = resp.ok ? 'success' : 'http_' + resp.status;
    let code = null;
    try {
      const j = JSON.parse(text);
      code = j.code || j.pairingCode || j.pair_code || j.pairing_code || j.pairCode || null;
    } catch (_) {}
    return { server, number, status, code, ms: Date.now() - t0, raw: text.slice(0, 120) };
  } catch (e) {
    return { server, number, status: 'error', code: null, ms: Date.now() - t0, raw: e.message };
  }
}

module.exports = async function handler(req, res) {
  const token = req.query.token || '';
  if (token !== process.env.CONTROL_TOKEN) return res.status(401).json({ error: 'invalid token' });

  const db = await getDb();
  if (!db) return res.status(500).json({ error: 'MONGODB_URI not set' });

  const stateCol = db.collection('state');
  const statsCol = db.collection('stats');

  const state = await stateCol.findOne({ _id: 'state' });
  if (!state || !state.running) return res.json({ running: false, reason: 'bot is stopped' });
  if (!state.servers || !state.servers.length) return res.json({ running: true, error: 'no servers configured' });

  // overlap guard: skip if another invocation already ran in the last 40s
  if (state.lastRunAt && Date.now() - new Date(state.lastRunAt).getTime() < 40000) {
    return res.json({ running: true, skipped: 'recent run detected' });
  }
  await stateCol.updateOne({ _id: 'state' }, { $set: { lastRunAt: new Date() } });

  let stats = await statsCol.findOne({ _id: 'stats' }) ||
    { _id: 'stats', total: 0, success: 0, error: 0, perServer: {}, recent: [] };
  if (!stats.perServer) stats.perServer = {};
  if (!stats.recent) stats.recent = [];

  const deadline = Date.now() + BUDGET_MS;
  let processed = 0;

  while (Date.now() < deadline) {
    // pick next number
    let number = null;
    if (state.numbers && state.numbers.length) {
      if (state.numIndex >= state.numbers.length) {
        if (state.random) number = randomNumber();
        else if (state.loop) { state.numIndex = 0; number = state.numbers[0]; state.numIndex++; }
        else break; // list finished, no loop
      } else {
        number = state.numbers[state.numIndex];
        state.numIndex++;
      }
    } else if (state.random) {
      number = randomNumber();
    } else {
      break;
    }

    // ALL servers in parallel for this number — nobody gets skipped
    const results = await Promise.allSettled(
      state.servers.map((srv) => hit(srv, number, state.path))
    );

    let ok = 0, bad = 0;
    results.forEach((r, i) => {
      const url = state.servers[i];
      const v = r.status === 'fulfilled'
        ? r.value
        : { status: 'error', code: null, ms: 0, raw: (r.reason && r.reason.message) || 'rejected' };
      const ps = stats.perServer[url] || (stats.perServer[url] = { total: 0, success: 0, error: 0, lastCode: '' });
      ps.total++;
      if (v.status === 'success') { ps.success++; ok++; ps.lastCode = v.code || ps.lastCode; }
      else { ps.error++; bad++; }
      stats.total++;
    });
    stats.success += ok;
    stats.error += bad;

    stats.recent.unshift({
      at: new Date().toISOString(),
      number,
      ok, bad,
      sample: results.slice(0, 5).map((r) => {
        const v = r.status === 'fulfilled' ? r.value : { status: 'error', code: null, ms: 0 };
        return { s: v.server.replace('https://', '').slice(0, 24), st: v.status, code: v.code || null, ms: v.ms };
      })
    });
    stats.recent = stats.recent.slice(0, 50);
    await statsCol.replaceOne({ _id: 'stats' }, stats, { upsert: true });
    // persist progress every round so a killed run resumes correctly
    await stateCol.updateOne({ _id: 'state' }, { $set: { numIndex: state.numIndex } });

    processed++;
    if (state.delay) await sleep(state.delay);
  }

  return res.json({ running: true, processed, at: new Date().toISOString(), total: stats.total });
};

module.exports.config = { maxDuration: 60 };
