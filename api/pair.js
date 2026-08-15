// api/pair.js — sends one pairing request to the target server, logs it to MongoDB
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://dreammini:dreammini@cluster0.drhitpk.mongodb.net/?appName=Cluster0';
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
      code = j.code || j.pairingCode || j.pair_code || j.pairing_code || null;
    } catch (_) { /* not JSON */ }
  } catch (e) {
    status = 'error';
    message = e.name === 'AbortError' ? 'timeout (>15s)' : e.message;
  }

  const ms = Date.now() - started;
  let saved = false;
  try {
    const db = await getDb();
    if (db) {
      await db.collection('requests').insertOne({
        server: base, number: clean, path: route,
        status, message: message.slice(0, 300), code,
        ms, session: String(session || 'default').slice(0, 50),
        createdAt: new Date()
      });
      saved = true;
    }
  } catch (e) { console.error('save failed:', e.message); }

  return res.status(200).json({ server: base, number: clean, status, code, ms, saved, raw: message });
};

module.exports.config = { maxDuration: 60 };
