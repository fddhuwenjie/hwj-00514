const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const db = require('./models/database');

const roomRoutes = require('./routes/rooms');
const bookingRoutes = require('./routes/bookings');
const checkinRoutes = require('./routes/checkin');
const cleaningRoutes = require('./routes/cleaning');
const maintenanceRoutes = require('./routes/maintenance');
const statsRoutes = require('./routes/stats');
const cleanerRoutes = require('./routes/cleaners');

const app = express();
const PORT = 8514;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/api/rooms', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/cleaning', cleaningRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/cleaners', cleanerRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '民宿管理系统API运行正常' });
});

app.listen(PORT, () => {
  console.log(`后端服务器运行在 http://localhost:${PORT}`);
  console.log(`API健康检查: http://localhost:${PORT}/api/health`);
});

module.exports = app;
