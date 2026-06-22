const express = require('express');
const router = express.Router();
const db = require('../models/database');
const moment = require('moment');

router.get('/', (req, res) => {
  const { status, room_id, start_date, end_date } = req.query;
  
  let sql = `
    SELECT m.*, r.room_number, r.room_type
    FROM maintenance_orders m
    LEFT JOIN rooms r ON m.room_id = r.id
    WHERE 1=1
  `;
  let params = [];
  
  if (status) {
    sql += ' AND m.status = ?';
    params.push(status);
  }
  
  if (room_id) {
    sql += ' AND m.room_id = ?';
    params.push(room_id);
  }
  
  if (start_date) {
    sql += ' AND m.start_date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    sql += ' AND (m.end_date IS NULL OR m.end_date <= ?)';
    params.push(end_date);
  }
  
  sql += ' ORDER BY m.created_at DESC';
  
  try {
    const orders = db.prepare(sql).all(...params);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const order = db.prepare(`
      SELECT m.*, r.room_number, r.room_type
      FROM maintenance_orders m
      LEFT JOIN rooms r ON m.room_id = r.id
      WHERE m.id = ?
    `).get(req.params.id);
    
    if (!order) {
      return res.status(404).json({ success: false, message: '维修单不存在' });
    }
    
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/check-conflicts', (req, res) => {
  const { room_ids, start_date, end_date } = req.body;

  if (!room_ids || !start_date || !end_date) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }

  try {
    const conflicts = [];
    const roomIds = Array.isArray(room_ids) ? room_ids : [room_ids];

    roomIds.forEach(roomId => {
      const room = db.prepare('SELECT room_number, room_type FROM rooms WHERE id = ?').get(roomId);
      if (!room) return;

      const bookings = db.prepare(`
        SELECT b.*, r.room_number
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.room_id = ?
          AND b.status NOT IN ('cancelled')
          AND b.checkin_date < ?
          AND b.checkout_date > ?
      `).all(roomId, end_date, start_date);

      if (bookings.length > 0) {
        bookings.forEach(booking => {
          conflicts.push({
            type: 'booking',
            room_id: roomId,
            room_number: room.room_number,
            room_type: room.room_type,
            booking_id: booking.id,
            booking_no: booking.booking_no,
            guest_name: booking.guest_name,
            checkin_date: booking.checkin_date,
            checkout_date: booking.checkout_date,
            status: booking.status,
            total_amount: booking.total_amount
          });
        });
      }
    });

    res.json({
      success: true,
      data: {
        has_conflicts: conflicts.length > 0,
        conflicts: conflicts,
        conflict_count: conflicts.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', (req, res) => {
  const { room_id, title, description, start_date, end_date, check_conflicts } = req.body;
  
  if (!room_id || !title || !start_date) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }
  
  try {
    const room = db.prepare('SELECT status, room_number, room_type FROM rooms WHERE id = ?').get(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: '房间不存在' });
    }
    
    const conflicts = db.prepare(`
      SELECT * FROM maintenance_orders
      WHERE room_id = ?
        AND status NOT IN ('completed')
        AND start_date < ?
        AND (end_date IS NULL OR end_date > ?)
    `).all(room_id, end_date || '9999-12-31', start_date);
    
    if (conflicts.length > 0) {
      return res.status(400).json({ success: false, message: '该时间段已有维修单' });
    }

    if (check_conflicts) {
      const bookingConflicts = db.prepare(`
        SELECT b.*, r.room_number
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.room_id = ?
          AND b.status NOT IN ('cancelled')
          AND b.checkin_date < ?
          AND b.checkout_date > ?
      `).all(room_id, end_date || '9999-12-31', start_date);

      if (bookingConflicts.length > 0) {
        const conflicts = bookingConflicts.map(booking => ({
          type: 'booking',
          room_id: room_id,
          room_number: room.room_number,
          room_type: room.room_type,
          booking_id: booking.id,
          booking_no: booking.booking_no,
          guest_name: booking.guest_name,
          checkin_date: booking.checkin_date,
          checkout_date: booking.checkout_date,
          status: booking.status,
          total_amount: booking.total_amount
        }));

        return res.status(400).json({
          success: false,
          message: '维修区间覆盖已有订单，请先处理',
          conflicts: conflicts
        });
      }
    }
    
    const result = db.prepare(`
      INSERT INTO maintenance_orders (room_id, title, description, status, start_date, end_date)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(
      room_id,
      title,
      description || '',
      start_date,
      end_date || null
    );
    
    db.prepare("UPDATE rooms SET status = 'maintenance', updated_at = datetime('now','localtime') WHERE id = ?").run(room_id);
    
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { title, description, status, start_date, end_date } = req.body;
  
  try {
    const order = db.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: '维修单不存在' });
    }
    
    db.prepare(`
      UPDATE maintenance_orders SET 
        title = ?, description = ?, status = ?, 
        start_date = ?, end_date = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      title || order.title,
      description !== undefined ? description : order.description,
      status || order.status,
      start_date || order.start_date,
      end_date !== undefined ? end_date : order.end_date,
      req.params.id
    );
    
    if (status === 'completed') {
      const pendingCleanings = db.prepare(`
        SELECT COUNT(*) as count FROM cleaning_tasks 
        WHERE room_id = ? AND status IN ('pending', 'in_progress')
      `).get(order.room_id).count;
      
      if (pendingCleanings > 0) {
        db.prepare("UPDATE rooms SET status = 'cleaning', updated_at = datetime('now','localtime') WHERE id = ?").run(order.room_id);
      } else {
        db.prepare("UPDATE rooms SET status = 'available', updated_at = datetime('now','localtime') WHERE id = ?").run(order.room_id);
      }
    } else if (status === 'in_progress' || status === 'pending') {
      db.prepare("UPDATE rooms SET status = 'maintenance', updated_at = datetime('now','localtime') WHERE id = ?").run(order.room_id);
    }
    
    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/complete', (req, res) => {
  const { return_to_cleaning } = req.body;
  
  try {
    const order = db.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: '维修单不存在' });
    }
    
    db.prepare(`
      UPDATE maintenance_orders SET 
        status = 'completed', 
        end_date = date('now','localtime'),
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(req.params.id);
    
    if (return_to_cleaning) {
      db.prepare("UPDATE rooms SET status = 'cleaning', updated_at = datetime('now','localtime') WHERE id = ?").run(order.room_id);
      
      db.prepare(`
        INSERT INTO cleaning_tasks (room_id, status, scheduled_time)
        VALUES (?, 'pending', datetime('now','localtime'))
      `).run(order.room_id);
    } else {
      db.prepare("UPDATE rooms SET status = 'available', updated_at = datetime('now','localtime') WHERE id = ?").run(order.room_id);
    }
    
    res.json({ success: true, message: '维修完成' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM maintenance_orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: '维修单不存在' });
    }
    
    db.prepare('DELETE FROM maintenance_orders WHERE id = ?').run(req.params.id);
    
    const pendingMaintenances = db.prepare(`
      SELECT COUNT(*) as count FROM maintenance_orders 
      WHERE room_id = ? AND status NOT IN ('completed')
    `).get(order.room_id).count;
    
    if (pendingMaintenances === 0) {
      db.prepare("UPDATE rooms SET status = 'available', updated_at = datetime('now','localtime') WHERE id = ?").run(order.room_id);
    }
    
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
