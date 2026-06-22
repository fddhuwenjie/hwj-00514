const express = require('express');
const router = express.Router();
const db = require('../models/database');
const moment = require('moment');

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
    return {
      price: priceRule.price,
      rule: priceRule,
      is_holiday: isHoliday,
      is_weekend: isWeekend,
      weekday: weekday
    };
  }

  return {
    price: basePrice,
    rule: null,
    is_holiday: isHoliday,
    is_weekend: isWeekend,
    weekday: weekday
  };
}

function calculatePriceWithDetails(roomId, checkinDate, checkoutDate) {
  const room = db.prepare('SELECT base_price, room_type FROM rooms WHERE id = ?').get(roomId);
  if (!room) return { total: 0, details: [] };

  const start = moment(checkinDate);
  const end = moment(checkoutDate);
  const nights = end.diff(start, 'days');

  let totalPrice = 0;
  const details = [];
  const current = start.clone();

  for (let i = 0; i < nights; i++) {
    const dateStr = current.format('YYYY-MM-DD');
    const priceInfo = getPriceForDate(roomId, room.room_type, room.base_price, dateStr);
    totalPrice += priceInfo.price;
    details.push({
      date: dateStr,
      price: priceInfo.price,
      is_holiday: priceInfo.is_holiday,
      is_weekend: priceInfo.is_weekend,
      weekday: priceInfo.weekday,
      rule_name: priceInfo.rule ? priceInfo.rule.name : '基础价',
      rule_type: priceInfo.rule ? priceInfo.rule.price_type : 'base'
    });
    current.add(1, 'day');
  }

  return {
    total: totalPrice,
    nights: nights,
    details: details
  };
}

router.get('/inventory', (req, res) => {
  const { start_date, days } = req.query;
  
  const start = start_date ? moment(start_date) : moment();
  const totalDays = days ? parseInt(days) : 30;
  const end = start.clone().add(totalDays - 1, 'days');

  try {
    const rooms = db.prepare("SELECT * FROM rooms ORDER BY room_number").all();
    const roomTypes = [...new Set(rooms.map(r => r.room_type))];

    const bookings = db.prepare(`
      SELECT b.*, r.room_number
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.status NOT IN ('cancelled')
        AND b.checkout_date >= ?
        AND b.checkin_date <= ?
    `).all(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));

    const maintenances = db.prepare(`
      SELECT m.*, r.room_number
      FROM maintenance_orders m
      JOIN rooms r ON m.room_id = r.id
      WHERE m.status NOT IN ('completed')
        AND (m.end_date IS NULL OR m.end_date >= ?)
        AND m.start_date <= ?
    `).all(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));

    const cleaningTasks = db.prepare(`
      SELECT ct.*, r.room_number
      FROM cleaning_tasks ct
      JOIN rooms r ON ct.room_id = r.id
      WHERE ct.status IN ('pending', 'in_progress')
        AND date(ct.scheduled_time) >= ?
        AND date(ct.scheduled_time) <= ?
    `).all(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));

    const holidays = db.prepare(`
      SELECT * FROM holidays 
      WHERE date >= ? AND date <= ?
    `).all(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));

    const holidayMap = {};
    holidays.forEach(h => {
      holidayMap[h.date] = h;
    });

    const calendar = [];

    for (let i = 0; i < totalDays; i++) {
      const date = start.clone().add(i, 'days');
      const dateStr = date.format('YYYY-MM-DD');
      const weekday = date.isoWeekday();
      const isWeekend = weekday >= 6;
      const holiday = holidayMap[dateStr];

      const dayData = {
        date: dateStr,
        weekday: date.format('ddd'),
        weekday_num: weekday,
        is_weekend: isWeekend,
        is_holiday: !!holiday,
        holiday_name: holiday ? holiday.name : null,
        rooms: []
      };

      rooms.forEach(room => {
        const roomBookings = bookings.filter(b =>
          b.room_id === room.id &&
          b.checkin_date <= dateStr &&
          b.checkout_date > dateStr
        );

        const roomMaintenance = maintenances.filter(m =>
          m.room_id === room.id &&
          m.start_date <= dateStr &&
          (m.end_date === null || m.end_date >= dateStr)
        );

        const roomCleaning = cleaningTasks.filter(c =>
          c.room_id === room.id &&
          moment(c.scheduled_time).format('YYYY-MM-DD') === dateStr
        );

        let status = 'available';
        let statusText = '可订';

        if (room.status === 'out_of_service') {
          status = 'out_of_service';
          statusText = '停用';
        } else if (roomMaintenance.length > 0) {
          status = 'maintenance';
          statusText = '维修';
        } else if (roomCleaning.length > 0) {
          status = 'cleaning';
          statusText = '待清洁';
        } else if (roomBookings.length > 0) {
          const booking = roomBookings[0];
          if (booking.status === 'checked_in') {
            status = 'occupied';
            statusText = '入住中';
          } else {
            status = 'booked';
            statusText = '已预订';
          }
        } else if (room.status === 'cleaning') {
          status = 'cleaning';
          statusText = '待清洁';
        } else if (room.status === 'maintenance') {
          status = 'maintenance';
          statusText = '维修';
        }

        const priceInfo = getPriceForDate(room.id, room.room_type, room.base_price, dateStr);

        dayData.rooms.push({
          room_id: room.id,
          room_number: room.room_number,
          room_type: room.room_type,
          base_price: room.base_price,
          status: status,
          status_text: statusText,
          price: priceInfo.price,
          is_holiday: priceInfo.is_holiday,
          is_weekend: priceInfo.is_weekend,
          rule_name: priceInfo.rule ? priceInfo.rule.name : null,
          rule_type: priceInfo.rule ? priceInfo.rule.price_type : null,
          booking: roomBookings.length > 0 ? roomBookings[0] : null,
          maintenance: roomMaintenance.length > 0 ? roomMaintenance[0] : null,
          cleaning: roomCleaning.length > 0 ? roomCleaning[0] : null
        });
      });

      calendar.push(dayData);
    }

    res.json({
      success: true,
      data: {
        calendar: calendar,
        rooms: rooms,
        room_types: roomTypes,
        start_date: start.format('YYYY-MM-DD'),
        end_date: end.format('YYYY-MM-DD'),
        total_days: totalDays
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/room/:roomId/date/:date', (req, res) => {
  const { roomId, date } = req.params;

  try {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!room) {
      return res.status(404).json({ success: false, message: '房间不存在' });
    }

    const bookings = db.prepare(`
      SELECT b.*, r.room_number, r.room_type
      FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.room_id = ?
        AND b.status NOT IN ('cancelled')
        AND b.checkin_date <= ?
        AND b.checkout_date > ?
    `).all(roomId, date, date);

    const maintenances = db.prepare(`
      SELECT m.*, r.room_number, r.room_type
      FROM maintenance_orders m
      JOIN rooms r ON m.room_id = r.id
      WHERE m.room_id = ?
        AND m.status NOT IN ('completed')
        AND m.start_date <= ?
        AND (m.end_date IS NULL OR m.end_date >= ?)
    `).all(roomId, date, date);

    const cleanings = db.prepare(`
      SELECT ct.*, r.room_number, r.room_type, c.name as cleaner_name
      FROM cleaning_tasks ct
      JOIN rooms r ON ct.room_id = r.id
      LEFT JOIN cleaners c ON ct.cleaner_id = c.id
      WHERE ct.room_id = ?
        AND date(ct.scheduled_time) = ?
    `).all(roomId, date);

    const holiday = db.prepare(`
      SELECT * FROM holidays WHERE date = ?
    `).get(date);

    const priceInfo = getPriceForDate(room.id, room.room_type, room.base_price, date);

    let status = 'available';
    let statusText = '可订';

    if (room.status === 'out_of_service') {
      status = 'out_of_service';
      statusText = '停用';
    } else if (maintenances.length > 0) {
      status = 'maintenance';
      statusText = '维修';
    } else if (cleanings.length > 0) {
      status = 'cleaning';
      statusText = '待清洁';
    } else if (bookings.length > 0) {
      const booking = bookings[0];
      if (booking.status === 'checked_in') {
        status = 'occupied';
        statusText = '入住中';
      } else {
        status = 'booked';
        statusText = '已预订';
      }
    } else if (room.status === 'cleaning') {
      status = 'cleaning';
      statusText = '待清洁';
    } else if (room.status === 'maintenance') {
      status = 'maintenance';
      statusText = '维修';
    }

    res.json({
      success: true,
      data: {
        room: room,
        date: date,
        status: status,
        status_text: statusText,
        price: priceInfo.price,
        base_price: room.base_price,
        is_holiday: priceInfo.is_holiday,
        is_weekend: priceInfo.is_weekend,
        holiday: holiday,
        rule: priceInfo.rule,
        bookings: bookings,
        maintenances: maintenances,
        cleanings: cleanings
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pricing/rules', (req, res) => {
  const { room_id, room_type, price_type } = req.query;

  let sql = `
    SELECT sp.*, r.room_number, r.room_type as r_type
    FROM seasonal_prices sp
    LEFT JOIN rooms r ON sp.room_id = r.id
    WHERE 1=1
  `;
  let params = [];

  if (room_id) {
    sql += ' AND sp.room_id = ?';
    params.push(room_id);
  }

  if (room_type) {
    sql += ' AND sp.room_type = ?';
    params.push(room_type);
  }

  if (price_type) {
    sql += ' AND sp.price_type = ?';
    params.push(price_type);
  }

  sql += ' ORDER BY sp.created_at DESC';

  try {
    const rules = db.prepare(sql).all(...params);
    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/pricing/batch', (req, res) => {
  const {
    room_ids,
    room_type,
    start_date,
    end_date,
    price,
    price_type,
    name,
    apply_weekend,
    apply_holiday,
    apply_weekdays
  } = req.body;

  if (!start_date || !end_date || !price) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }

  if (price_type === 'temporary' && !name) {
    return res.status(400).json({ success: false, message: '临时价需要填写名称' });
  }

  try {
    const insertStmt = db.prepare(`
      INSERT INTO seasonal_prices 
      (room_id, room_type, start_date, end_date, price, price_type, name, apply_weekend, apply_holiday, apply_weekdays)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let createdCount = 0;

    if (room_type) {
      const result = insertStmt.run(
        null,
        room_type,
        start_date,
        end_date,
        price,
        price_type || 'seasonal',
        name || '',
        apply_weekend ? 1 : 0,
        apply_holiday ? 1 : 0,
        apply_weekdays ? apply_weekdays.join(',') : null
      );
      createdCount = 1;
    } else if (room_ids && room_ids.length > 0) {
      room_ids.forEach(roomId => {
        insertStmt.run(
          roomId,
          null,
          start_date,
          end_date,
          price,
          price_type || 'seasonal',
          name || '',
          apply_weekend ? 1 : 0,
          apply_holiday ? 1 : 0,
          apply_weekdays ? apply_weekdays.join(',') : null
        );
        createdCount++;
      });
    } else {
      return res.status(400).json({ success: false, message: '请选择房型或房间' });
    }

    res.json({
      success: true,
      data: {
        created_count: createdCount,
        message: `成功创建 ${createdCount} 条价格规则`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/pricing/rules/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM seasonal_prices WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/check-conflicts', (req, res) => {
  const { room_ids, start_date, end_date, operation_type } = req.body;

  if (!room_ids || !start_date || !end_date || !operation_type) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }

  try {
    const conflicts = [];

    room_ids.forEach(roomId => {
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

router.post('/batch-status', (req, res) => {
  const { room_ids, start_date, end_date, status, reason, check_conflicts } = req.body;

  if (!room_ids || !start_date || !end_date || !status) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }

  if (!['maintenance', 'out_of_service'].includes(status)) {
    return res.status(400).json({ success: false, message: '无效的状态类型' });
  }

  try {
    if (check_conflicts) {
      const bookings = db.prepare(`
        SELECT b.*, r.room_number
        FROM bookings b
        JOIN rooms r ON b.room_id = r.id
        WHERE b.room_id IN (${room_ids.map(() => '?').join(',')})
          AND b.status NOT IN ('cancelled')
          AND b.checkin_date < ?
          AND b.checkout_date > ?
      `).all(...room_ids, end_date, start_date);

      if (bookings.length > 0) {
        const conflicts = bookings.map(booking => ({
          type: 'booking',
          room_id: booking.room_id,
          room_number: booking.room_number,
          booking_id: booking.id,
          booking_no: booking.booking_no,
          guest_name: booking.guest_name,
          checkin_date: booking.checkin_date,
          checkout_date: booking.checkout_date,
          status: booking.status
        }));
        return res.status(400).json({
          success: false,
          message: '存在冲突订单，请先处理',
          conflicts: conflicts
        });
      }
    }

    let createdCount = 0;

    if (status === 'maintenance') {
      const insertMaintenance = db.prepare(`
        INSERT INTO maintenance_orders (room_id, title, description, status, start_date, end_date)
        VALUES (?, ?, ?, 'pending', ?, ?)
      `);

      room_ids.forEach(roomId => {
        insertMaintenance.run(
          roomId,
          reason || '批量维修',
          reason || '批量设置维修状态',
          start_date,
          end_date
        );
        db.prepare("UPDATE rooms SET status = 'maintenance', updated_at = datetime('now','localtime') WHERE id = ?").run(roomId);
        createdCount++;
      });
    } else if (status === 'out_of_service') {
      room_ids.forEach(roomId => {
        db.prepare("UPDATE rooms SET status = 'out_of_service', updated_at = datetime('now','localtime') WHERE id = ?").run(roomId);
        createdCount++;
      });
    }

    res.json({
      success: true,
      data: {
        created_count: createdCount,
        message: `成功设置 ${createdCount} 个房间的状态`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/holidays', (req, res) => {
  const { year } = req.query;

  let sql = 'SELECT * FROM holidays';
  let params = [];

  if (year) {
    sql += ' WHERE date LIKE ?';
    params.push(`${year}-%`);
  }

  sql += ' ORDER BY date';

  try {
    const holidays = db.prepare(sql).all(...params);
    res.json({ success: true, data: holidays });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/holidays', (req, res) => {
  const { date, name, type } = req.body;

  if (!date || !name) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }

  try {
    const result = db.prepare(`
      INSERT OR REPLACE INTO holidays (date, name, type)
      VALUES (?, ?, ?)
    `).run(date, name, type || 'holiday');

    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/holidays/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM holidays WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/calculate-price', (req, res) => {
  const { room_id, checkin_date, checkout_date } = req.body;

  if (!room_id || !checkin_date || !checkout_date) {
    return res.status(400).json({ success: false, message: '缺少必要参数' });
  }

  try {
    const priceDetails = calculatePriceWithDetails(room_id, checkin_date, checkout_date);
    res.json({ success: true, data: priceDetails });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
