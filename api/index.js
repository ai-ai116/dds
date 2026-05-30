require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== SERVE STATIC FILES (FIX #1) ====================
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback: if no API route matches, serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ==================== MongoDB Connection ====================
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/whatsapp-pair';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ==================== MongoDB Schemas ====================
const HistorySchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  serverUrl: { type: String, required: true },
  pairCode: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
  requestsSent: { type: Number, default: 0 },
  targetCount: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const StatsSchema = new mongoose.Schema({
  totalRequests: { type: Number, default: 0 },
  successfulPairs: { type: Number, default: 0 },
  failedPairs: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});

const History = mongoose.model('History', HistorySchema);
const Stats = mongoose.model('Stats', StatsSchema);

// ==================== Initialize Stats ====================
async function initStats() {
  const stats = await Stats.findOne({});
  if (!stats) {
    await new Stats({ totalRequests: 0, successfulPairs: 0, failedPairs: 0 }).save();
  }
}
initStats();

// ==================== Mock Pair Function (Vercel-safe) ====================
// Vercel serverless cannot run @whiskeysockets/baileys (needs persistent WebSocket & file writes)
// For production pair code generation, you need a VPS or Railway.
// This endpoint records the request and returns a simulated pair code for demonstration.
app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber, serverUrl } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    // Generate a mock pair code (real pairing needs a VPS)
    const mockCode = Math.random().toString(36).substring(2, 6).toUpperCase() + 
                     '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    await History.create({
      phoneNumber,
      serverUrl: serverUrl || 'N/A',
      pairCode: mockCode,
      status: 'success',
      requestsSent: 1
    });

    await Stats.findOneAndUpdate({}, { $inc: { totalRequests: 1, successfulPairs: 1 } });

    res.json({
      success: true,
      code: mockCode,
      phone: phoneNumber,
      message: 'Pair code generated (demo mode — for real pairing deploy on Railway)'
    });
  } catch (error) {
    await Stats.findOneAndUpdate({}, { $inc: { failedPairs: 1 } });
    res.status(500).json({ success: false, message: error.message });
  }
});

// Batch pair endpoint
app.post('/api/pair-batch', async (req, res) => {
  try {
    const { phoneNumber, serverUrl, count, mode } = req.body;
    const batchCount = parseInt(count) || 1;
    const numberMode = mode || 'custom';
    let results = [];
    let currentPhone = phoneNumber;

    for (let i = 0; i < Math.min(batchCount, 100); i++) { // Limit to 100 on Vercel
      if (numberMode === 'random') {
        currentPhone = `92${Math.floor(Math.random() * 90000000) + 10000000}`;
      }
      if (i > 0 && numberMode === 'auto-increment' && phoneNumber) {
        currentPhone = (parseInt(phoneNumber.replace(/\D/g, '')) + i).toString();
      }

      const mockCode = Math.random().toString(36).substring(2, 6).toUpperCase() + 
                       '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      
      results.push({ phone: currentPhone, code: mockCode, success: true });
    }

    await Stats.findOneAndUpdate({}, { $inc: { totalRequests: results.length, successfulPairs: results.length } });

    res.json({
      success: true,
      totalRequested: results.length,
      successful: results.length,
      failed: 0,
      results
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get history
app.get('/api/history', async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const history = await History.find().sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await History.countDocuments();
    res.json({ success: true, history, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get stats
app.get('/api/stats', async (req, res) => {
  try {
    let stats = await Stats.findOne({});
    if (!stats) stats = await new Stats().save();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Clear history
app.delete('/api/history', async (req, res) => {
  try {
    await History.deleteMany({});
    res.json({ success: true, message: 'History cleared' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'running', timestamp: new Date().toISOString() });
});

// ==================== Export for Vercel ====================
module.exports = app;
