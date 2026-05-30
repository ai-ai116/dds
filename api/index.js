require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

const SettingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed
});

const History = mongoose.model('History', HistorySchema);
const Stats = mongoose.model('Stats', StatsSchema);
const Setting = mongoose.model('Setting', SettingSchema);

// ==================== Initialize Stats ====================
async function initStats() {
  const stats = await Stats.findOne({});
  if (!stats) {
    await new Stats({ totalRequests: 0, successfulPairs: 0, failedPairs: 0 }).save();
  }
}
initStats();

// ==================== Helper: WhatsApp Pair Function ====================
async function generatePairCode(phoneNumber, serverUrl) {
  return new Promise(async (resolve, reject) => {
    try {
      // Clean phone number - remove any non-digit characters
      const cleanNumber = phoneNumber.replace(/[^0-9]/g, '');
      if (cleanNumber.length < 10) {
        return reject(new Error('Invalid phone number. Must be at least 10 digits.'));
      }

      const logger = pino({ level: 'silent' });
      const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${cleanNumber}`);

      const sock = makeWASocket({
        logger,
        printQRInTerminal: false,
        auth: state,
        browser: ['Chrome (Linux)', '', ''],
        syncFullHistory: false,
        generateHighQualityLink: true
      });

      // Timeout after 30 seconds
      const timeout = setTimeout(() => {
        sock.end(new Error('Timeout'));
        reject(new Error('Pairing code generation timed out. Try again.'));
      }, 30000);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          clearTimeout(timeout);
          sock.end();
          resolve({ success: true, message: 'Already connected', phone: cleanNumber });
        }

        if (connection === 'connecting' || update.qr) {
          try {
            // Request pairing code
            const code = await sock.requestPairingCode(cleanNumber);
            clearTimeout(timeout);
            
            if (code) {
              // Format code with dash in the middle
              const formattedCode = code.substring(0, 4) + '-' + code.substring(4);
              sock.end();
              
              // Log to history
              await History.create({
                phoneNumber: cleanNumber,
                serverUrl: serverUrl || 'N/A',
                pairCode: formattedCode,
                status: 'success',
                requestsSent: 1
              });

              // Update stats
              await Stats.findOneAndUpdate({}, { $inc: { totalRequests: 1, successfulPairs: 1 } });

              resolve({ success: true, code: formattedCode, phone: cleanNumber });
            }
          } catch (err) {
            clearTimeout(timeout);
            sock.end();
            reject(new Error(`Pairing failed: ${err.message}`));
          }
        }

        if (connection === 'close') {
          clearTimeout(timeout);
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          if (statusCode === DisconnectReason.loggedOut) {
            reject(new Error('Session logged out.'));
          } else if (statusCode === DisconnectReason.restartRequired) {
            // Retry once
            try {
              const retryResult = await generatePairCode(phoneNumber, serverUrl);
              resolve(retryResult);
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error(`Connection closed. Code: ${statusCode}`));
          }
        }
      });

    } catch (error) {
      reject(error);
    }
  });
}

// ==================== API Routes ====================

// Generate single pair code
app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber, serverUrl } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const result = await generatePairCode(phoneNumber, serverUrl || 'Direct');
    
    res.json({
      success: true,
      code: result.code,
      phone: result.phone,
      message: 'Pairing code generated successfully'
    });

  } catch (error) {
    await Stats.findOneAndUpdate({}, { $inc: { failedPairs: 1 } });
    res.status(500).json({ success: false, message: error.message });
  }
});

// Generate multiple pair codes (batch)
app.post('/api/pair-batch', async (req, res) => {
  try {
    const { phoneNumber, serverUrl, count, mode } = req.body;
    const batchCount = parseInt(count) || 1;
    const numberMode = mode || 'custom';

    if (!phoneNumber && numberMode === 'custom') {
      return res.status(400).json({ success: false, message: 'Phone number is required in custom mode' });
    }

    let results = [];
    let currentPhone = phoneNumber;

    for (let i = 0; i < batchCount; i++) {
      try {
        if (numberMode === 'random') {
          // Generate random Pakistani phone number
          const randomSuffix = Math.floor(Math.random() * 90000000) + 10000000;
          currentPhone = `92${randomSuffix}`;
        }

        // For auto-increment: modify last digit
        if (i > 0 && numberMode === 'auto-increment') {
          const baseNum = parseInt(phoneNumber.replace(/\D/g, ''));
          currentPhone = (baseNum + i).toString();
        }

        const result = await generatePairCode(currentPhone, serverUrl || 'Batch');
        results.push({ phone: currentPhone, code: result.code, success: true });

        // Small delay between requests
        if (i < batchCount - 1) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (err) {
        results.push({ phone: currentPhone, error: err.message, success: false });
      }
    }

    res.json({
      success: true,
      totalRequested: batchCount,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
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

    const history = await History.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await History.countDocuments();

    res.json({
      success: true,
      history,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get stats
app.get('/api/stats', async (req, res) => {
  try {
    let stats = await Stats.findOne({});
    if (!stats) {
      stats = await new Stats({ totalRequests: 0, successfulPairs: 0, failedPairs: 0 }).save();
    }
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

// ==================== Health Check ====================
app.get('/api/health', (req, res) => {
  res.json({ status: 'running', timestamp: new Date().toISOString() });
});

// ==================== Export for Vercel ====================
module.exports = app;
