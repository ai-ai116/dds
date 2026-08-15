// api/data.js — GET saved records / stats, DELETE clears the collection
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'pair_panel';

let cached = globalThis._mongo;
if (!cached) cached = globalThis._mongo = { client: null, db: null };

async function getDb() {
  if (cached.db) return cached.db;
  if (!MONGODB_URI) return null;
  try {
    cached.client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 4000 });
    await cached.client.connect();
    cached.db = cached.client.db(MONGODB_DB);
    return cached.db;
  } catch (e) {
    console.error('Mongo connect failed:', e.message);
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const db = await getDb();
  if (!db) return res.status(503).json({ error: 'MongoDB not configured. Add MONGODB_URI env var in Vercel.' });
  const col = db.collection('requests');

  if (req.method === 'GET') {
    const { server, number, session, limit = 50 } = req.query;
    const q = {};
    if (server) q.server = new RegExp(String(server), 'i');
    if (number) q.number = String(number).replace(/\D/g, '');
    if (session) q.session = String(session);
    const docs = await col.find(q).sort({ createdAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).toArray();
    const byStatus = await col.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).toArray();
    const totals = { total: 0 };
    byStatus.forEach((s) => { totals[s._id] = s.count; totals.total += s.count; });
    const byServer = await col.aggregate([{ $group: { _id: '$server', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]).toArray();
    return res.json({ docs, totals, byServer });
  }

  if (req.method === 'DELETE') {
    const r = await col.deleteMany({});
    return res.json({ deleted: r.deletedCount });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
