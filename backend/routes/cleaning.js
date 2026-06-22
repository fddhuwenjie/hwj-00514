const express = require('express');
const router = express.Router();
const db = require('../models/database');
const moment = require('moment');

router.get('/', (req, res) => {
  const { status, cleaner_id, room_id, start_date, end_date } = req.query;
  
  let sql = `
    SELECT ct.*, r.room_number, r.room_type, c.name as cleaner_name
    FROM cleaning_tasks ct
    LEFT JOIN rooms r ON ct.room_id = r.id
    LEFT JOIN cleaners c ON ct.cleaner_id = c.id
    WHERE 1=1
  `;
  let params = [];
  
  if (status) {
    sql += ' AND ct.status = ?';
    params.push(status);
  }
  
  if (cleaner_id) {
    sql += ' AND ct.cleaner_id = ?';
    params.push(cleaner_id);
  }
  
  if (room_id) {
    sql += ' AND ct.room_id = ?';
    params.push(room_id);
  }
  
  if (start_date) {
    sql += ' AND date(ct.created_at) >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    sql += ' AND date(ct.created_at) <= ?';
    params.push(end_date);
  }
  
  sql += ' ORDER BY ct.created_at DESC';
  
  try {
    const tasks = db.prepare(sql).all(...params);
    
    tasks.forEach(task => {
      if (task.status === 'in_progress' && task.scheduled_time) {
        const scheduled = moment(task.scheduled_time);
        const now = moment();
        if (now.diff(scheduled, 'minutes') > 120) {
          task.is_overdue = 1;
        }
      }
      if (task.status === 'pending' && task.scheduled_time) {
        const scheduled = moment(task.scheduled_time);
        const now = moment();
        if (now.isAfter(scheduled)) {
          task.is_overdue = 1;
        }
      }
    });
    
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const task = db.prepare(`
      SELECT ct.*, r.room_number, r.room_type, c.name as cleaner_name, c.phone as cleaner_phone
      FROM cleaning_tasks ct
      LEFT JOIN rooms r ON ct.room_id = r.id
      LEFT JOIN cleaners c ON ct.cleaner_id = c.id
      WHERE ct.id = ?
    `).get(req.params.id);
    
    if (!task) {
      return res.status(404).json({ success: false, message: '清洁任务不存在' });
    }
    
    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', (req, res) => {
  const { room_id, cleaner_id, scheduled_time, booking_id } = req.body;
  
  if (!room_id) {
    return res.status(400).json({ success: false, message: '缺少房间ID' });
  }
  
  try {
    const result = db.prepare(`
      INSERT INTO cleaning_tasks (room_id, cleaner_id, booking_id, scheduled_time, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(
      room_id,
      cleaner_id || null,
      booking_id || null,
      scheduled_time || moment().format('YYYY-MM-DD HH:mm')
    );
    
    db.prepare("UPDATE rooms SET status = 'cleaning', updated_at = datetime('now','localtime') WHERE id = ?").run(room_id);
    
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id/assign', (req, res) => {
  const { cleaner_id, scheduled_time } = req.body;
  
  if (!cleaner_id) {
    return res.status(400).json({ success: false, message: '缺少保洁员ID' });
  }
  
  try {
    const task = db.prepare('SELECT * FROM cleaning_tasks WHERE id = ?').get(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: '清洁任务不存在' });
    }
    
    db.prepare(`
      UPDATE cleaning_tasks SET cleaner_id = ?, scheduled_time = ?
      WHERE id = ?
    `).run(
      cleaner_id,
      scheduled_time || task.scheduled_time,
      req.params.id
    );
    
    res.json({ success: true, message: '分配成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/start', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM cleaning_tasks WHERE id = ?').get(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: '清洁任务不存在' });
    }
    
    if (task.status !== 'pending') {
      return res.status(400).json({ success: false, message: '任务状态不允许开始' });
    }
    
    db.prepare(`
      UPDATE cleaning_tasks SET status = 'in_progress', started_at = datetime('now','localtime')
      WHERE id = ?
    `).run(req.params.id);
    
    res.json({ success: true, message: '开始清洁' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/complete', (req, res) => {
  const { photo_url, exception } = req.body;
  
  try {
    const task = db.prepare('SELECT * FROM cleaning_tasks WHERE id = ?').get(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: '清洁任务不存在' });
    }
    
    if (task.status !== 'in_progress' && task.status !== 'pending') {
      return res.status(400).json({ success: false, message: '任务状态不允许完成' });
    }
    
    const isOverdue = task.scheduled_time 
      ? moment().isAfter(moment(task.scheduled_time).add(2, 'hours')) 
      : false;
    
    db.prepare(`
      UPDATE cleaning_tasks SET 
        status = 'completed', 
        completed_at = datetime('now','localtime'),
        photo_url = ?,
        exception = ?,
        is_overdue = ?
      WHERE id = ?
    `).run(
      photo_url || '',
      exception || '',
      isOverdue ? 1 : 0,
      req.params.id
    );
    
    const pendingCleanings = db.prepare(`
      SELECT COUNT(*) as count FROM cleaning_tasks 
      WHERE room_id = ? AND status IN ('pending', 'in_progress')
    `).get(task.room_id).count;
    
    if (pendingCleanings === 0) {
      db.prepare("UPDATE rooms SET status = 'available', updated_at = datetime('now','localtime') WHERE id = ?").run(task.room_id);
    }
    
    res.json({ success: true, message: '清洁完成' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/cleaner/:cleanerId/tasks', (req, res) => {
  const { date, status } = req.query;
  
  let sql = `
    SELECT ct.*, r.room_number, r.room_type
    FROM cleaning_tasks ct
    JOIN rooms r ON ct.room_id = r.id
    WHERE ct.cleaner_id = ?
  `;
  let params = [req.params.cleanerId];
  
  if (date) {
    sql += ' AND date(ct.scheduled_time) = ?';
    params.push(date);
  }
  
  if (status) {
    sql += ' AND ct.status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY ct.scheduled_time ASC';
  
  try {
    const tasks = db.prepare(sql).all(...params);
    
    tasks.forEach(task => {
      if (task.status === 'pending' && task.scheduled_time) {
        const scheduled = moment(task.scheduled_time);
        const now = moment();
        if (now.isAfter(scheduled)) {
          task.is_overdue = 1;
        }
      }
    });
    
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/overdue/alerts', (req, res) => {
  try {
    const now = moment();
    const twoHoursAgo = now.clone().subtract(2, 'hours').format('YYYY-MM-DD HH:mm');
    
    const overdueTasks = db.prepare(`
      SELECT ct.*, r.room_number, r.room_type, c.name as cleaner_name, c.phone as cleaner_phone
      FROM cleaning_tasks ct
      JOIN rooms r ON ct.room_id = r.id
      LEFT JOIN cleaners c ON ct.cleaner_id = c.id
      WHERE ct.status IN ('pending', 'in_progress')
        AND ct.scheduled_time < ?
      ORDER BY ct.scheduled_time ASC
    `).all(twoHoursAgo);
    
    res.json({ success: true, data: overdueTasks, count: overdueTasks.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
