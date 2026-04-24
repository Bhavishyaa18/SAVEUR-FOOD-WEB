/**
 * sockets/orderTracking.js — Real-time order tracking via Socket.IO
 */

module.exports = (io) => {
  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'saveur_super_secret_change_in_prod';

  // Auth middleware for sockets
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    console.log(`🔌 Socket connected: user ${userId}`);

    // Join personal room
    socket.join(`user_${userId}`);

    // Track specific order
    socket.on('track:order', (orderId) => {
      socket.join(`order_${orderId}`);
      socket.emit('track:joined', { orderId });
    });

    // Delivery agent location update
    socket.on('delivery:location', ({ orderId, lat, lng }) => {
      if (!['delivery', 'admin'].includes(socket.user.role)) return;
      io.to(`order_${orderId}`).emit('delivery:location', { lat, lng, timestamp: Date.now() });
    });

    // Chef marks order ready
    socket.on('chef:ready', (orderId) => {
      if (!['chef', 'admin'].includes(socket.user.role)) return;
      io.to(`order_${orderId}`).emit('order:status', { orderId, status: 'out_for_delivery' });
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: user ${userId}`);
    });
  });
};
