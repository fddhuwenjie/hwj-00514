const express = require('express');
const router = express.Router();
const db = require('../models/database');
const moment = require('moment');

router.get('/occupancy', (req, res) => {
  const { start_date, end_date } = req.query;
  
  const start = start_date ? moment(start_date) : moment().subtract(30, 'days');
  const end = end_date ? moment(end_date) : moment();
  const days = end.diff(start, 'days') + 1;
  
  try {
    const totalRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status != 'out_of_service'").get().count;
    
    const bookings = db.prepare(`
      SELECT checkin_date, checkout_date, total_amount
      FROM bookings 
      WHERE status NOT IN ('cancelled')
        AND checkout_date >= ?
        AND checkin_date <= ?
    `).all(start.format('YYYY-MM-DD'), end.format('YYYY-MM-DD'));
    
    let totalRoomNights = 0;
    let totalRevenue = 0;
    
    bookings.forEach(booking => {
      const checkin = moment(booking.checkin_date).isAfter(start) ? moment(booking.checkin_date) : start.clone();
      const checkout = moment(booking.checkout_date).isBefore(end) ? moment(booking.checkout_date) : end.clone().add(1, 'days');
      const nights = checkout.diff(checkin, 'days');
      
      if (nights > 0) {
        totalRoomNights += nights;
        totalRevenue += booking.total_amount;
      }
    });
    
    const availableRoomNights = totalRooms * days;
    const occupancyRate = availableRoomNights > 0 ? (totalRoomNights / availableRoomNights * 100).toFixed(2) : 0;
    const revpar = availableRoomNights > 0 ? (totalRevenue / availableRoomNights).toFixed(2) : 0;
    const adr = totalRoomNights > 0 ? (totalRevenue / totalRoomNights).toFixed(2) : 0;
    
    res.json({
      success: true,
      data: {
        start_date: start.format('YYYY-MM-DD'),
        end_date: end.format('YYYY-MM-DD'),
        total_rooms: totalRooms,
        total_room_nights: totalRoomNights,
        available_room_nights: availableRoomNights,
        occupancy_rate: parseFloat(occupancyRate),
        total_revenue: parseFloat(totalRevenue.toFixed(2)),
        revpar: parseFloat(revpar),
        adr: parseFloat(adr),
        days: days
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/channel-stats', (req, res) => {
  const { start_date, end_date } = req.query;
  
  let sql = `
    SELECT channel, 
      COUNT(*) as order_count, 
      SUM(total_amount) as total_amount,
      SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) as confirmed_count
    FROM bookings
    WHERE 1=1
  `;
  let params = [];
  
  if (start_date) {
    sql += ' AND checkin_date >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    sql += ' AND checkin_date <= ?';
    params.push(end_date);
  }
  
  sql += ' GROUP BY channel ORDER BY order_count DESC';
  
  try {
    const stats = db.prepare(sql).all(...params);
    
    const totalOrders = stats.reduce((sum, s) => sum + s.order_count, 0);
    stats.forEach(s => {
      s.percentage = totalOrders > 0 ? parseFloat(((s.order_count / totalOrders) * 100).toFixed(2)) : 0;
      s.total_amount = parseFloat(s.total_amount || 0).toFixed(2);
    });
    
    const channelNames = {
      'direct': '自营',
      'ctrip': '携程',
      'meituan': '美团',
      'phone': '电话'
    };
    
    stats.forEach(s => {
      s.channel_name = channelNames[s.channel] || s.channel;
    });
    
    res.json({ success: true, data: stats, total: totalOrders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/cleaner-workload', (req, res) => {
  const { start_date, end_date } = req.query;
  
  let sql = `
    SELECT c.id, c.name, c.phone,
      COUNT(ct.id) as total_tasks,
      SUM(CASE WHEN ct.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
      SUM(CASE WHEN ct.is_overdue = 1 THEN 1 ELSE 0 END) as overdue_tasks
    FROM cleaners c
    LEFT JOIN cleaning_tasks ct ON c.id = ct.cleaner_id
    WHERE c.status = 'active'
  `;
  let params = [];
  
  if (start_date) {
    sql += ' AND date(ct.created_at) >= ?';
    params.push(start_date);
  }
  
  if (end_date) {
    sql += ' AND date(ct.created_at) <= ?';
    params.push(end_date);
  }
  
  sql += ' GROUP BY c.id ORDER BY completed_tasks DESC';
  
  try {
    const stats = db.prepare(sql).all(...params);
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/maintenance-days', (req, res) => {
  const { start_date, end_date } = req.query;
  
  const start = start_date ? moment(start_date) : moment().subtract(30, 'days');
  const end = end_date ? moment(end_date) : moment();
  
  try {
    const orders = db.prepare(`
      SELECT m.*, r.room_number
      FROM maintenance_orders m
      JOIN rooms r ON m.room_id = r.id
      WHERE m.start_date <= ?
        AND (m.end_date IS NULL OR m.end_date >= ?)
    `).all(end.format('YYYY-MM-DD'), start.format('YYYY-MM-DD'));
    
    let totalDays = 0;
    const roomStats = {};
    
    orders.forEach(order => {
      const orderStart = moment(order.start_date).isAfter(start) ? moment(order.start_date) : start.clone();
      const orderEnd = order.end_date ? moment(order.end_date) : end.clone();
      const actualEnd = orderEnd.isBefore(end) ? orderEnd : end.clone();
      const days = actualEnd.diff(orderStart, 'days') + 1;
      
      if (days > 0) {
        totalDays += days;
        if (!roomStats[order.room_id]) {
          roomStats[order.room_id] = {
            room_id: order.room_id,
            room_number: order.room_number,
            days: 0,
            count: 0
          };
        }
        roomStats[order.room_id].days += days;
        roomStats[order.room_id].count += 1;
      }
    });
    
    const roomStatsArray = Object.values(roomStats).sort((a, b) => b.days - a.days);
    
    res.json({
      success: true,
      data: {
        total_maintenance_days: totalDays,
        total_orders: orders.length,
        room_stats: roomStatsArray,
        start_date: start.format('YYYY-MM-DD'),
        end_date: end.format('YYYY-MM-DD')
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/room-calendar', (req, res) => {
  const { start_date, end_date } = req.query;
  
  const start = start_date ? moment(start_date) : moment();
  const end = end_date ? moment(end_date) : moment().add(13, 'days');
  
  try {
    const rooms = db.prepare("SELECT * FROM rooms ORDER BY room_number").all();
    
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
    
    const calendar = [];
    const days = end.diff(start, 'days') + 1;
    
    for (let i = 0; i < days; i++) {
      const date = start.clone().add(i, 'days');
      const dateStr = date.format('YYYY-MM-DD');
      
      const dayData = {
        date: dateStr,
        weekday: date.format('ddd'),
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
        
        dayData.rooms.push({
          room_id: room.id,
          room_number: room.room_number,
          room_type: room.room_type,
          status: status,
          status_text: statusText,
          booking: roomBookings.length > 0 ? roomBookings[0] : null,
          maintenance: roomMaintenance.length > 0 ? roomMaintenance[0] : null,
          cleaning: roomCleaning.length > 0 ? roomCleaning[0] : null
        });
      });
      
      calendar.push(dayData);
    }
    
    res.json({ success: true, data: calendar, rooms: rooms.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/dashboard', (req, res) => {
  try {
    const today = moment().format('YYYY-MM-DD');
    
    const totalRooms = db.prepare("SELECT COUNT(*) as count FROM rooms").get().count;
    const availableRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'available'").get().count;
    const occupiedRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'occupied'").get().count;
    const cleaningRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'cleaning'").get().count;
    const maintenanceRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'maintenance'").get().count;
    
    const todayCheckins = db.prepare(`
      SELECT COUNT(*) as count FROM bookings 
      WHERE checkin_date = ? AND status IN ('confirmed', 'pending')
    `).get(today).count;
    
    const todayCheckouts = db.prepare(`
      SELECT COUNT(*) as count FROM bookings 
      WHERE checkout_date = ? AND status = 'checked_in'
    `).get(today).count;
    
    const inHouseGuests = db.prepare(`
      SELECT COUNT(*) as count FROM bookings 
      WHERE status = 'checked_in'
    `).get().count;
    
    const pendingCleanings = db.prepare(`
      SELECT COUNT(*) as count FROM cleaning_tasks 
      WHERE status IN ('pending', 'in_progress')
    `).get().count;
    
    const pendingMaintenance = db.prepare(`
      SELECT COUNT(*) as count FROM maintenance_orders 
      WHERE status NOT IN ('completed')
    `).get().count;
    
    const monthStart = moment().startOf('month').format('YYYY-MM-DD');
    const monthEnd = moment().endOf('month').format('YYYY-MM-DD');
    
    const monthRevenue = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total FROM bookings 
      WHERE status NOT IN ('cancelled')
        AND checkin_date >= ?
        AND checkin_date <= ?
    `).get(monthStart, monthEnd).total;
    
    const monthBookings = db.prepare(`
      SELECT COUNT(*) as count FROM bookings 
      WHERE status NOT IN ('cancelled')
        AND checkin_date >= ?
        AND checkin_date <= ?
    `).get(monthStart, monthEnd).count;
    
    res.json({
      success: true,
      data: {
        total_rooms: totalRooms,
        available_rooms: availableRooms,
        occupied_rooms: occupiedRooms,
        cleaning_rooms: cleaningRooms,
        maintenance_rooms: maintenanceRooms,
        today_checkins: todayCheckins,
        today_checkouts: todayCheckouts,
        in_house_guests: inHouseGuests,
        pending_cleanings: pendingCleanings,
        pending_maintenance: pendingMaintenance,
        month_revenue: parseFloat(monthRevenue),
        month_bookings: monthBookings
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
