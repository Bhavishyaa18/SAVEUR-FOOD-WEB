/**
 * routes/cart.js — Cart management
 */

const router = require('express').Router();
const db     = require('../db');
const { authenticate } = require('../middleware/auth');

const getCart = (userId) => {
  let cart = db.prepare('SELECT * FROM carts WHERE user_id=?').get(userId);
  if (!cart) {
    const { lastInsertRowid } = db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(userId);
    cart = { id: lastInsertRowid, user_id: userId };
  }
  const items = db.prepare(`
    SELECT ci.*, d.name, d.image_url, d.price as unit_price,
           ROUND(d.price * (1 - d.discount_pct/100.0), 2) as final_price,
           d.is_available, d.prep_time_min
    FROM cart_items ci JOIN dishes d ON d.id = ci.dish_id
    WHERE ci.cart_id = ?
  `).all(cart.id);

  const subtotal    = items.reduce((s, i) => s + i.final_price * i.quantity, 0);
  const delivery    = subtotal >= 999 ? 0 : 49;
  const gst         = subtotal * 0.05;
  const total       = subtotal + delivery + gst;
  const prep_time   = Math.max(...items.map(i => i.prep_time_min), 0) + 10;

  return { cart_id: cart.id, items, subtotal: +subtotal.toFixed(2),
           delivery_fee: delivery, gst: +gst.toFixed(2), total: +total.toFixed(2), prep_time };
};

router.get('/',    authenticate, (req, res) => res.json(getCart(req.user.id)));

router.post('/add', authenticate, (req, res) => {
  const { dish_id, quantity = 1, notes } = req.body;
  if (!dish_id) return res.status(400).json({ error: 'dish_id required' });

  const dish = db.prepare('SELECT * FROM dishes WHERE id=? AND is_available=1').get(dish_id);
  if (!dish) return res.status(404).json({ error: 'Dish not available' });

  const cart = db.prepare('SELECT * FROM carts WHERE user_id=?').get(req.user.id)
             || { id: db.prepare('INSERT INTO carts (user_id) VALUES (?)').run(req.user.id).lastInsertRowid };

  const existing = db.prepare('SELECT * FROM cart_items WHERE cart_id=? AND dish_id=?').get(cart.id, dish_id);
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity=quantity+?, notes=COALESCE(?,notes) WHERE id=?')
      .run(quantity, notes || null, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (cart_id, dish_id, quantity, notes) VALUES (?,?,?,?)')
      .run(cart.id, dish_id, quantity, notes || null);
  }
  db.prepare('UPDATE carts SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(cart.id);
  res.json(getCart(req.user.id));
});

router.patch('/item/:itemId', authenticate, (req, res) => {
  const { quantity } = req.body;
  if (quantity <= 0) {
    db.prepare('DELETE FROM cart_items WHERE id=?').run(req.params.itemId);
  } else {
    db.prepare('UPDATE cart_items SET quantity=? WHERE id=?').run(quantity, req.params.itemId);
  }
  res.json(getCart(req.user.id));
});

router.delete('/item/:itemId', authenticate, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id=?').run(req.params.itemId);
  res.json(getCart(req.user.id));
});

router.delete('/clear', authenticate, (req, res) => {
  const cart = db.prepare('SELECT id FROM carts WHERE user_id=?').get(req.user.id);
  if (cart) db.prepare('DELETE FROM cart_items WHERE cart_id=?').run(cart.id);
  res.json({ message: 'Cart cleared' });
});

// Apply coupon
router.post('/coupon', authenticate, (req, res) => {
  const { code } = req.body;
  const coupon = db.prepare(`
    SELECT * FROM coupons WHERE code=? AND is_active=1
    AND (expires_at IS NULL OR expires_at > datetime('now'))
    AND used_count < usage_limit
  `).get(code?.toUpperCase());

  if (!coupon) return res.status(404).json({ error: 'Invalid or expired coupon' });

  const { subtotal } = getCart(req.user.id);
  if (subtotal < coupon.min_order)
    return res.status(400).json({ error: `Minimum order ₹${coupon.min_order} required` });

  let discount = coupon.type === 'flat'
    ? coupon.value
    : Math.min(subtotal * coupon.value / 100, coupon.max_discount || Infinity);

  res.json({ coupon_id: coupon.id, code: coupon.code, discount: +discount.toFixed(2) });
});

module.exports = router;


// ═══════════════════════════════════════════════════════════════════════════════
// routes/orders.js
// ═══════════════════════════════════════════════════════════════════════════════
// Separate file in real project; combined here for brevity
