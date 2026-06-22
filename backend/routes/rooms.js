const express = require('express');
const router = express.Router();
const db = require('../models/database');
const moment = require('moment');

router.get('/', (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM rooms';
  let params = [];
  
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY room_number';
  
  try {
    const rooms = db.prepare(sql).all(...params);
    rooms.forEach(room => {
      if (room.facilities) {
        room.facilities = room.facilities.split(',');
      } else {
        room.facilities = [];
      }
    });
    res.json({ success: true, data: rooms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: '房间不存在' });
    }
    if (room.facilities) {
      room.facilities = room.facilities.split(',');
    } else {
      room.facilities = [];
    }
    res.json({ success: true, data: room });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', (req, res) => {
  const { room_number, room_type, bed_type, max_guests, base_price, cleaning_duration, facilities, status } = req.body;
  
  if (!room_number || !room_type || !bed_type || !max_guests || !base_price) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }
  
  try {
    const facilitiesStr = Array.isArray(facilities) ? facilities.join(',') : facilities || '';
    const result = db.prepare(`
      INSERT INTO rooms (room_number, room_type, bed_type, max_guests, base_price, cleaning_duration, facilities, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      room_number,
      room_type,
      bed_type,
      max_guests,
      base_price,
      cleaning_duration || 60,
      facilitiesStr,
      status || 'available'
    );
    
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { room_type, bed_type, max_guests, base_price, cleaning_duration, facilities, status } = req.body;
  
  try {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: '房间不存在' });
    }
    
    const facilitiesStr = facilities ? (Array.isArray(facilities) ? facilities.join(',') : facilities) : room.facilities;
    
    db.prepare(`
      UPDATE rooms SET 
        room_type = ?, bed_type = ?, max_guests = ?, base_price = ?, 
        cleaning_duration = ?, facilities = ?, status = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      room_type || room.room_type,
      bed_type || room.bed_type,
      max_guests || room.max_guests,
      base_price || room.base_price,
      cleaning_duration || room.cleaning_duration,
      facilitiesStr,
      status || room.status,
      req.params.id
    );
    
    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: '房间不存在' });
    }
    
    db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id/seasonal-prices', (req, res) => {
  try {
    const prices = db.prepare(`
      SELECT * FROM seasonal_prices 
      WHERE room_id = ? 
      ORDER BY start_date
    `).all(req.params.id);
    
    res.json({ success: true, data: prices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/seasonal-prices', (req, res) => {
  const { start_date, end_date, price, name } = req.body;
  
  if (!start_date || !end_date || !price) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }
  
  try {
    const result = db.prepare(`
      INSERT INTO seasonal_prices (room_id, start_date, end_date, price, name)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, start_date, end_date, price, name || '');
    
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/seasonal-prices/:priceId', (req, res) => {
  try {
    db.prepare('DELETE FROM seasonal_prices WHERE id = ?').run(req.params.priceId);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

function getPriceForDate(roomId, roomType, basePrice, dateStr) {
  const date = moment(dateStr);
  const weekday = date.isoWeekday();
  const isWeekend = weekday >= 6;
  
  const isHoliday = db.prepare(`
    SELECT COUNT(*) as count FROM holidays WHERE date = ?
  `).get(dateStr).count > 0;

  const priceRule = db.prepare(`
    SELECT * FROM seasonal_prices 
    WHERE (room_id = ? OR room_type = ? OR (room_id IS NULL AND room_type IS NULL))
      AND start_date <= ? 
      AND end_date >= ?
      AND (
        (apply_weekend = 1 AND ? = 1) OR
        (apply_holiday = 1 AND ? = 1) OR
        (apply_weekdays LIKE ?) OR
        (apply_weekend = 0 AND apply_holiday = 0 AND apply_weekdays IS NULL)
      )
    ORDER BY 
      CASE WHEN room_id = ? THEN 0 
           WHEN room_type = ? THEN 1 
           ELSE 2 END,
      price_type = 'temporary' DESC,
      created_at DESC
    LIMIT 1
  `).get(roomId, roomType, dateStr, dateStr, isWeekend ? 1 : 0, isHoliday ? 1 : 0, `%${weekday}%`, roomId, roomType);

  if (priceRule) {
    return priceRule.price;
  }

  return basePrice;
}

function calculatePriceWithDetails(roomId, checkinDate, checkoutDate) {
  const room = db.prepare('SELECT base_price, room_type FROM rooms WHERE id = ?').get(roomId);
  if (!room) return { total: 0, details: [], nights: 0 };

  const start = moment(checkinDate);
  const end = moment(checkoutDate);
  const nights = end.diff(start, 'days');

  let totalPrice = 0;
  const details = [];
  const current = start.clone();

  for (let i = 0; i < nights; i++) {
    const dateStr = current.format('YYYY-MM-DD');
    const price = getPriceForDate(roomId, room.room_type, room.base_price, dateStr);
    const isWeekend = current.isoWeekday() >= 6;
    const isHoliday = db.prepare(`
      SELECT COUNT(*) as count FROM holidays WHERE date = ?
    `).get(dateStr).count > 0;

    totalPrice += price;
    details.push({
      date: dateStr,
      price: price,
      is_holiday: isHoliday,
      is_weekend: isWeekend,
      weekday: current.isoWeekday()
    });
    current.add(1, 'day');
  }

  return {
    total: totalPrice,
    nights: nights,
    details: details
  };
}

router.get('/:id/availability', (req, res) => {
  const { start_date, end_date } = req.query;
  
  if (!start_date || !end_date) {
    return res.status(400).json({ success: false, message: '缺少日期参数' });
  }
  
  try {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
    if (!room) {
      return res.status(404).json({ success: false, message: '房间不存在' });
    }
    
    const bookings = db.prepare(`
      SELECT * FROM bookings 
      WHERE room_id = ? 
        AND status NOT IN ('cancelled')
        AND checkin_date < ? 
        AND checkout_date > ?
    `).all(req.params.id, end_date, start_date);
    
    const maintenance = db.prepare(`
      SELECT * FROM maintenance_orders 
      WHERE room_id = ? 
        AND status NOT IN ('completed')
        AND start_date < ? 
        AND (end_date IS NULL OR end_date > ?)
    `).all(req.params.id, end_date, start_date);
    
    const isAvailable = bookings.length === 0 && maintenance.length === 0 && room.status !== 'out_of_service';
    
    const priceDetails = calculatePriceWithDetails(req.params.id, start_date, end_date);
    
    res.json({
      success: true,
      data: {
        available: isAvailable,
        price: priceDetails.nights > 0 ? priceDetails.details[0].price : room.base_price,
        total_price: priceDetails.total,
        nights: priceDetails.nights,
        price_details: priceDetails.details,
        conflicting_bookings: bookings,
        conflicting_maintenance: maintenance
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
