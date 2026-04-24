/**
 * routes/dishes.js — Full dish CRUD with search, filter, pagination
 */

const router = require('express').Router();
const db     = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── GET /api/dishes ──────────────────────────────────────────────────────────
// ?category=italian&search=pasta&is_veg=1&sort=price_asc&page=1&limit=12
router.get('/', (req, res) => {
  const {
    category, search, is_veg, is_featured,
    sort = 'created_at_desc', page = 1, limit = 12
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  let where = ['d.is_available = 1'];
  const params = [];

  if (category) {
    where.push('c.slug = ?');
    params.push(category);
  }
  if (search) {
    where.push('(d.name LIKE ? OR d.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (is_veg !== undefined) { where.push('d.is_veg = ?'); params.push(Number(is_veg)); }
  if (is_featured !== undefined) { where.push('d.is_featured = ?'); params.push(Number(is_featured)); }

  const sortMap = {
    price_asc: 'd.price ASC', price_desc: 'd.price DESC',
    rating_desc: 'COALESCE(r.avg_rating,0) DESC',
    created_at_desc: 'd.created_at DESC', name_asc: 'd.name ASC'
  };
  const orderBy = sortMap[sort] || sortMap.created_at_desc;

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT d.*, c.name as category_name, c.slug as category_slug,
           COALESCE(r.avg_rating,0) as avg_rating, COALESCE(r.count,0) as review_count,
           ROUND(d.price * (1 - d.discount_pct/100.0), 2) as final_price
    FROM dishes d
    JOIN categories c ON c.id = d.category_id
    LEFT JOIN dish_ratings r ON r.dish_id = d.id
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all([...params, Number(limit), offset]);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM dishes d
    JOIN categories c ON c.id = d.category_id
    ${whereClause}
  `).get(params).c;

  res.json({
    dishes: rows,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) }
  });
});

// ─── GET /api/dishes/featured ─────────────────────────────────────────────────
router.get('/featured', (req, res) => {
  const dishes = db.prepare(`
    SELECT d.*, c.name as category_name,
           COALESCE(r.avg_rating,0) as avg_rating, COALESCE(r.count,0) as review_count,
           ROUND(d.price * (1 - d.discount_pct/100.0), 2) as final_price
    FROM dishes d
    JOIN categories c ON c.id = d.category_id
    LEFT JOIN dish_ratings r ON r.dish_id = d.id
    WHERE d.is_featured=1 AND d.is_available=1
    ORDER BY r.avg_rating DESC LIMIT 8
  `).all();
  res.json(dishes);
});

// ─── GET /api/dishes/:slug ────────────────────────────────────────────────────
router.get('/:slug', (req, res) => {
  const dish = db.prepare(`
    SELECT d.*, c.name as category_name, c.slug as category_slug,
           COALESCE(r.avg_rating,0) as avg_rating, COALESCE(r.count,0) as review_count,
           ROUND(d.price * (1 - d.discount_pct/100.0), 2) as final_price
    FROM dishes d
    JOIN categories c ON c.id = d.category_id
    LEFT JOIN dish_ratings r ON r.dish_id = d.id
    WHERE d.slug = ?
  `).get(req.params.slug);

  if (!dish) return res.status(404).json({ error: 'Dish not found' });

  const reviews = db.prepare(`
    SELECT rv.*, u.name as user_name, u.avatar_url
    FROM reviews rv JOIN users u ON u.id = rv.user_id
    WHERE rv.dish_id = ? ORDER BY rv.created_at DESC LIMIT 10
  `).all(dish.id);

  res.json({ ...dish, ingredients: JSON.parse(dish.ingredients || '[]'), reviews });
});

// ─── POST /api/dishes — Admin only ───────────────────────────────────────────
router.post('/', authenticate, requireRole('admin', 'chef'), (req, res) => {
  const { category_id, name, slug, description, ingredients, price,
          discount_pct, image_url, is_veg, is_featured, spice_level,
          prep_time_min, calories } = req.body;

  if (!category_id || !name || !price)
    return res.status(400).json({ error: 'category_id, name and price are required' });

  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO dishes (category_id,name,slug,description,ingredients,price,discount_pct,
      image_url,is_veg,is_featured,spice_level,prep_time_min,calories)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(category_id, name, slug || name.toLowerCase().replace(/\s+/g,'-'),
         description, JSON.stringify(ingredients || []), price,
         discount_pct||0, image_url, is_veg?1:0, is_featured?1:0,
         spice_level||0, prep_time_min||20, calories||null);

  db.prepare('INSERT INTO dish_ratings (dish_id) VALUES (?)').run(id);
  res.status(201).json({ id, message: 'Dish created' });
});

// ─── PATCH /api/dishes/:id — Admin only ──────────────────────────────────────
router.patch('/:id', authenticate, requireRole('admin', 'chef'), (req, res) => {
  const allowed = ['name','description','price','discount_pct','image_url','is_veg',
                   'is_featured','spice_level','prep_time_min','calories','is_available','ingredients'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields' });

  if (updates.ingredients) updates.ingredients = JSON.stringify(updates.ingredients);

  const sets = Object.keys(updates).map(k => `${k}=?`).join(',');
  db.prepare(`UPDATE dishes SET ${sets} WHERE id=?`).run(...Object.values(updates), req.params.id);
  res.json({ message: 'Dish updated' });
});

// ─── DELETE /api/dishes/:id — Admin only ─────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  db.prepare('UPDATE dishes SET is_available=0 WHERE id=?').run(req.params.id);
  res.json({ message: 'Dish deactivated' });
});

module.exports = router;
