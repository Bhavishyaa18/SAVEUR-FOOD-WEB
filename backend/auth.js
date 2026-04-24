/**
 * middleware/auth.js — JWT authentication middleware
 */

const jwt = require('jsonwebtoken');
const db  = require('../db');

const JWT_SECRET         = process.env.JWT_SECRET || 'saveur_super_secret_change_in_prod';
const JWT_EXPIRES        = process.env.JWT_EXPIRES || '15m';
const REFRESH_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Token Generators ─────────────────────────────────────────────────────────
const signAccess = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

const signRefresh = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

const storeRefresh = (userId, token) => {
  const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_MS).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?,?,?)')
    .run(userId, token, expiresAt);
};

// ─── Authenticate Middleware ──────────────────────────────────────────────────
const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ error: 'No token provided' });

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id,name,email,role,is_active FROM users WHERE id=?').get(decoded.id);
    if (!user || !user.is_active)
      return res.status(401).json({ error: 'Account not found or deactivated' });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── Role Guard ───────────────────────────────────────────────────────────────
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!roles.includes(req.user.role))
    return res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
  next();
};

module.exports = { authenticate, requireRole, signAccess, signRefresh, storeRefresh };
