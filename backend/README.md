# 🍽 SAVEUR — Backend API

> Node.js + Express + SQLite + Socket.IO + Razorpay

---

## 🚀 Quick Start

```bash
cd saveur-backend
npm install
cp .env.example .env        # Fill in your secrets
npm run dev                 # Starts on http://localhost:5000
```

Database auto-creates at `saveur.db` with seeded categories, 14 dishes, and 2 sample coupons on first run.

---

## 🏗 Project Structure

```
saveur-backend/
├── server.js               # Entry point, Express + Socket.IO setup
├── db/
│   └── index.js            # SQLite schema, migrations, seed data
├── middleware/
│   └── auth.js             # JWT auth + role guard
├── routes/
│   ├── auth.js             # Register, login, refresh, logout
│   ├── dishes.js           # CRUD + search + filter
│   ├── categories.js       # Category listing + admin CRUD
│   ├── cart.js             # Cart management + coupon apply
│   ├── orders.js           # Place + track + manage orders
│   ├── payments.js         # Razorpay create + verify
│   ├── reviews.js          # Submit + read dish reviews
│   ├── addresses.js        # Saved delivery addresses
│   ├── users.js            # Profile management
│   └── admin.js            # Admin dashboard + controls
├── sockets/
│   └── orderTracking.js    # Real-time delivery tracking
├── package.json
└── .env.example
```

---

## 🔑 Authentication

All protected routes require:
```
Authorization: Bearer <accessToken>
```

Access tokens expire in 15 minutes. Use `/api/auth/refresh` with a refresh token to get a new one.

**Roles:** `customer` · `chef` · `delivery` · `admin`

---

## 📡 API Endpoints

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | — | Register new user |
| POST | `/api/auth/login` | — | Login → tokens |
| POST | `/api/auth/refresh` | — | Refresh access token |
| POST | `/api/auth/logout` | ✅ | Invalidate refresh token |
| GET  | `/api/auth/me` | ✅ | Current user info |
| POST | `/api/auth/change-password` | ✅ | Change password |

### Dishes
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/dishes` | — | List dishes (search, filter, paginate) |
| GET | `/api/dishes/featured` | — | Featured dishes |
| GET | `/api/dishes/:slug` | — | Single dish + reviews |
| POST | `/api/dishes` | Admin/Chef | Create dish |
| PATCH | `/api/dishes/:id` | Admin/Chef | Update dish |
| DELETE | `/api/dishes/:id` | Admin | Deactivate dish |

**Query params for GET /api/dishes:**
- `?category=italian` — filter by category slug
- `?search=pasta` — full-text search
- `?is_veg=1` — vegetarian only
- `?is_featured=1` — featured only
- `?sort=price_asc|price_desc|rating_desc|name_asc`
- `?page=1&limit=12`

### Cart
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/cart` | ✅ | Get cart with totals |
| POST | `/api/cart/add` | ✅ | Add dish to cart |
| PATCH | `/api/cart/item/:id` | ✅ | Update quantity |
| DELETE | `/api/cart/item/:id` | ✅ | Remove item |
| DELETE | `/api/cart/clear` | ✅ | Clear cart |
| POST | `/api/cart/coupon` | ✅ | Apply coupon code |

### Orders
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/orders` | ✅ | Place order from cart |
| GET | `/api/orders` | ✅ | My order history |
| GET | `/api/orders/:id` | ✅ | Order detail + status log |
| PATCH | `/api/orders/:id/status` | Staff | Update order status |
| POST | `/api/orders/:id/cancel` | ✅ | Cancel order |

**Order statuses:** `pending → confirmed → preparing → out_for_delivery → delivered`

### Payments (Razorpay)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/payments/create-order` | ✅ | Create Razorpay order |
| POST | `/api/payments/verify` | ✅ | Verify payment signature |

### Reviews
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/reviews` | ✅ | Submit review (1-5 stars) |
| GET | `/api/reviews/dish/:dishId` | — | Reviews for a dish |

### Addresses
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/addresses` | ✅ | Saved addresses |
| POST | `/api/addresses` | ✅ | Add address |
| PATCH | `/api/addresses/:id` | ✅ | Update address |
| DELETE | `/api/addresses/:id` | ✅ | Delete address |

### Admin
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/stats` | Admin | Dashboard stats |
| GET | `/api/admin/orders` | Admin | All orders |
| GET | `/api/admin/users` | Admin | All users |
| PATCH | `/api/admin/users/:id/toggle` | Admin | Enable/disable user |

---

## ⚡ Real-time (Socket.IO)

Connect with JWT token:
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000', {
  auth: { token: 'your_access_token' }
});

// Track an order
socket.emit('track:order', orderId);

// Listen for status updates
socket.on('order:status', ({ orderId, status }) => {
  console.log(`Order ${orderId} is now: ${status}`);
});

// Listen for delivery location (live map)
socket.on('delivery:location', ({ lat, lng }) => {
  updateMapMarker(lat, lng);
});
```

---

## 🛒 Sample: Place an Order

```bash
# 1. Register
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Priya","email":"priya@example.com","password":"password123"}'

# 2. Add to cart (use the accessToken from above)
curl -X POST http://localhost:5000/api/cart/add \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"dish_id":1,"quantity":2}'

# 3. Add address
curl -X POST http://localhost:5000/api/addresses \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"line1":"42 MG Road","city":"Delhi","state":"Delhi","pincode":"110001"}'

# 4. Place order
curl -X POST http://localhost:5000/api/orders \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"address_id":1,"payment_method":"cod"}'
```

---

## 🔒 Security Features

- **Helmet.js** — HTTP security headers
- **Rate limiting** — 200 req/15min per IP
- **bcrypt** — Password hashing (12 rounds)
- **JWT** — Short-lived access tokens (15m) + rotating refresh tokens
- **Razorpay HMAC** — Payment signature verification
- **Role-based access** — customer / chef / delivery / admin
- **SQL injection safe** — Parameterized queries via better-sqlite3

---

## 🌱 Pre-seeded Data

**Coupons:** `SAVEUR20` (20% off, min ₹499) · `FLAT100` (₹100 off, min ₹699)

**14 dishes** across 5 categories, all with ratings.

---

## 📦 Production Deployment

```bash
# Build
NODE_ENV=production npm start

# With PM2
npm install -g pm2
pm2 start server.js --name saveur-api

# Nginx reverse proxy
# proxy_pass http://localhost:5000;
```

> For production, replace SQLite with **PostgreSQL** (pg + Drizzle ORM) and use **Redis** for refresh token storage.
