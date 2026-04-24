/**
 * db/index.js — SQLite database setup & migrations
 */

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../saveur.db'), {
  verbose: process.env.NODE_ENV === 'development' ? console.log : null
});

// Performance pragmas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    phone       TEXT    UNIQUE,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin','chef','delivery')),
    avatar_url  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    slug        TEXT    NOT NULL UNIQUE,
    description TEXT,
    image_url   TEXT,
    sort_order  INTEGER DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS dishes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id   INTEGER NOT NULL REFERENCES categories(id),
    name          TEXT    NOT NULL,
    slug          TEXT    NOT NULL UNIQUE,
    description   TEXT,
    ingredients   TEXT,              -- JSON array
    price         REAL    NOT NULL,
    discount_pct  INTEGER DEFAULT 0,
    image_url     TEXT,
    is_veg        INTEGER DEFAULT 0,
    is_featured   INTEGER DEFAULT 0,
    spice_level   INTEGER DEFAULT 0 CHECK(spice_level BETWEEN 0 AND 3),
    prep_time_min INTEGER DEFAULT 20,
    calories      INTEGER,
    is_available  INTEGER DEFAULT 1,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS dish_ratings (
    dish_id   INTEGER NOT NULL REFERENCES dishes(id),
    avg_rating REAL   DEFAULT 0,
    count      INTEGER DEFAULT 0,
    PRIMARY KEY (dish_id)
  );

  CREATE TABLE IF NOT EXISTS addresses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label        TEXT    DEFAULT 'Home',
    line1        TEXT    NOT NULL,
    line2        TEXT,
    city         TEXT    NOT NULL,
    state        TEXT    NOT NULL,
    pincode      TEXT    NOT NULL,
    lat          REAL,
    lng          REAL,
    is_default   INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS carts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cart_id    INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    dish_id    INTEGER NOT NULL REFERENCES dishes(id),
    quantity   INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
    notes      TEXT,
    UNIQUE(cart_id, dish_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number    TEXT    NOT NULL UNIQUE,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    address_id      INTEGER REFERENCES addresses(id),
    status          TEXT    NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','confirmed','preparing','out_for_delivery','delivered','cancelled')),
    subtotal        REAL    NOT NULL,
    delivery_fee    REAL    NOT NULL DEFAULT 49,
    discount        REAL    NOT NULL DEFAULT 0,
    gst             REAL    NOT NULL DEFAULT 0,
    total           REAL    NOT NULL,
    payment_method  TEXT    DEFAULT 'online',
    payment_status  TEXT    DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
    razorpay_order_id   TEXT,
    razorpay_payment_id TEXT,
    estimated_delivery  DATETIME,
    delivered_at        DATETIME,
    notes           TEXT,
    chef_id         INTEGER REFERENCES users(id),
    delivery_agent_id INTEGER REFERENCES users(id),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id  INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    dish_id   INTEGER NOT NULL REFERENCES dishes(id),
    name      TEXT    NOT NULL,
    price     REAL    NOT NULL,
    quantity  INTEGER NOT NULL,
    subtotal  REAL    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_status_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status     TEXT    NOT NULL,
    note       TEXT,
    changed_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    dish_id    INTEGER NOT NULL REFERENCES dishes(id),
    order_id   INTEGER REFERENCES orders(id),
    rating     INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, dish_id, order_id)
  );

  CREATE TABLE IF NOT EXISTS coupons (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    code           TEXT    NOT NULL UNIQUE,
    type           TEXT    NOT NULL CHECK(type IN ('flat','percent')),
    value          REAL    NOT NULL,
    min_order      REAL    DEFAULT 0,
    max_discount   REAL,
    usage_limit    INTEGER DEFAULT 100,
    used_count     INTEGER DEFAULT 0,
    expires_at     DATETIME,
    is_active      INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_dishes_category    ON dishes(category_id);
  CREATE INDEX IF NOT EXISTS idx_dishes_featured    ON dishes(is_featured);
  CREATE INDEX IF NOT EXISTS idx_orders_user        ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_dish       ON reviews(dish_id);
  CREATE INDEX IF NOT EXISTS idx_cart_items_cart    ON cart_items(cart_id);
`);

// ─── Seed Initial Data ─────────────────────────────────────────────────────────
const seedData = () => {
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
  if (catCount > 0) return;

  const insertCat = db.prepare(
    'INSERT INTO categories (name, slug, description, image_url, sort_order) VALUES (?,?,?,?,?)'
  );
  const cats = [
    ['Italian',      'italian',     'Rustic Italian classics',      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400', 1],
    ['Japanese',     'japanese',    'Refined Japanese cuisine',     'https://images.unsplash.com/photo-1617196034183-421b4040ed20?w=400', 2],
    ['Indian',       'indian',      'Bold Indian flavours',         'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400', 3],
    ['Continental',  'continental', 'European fine dining',         'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=400', 4],
    ['Desserts',     'desserts',    'Sweet endings',                'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=400', 5],
  ];
  cats.forEach(c => insertCat.run(...c));

  const insertDish = db.prepare(`
    INSERT INTO dishes (category_id, name, slug, description, price, discount_pct, image_url, is_veg, is_featured, spice_level, prep_time_min, calories)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertRating = db.prepare('INSERT INTO dish_ratings (dish_id, avg_rating, count) VALUES (?,?,?)');

  const dishes = [
    [1,'Truffle Mushroom Risotto','truffle-mushroom-risotto','Arborio rice, black truffle, wild porcini, aged parmesan',920,0,'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=800',1,1,0,30,620],
    [1,'Spaghetti Carbonara','spaghetti-carbonara','Guanciale, egg yolk, pecorino romano, black pepper',680,10,'https://images.unsplash.com/photo-1555949258-eb67b1ef0ceb?w=800',0,0,1,20,780],
    [1,'Margherita Pizza','margherita-pizza','San Marzano tomatoes, fior di latte, fresh basil',560,0,'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800',1,1,0,18,680],
    [1,'Tiramisu','tiramisu','Mascarpone, ladyfingers, espresso, cocoa',380,0,'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=800',1,0,0,0,450],
    [2,'Salmon Teriyaki','salmon-teriyaki','Atlantic salmon, house teriyaki glaze, steamed rice',680,0,'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=800',0,1,0,25,520],
    [2,'Chicken Ramen','chicken-ramen','Tonkotsu broth, chashu pork, soft egg, nori',540,0,'https://images.unsplash.com/photo-1591814468924-caf88d1232e1?w=800',0,0,1,35,680],
    [2,'Dragon Roll','dragon-roll','Tempura prawn, avocado, cucumber, eel sauce',720,15,'https://images.unsplash.com/photo-1617196034183-421b4040ed20?w=800',0,0,2,20,480],
    [3,'Butter Chicken','butter-chicken','Slow-cooked chicken in rich tomato-cream sauce',450,0,'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=800',0,1,2,40,560],
    [3,'Dal Makhani','dal-makhani','Black lentils slow-cooked overnight, cream, butter',380,0,'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=800',1,0,1,0,420],
    [3,'Paneer Tikka','paneer-tikka','Chargrilled paneer, bell peppers, mint chutney',420,0,'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800',1,1,3,25,480],
    [4,'Beef Wellington','beef-wellington','Filet mignon, mushroom duxelles, golden puff pastry',1480,0,'https://images.unsplash.com/photo-1600891964092-4316c288032e?w=800',0,1,0,55,820],
    [4,'French Onion Soup','french-onion-soup','Caramelized onions, beef broth, gruyère crouton',380,0,'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=800',0,0,0,30,390],
    [5,'Crème Brûlée','creme-brulee','Vanilla custard, caramelized sugar crust',420,0,'https://images.unsplash.com/photo-1579306194872-64d3b7bac4c2?w=800',1,1,0,0,380],
    [5,'Chocolate Lava Cake','chocolate-lava-cake','Dark chocolate, molten core, vanilla ice cream',480,0,'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=800',1,0,0,20,520],
  ];

  dishes.forEach((d, i) => {
    const info = insertDish.run(...d);
    insertRating.run(info.lastInsertRowid, (4.6 + Math.random() * 0.4).toFixed(1), Math.floor(50 + Math.random() * 400));
  });

  // Sample coupon
  db.prepare(`INSERT INTO coupons (code, type, value, min_order, max_discount, usage_limit) VALUES (?,?,?,?,?,?)`)
    .run('SAVEUR20', 'percent', 20, 499, 200, 500);
  db.prepare(`INSERT INTO coupons (code, type, value, min_order) VALUES (?,?,?,?)`)
    .run('FLAT100', 'flat', 100, 699);

  console.log('✅ Database seeded');
};

seedData();

module.exports = db;
