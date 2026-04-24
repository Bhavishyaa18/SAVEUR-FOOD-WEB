/**
 * SAVEUR — Food Delivery Backend
 * Stack: Node.js + Express + SQLite (via better-sqlite3)
 * Auth: JWT + bcrypt
 * Payments: Razorpay (India)
 * Real-time: Socket.IO (order tracking)
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: 'Too many requests' } });
app.use('/api/', limiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/dishes',     require('./routes/dishes'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/cart',       require('./routes/cart'));
app.use('/api/orders',     require('./routes/orders'));
app.use('/api/payments',   require('./routes/payments'));
app.use('/api/users',      require('./routes/users'));
app.use('/api/reviews',    require('./routes/reviews'));
app.use('/api/addresses',  require('./routes/addresses'));
app.use('/api/admin',      require('./routes/admin'));

// ─── Socket.IO — Live Order Tracking ─────────────────────────────────────────
require('./sockets/orderTracking')(io);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ─── 404 + Error Handler ──────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🍽  Saveur API running on port ${PORT}`));

module.exports = { app, io };
