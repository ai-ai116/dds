// api/stats.js — public read-only stats for the panel
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const db = await getDb();
    if (!db) return res.status(500).json({ error: 'MONGODB_URI not set' });
    const [state, stats] = await Promise.all([
      db.collection('state').findOne({ _id: 'state' }),
      db.collection('stats').findOne({ _id: 'stats' })
    ]);
    return res.json({
      state: state ? {
        running: state.running,
        serverCount: (state.servers || []).length,
        numberCount: (state.numbers || []).length,
        numIndex: state.numIndex,
        loop: state.loop,
        random: state.random,
        path: state.path,
        session: state.session,
        delay: state.delay,
        startedAt: state.startedAt,
        stoppedAt: state.stoppedAt,
        lastRunAt: state.lastRunAt
      } : null,
      stats: stats || { total: 0, success: 0, error: 0, perServer: {}, recent: [] }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
