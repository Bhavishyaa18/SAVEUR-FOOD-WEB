/**
 * routes/auth.js — Register · Login · Refresh · Logout · Me
 */

const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const db      = require('../db');
const { signAccess, signRefresh, storeRefresh, authenticate } = require('../middleware/auth');

const SALT_ROUNDS = 12;

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email and password are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO users (name, email, phone, password) VALUES (?,?,?,?)'
  ).run(name, email.toLowerCase(), phone || null, hash);

  // Auto-create empty cart
  db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(id);

  const user = { id, name, email, role: 'customer' };
  const accessToken  = signAccess(user);
  const refreshToken = signRefresh(user);
  storeRefresh(id, refreshToken);

  res.status(201).json({ user, accessToken, refreshToken });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email=? AND is_active=1').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const payload = { id: user.id, name: user.name, email: user.email, role: user.role };
  const accessToken  = signAccess(payload);
  const refreshToken = signRefresh(payload);
  storeRefresh(user.id, refreshToken);

  const { password: _, ...safeUser } = user;
  res.json({ user: safeUser, accessToken, refreshToken });
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const stored = db.prepare(
    'SELECT * FROM refresh_tokens WHERE token=? AND expires_at > datetime("now")'
  ).get(refreshToken);
  if (!stored) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'saveur_super_secret_change_in_prod';
  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    const user = db.prepare('SELECT id,name,email,role FROM users WHERE id=?').get(decoded.id);
    const newAccess = signAccess({ id: user.id, name: user.name, email: user.email, role: user.role });
    res.json({ accessToken: newAccess });
  } catch {
    res.status(401).json({ error: 'Token verification failed' });
  }
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', authenticate, (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken)
    db.prepare('DELETE FROM refresh_tokens WHERE token=?').run(refreshToken);
  else
    db.prepare('DELETE FROM refresh_tokens WHERE user_id=?').run(req.user.id);
  res.json({ message: 'Logged out successfully' });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(
    'SELECT id,name,email,phone,role,avatar_url,created_at FROM users WHERE id=?'
  ).get(req.user.id);
  res.json(user);
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return res.status(400).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE users SET password=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(hash, req.user.id);
  db.prepare('DELETE FROM refresh_tokens WHERE user_id=?').run(req.user.id);

  res.json({ message: 'Password changed. Please log in again.' });
});

module.exports = router;
