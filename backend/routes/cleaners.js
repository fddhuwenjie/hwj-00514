const express = require('express');
const router = express.Router();
const db = require('../models/database');

router.get('/', (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM cleaners';
  let params = [];
  
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY id';
  
  try {
    const cleaners = db.prepare(sql).all(...params);
    res.json({ success: true, data: cleaners });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const cleaner = db.prepare('SELECT * FROM cleaners WHERE id = ?').get(req.params.id);
    if (!cleaner) {
      return res.status(404).json({ success: false, message: '保洁员不存在' });
    }
    res.json({ success: true, data: cleaner });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', (req, res) => {
  const { name, phone } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, message: '缺少姓名' });
  }
  
  try {
    const result = db.prepare(`
      INSERT INTO cleaners (name, phone, status)
      VALUES (?, ?, 'active')
    `).run(name, phone || '');
    
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', (req, res) => {
  const { name, phone, status } = req.body;
  
  try {
    const cleaner = db.prepare('SELECT * FROM cleaners WHERE id = ?').get(req.params.id);
    if (!cleaner) {
      return res.status(404).json({ success: false, message: '保洁员不存在' });
    }
    
    db.prepare(`
      UPDATE cleaners SET name = ?, phone = ?, status = ?
      WHERE id = ?
    `).run(
      name || cleaner.name,
      phone !== undefined ? phone : cleaner.phone,
      status || cleaner.status,
      req.params.id
    );
    
    res.json({ success: true, message: '更新成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const cleaner = db.prepare('SELECT * FROM cleaners WHERE id = ?').get(req.params.id);
    if (!cleaner) {
      return res.status(404).json({ success: false, message: '保洁员不存在' });
    }
    
    db.prepare('DELETE FROM cleaners WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
