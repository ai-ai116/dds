// api/control.js — START / STOP the 24/7 bot. State lives in MongoDB.
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const db = await getDb();
  if (!db) return res.status(500).json({ error: 'MONGODB_URI env var not set in Vercel' });

  const token = (req.query.token || (req.body && req.body.token) || '');
  if (token !== process.env.CONTROL_TOKEN) {
    return res.status(401).json({ error: 'invalid token' });
  }

  const col = db.collection('state');

  if (req.method === 'GET') {
    const s = await col.findOne({ _id: 'state' });
    return res.json({ state: s || null });
  }

  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (action === 'start') {
      const servers = (req.body.servers || [])
        .map((s) => String(s).trim().replace(/\/+$/, ''))
        .filter(Boolean);
      const numbers = (req.body.numbers || [])
        .map((n) => String(n).replace(/\D/g, ''))
        .filter((n) => /^\d{7,15}$/.test(n));
      if (!servers.length) return res.status(400).json({ error: 'at least one server required' });
      if (!numbers.length && !req.body.random) return res.status(400).json({ error: 'add numbers or enable random mode' });

      const state = {
        _id: 'state',
        running: true,
        servers,
        numbers,
        numIndex: 0,
        path: String(req.body.path || '/pair').trim(),
        session: String(req.body.session || 'default').slice(0, 50),
        delay: Math.max(0, parseInt(req.body.delay, 10) || 0),
        loop: !!req.body.loop,
        random: !!req.body.random,
        startedAt: new Date(),
        stoppedAt: null,
        lastRunAt: null
      };
      await col.replaceOne({ _id: 'state' }, state, { upsert: true });
      // fresh run = fresh counters
      await db.collection('stats').replaceOne(
        { _id: 'stats' },
        { _id: 'stats', total: 0, success: 0, error: 0, perServer: {}, recent: [] },
        { upsert: true }
      );
      return res.json({ ok: true, running: true, servers: servers.length, numbers: numbers.length });
    }

    if (action === 'stop') {
      await col.updateOne({ _id: 'state' }, { $set: { running: false, stoppedAt: new Date() } });
      return res.json({ ok: true, running: false });
    }

    return res.status(400).json({ error: 'action must be "start" or "stop"' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
