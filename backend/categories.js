/**
 * routes/categories.js
 */
const router = require('express').Router();
const db     = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/', (req, res) => {
  const cats = db.prepare(`
    SELECT c.*, COUNT(d.id) as dish_count
    FROM categories c LEFT JOIN dishes d ON d.category_id=c.id AND d.is_available=1
    WHERE c.is_active=1 GROUP BY c.id ORDER BY c.sort_order
  `).all();
  res.json(cats);
});

router.post('/', authenticate, requireRole('admin'), (req, res) => {
  const { name, slug, description, image_url, sort_order } = req.body;
  if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO categories (name,slug,description,image_url,sort_order) VALUES (?,?,?,?,?)'
  ).run(name, slug, description||null, image_url||null, sort_order||0);
  res.status(201).json({ id: lastInsertRowid });
});

module.exports = router;


// ─────────────────────────────────────────────────────────────────────────────
// routes/users.js
// ─────────────────────────────────────────────────────────────────────────────
const userRouter = require('express').Router();

userRouter.get('/profile', require('../middleware/auth').authenticate, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,avatar_url,role,created_at FROM users WHERE id=?').get(req.user.id);
  res.json(user);
});

userRouter.patch('/profile', require('../middleware/auth').authenticate, (req, res) => {
  const { name, phone, avatar_url } = req.body;
  db.prepare('UPDATE users SET name=COALESCE(?,name),phone=COALESCE(?,phone),avatar_url=COALESCE(?,avatar_url),updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(name||null, phone||null, avatar_url||null, req.user.id);
  res.json({ message: 'Profile updated' });
});

module.exports.userRouter = userRouter;


// ─────────────────────────────────────────────────────────────────────────────
// routes/admin.js
// ─────────────────────────────────────────────────────────────────────────────
const adminRouter = require('express').Router();
const { authenticate: auth, requireRole: role } = require('../middleware/auth');

// Dashboard stats
adminRouter.get('/stats', auth, role('admin'), (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.json({
    orders_today:   db.prepare("SELECT COUNT(*) as c FROM orders WHERE date(created_at)=?").get(today).c,
    revenue_today:  db.prepare("SELECT COALESCE(SUM(total),0) as r FROM orders WHERE date(created_at)=? AND payment_status='paid'").get(today).r,
    total_users:    db.prepare("SELECT COUNT(*) as c FROM users WHERE role='customer'").get().c,
    total_dishes:   db.prepare("SELECT COUNT(*) as c FROM dishes WHERE is_available=1").get().c,
    pending_orders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='pending'").get().c,
    avg_rating:     db.prepare("SELECT ROUND(AVG(avg_rating),2) as a FROM dish_ratings").get().a,
    recent_orders:  db.prepare(`
      SELECT o.*, u.name as customer_name FROM orders o
      JOIN users u ON u.id=o.user_id ORDER BY o.created_at DESC LIMIT 10
    `).all()
  });
});

// All orders (admin)
adminRouter.get('/orders', auth, role('admin'), (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (page-1)*limit;
  let where = ''; const params = [];
  if (status) { where = 'WHERE o.status=?'; params.push(status); }
  const orders = db.prepare(`
    SELECT o.*, u.name as customer_name, u.phone
    FROM orders o JOIN users u ON u.id=o.user_id
    ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all([...params, Number(limit), offset]);
  res.json(orders);
});

// All users (admin)
adminRouter.get('/users', auth, role('admin'), (req, res) => {
  const users = db.prepare('SELECT id,name,email,phone,role,is_active,created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// Toggle user active
adminRouter.patch('/users/:id/toggle', auth, role('admin'), (req, res) => {
  db.prepare('UPDATE users SET is_active=1-is_active WHERE id=?').run(req.params.id);
  res.json({ message: 'User status toggled' });
});

module.exports.adminRouter = adminRouter;
