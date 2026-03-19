const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const pool = require('./config/database');
const authenticate = require('./middleware/auth');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Download sample manual upload sheet
app.get('/api/download/sample-sheet', (req, res) => {
  const filePath = path.join(__dirname, 'sample', 'manual_upload.xlsx');
  res.download(filePath, 'manual_upload.xlsx', (err) => {
    if (err) {
      res.status(404).json({ error: 'Sample file not found' });
    }
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/usage', require('./routes/usage'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});



