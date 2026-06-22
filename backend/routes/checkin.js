const express = require('express');
const router = express.Router();
const db = require('../models/database');
const moment = require('moment');

router.post('/checkin', (req, res) => {
  const { booking_id, id_card_last4, deposit_paid } = req.body;
  
  if (!booking_id) {
    return res.status(400).json({ success: false, message: '缺少预订ID' });
  }
  
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
    if (!booking) {
      return res.status(404).json({ success: false, message: '预订不存在' });
    }
    
    if (booking.status !== 'confirmed' && booking.status !== 'pending') {
      return res.status(400).json({ success: false, message: '订单状态不允许入住' });
    }
    
    db.prepare(`
      UPDATE bookings SET 
        status = 'checked_in', 
        id_card_last4 = ?, 
        deposit_paid = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      id_card_last4 || '',
      deposit_paid ? 1 : 0,
      booking_id
    );
    
    db.prepare("UPDATE rooms SET status = 'occupied', updated_at = datetime('now','localtime') WHERE id = ?").run(booking.room_id);
    
    res.json({ success: true, message: '入住成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/checkout', (req, res) => {
  const { booking_id, charges } = req.body;
  
  if (!booking_id) {
    return res.status(400).json({ success: false, message: '缺少预订ID' });
  }
  
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(booking_id);
    if (!booking) {
      return res.status(404).json({ success: false, message: '预订不存在' });
    }
    
    if (booking.status !== 'checked_in') {
      return res.status(400).json({ success: false, message: '订单状态不允许退房' });
    }
    
    let totalCharges = 0;
    if (charges && Array.isArray(charges)) {
      const insertCharge = db.prepare('INSERT INTO charges (booking_id, name, amount) VALUES (?, ?, ?)');
      charges.forEach(charge => {
        insertCharge.run(booking_id, charge.name, charge.amount);
        totalCharges += parseFloat(charge.amount) || 0;
      });
    }
    
    const refundDeposit = booking.deposit - totalCharges;
    
    db.prepare(`
      UPDATE bookings SET 
        status = 'checked_out', 
        total_amount = total_amount + ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(totalCharges, booking_id);
    
    db.prepare("UPDATE rooms SET status = 'cleaning', updated_at = datetime('now','localtime') WHERE id = ?").run(booking.room_id);
    
    db.prepare(`
      INSERT INTO cleaning_tasks (room_id, booking_id, status, scheduled_time)
      VALUES (?, ?, 'pending', datetime('now','localtime'))
    `).run(booking.room_id, booking_id);
    
    res.json({ 
      success: true, 
      message: '退房成功',
      data: {
        total_charges: totalCharges,
        refund_deposit: Math.max(0, refundDeposit),
        deposit: booking.deposit
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/today', (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    
    const checkins = db.prepare(`
      SELECT b.*, r.room_number, r.room_type 
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.checkin_date = ? 
        AND b.status IN ('confirmed', 'pending')
      ORDER BY b.checkin_date
    `).all(today);
    
    const checkouts = db.prepare(`
      SELECT b.*, r.room_number, r.room_type 
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.checkout_date = ? 
        AND b.status = 'checked_in'
      ORDER BY b.checkout_date
    `).all(today);
    
    const inHouse = db.prepare(`
      SELECT b.*, r.room_number, r.room_type 
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.status = 'checked_in'
      ORDER BY r.room_number
    `).all();
    
    res.json({
      success: true,
      data: {
        checkins: checkins,
        checkouts: checkouts,
        in_house: inHouse,
        checkin_count: checkins.length,
        checkout_count: checkouts.length,
        in_house_count: inHouse.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
