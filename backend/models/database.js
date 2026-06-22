const Database = require('better-sqlite3');
const path = require('path');
const moment = require('moment');

const dbPath = path.join(__dirname, '..', 'data', 'homestay.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_number TEXT UNIQUE NOT NULL,
      room_type TEXT NOT NULL,
      bed_type TEXT NOT NULL,
      max_guests INTEGER NOT NULL,
      base_price REAL NOT NULL,
      cleaning_duration INTEGER NOT NULL DEFAULT 60,
      facilities TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS seasonal_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      price REAL NOT NULL,
      name TEXT,
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS cleaners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_no TEXT UNIQUE NOT NULL,
      guest_name TEXT NOT NULL,
      guest_phone TEXT,
      room_id INTEGER NOT NULL,
      checkin_date TEXT NOT NULL,
      checkout_date TEXT NOT NULL,
      guest_count INTEGER NOT NULL DEFAULT 1,
      channel TEXT NOT NULL DEFAULT 'direct',
      total_amount REAL NOT NULL,
      deposit REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      id_card_last4 TEXT,
      deposit_paid INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS cleaning_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      cleaner_id INTEGER,
      booking_id INTEGER,
      scheduled_time TEXT,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      photo_url TEXT,
      exception TEXT,
      is_overdue INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (cleaner_id) REFERENCES cleaners(id),
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    );

    CREATE TABLE IF NOT EXISTS maintenance_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      start_date TEXT NOT NULL,
      end_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (booking_id) REFERENCES bookings(id)
    );
  `);

  const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
  if (roomCount === 0) {
    seedData();
  }
}

function seedData() {
  console.log('正在初始化预置数据...');

  const roomTypes = [
    { type: '标准大床房', bed: '1.8米大床', guests: 2, price: 299, duration: 60 },
    { type: '标准双床房', bed: '1.2米双床', guests: 2, price: 279, duration: 60 },
    { type: '豪华大床房', bed: '2米大床', guests: 2, price: 459, duration: 90 },
    { type: '家庭房', bed: '1.8米+1.2米', guests: 4, price: 559, duration: 90 },
    { type: '豪华套房', bed: '2米大床', guests: 2, price: 699, duration: 120 },
  ];

  const facilities = ['WiFi', '空调', '独立卫浴', '电视', '冰箱', '吹风机', '热水壶', '拖鞋', '洗漱用品'];

  const insertRoom = db.prepare(`
    INSERT INTO rooms (room_number, room_type, bed_type, max_guests, base_price, cleaning_duration, facilities, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const roomIds = [];
  const roomNumbers = ['101', '102', '103', '105', '106', '201', '202', '203', '205', '206', '301', '302', '303', '305', '306'];

  for (let i = 0; i < 15; i++) {
    const typeIndex = i % 5;
    const roomType = roomTypes[typeIndex];
    const roomFacilities = facilities.slice(0, 5 + (i % 4)).join(',');
    let status = 'available';
    if (i === 14) status = 'maintenance';
    if (i === 13) status = 'out_of_service';

    const result = insertRoom.run(
      roomNumbers[i],
      roomType.type,
      roomType.bed,
      roomType.guests,
      roomType.price,
      roomType.duration,
      roomFacilities,
      status
    );
    roomIds.push(result.lastInsertRowid);
  }

  const insertSeasonalPrice = db.prepare(`
    INSERT INTO seasonal_prices (room_id, start_date, end_date, price, name)
    VALUES (?, ?, ?, ?, ?)
  `);

  const today = moment();
  const peakSeasonStart = moment().month(6).date(1).format('YYYY-MM-DD');
  const peakSeasonEnd = moment().month(7).date(31).format('YYYY-MM-DD');
  const weekendStart = moment().add(2, 'days').day(5).format('YYYY-MM-DD');
  const weekendEnd = moment().add(2, 'days').day(6).format('YYYY-MM-DD');

  for (let i = 0; i < 10; i++) {
    const room = db.prepare('SELECT base_price FROM rooms WHERE id = ?').get(roomIds[i]);
    insertSeasonalPrice.run(
      roomIds[i],
      peakSeasonStart,
      peakSeasonEnd,
      room.base_price * 1.5,
      '暑期旺季'
    );
  }

  const cleaners = [
    { name: '张阿姨', phone: '13800000001' },
    { name: '李阿姨', phone: '13800000002' },
    { name: '王阿姨', phone: '13800000003' },
    { name: '赵阿姨', phone: '13800000004' },
    { name: '陈阿姨', phone: '13800000005' },
  ];

  const insertCleaner = db.prepare(`
    INSERT INTO cleaners (name, phone, status)
    VALUES (?, ?, 'active')
  `);

  const cleanerIds = [];
  for (const cleaner of cleaners) {
    const result = insertCleaner.run(cleaner.name, cleaner.phone);
    cleanerIds.push(result.lastInsertRowid);
  }

  const channels = ['direct', 'ctrip', 'meituan', 'phone'];
  const statuses = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
  const guestNames = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十', '郑一', '王二', '冯三', '陈四', '褚五', '卫六', '蒋七', '沈八', '韩九', '杨十'];

  const insertBooking = db.prepare(`
    INSERT INTO bookings (booking_no, guest_name, guest_phone, room_id, checkin_date, checkout_date, guest_count, channel, total_amount, deposit, status, id_card_last4, deposit_paid, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCleaningTask = db.prepare(`
    INSERT INTO cleaning_tasks (room_id, cleaner_id, booking_id, scheduled_time, started_at, completed_at, status, photo_url, exception)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMaintenance = db.prepare(`
    INSERT INTO maintenance_orders (room_id, title, description, status, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let bookingCount = 0;
  let cleaningCount = 0;
  let maintenanceCount = 0;

  for (let i = 0; i < 28; i++) {
    const roomIdx = i % 13;
    const dayOffset = Math.floor(i / 5);
    const checkin = moment().add(dayOffset - 2, 'days');
    const nights = 1 + (i % 3);
    const checkout = checkin.clone().add(nights, 'days');
    const room = db.prepare('SELECT base_price FROM rooms WHERE id = ?').get(roomIds[roomIdx]);
    const total = room.base_price * nights;

    let status;
    if (i < 5) status = 'checked_out';
    else if (i < 8) status = 'checked_in';
    else if (i < 15) status = 'confirmed';
    else if (i < 20) status = 'pending';
    else status = 'cancelled';

    const bookingNo = 'BK' + moment().format('YYYYMMDD') + String(i + 1).padStart(4, '0');

    const result = insertBooking.run(
      bookingNo,
      guestNames[i % guestNames.length] + (i > guestNames.length ? i : ''),
      '139' + String(10000000 + i).padStart(8, '0'),
      roomIds[roomIdx],
      checkin.format('YYYY-MM-DD'),
      checkout.format('YYYY-MM-DD'),
      1 + (i % 3),
      channels[i % channels.length],
      total,
      total * 0.3,
      status,
      status === 'checked_in' || status === 'checked_out' ? String(1000 + i).padStart(4, '0') : null,
      status === 'checked_in' || status === 'checked_out' ? 1 : 0,
      i % 5 === 0 ? '备注：需要加床' : ''
    );

    bookingCount++;

    if (status === 'checked_out' && cleaningCount < 8) {
      const scheduled = checkin.clone().add(nights, 'days').hour(12).minute(0);
      const started = scheduled.clone().add(30, 'minutes');
      const completed = started.clone().add(roomIds[roomIdx] ? 60 : 90, 'minutes');

      insertCleaningTask.run(
        roomIds[roomIdx],
        cleanerIds[cleaningCount % cleanerIds.length],
        result.lastInsertRowid,
        scheduled.format('YYYY-MM-DD HH:mm'),
        started.format('YYYY-MM-DD HH:mm'),
        completed.format('YYYY-MM-DD HH:mm'),
        'completed',
        '',
        ''
      );
      cleaningCount++;
    }
  }

  for (let i = 0; i < 5; i++) {
    const roomIdx = 10 + i;
    const scheduled = moment().add(i, 'days').hour(10).minute(0);
    let status = 'pending';
    let started = null;
    if (i === 0) {
      status = 'in_progress';
      started = moment().format('YYYY-MM-DD HH:mm');
    }

    insertCleaningTask.run(
      roomIds[roomIdx % roomIds.length],
      cleanerIds[i % cleanerIds.length],
      null,
      scheduled.format('YYYY-MM-DD HH:mm'),
      started,
      null,
      status,
      '',
      ''
    );
    cleaningCount++;
  }

  insertMaintenance.run(
    roomIds[14],
    '空调故障维修',
    '房间空调不制冷，需要维修',
    'in_progress',
    moment().subtract(1, 'days').format('YYYY-MM-DD'),
    null
  );
  maintenanceCount++;

  insertMaintenance.run(
    roomIds[5],
    '水管漏水',
    '卫生间水管漏水',
    'completed',
    moment().subtract(7, 'days').format('YYYY-MM-DD'),
    moment().subtract(5, 'days').format('YYYY-MM-DD')
  );
  maintenanceCount++;

  insertMaintenance.run(
    roomIds[8],
    '定期维护',
    '季度例行检查维护',
    'pending',
    moment().add(3, 'days').format('YYYY-MM-DD'),
    moment().add(4, 'days').format('YYYY-MM-DD')
  );
  maintenanceCount++;

  console.log('正在同步房间状态...');
  
  const checkedInBookings = db.prepare(`
    SELECT DISTINCT room_id FROM bookings WHERE status = 'checked_in'
  `).all();
  checkedInBookings.forEach(b => {
    db.prepare("UPDATE rooms SET status = 'occupied' WHERE id = ?").run(b.room_id);
  });
  
  const pendingCleanings = db.prepare(`
    SELECT DISTINCT room_id FROM cleaning_tasks 
    WHERE status IN ('pending', 'in_progress')
    AND room_id NOT IN (SELECT room_id FROM bookings WHERE status = 'checked_in')
    AND room_id NOT IN (SELECT room_id FROM maintenance_orders WHERE status NOT IN ('completed'))
  `).all();
  pendingCleanings.forEach(c => {
    const room = db.prepare('SELECT status FROM rooms WHERE id = ?').get(c.room_id);
    if (room && room.status === 'available') {
      db.prepare("UPDATE rooms SET status = 'cleaning' WHERE id = ?").run(c.room_id);
    }
  });
  
  const activeMaintenance = db.prepare(`
    SELECT DISTINCT room_id FROM maintenance_orders WHERE status NOT IN ('completed')
  `).all();
  activeMaintenance.forEach(m => {
    db.prepare("UPDATE rooms SET status = 'maintenance' WHERE id = ?").run(m.room_id);
  });
  
  console.log(`预置数据完成：${roomIds.length}间房, ${cleanerIds.length}名保洁员, ${bookingCount}条预订, ${cleaningCount}条清洁记录, ${maintenanceCount}条维修记录`);
}

initDatabase();

module.exports = db;
