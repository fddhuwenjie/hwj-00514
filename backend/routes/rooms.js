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
    
    const isAvailable = bookings.length === 0 && maintenance.length === 0 && room.status === 'available';
    
    let price = room.base_price;
    const seasonal = db.prepare(`
      SELECT * FROM seasonal_prices 
      WHERE room_id = ? 
        AND start_date <= ? 
        AND end_date >= ?
      LIMIT 1
    `).get(req.params.id, start_date, start_date);
    
    if (seasonal) {
      price = seasonal.price;
    }
    
    const nights = moment(end_date).diff(moment(start_date), 'days');
    
    res.json({
      success: true,
      data: {
        available: isAvailable,
        price: price,
        total_price: price * nights,
        nights: nights,
        conflicting_bookings: bookings,
        conflicting_maintenance: maintenance
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
