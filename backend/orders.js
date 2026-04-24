/**
 * routes/orders.js — Place, track, manage orders
 */

const router = require('express').Router();
const db     = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const genOrderNumber = () =>
  'SAV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase();

// ─── POST /api/orders — Place Order ──────────────────────────────────────────
router.post('/', authenticate, (req, res) => {
  const { address_id, coupon_id, payment_method = 'online', notes } = req.body;

  if (!address_id)
    return res.status(400).json({ error: 'Delivery address required' });

  const addr = db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(address_id, req.user.id);
  if (!addr) return res.status(404).json({ error: 'Address not found' });

  const cart = db.prepare('SELECT * FROM carts WHERE user_id=?').get(req.user.id);
  if (!cart) return res.status(400).json({ error: 'Cart is empty' });

  const items = db.prepare(`
    SELECT ci.*, d.name, d.price, d.discount_pct, d.is_available,
           ROUND(d.price*(1-d.discount_pct/100.0),2) as final_price
    FROM cart_items ci JOIN dishes d ON d.id=ci.dish_id WHERE ci.cart_id=?
  `).all(cart.id);

  if (!items.length) return res.status(400).json({ error: 'Cart is empty' });

  const unavailable = items.filter(i => !i.is_available);
  if (unavailable.length)
    return res.status(400).json({ error: `These dishes are unavailable: ${unavailable.map(i=>i.name).join(', ')}` });

  const subtotal    = items.reduce((s, i) => s + i.final_price * i.quantity, 0);
  const delivery    = subtotal >= 999 ? 0 : 49;
  const gst         = subtotal * 0.05;
  let   discount    = 0;

  if (coupon_id) {
    const coupon = db.prepare('SELECT * FROM coupons WHERE id=? AND is_active=1').get(coupon_id);
    if (coupon && subtotal >= coupon.min_order) {
      discount = coupon.type === 'flat'
        ? coupon.value
        : Math.min(subtotal * coupon.value / 100, coupon.max_discount || Infinity);
      db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(coupon_id);
    }
  }

  const total = +(subtotal + delivery + gst - discount).toFixed(2);
  const estimatedDelivery = new Date(Date.now() + 40 * 60 * 1000).toISOString();

  const placeOrder = db.transaction(() => {
    const { lastInsertRowid: orderId } = db.prepare(`
      INSERT INTO orders
        (order_number,user_id,address_id,subtotal,delivery_fee,discount,gst,total,
         payment_method,estimated_delivery,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(genOrderNumber(), req.user.id, address_id, +subtotal.toFixed(2),
           delivery, +discount.toFixed(2), +gst.toFixed(2), total,
           payment_method, estimatedDelivery, notes || null);

    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id,dish_id,name,price,quantity,subtotal) VALUES (?,?,?,?,?,?)'
    );
    items.forEach(i => insertItem.run(orderId, i.dish_id, i.name, i.final_price, i.quantity, +(i.final_price*i.quantity).toFixed(2)));

    db.prepare(`INSERT INTO order_status_log (order_id,status,changed_by) VALUES (?,?,?)`)
      .run(orderId, 'pending', req.user.id);

    db.prepare('DELETE FROM cart_items WHERE cart_id=?').run(cart.id);

    return orderId;
  });

  const orderId = placeOrder();

  if (payment_method === 'cod') {
    db.prepare("UPDATE orders SET status='confirmed', payment_status='pending' WHERE id=?").run(orderId);
    db.prepare("INSERT INTO order_status_log (order_id,status) VALUES (?,?)").run(orderId, 'confirmed');
  }

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  res.status(201).json({ order, message: 'Order placed successfully' });
});

// ─── GET /api/orders — My Orders ─────────────────────────────────────────────
router.get('/', authenticate, (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE o.user_id=?';
  const params = [req.user.id];
  if (status) { where += ' AND o.status=?'; params.push(status); }

  const orders = db.prepare(`
    SELECT o.*, COUNT(oi.id) as item_count
    FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id
    ${where} GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?
  `).all([...params, Number(limit), offset]);

  res.json({ orders, page: Number(page) });
});

// ─── GET /api/orders/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const order = db.prepare(`
    SELECT o.*, a.line1, a.line2, a.city, a.state, a.pincode
    FROM orders o LEFT JOIN addresses a ON a.id=o.address_id
    WHERE o.id=? AND (o.user_id=? OR ? IN ('admin','chef','delivery'))
  `).get(req.params.id, req.user.id, req.user.role);

  if (!order) return res.status(404).json({ error: 'Order not found' });

  const items = db.prepare(`
    SELECT oi.*, d.image_url FROM order_items oi
    LEFT JOIN dishes d ON d.id=oi.dish_id WHERE oi.order_id=?
  `).all(order.id);

  const statusLog = db.prepare(
    'SELECT * FROM order_status_log WHERE order_id=? ORDER BY created_at ASC'
  ).all(order.id);

  res.json({ ...order, items, statusLog });
});

// ─── PATCH /api/orders/:id/status — Staff only ───────────────────────────────
router.patch('/:id/status', authenticate, requireRole('admin','chef','delivery'), (req, res) => {
  const { status, note } = req.body;
  const valid = ['confirmed','preparing','out_for_delivery','delivered','cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const updates = { status };
  if (status === 'delivered') updates.delivered_at = new Date().toISOString();

  const sets = Object.keys(updates).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE orders SET ${sets}, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(...Object.values(updates), order.id);
  db.prepare('INSERT INTO order_status_log (order_id,status,note,changed_by) VALUES (?,?,?,?)')
    .run(order.id, status, note || null, req.user.id);

  // Emit real-time update
  try {
    const { io } = require('../server');
    io.to(`order_${order.id}`).emit('order:status', { orderId: order.id, status, note });
    io.to(`user_${order.user_id}`).emit('order:status', { orderId: order.id, status });
  } catch {}

  res.json({ message: 'Status updated', status });
});

// ─── POST /api/orders/:id/cancel ─────────────────────────────────────────────
router.post('/:id/cancel', authenticate, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!['pending','confirmed'].includes(order.status))
    return res.status(400).json({ error: 'Order cannot be cancelled at this stage' });

  db.prepare("UPDATE orders SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
  db.prepare('INSERT INTO order_status_log (order_id,status,changed_by) VALUES (?,?,?)').run(order.id, 'cancelled', req.user.id);

  res.json({ message: 'Order cancelled' });
});

module.exports = router;
