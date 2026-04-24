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


app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { error: 'Too many requests' } });
app.use('/api/', limiter);


app.use('/api/auth',       require('./auth'));
app.use('/api/dishes',     require('./dishes'));
app.use('/api/categories', require('./categories'));
app.use('/api/cart',       require('./cart'));
app.use('/api/orders',     require('./orders'));
app.use('/api/payments',   require('./payments'));
// app.use('/api/users',      require('./users'));
// app.use('/api/reviews',    require('./reviews'));
// app.use('/api/addresses',  require('./addresses'));
// app.use('/api/admin',      require('./admin'));
require('./orderTracking')(io);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));


app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🍽  Saveur API running on port ${PORT}`));

module.exports = { app, io };
