const express = require('express');
const router = express.Router();
const db = require('../models/database');
const moment = require('moment');

function generateBookingNo() {
  return 'BK' + moment().format('YYYYMMDDHHmmss') + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
}

function checkRoomConflict(roomId, checkinDate, checkoutDate, excludeBookingId = null) {
  let sql = `
    SELECT * FROM bookings 
    WHERE room_id = ? 
      AND status NOT IN ('cancelled')
      AND checkin_date < ? 
      AND checkout_date > ?
  `;
  let params = [roomId, checkoutDate, checkinDate];
  
  if (excludeBookingId) {
    sql += ' AND id != ?';
    params.push(excludeBookingId);
  }
  
  return db.prepare(sql).all(...params);
}

function checkMaintenanceConflict(roomId, checkinDate, checkoutDate) {
  return db.prepare(`
    SELECT * FROM maintenance_orders 
    WHERE room_id = ? 
      AND status NOT IN ('completed')
      AND start_date < ? 
      AND (end_date IS NULL OR end_date > ?)
  `).all(roomId, checkoutDate, checkinDate);
}

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

function calculatePrice(roomId, checkinDate, checkoutDate) {
  const room = db.prepare('SELECT base_price, room_type FROM rooms WHERE id = ?').get(roomId);
  if (!room) return 0;
  
  const start = moment(checkinDate);
  const end = moment(checkoutDate);
  const nights = end.diff(start, 'days');
  
  let totalPrice = 0;
  const current = start.clone();
  
  for (let i = 0; i < nights; i++) {
    const dateStr = current.format('YYYY-MM-DD');
    totalPrice += getPriceForDate(roomId, room.room_type, room.base_price, dateStr);
    current.add(1, 'day');
  }
  
  return totalPrice;
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

router.get('/', (req, res) => {
  const { status, room_id, start_date, end_date, channel } = req.query;
  
  let sql = `
    SELECT b.*, r.room_number, r.room_type 
    FROM bookings b 
    LEFT JOIN rooms r ON b.room_id = r.id
    WHERE 1=1
  `;
  let params = [];
  
  if (status) {
    sql += ' AND b.status = ?';
    params.push(status);
  }
  
  if (room_id) {
    sql += ' AND b.room_id = ?';
    params.push(room_id);
  }
  
  if (start_date) {
    sql += ' AND b.checkout_date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    sql += ' AND b.checkin_date <= ?';
    params.push(end_date);
  }
  
  if (channel) {
    sql += ' AND b.channel = ?';
    params.push(channel);
  }
  
  sql += ' ORDER BY b.created_at DESC';
  
  try {
    const bookings = db.prepare(sql).all(...params);
    res.json({ success: true, data: bookings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const booking = db.prepare(`
      SELECT b.*, r.room_number, r.room_type, r.bed_type, r.max_guests
      FROM bookings b 
      LEFT JOIN rooms r ON b.room_id = r.id
      WHERE b.id = ?
    `).get(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ success: false, message: '预订不存在' });
    }
    
    const charges = db.prepare('SELECT * FROM charges WHERE booking_id = ?').all(req.params.id);
    booking.charges = charges;
    
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/check-conflict', (req, res) => {
  const { room_id, checkin_date, checkout_date, booking_id } = req.body;
  
  if (!room_id || !checkin_date || !checkout_date) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }
  
  try {
    const bookingConflicts = checkRoomConflict(room_id, checkin_date, checkout_date, booking_id);
    const maintenanceConflicts = checkMaintenanceConflict(room_id, checkin_date, checkout_date);
    const room = db.prepare('SELECT status FROM rooms WHERE id = ?').get(room_id);
    
    const hasConflict = bookingConflicts.length > 0 || maintenanceConflicts.length > 0 || (room && room.status === 'out_of_service');
    const priceDetails = calculatePriceWithDetails(room_id, checkin_date, checkout_date);
    
    res.json({
      success: true,
      data: {
        available: !hasConflict,
        price: priceDetails.total,
        total_price: priceDetails.total,
        nights: priceDetails.nights,
        price_details: priceDetails.details,
        booking_conflicts: bookingConflicts,
        maintenance_conflicts: maintenanceConflicts,
        room_status: room ? room.status : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', (req, res) => {
  const { guest_name, guest_phone, room_id, checkin_date, checkout_date, guest_count, channel, total_amount, deposit, notes } = req.body;
  
  if (!guest_name || !room_id || !checkin_date || !checkout_date) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }
  
  try {
    const bookingConflicts = checkRoomConflict(room_id, checkin_date, checkout_date);
    if (bookingConflicts.length > 0) {
      return res.status(400).json({ success: false, message: '该时间段房间已被预订', conflicts: bookingConflicts });
    }
    
    const maintenanceConflicts = checkMaintenanceConflict(room_id, checkin_date, checkout_date);
    if (maintenanceConflicts.length > 0) {
      return res.status(400).json({ success: false, message: '该时间段房间处于维修中', conflicts: maintenanceConflicts });
    }
    
    const room = db.prepare('SELECT status FROM rooms WHERE id = ?').get(room_id);
    if (!room) {
      return res.status(400).json({ success: false, message: '房间不存在' });
    }
    if (room.status === 'out_of_service') {
      return res.status(400).json({ success: false, message: '房间已停用，不可预订' });
    }
    
    const bookingNo = generateBookingNo();
    const calculatedPrice = calculatePrice(room_id, checkin_date, checkout_date);
    const finalAmount = total_amount || calculatedPrice;
    
    const result = db.prepare(`
      INSERT INTO bookings (booking_no, guest_name, guest_phone, room_id, checkin_date, checkout_date, guest_count, channel, total_amount, deposit, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      bookingNo,
      guest_name,
      guest_phone || '',
      room_id,
      checkin_date,
      checkout_date,
      guest_count || 1,
      channel || 'direct',
      finalAmount,
      deposit !== undefined ? deposit : finalAmount * 0.3,
      notes || ''
    );
    
    res.json({ success: true, data: { id: result.lastInsertRowid, booking_no: bookingNo } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { guest_name, guest_phone, room_id, checkin_date, checkout_date, guest_count, channel, total_amount, deposit, status, notes } = req.body;
  
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: '预订不存在' });
    }
    
    const newRoomId = room_id || booking.room_id;
    const newCheckin = checkin_date || booking.checkin_date;
    const newCheckout = checkout_date || booking.checkout_date;
    
    if (room_id || checkin_date || checkout_date) {
      const bookingConflicts = checkRoomConflict(newRoomId, newCheckin, newCheckout, req.params.id);
      if (bookingConflicts.length > 0) {
        return res.status(400).json({ success: false, message: '该时间段房间已被预订' });
      }
      
      const maintenanceConflicts = checkMaintenanceConflict(newRoomId, newCheckin, newCheckout);
      if (maintenanceConflicts.length > 0) {
        return res.status(400).json({ success: false, message: '该时间段房间处于维修中' });
      }

      const room = db.prepare('SELECT status FROM rooms WHERE id = ?').get(newRoomId);
      if (room && room.status === 'out_of_service') {
        return res.status(400).json({ success: false, message: '房间已停用，不可预订' });
      }
    }
    
    db.prepare(`
      UPDATE bookings SET 
        guest_name = ?, guest_phone = ?, room_id = ?, checkin_date = ?, 
        checkout_date = ?, guest_count = ?, channel = ?, total_amount = ?, 
        deposit = ?, status = ?, notes = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      guest_name || booking.guest_name,
      guest_phone !== undefined ? guest_phone : booking.guest_phone,
      newRoomId,
      newCheckin,
      newCheckout,
      guest_count || booking.guest_count,
      channel || booking.channel,
      total_amount !== undefined ? total_amount : booking.total_amount,
      deposit !== undefined ? deposit : booking.deposit,
      status || booking.status,
      notes !== undefined ? notes : booking.notes,
      req.params.id
    );
    
    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: '预订不存在' });
    }
    
    db.prepare('DELETE FROM charges WHERE booking_id = ?').run(req.params.id);
    db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
    
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/cancel', (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: '预订不存在' });
    }
    
    if (booking.status === 'checked_in') {
      return res.status(400).json({ success: false, message: '已入住的订单不能取消' });
    }
    
    db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
    
    res.json({ success: true, message: '取消成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/confirm', (req, res) => {
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
    if (!booking) {
      return res.status(404).json({ success: false, message: '预订不存在' });
    }
    
    if (booking.status !== 'pending') {
      return res.status(400).json({ success: false, message: '订单状态不允许确认' });
    }
    
    db.prepare("UPDATE bookings SET status = 'confirmed', updated_at = datetime('now','localtime') WHERE id = ?").run(req.params.id);
    
    res.json({ success: true, message: '确认成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
