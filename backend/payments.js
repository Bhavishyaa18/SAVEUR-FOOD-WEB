/**
 * routes/payments.js — Razorpay integration
 */
const router  = require('express').Router();
const db      = require('../db');
const { authenticate } = require('../middleware/auth');
const crypto  = require('crypto');

const Razorpay = (() => {
  try { return require('razorpay'); } catch { return null; }
})();

const razorpay = Razorpay ? new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_XXXXXXXX',
  key_secret: process.env.RAZORPAY_SECRET || 'secret'
}) : null;

// Create Razorpay order
router.post('/create-order', authenticate, async (req, res) => {
  const { order_id } = req.body;
  if (!razorpay) return res.status(503).json({ error: 'Payment gateway not configured' });

  const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(order_id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  try {
    const rpOrder = await razorpay.orders.create({
      amount: Math.round(order.total * 100), // paise
      currency: 'INR',
      receipt: order.order_number,
      notes: { order_id: order.id, user_id: req.user.id }
    });

    db.prepare('UPDATE orders SET razorpay_order_id=? WHERE id=?').run(rpOrder.id, order.id);
    res.json({ razorpay_order_id: rpOrder.id, amount: rpOrder.amount, currency: 'INR',
               key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// Verify payment
router.post('/verify', authenticate, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;

  const secret = process.env.RAZORPAY_SECRET || 'secret';
  const body   = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

  if (expected !== razorpay_signature)
    return res.status(400).json({ error: 'Payment verification failed' });

  db.prepare(`UPDATE orders SET payment_status='paid', razorpay_payment_id=?,
    status='confirmed', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(razorpay_payment_id, order_id);

  db.prepare('INSERT INTO order_status_log (order_id,status) VALUES (?,?)').run(order_id, 'confirmed');
  res.json({ message: 'Payment verified. Order confirmed!' });
});

module.exports = router;


// ═══════════════════════════════════════════════════════════════════════════════
// Inline: routes/reviews.js
// ═══════════════════════════════════════════════════════════════════════════════
const reviewRouter = require('express').Router();

reviewRouter.post('/', authenticate, (req, res) => {
  const { dish_id, order_id, rating, comment } = req.body;
  if (!dish_id || !rating) return res.status(400).json({ error: 'dish_id and rating required' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

  const existing = db.prepare('SELECT id FROM reviews WHERE user_id=? AND dish_id=? AND order_id=?')
                     .get(req.user.id, dish_id, order_id || null);
  if (existing) return res.status(409).json({ error: 'Already reviewed this dish for this order' });

  db.prepare('INSERT INTO reviews (user_id,dish_id,order_id,rating,comment) VALUES (?,?,?,?,?)')
    .run(req.user.id, dish_id, order_id || null, rating, comment || null);

  // Recalculate avg
  const agg = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE dish_id=?').get(dish_id);
  db.prepare('INSERT INTO dish_ratings (dish_id,avg_rating,count) VALUES (?,?,?) ON CONFLICT(dish_id) DO UPDATE SET avg_rating=?,count=?')
    .run(dish_id, +agg.avg.toFixed(2), agg.cnt, +agg.avg.toFixed(2), agg.cnt);

  res.status(201).json({ message: 'Review submitted. Thank you!' });
});

reviewRouter.get('/dish/:dishId', (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;
  const reviews = db.prepare(`
    SELECT r.*, u.name as user_name, u.avatar_url
    FROM reviews r JOIN users u ON u.id=r.user_id
    WHERE r.dish_id=? ORDER BY r.created_at DESC LIMIT ? OFFSET ?
  `).all(req.params.dishId, Number(limit), offset);
  res.json(reviews);
});

module.exports.reviewRouter = reviewRouter;


// ═══════════════════════════════════════════════════════════════════════════════
// Inline: routes/addresses.js
// ═══════════════════════════════════════════════════════════════════════════════
const addrRouter = require('express').Router();

addrRouter.get('/', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC').all(req.user.id));
});

addrRouter.post('/', authenticate, (req, res) => {
  const { label, line1, line2, city, state, pincode, lat, lng, is_default } = req.body;
  if (!line1 || !city || !state || !pincode)
    return res.status(400).json({ error: 'line1, city, state, pincode required' });

  if (is_default)
    db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO addresses (user_id,label,line1,line2,city,state,pincode,lat,lng,is_default)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(req.user.id, label||'Home', line1, line2||null, city, state, pincode,
         lat||null, lng||null, is_default?1:0);

  res.status(201).json({ id: lastInsertRowid, message: 'Address saved' });
});

addrRouter.patch('/:id', authenticate, (req, res) => {
  const addr = db.prepare('SELECT * FROM addresses WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!addr) return res.status(404).json({ error: 'Address not found' });
  const { label, line1, line2, city, state, pincode, is_default } = req.body;
  if (is_default) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
  db.prepare(`UPDATE addresses SET label=COALESCE(?,label),line1=COALESCE(?,line1),line2=COALESCE(?,line2),
    city=COALESCE(?,city),state=COALESCE(?,state),pincode=COALESCE(?,pincode),is_default=COALESCE(?,is_default)
    WHERE id=?`).run(label, line1, line2, city, state, pincode, is_default!=null?+is_default:null, req.params.id);
  res.json({ message: 'Address updated' });
});

addrRouter.delete('/:id', authenticate, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ message: 'Address deleted' });
});

module.exports.addrRouter = addrRouter;
