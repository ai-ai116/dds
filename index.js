const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Connection (Replace with your MongoDB URL)
mongoose.connect('mongodb+srv://erfanx:erfanx@cluster0.k0m6dn2.mongodb.net/?appName=Cluster0/pairdb?retryWrites=true&w=majority')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('MongoDB Error:', err));

// Save History Schema
const logSchema = new mongoose.Schema({
  number: String,
  code: String,
  timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', logSchema);

app.post('/send-pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.json({ success: false, message: "Number required" });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(`auth_${number}`);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    const code = await sock.requestPairingCode(number);
    
    // Save to MongoDB
    await new Log({ number, code }).save();

    console.log(`Pair Code for ${number}: ${code}`);
    res.json({ success: true, code });

  } catch (error) {
    console.error(error);
    res.json({ success: false, message: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));