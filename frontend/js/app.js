const API_BASE = 'http://localhost:8514/api';

let currentPage = 'dashboard';
let calendarStartDate = new Date();
let currentCheckinTab = 'checkins';
let calendarRooms = [];
let calendarRoomTypes = [];
let selectedRoomsForBatch = [];

function init() {
  updateCurrentDate();
  setupNavigation();
  loadDashboard();
}

function updateCurrentDate() {
  const now = new Date();
  const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' };
  document.getElementById('current-date').textContent = now.toLocaleDateString('zh-CN', options);
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      navigateTo(page);
    });
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.page === page) {
      item.classList.add('active');
    }
  });

  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
  });
  document.getElementById(`page-${page}`).classList.add('active');

  const titles = {
    dashboard: '首页概览',
    rooms: '房源管理',
    bookings: '预订管理',
    checkin: '入住退房',
    cleaning: '清洁排班',
    maintenance: '维修停房',
    stats: '统计报表',
    calendar: '房态日历'
  };
  document.getElementById('page-title').textContent = titles[page] || page;

  currentPage = page;

  switch (page) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'rooms':
      loadRooms();
      break;
    case 'bookings':
      loadBookings();
      break;
    case 'checkin':
      loadCheckinData();
      break;
    case 'cleaning':
      loadCleaningTasks();
      break;
    case 'maintenance':
      loadMaintenance();
      break;
    case 'stats':
      loadStats();
      break;
    case 'calendar':
      loadCalendar();
      break;
  }
}

async function apiRequest(path, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    const data = await response.json();
    return data;
  } catch (err) {
    console.error('API请求失败:', err);
    showToast('网络请求失败', 'error');
    return { success: false, message: err.message };
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.className = `toast ${type}`;
  }, 3000);
}

function showModal(title, content) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = content;
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

async function loadDashboard() {
  const data = await apiRequest('/stats/dashboard');
  if (data.success) {
    const d = data.data;
    document.getElementById('stat-total-rooms').textContent = d.total_rooms;
    document.getElementById('stat-available-rooms').textContent = d.available_rooms;
    document.getElementById('stat-occupied-rooms').textContent = d.occupied_rooms;
    document.getElementById('stat-cleaning-rooms').textContent = d.cleaning_rooms;
    document.getElementById('stat-maintenance-rooms').textContent = d.maintenance_rooms;
    document.getElementById('stat-month-revenue').textContent = '¥' + d.month_revenue.toFixed(0);

    document.getElementById('today-checkins').textContent = d.today_checkins;
    document.getElementById('today-checkouts').textContent = d.today_checkouts;
    document.getElementById('in-house-guests').textContent = d.in_house_guests;

    document.getElementById('pending-cleanings').textContent = d.pending_cleanings;
    document.getElementById('pending-maintenance').textContent = d.pending_maintenance;

    const pendingBookings = await apiRequest('/bookings?status=pending');
    if (pendingBookings.success) {
      document.getElementById('pending-bookings').textContent = pendingBookings.data.length;
    }
  }
}

async function loadRooms() {
  const status = document.getElementById('room-status-filter').value;
  let url = '/rooms';
  if (status) {
    url += `?status=${status}`;
  }
  
  const data = await apiRequest(url);
  if (data.success) {
    const grid = document.getElementById('room-grid');
    grid.innerHTML = data.data.map(room => `
      <div class="room-card">
        <div class="room-header ${room.status}">
          <span class="room-number">${room.room_number}</span>
          <span class="room-status">${getStatusText(room.status)}</span>
        </div>
        <div class="room-body">
          <div class="room-type">${room.room_type}</div>
          <div class="room-info">${room.bed_type} | 可住${room.max_guests}人</div>
          <div class="room-info">清洁时长: ${room.cleaning_duration}分钟</div>
          ${room.facilities && room.facilities.length > 0 ? `
            <div class="facilities-tags">
              ${room.facilities.slice(0, 4).map(f => `<span class="facility-tag">${f}</span>`).join('')}
            </div>
          ` : ''}
          <div class="room-price">¥${room.base_price}<span style="font-size: 12px; color: #999; font-weight: normal;">/晚</span></div>
        </div>
        <div class="room-actions">
          <button class="btn btn-sm btn-default" onclick="editRoom(${room.id})">编辑</button>
          <button class="btn btn-sm btn-primary" onclick="viewRoomPrices(${room.id})">价格日历</button>
          <button class="btn btn-sm btn-success" onclick="quickBook(${room.id})">快速预订</button>
        </div>
      </div>
    `).join('');
  }
}

function getStatusText(status) {
  const map = {
    available: '可订',
    occupied: '入住中',
    cleaning: '待清洁',
    maintenance: '维修中',
    out_of_service: '停用',
    pending: '待确认',
    confirmed: '已确认',
    checked_in: '入住中',
    checked_out: '已离店',
    cancelled: '已取消',
    in_progress: '进行中',
    completed: '已完成'
  };
  return map[status] || status;
}

function getChannelText(channel) {
  const map = {
    direct: '自营',
    ctrip: '携程',
    meituan: '美团',
    phone: '电话'
  };
  return map[channel] || channel;
}

function showAddRoomModal() {
  const content = `
    <form id="room-form" onsubmit="saveRoom(event)">
      <div class="form-row">
        <div class="form-group">
          <label>房号 *</label>
          <input type="text" name="room_number" required>
        </div>
        <div class="form-group">
          <label>房型 *</label>
          <input type="text" name="room_type" required placeholder="如: 标准大床房">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>床型 *</label>
          <input type="text" name="bed_type" required placeholder="如: 1.8米大床">
        </div>
        <div class="form-group">
          <label>可住人数 *</label>
          <input type="number" name="max_guests" required min="1" value="2">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>基础价(元) *</label>
          <input type="number" name="base_price" required min="0" step="0.01">
        </div>
        <div class="form-group">
          <label>清洁时长(分钟)</label>
          <input type="number" name="cleaning_duration" min="0" value="60">
        </div>
      </div>
      <div class="form-group">
        <label>设施标签 (逗号分隔)</label>
        <input type="text" name="facilities" placeholder="WiFi,空调,电视">
      </div>
      <div class="form-group">
        <label>状态</label>
        <select name="status">
          <option value="available">可订</option>
          <option value="maintenance">维修中</option>
          <option value="out_of_service">停用</option>
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `;
  showModal('添加房间', content);
}

async function editRoom(id) {
  const data = await apiRequest(`/rooms/${id}`);
  if (data.success) {
    const room = data.data;
    const facilities = Array.isArray(room.facilities) ? room.facilities.join(',') : '';
    
    const content = `
      <form id="room-form" onsubmit="updateRoom(event, ${id})">
        <div class="form-row">
          <div class="form-group">
            <label>房号 *</label>
            <input type="text" name="room_number" value="${room.room_number}" required>
          </div>
          <div class="form-group">
            <label>房型 *</label>
            <input type="text" name="room_type" value="${room.room_type}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>床型 *</label>
            <input type="text" name="bed_type" value="${room.bed_type}" required>
          </div>
          <div class="form-group">
            <label>可住人数 *</label>
            <input type="number" name="max_guests" value="${room.max_guests}" required min="1">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>基础价(元) *</label>
            <input type="number" name="base_price" value="${room.base_price}" required min="0" step="0.01">
          </div>
          <div class="form-group">
            <label>清洁时长(分钟)</label>
            <input type="number" name="cleaning_duration" value="${room.cleaning_duration}" min="0">
          </div>
        </div>
        <div class="form-group">
          <label>设施标签 (逗号分隔)</label>
          <input type="text" name="facilities" value="${facilities}">
        </div>
        <div class="form-group">
          <label>状态</label>
          <select name="status">
            <option value="available" ${room.status === 'available' ? 'selected' : ''}>可订</option>
            <option value="maintenance" ${room.status === 'maintenance' ? 'selected' : ''}>维修中</option>
            <option value="out_of_service" ${room.status === 'out_of_service' ? 'selected' : ''}>停用</option>
          </select>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `;
    showModal('编辑房间', content);
  }
}

async function saveRoom(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  if (data.facilities) {
    data.facilities = data.facilities.split(',').map(f => f.trim()).filter(f => f);
  }
  
  const result = await apiRequest('/rooms', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('房间添加成功', 'success');
    closeModal();
    loadRooms();
  } else {
    showToast(result.message || '添加失败', 'error');
  }
}

async function updateRoom(event, id) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  if (data.facilities) {
    data.facilities = data.facilities.split(',').map(f => f.trim()).filter(f => f);
  }
  
  const result = await apiRequest(`/rooms/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('房间更新成功', 'success');
    closeModal();
    loadRooms();
  } else {
    showToast(result.message || '更新失败', 'error');
  }
}

async function viewRoomPrices(roomId) {
  const pricesData = await apiRequest(`/rooms/${roomId}/seasonal-prices`);
  const roomData = await apiRequest(`/rooms/${roomId}`);
  
  if (!pricesData.success || !roomData.success) return;
  
  const prices = pricesData.data;
  const room = roomData.data;
  
  const content = `
    <div class="form-group">
      <label>房间: ${room.room_number} - ${room.room_type}</label>
      <p style="color: #666; font-size: 13px;">基础价: ¥${room.base_price}/晚</p>
    </div>
    
    <h4 style="margin: 15px 0 10px;">季节价格</h4>
    ${prices.length > 0 ? `
      <table class="data-table" style="font-size: 13px;">
        <thead>
          <tr>
            <th>名称</th>
            <th>开始日期</th>
            <th>结束日期</th>
            <th>价格</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${prices.map(p => `
            <tr>
              <td>${p.name || '-'}</td>
              <td>${p.start_date}</td>
              <td>${p.end_date}</td>
              <td>¥${p.price}</td>
              <td><button class="btn btn-sm btn-danger" onclick="deleteSeasonalPrice(${p.id}, ${roomId})">删除</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p style="color: #999; font-size: 13px;">暂无季节价格</p>'}
    
    <hr style="margin: 15px 0;">
    
    <h4 style="margin-bottom: 10px;">添加季节价格</h4>
    <form onsubmit="addSeasonalPrice(event, ${roomId})">
      <div class="form-row">
        <div class="form-group">
          <label>名称</label>
          <input type="text" name="name" placeholder="如: 暑期旺季">
        </div>
        <div class="form-group">
          <label>价格(元) *</label>
          <input type="number" name="price" required min="0" step="0.01">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>开始日期 *</label>
          <input type="date" name="start_date" required>
        </div>
        <div class="form-group">
          <label>结束日期 *</label>
          <input type="date" name="end_date" required>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">关闭</button>
        <button type="submit" class="btn btn-primary">添加</button>
      </div>
    </form>
  `;
  showModal('房间价格日历', content);
}

async function addSeasonalPrice(event, roomId) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  const result = await apiRequest(`/rooms/${roomId}/seasonal-prices`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('季节价格添加成功', 'success');
    viewRoomPrices(roomId);
  } else {
    showToast(result.message || '添加失败', 'error');
  }
}

async function deleteSeasonalPrice(priceId, roomId) {
  if (!confirm('确定要删除这个季节价格吗？')) return;
  
  const result = await apiRequest(`/rooms/seasonal-prices/${priceId}`, {
    method: 'DELETE'
  });
  
  if (result.success) {
    showToast('删除成功', 'success');
    viewRoomPrices(roomId);
  } else {
    showToast(result.message || '删除失败', 'error');
  }
}

function quickBook(roomId) {
  showAddBookingModal(roomId);
}

async function loadBookings() {
  const status = document.getElementById('booking-status-filter').value;
  const channel = document.getElementById('booking-channel-filter').value;
  
  let params = [];
  if (status) params.push(`status=${status}`);
  if (channel) params.push(`channel=${channel}`);
  
  let url = '/bookings';
  if (params.length > 0) {
    url += '?' + params.join('&');
  }
  
  const data = await apiRequest(url);
  if (data.success) {
    const tbody = document.getElementById('bookings-tbody');
    tbody.innerHTML = data.data.map(booking => `
      <tr>
        <td>${booking.booking_no}</td>
        <td>${booking.guest_name}</td>
        <td>${booking.room_number} - ${booking.room_type}</td>
        <td>${booking.checkin_date}</td>
        <td>${booking.checkout_date}</td>
        <td>${getChannelText(booking.channel)}</td>
        <td>¥${booking.total_amount}</td>
        <td><span class="status-badge ${booking.status}">${getStatusText(booking.status)}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn btn-sm btn-default" onclick="viewBooking(${booking.id})">详情</button>
            ${booking.status === 'pending' ? `<button class="btn btn-sm btn-success" onclick="confirmBooking(${booking.id})">确认</button>` : ''}
            ${booking.status !== 'cancelled' && booking.status !== 'checked_out' && booking.status !== 'checked_in' ? 
              `<button class="btn btn-sm btn-danger" onclick="cancelBooking(${booking.id})">取消</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  }
}

function showAddBookingModal(roomId = null) {
  const today = new Date().toISOString().split('T')[0];
  
  const content = `
    <form id="booking-form" onsubmit="saveBooking(event)">
      ${roomId ? `<input type="hidden" name="room_id" value="${roomId}">` : ''}
      
      <div class="form-row">
        <div class="form-group">
          <label>入住人 *</label>
          <input type="text" name="guest_name" required>
        </div>
        <div class="form-group">
          <label>联系电话</label>
          <input type="tel" name="guest_phone">
        </div>
      </div>
      
      ${!roomId ? `
        <div class="form-group">
          <label>房间 *</label>
          <select name="room_id" id="booking-room-select" required onchange="checkBookingConflict()">
            <option value="">请选择房间</option>
          </select>
        </div>
      ` : ''}
      
      <div class="form-row">
        <div class="form-group">
          <label>入住日期 *</label>
          <input type="date" name="checkin_date" id="booking-checkin" required value="${today}" onchange="checkBookingConflict()">
        </div>
        <div class="form-group">
          <label>离店日期 *</label>
          <input type="date" name="checkout_date" id="booking-checkout" required onchange="checkBookingConflict()">
        </div>
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <label>入住人数</label>
          <input type="number" name="guest_count" value="1" min="1">
        </div>
        <div class="form-group">
          <label>渠道</label>
          <select name="channel">
            <option value="direct">自营</option>
            <option value="ctrip">携程</option>
            <option value="meituan">美团</option>
            <option value="phone">电话</option>
          </select>
        </div>
      </div>
      
      <div class="form-row">
        <div class="form-group">
          <label>订单金额(元)</label>
          <input type="number" name="total_amount" id="booking-amount" min="0" step="0.01">
          <small id="price-hint" style="color: #999;">请选择日期计算价格</small>
        </div>
        <div class="form-group">
          <label>押金(元)</label>
          <input type="number" name="deposit" min="0" step="0.01" value="0">
        </div>
      </div>
      
      <div id="booking-price-preview"></div>
      
      <div class="form-group">
        <label>备注</label>
        <textarea name="notes" rows="2"></textarea>
      </div>
      
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">创建预订</button>
      </div>
    </form>
  `;
  showModal('新建预订', content);
  
  if (!roomId) {
    loadRoomSelect();
  }
  
  const checkoutDate = new Date();
  checkoutDate.setDate(checkoutDate.getDate() + 1);
  document.getElementById('booking-checkout').value = checkoutDate.toISOString().split('T')[0];
}

async function loadRoomSelect() {
  const data = await apiRequest('/rooms?status=available');
  if (data.success) {
    const select = document.getElementById('booking-room-select');
    if (select) {
      data.data.forEach(room => {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = `${room.room_number} - ${room.room_type} (¥${room.base_price}/晚)`;
        select.appendChild(option);
      });
    }
  }
}

async function checkBookingConflict() {
  const roomId = document.querySelector('[name="room_id"]').value;
  const checkinDate = document.getElementById('booking-checkin').value;
  const checkoutDate = document.getElementById('booking-checkout').value;
  
  if (!roomId || !checkinDate || !checkoutDate) return;
  if (new Date(checkinDate) >= new Date(checkoutDate)) return;
  
  const data = await apiRequest('/bookings/check-conflict', {
    method: 'POST',
    body: JSON.stringify({
      room_id: parseInt(roomId),
      checkin_date: checkinDate,
      checkout_date: checkoutDate
    })
  });
  
  if (data.success) {
    const hint = document.getElementById('price-hint');
    const amountInput = document.getElementById('booking-amount');
    const pricePreviewDiv = document.getElementById('booking-price-preview');
    
    if (data.data.available) {
      hint.textContent = `可预订，${data.data.nights}晚，预估总价: ¥${data.data.total_price}`;
      hint.style.color = '#2ecc71';
      if (!amountInput.value) {
        amountInput.value = data.data.total_price;
      }

      if (data.data.price_details && pricePreviewDiv) {
        const details = data.data.price_details;
        const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
        
        const detailsHtml = details.map(d => {
          let tags = '';
          if (d.is_holiday) tags += '<span class="price-tag holiday">节假日</span>';
          if (d.is_weekend) tags += '<span class="price-tag weekend">周末</span>';
          
          return `
            <div class="price-breakdown-row">
              <span class="date">${d.date} ${weekdayNames[d.weekday] || ''}</span>
              <span>
                ${tags}
                <span class="price">¥${d.price}</span>
              </span>
            </div>
          `;
        }).join('');

        pricePreviewDiv.innerHTML = `
          <div class="price-breakdown">
            <h4>价格明细 (${data.data.nights}晚)</h4>
            <div class="price-breakdown-table">
              ${detailsHtml}
            </div>
            <div class="price-total-row">
              <span>总价</span>
              <span>¥${data.data.total_price.toFixed(2)}</span>
            </div>
          </div>
        `;
      }
    } else {
      hint.textContent = '该时间段房间不可预订';
      hint.style.color = '#e74c3c';
      if (pricePreviewDiv) {
        pricePreviewDiv.innerHTML = '';
      }
    }
  }
}

async function saveBooking(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  data.room_id = parseInt(data.room_id);
  data.guest_count = parseInt(data.guest_count);
  if (data.total_amount) data.total_amount = parseFloat(data.total_amount);
  if (data.deposit) data.deposit = parseFloat(data.deposit);
  
  const result = await apiRequest('/bookings', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('预订创建成功', 'success');
    closeModal();
    loadBookings();
  } else {
    showToast(result.message || '创建失败', 'error');
  }
}

async function viewBooking(id) {
  const data = await apiRequest(`/bookings/${id}`);
  if (data.success) {
    const b = data.data;
    const content = `
      <div style="line-height: 2;">
        <p><strong>订单号:</strong> ${b.booking_no}</p>
        <p><strong>状态:</strong> <span class="status-badge ${b.status}">${getStatusText(b.status)}</span></p>
        <p><strong>入住人:</strong> ${b.guest_name}</p>
        <p><strong>联系电话:</strong> ${b.guest_phone || '-'}</p>
        <p><strong>房间:</strong> ${b.room_number} - ${b.room_type}</p>
        <p><strong>床型:</strong> ${b.bed_type}</p>
        <p><strong>入住日期:</strong> ${b.checkin_date}</p>
        <p><strong>离店日期:</strong> ${b.checkout_date}</p>
        <p><strong>入住人数:</strong> ${b.guest_count}人</p>
        <p><strong>渠道:</strong> ${getChannelText(b.channel)}</p>
        <p><strong>订单金额:</strong> ¥${b.total_amount}</p>
        <p><strong>押金:</strong> ¥${b.deposit}</p>
        ${b.id_card_last4 ? `<p><strong>证件后四位:</strong> ${b.id_card_last4}</p>` : ''}
        ${b.notes ? `<p><strong>备注:</strong> ${b.notes}</p>` : ''}
        
        ${b.charges && b.charges.length > 0 ? `
          <h4 style="margin: 15px 0 10px;">扣费项目</h4>
          <table class="data-table" style="font-size: 13px;">
            <thead>
              <tr>
                <th>项目</th>
                <th>金额</th>
              </tr>
            </thead>
            <tbody>
              ${b.charges.map(c => `<tr><td>${c.name}</td><td>¥${c.amount}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-default" onclick="closeModal()">关闭</button>
      </div>
    `;
    showModal('预订详情', content);
  }
}

async function confirmBooking(id) {
  if (!confirm('确定要确认这个预订吗？')) return;
  
  const result = await apiRequest(`/bookings/${id}/confirm`, {
    method: 'POST'
  });
  
  if (result.success) {
    showToast('预订已确认', 'success');
    loadBookings();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

async function cancelBooking(id) {
  if (!confirm('确定要取消这个预订吗？')) return;
  
  const result = await apiRequest(`/bookings/${id}/cancel`, {
    method: 'POST'
  });
  
  if (result.success) {
    showToast('预订已取消', 'success');
    loadBookings();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

function switchCheckinTab(tab) {
  currentCheckinTab = tab;
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.tab === tab) {
      btn.classList.add('active');
    }
  });
  
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`tab-${tab}`).classList.add('active');
  
  loadCheckinData();
}

async function loadCheckinData() {
  const data = await apiRequest('/checkin/today');
  if (data.success) {
    const d = data.data;
    
    document.getElementById('checkins-tbody').innerHTML = d.checkins.map(b => `
      <tr>
        <td>${b.booking_no}</td>
        <td>${b.guest_name}</td>
        <td>${b.room_number}</td>
        <td>${b.room_type}</td>
        <td>${b.guest_phone || '-'}</td>
        <td><span class="status-badge ${b.status}">${getStatusText(b.status)}</span></td>
        <td>
          <button class="btn btn-sm btn-success" onclick="checkIn(${b.id})">办理入住</button>
        </td>
      </tr>
    `).join('');
    
    document.getElementById('checkouts-tbody').innerHTML = d.checkouts.map(b => `
      <tr>
        <td>${b.booking_no}</td>
        <td>${b.guest_name}</td>
        <td>${b.room_number}</td>
        <td>${b.room_type}</td>
        <td>${b.checkin_date}</td>
        <td>
          <button class="btn btn-sm btn-warning" onclick="checkOut(${b.id})">办理退房</button>
        </td>
      </tr>
    `).join('');
    
    document.getElementById('inhouse-tbody').innerHTML = d.in_house.map(b => `
      <tr>
        <td>${b.booking_no}</td>
        <td>${b.guest_name}</td>
        <td>${b.room_number}</td>
        <td>${b.room_type}</td>
        <td>${b.checkin_date}</td>
        <td>${b.checkout_date}</td>
        <td>${b.id_card_last4 || '-'}</td>
        <td>
          <button class="btn btn-sm btn-warning" onclick="checkOut(${b.id})">退房</button>
        </td>
      </tr>
    `).join('');
  }
}

async function checkIn(bookingId) {
  const content = `
    <form onsubmit="doCheckIn(event, ${bookingId})">
      <div class="form-group">
        <label>证件号后四位</label>
        <input type="text" name="id_card_last4" maxlength="4" placeholder="请输入身份证后四位">
      </div>
      <div class="form-group">
        <label style="display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" name="deposit_paid" value="1" checked>
          已收取押金
        </label>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">确认入住</button>
      </div>
    </form>
  `;
  showModal('办理入住', content);
}

async function doCheckIn(event, bookingId) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.deposit_paid = formData.has('deposit_paid');
  
  const result = await apiRequest('/checkin/checkin', {
    method: 'POST',
    body: JSON.stringify({
      booking_id: bookingId,
      id_card_last4: data.id_card_last4,
      deposit_paid: data.deposit_paid
    })
  });
  
  if (result.success) {
    showToast('入住成功', 'success');
    closeModal();
    loadCheckinData();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

async function checkOut(bookingId) {
  const bookingData = await apiRequest(`/bookings/${bookingId}`);
  if (!bookingData.success) return;
  
  const booking = bookingData.data;
  
  const content = `
    <form onsubmit="doCheckOut(event, ${bookingId})">
      <div class="form-group">
        <p><strong>房间:</strong> ${booking.room_number} - ${booking.room_type}</p>
        <p><strong>入住人:</strong> ${booking.guest_name}</p>
        <p><strong>押金:</strong> ¥${booking.deposit}</p>
      </div>
      
      <h4 style="margin: 15px 0 10px;">房间状态检查 & 扣费项目</h4>
      
      <div id="charge-items">
        <div class="form-row charge-item">
          <div class="form-group">
            <input type="text" name="charge_name[]" placeholder="项目名称">
          </div>
          <div class="form-group">
            <input type="number" name="charge_amount[]" placeholder="金额" min="0" step="0.01">
          </div>
        </div>
      </div>
      
      <button type="button" class="btn btn-sm btn-default" onclick="addChargeItem()" style="margin-bottom: 15px;">➕ 添加扣费项</button>
      
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">确认退房</button>
      </div>
    </form>
  `;
  showModal('办理退房', content);
}

function addChargeItem() {
  const container = document.getElementById('charge-items');
  const item = document.createElement('div');
  item.className = 'form-row charge-item';
  item.innerHTML = `
    <div class="form-group">
      <input type="text" name="charge_name[]" placeholder="项目名称">
    </div>
    <div class="form-group">
      <input type="number" name="charge_amount[]" placeholder="金额" min="0" step="0.01">
    </div>
  `;
  container.appendChild(item);
}

async function doCheckOut(event, bookingId) {
  event.preventDefault();
  const form = event.target;
  
  const chargeNames = form.querySelectorAll('[name="charge_name[]"]');
  const chargeAmounts = form.querySelectorAll('[name="charge_amount[]"]');
  
  const charges = [];
  for (let i = 0; i < chargeNames.length; i++) {
    const name = chargeNames[i].value.trim();
    const amount = parseFloat(chargeAmounts[i].value);
    if (name && amount > 0) {
      charges.push({ name, amount });
    }
  }
  
  const result = await apiRequest('/checkin/checkout', {
    method: 'POST',
    body: JSON.stringify({
      booking_id: bookingId,
      charges: charges
    })
  });
  
  if (result.success) {
    const data = result.data;
    const msg = `退房成功！总扣费: ¥${data.total_charges.toFixed(2)}，应退押金: ¥${data.refund_deposit.toFixed(2)}`;
    showToast(msg, 'success');
    closeModal();
    loadCheckinData();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

async function loadCleaningTasks() {
  const status = document.getElementById('cleaning-status-filter').value;
  
  let url = '/cleaning';
  if (status) {
    url += `?status=${status}`;
  }
  
  const data = await apiRequest(url);
  if (data.success) {
    const tbody = document.getElementById('cleaning-tbody');
    tbody.innerHTML = data.data.map(task => `
      <tr>
        <td>${task.room_number} - ${task.room_type}</td>
        <td>${task.cleaner_name || '-'}</td>
        <td>${task.scheduled_time || '-'}</td>
        <td>${task.started_at || '-'}</td>
        <td>${task.completed_at || '-'}</td>
        <td><span class="status-badge ${task.status}">${getStatusText(task.status)}</span></td>
        <td>${task.is_overdue ? '<span style="color: #e74c3c;">是</span>' : '否'}</td>
        <td>
          <div class="action-btns">
            ${task.status === 'pending' ? `
              <button class="btn btn-sm btn-primary" onclick="assignCleaner(${task.id})">分配</button>
              <button class="btn btn-sm btn-success" onclick="startCleaning(${task.id})">开始</button>
            ` : ''}
            ${task.status === 'in_progress' ? 
              `<button class="btn btn-sm btn-success" onclick="completeCleaning(${task.id})">完成</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  }
}

async function assignCleaner(taskId) {
  const cleaners = await apiRequest('/cleaners');
  if (!cleaners.success) return;
  
  const content = `
    <form onsubmit="doAssignCleaner(event, ${taskId})">
      <div class="form-group">
        <label>保洁员 *</label>
        <select name="cleaner_id" required>
          <option value="">请选择保洁员</option>
          ${cleaners.data.map(c => `<option value="${c.id}">${c.name} (${c.phone || '-'})</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>计划时间</label>
        <input type="datetime-local" name="scheduled_time">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">分配</button>
      </div>
    </form>
  `;
  showModal('分配保洁员', content);
}

async function doAssignCleaner(event, taskId) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.cleaner_id = parseInt(data.cleaner_id);
  
  const result = await apiRequest(`/cleaning/${taskId}/assign`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('分配成功', 'success');
    closeModal();
    loadCleaningTasks();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

async function startCleaning(taskId) {
  if (!confirm('确定要开始清洁吗？')) return;
  
  const result = await apiRequest(`/cleaning/${taskId}/start`, {
    method: 'POST'
  });
  
  if (result.success) {
    showToast('开始清洁', 'success');
    loadCleaningTasks();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

async function completeCleaning(taskId) {
  const content = `
    <form onsubmit="doCompleteCleaning(event, ${taskId})">
      <div class="form-group">
        <label>照片URL</label>
        <input type="text" name="photo_url" placeholder="上传照片链接">
      </div>
      <div class="form-group">
        <label>异常情况</label>
        <textarea name="exception" rows="3" placeholder="如有异常请填写"></textarea>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">完成清洁</button>
      </div>
    </form>
  `;
  showModal('完成清洁', content);
}

async function doCompleteCleaning(event, taskId) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  const result = await apiRequest(`/cleaning/${taskId}/complete`, {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('清洁完成', 'success');
    closeModal();
    loadCleaningTasks();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

function showAddCleaningModal() {
  const today = new Date();
  const dateTimeStr = today.toISOString().slice(0, 16);
  
  const content = `
    <form onsubmit="addCleaningTask(event)">
      <div class="form-group">
        <label>房间 *</label>
        <select name="room_id" id="cleaning-room-select" required>
          <option value="">请选择房间</option>
        </select>
      </div>
      <div class="form-group">
        <label>保洁员</label>
        <select name="cleaner_id" id="cleaning-cleaner-select">
          <option value="">暂不分配</option>
        </select>
      </div>
      <div class="form-group">
        <label>计划时间</label>
        <input type="datetime-local" name="scheduled_time" value="${dateTimeStr}">
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">添加</button>
      </div>
    </form>
  `;
  showModal('添加清洁任务', content);
  
  loadCleaningRoomSelect();
  loadCleanerSelect();
}

async function loadCleaningRoomSelect() {
  const data = await apiRequest('/rooms');
  if (data.success) {
    const select = document.getElementById('cleaning-room-select');
    if (select) {
      data.data.forEach(room => {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = `${room.room_number} - ${room.room_type} (${getStatusText(room.status)})`;
        select.appendChild(option);
      });
    }
  }
}

async function loadCleanerSelect() {
  const data = await apiRequest('/cleaners');
  if (data.success) {
    const select = document.getElementById('cleaning-cleaner-select');
    if (select) {
      data.data.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = c.name;
        select.appendChild(option);
      });
    }
  }
}

async function addCleaningTask(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  data.room_id = parseInt(data.room_id);
  if (data.cleaner_id) data.cleaner_id = parseInt(data.cleaner_id);
  
  const result = await apiRequest('/cleaning', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('清洁任务添加成功', 'success');
    closeModal();
    loadCleaningTasks();
  } else {
    showToast(result.message || '添加失败', 'error');
  }
}

async function loadMaintenance() {
  const status = document.getElementById('maintenance-status-filter').value;
  
  let url = '/maintenance';
  if (status) {
    url += `?status=${status}`;
  }
  
  const data = await apiRequest(url);
  if (data.success) {
    const tbody = document.getElementById('maintenance-tbody');
    tbody.innerHTML = data.data.map(order => `
      <tr>
        <td>${order.room_number} - ${order.room_type}</td>
        <td>${order.title}</td>
        <td>${order.description || '-'}</td>
        <td>${order.start_date}</td>
        <td>${order.end_date || '-'}</td>
        <td><span class="status-badge ${order.status}">${getStatusText(order.status)}</span></td>
        <td>
          <div class="action-btns">
            ${order.status !== 'completed' ? 
              `<button class="btn btn-sm btn-success" onclick="completeMaintenance(${order.id})">完成</button>` : ''}
            <button class="btn btn-sm btn-default" onclick="viewMaintenance(${order.id})">详情</button>
          </div>
        </td>
      </tr>
    `).join('');
  }
}

function showAddMaintenanceModal() {
  const today = new Date().toISOString().split('T')[0];
  
  const content = `
    <form onsubmit="addMaintenance(event)">
      <div class="form-group">
        <label>房间 *</label>
        <select name="room_id" id="maintenance-room-select" required>
          <option value="">请选择房间</option>
        </select>
      </div>
      <div class="form-group">
        <label>标题 *</label>
        <input type="text" name="title" required placeholder="如: 空调故障维修">
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea name="description" rows="3"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>开始日期 *</label>
          <input type="date" name="start_date" required value="${today}">
        </div>
        <div class="form-group">
          <label>结束日期</label>
          <input type="date" name="end_date">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="submit" class="btn btn-primary">创建</button>
      </div>
    </form>
  `;
  showModal('创建维修单', content);
  
  loadMaintenanceRoomSelect();
}

async function loadMaintenanceRoomSelect() {
  const data = await apiRequest('/rooms');
  if (data.success) {
    const select = document.getElementById('maintenance-room-select');
    if (select) {
      data.data.forEach(room => {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = `${room.room_number} - ${room.room_type}`;
        select.appendChild(option);
      });
    }
  }
}

async function addMaintenance(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  
  data.room_id = parseInt(data.room_id);
  
  const result = await apiRequest('/maintenance', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  
  if (result.success) {
    showToast('维修单创建成功', 'success');
    closeModal();
    loadMaintenance();
  } else {
    showToast(result.message || '创建失败', 'error');
  }
}

async function viewMaintenance(id) {
  const data = await apiRequest(`/maintenance/${id}`);
  if (data.success) {
    const m = data.data;
    const content = `
      <div style="line-height: 2;">
        <p><strong>房间:</strong> ${m.room_number} - ${m.room_type}</p>
        <p><strong>标题:</strong> ${m.title}</p>
        <p><strong>状态:</strong> <span class="status-badge ${m.status}">${getStatusText(m.status)}</span></p>
        <p><strong>开始日期:</strong> ${m.start_date}</p>
        <p><strong>结束日期:</strong> ${m.end_date || '-'}</p>
        <p><strong>描述:</strong> ${m.description || '-'}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-default" onclick="closeModal()">关闭</button>
      </div>
    `;
    showModal('维修单详情', content);
  }
}

async function completeMaintenance(id) {
  const content = `
    <div class="form-group">
      <label style="display: flex; align-items: center; gap: 10px;">
        <input type="checkbox" id="return-to-cleaning" checked>
        维修完成后转为待清洁
      </label>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
      <button type="button" class="btn btn-primary" onclick="doCompleteMaintenance(${id})">确认完成</button>
    </div>
  `;
  showModal('完成维修', content);
}

async function doCompleteMaintenance(id) {
  const returnToCleaning = document.getElementById('return-to-cleaning').checked;
  
  const result = await apiRequest(`/maintenance/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ return_to_cleaning: returnToCleaning })
  });
  
  if (result.success) {
    showToast('维修已完成', 'success');
    closeModal();
    loadMaintenance();
  } else {
    showToast(result.message || '操作失败', 'error');
  }
}

async function loadStats() {
  const [occupancy, channelStats, cleanerStats, maintenanceStats] = await Promise.all([
    apiRequest('/stats/occupancy'),
    apiRequest('/stats/channel-stats'),
    apiRequest('/stats/cleaner-workload'),
    apiRequest('/stats/maintenance-days')
  ]);
  
  if (occupancy.success) {
    const d = occupancy.data;
    document.getElementById('occupancy-rate').textContent = d.occupancy_rate + '%';
    document.getElementById('revpar').textContent = '¥' + d.revpar;
    document.getElementById('adr').textContent = '¥' + d.adr;
    document.getElementById('stats-period').textContent = d.start_date + ' 至 ' + d.end_date;
    document.getElementById('total-room-nights').textContent = d.total_room_nights;
    document.getElementById('total-revenue').textContent = '¥' + d.total_revenue;
  }
  
  if (channelStats.success) {
    const container = document.getElementById('channel-stats');
    const maxCount = Math.max(...channelStats.data.map(c => c.order_count), 1);
    
    container.innerHTML = channelStats.data.map(c => `
      <div class="channel-item">
        <span class="channel-name">${c.channel_name}</span>
        <div class="channel-bar"><div class="channel-fill" style="width: ${(c.order_count / maxCount * 100)}%"></div></div>
        <span class="channel-count">${c.order_count}单 (${c.percentage}%)</span>
      </div>
    `).join('');
  }
  
  if (cleanerStats.success) {
    const container = document.getElementById('cleaner-stats');
    container.innerHTML = cleanerStats.data.map(c => `
      <div class="cleaner-item">
        <div class="cleaner-avatar">${c.name.charAt(0)}</div>
        <div class="cleaner-info">
          <div class="cleaner-name">${c.name}</div>
          <div class="cleaner-stats">完成 ${c.completed_tasks} 单 | 共 ${c.total_tasks} 单 | 超时 ${c.overdue_tasks} 单</div>
        </div>
      </div>
    `).join('');
  }
  
  if (maintenanceStats.success) {
    const d = maintenanceStats.data;
    document.getElementById('maintenance-days').textContent = d.total_maintenance_days;
    document.getElementById('maintenance-count').textContent = d.total_orders;
    
    const container = document.getElementById('maintenance-stats');
    if (d.room_stats && d.room_stats.length > 0) {
      container.innerHTML = `
        <h4 style="margin-top: 15px; font-size: 14px;">房间停房排行</h4>
        <div style="margin-top: 10px;">
          ${d.room_stats.slice(0, 5).map(r => `
            <div style="display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px;">
              <span>${r.room_number}</span>
              <span>${r.days}天 (${r.count}次)</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  }
}

function changeCalendarPeriod(offset) {
  const viewType = parseInt(document.getElementById('calendar-view-type').value) || 30;
  calendarStartDate.setDate(calendarStartDate.getDate() + offset * viewType);
  loadCalendar();
}

function changeCalendarView() {
  calendarStartDate = new Date();
  loadCalendar();
}

function goToToday() {
  calendarStartDate = new Date();
  loadCalendar();
}

async function loadCalendar() {
  const viewType = parseInt(document.getElementById('calendar-view-type').value) || 30;
  const roomFilter = document.getElementById('calendar-room-filter').value;
  const startStr = calendarStartDate.toISOString().split('T')[0];
  
  const data = await apiRequest(`/calendar/inventory?start_date=${startStr}&days=${viewType}`);
  
  if (data.success) {
    const result = data.data;
    const calendar = result.calendar;
    calendarRooms = result.rooms;
    calendarRoomTypes = result.room_types;
    
    const roomTypeFilter = document.getElementById('calendar-room-filter');
    const currentValue = roomTypeFilter.value;
    roomTypeFilter.innerHTML = '<option value="">全部房型</option>';
    calendarRoomTypes.forEach(type => {
      roomTypeFilter.innerHTML += `<option value="${type}" ${currentValue === type ? 'selected' : ''}>${type}</option>`;
    });
    
    document.getElementById('calendar-date-range').textContent = `${result.start_date} 至 ${result.end_date} (${result.total_days}天)`;
    
    const container = document.getElementById('calendar-table');
    
    if (calendar.length === 0) {
      container.innerHTML = '<p>暂无数据</p>';
      return;
    }
    
    let filteredRooms = calendarRooms;
    if (roomFilter) {
      filteredRooms = calendarRooms.filter(r => r.room_type === roomFilter);
    }
    
    const days = calendar.length;
    const rooms = filteredRooms.length;
    
    let html = '';
    
    html += '<div class="calendar-header" style="grid-template-columns: 100px repeat(' + days + ', 1fr);">';
    html += '<div class="calendar-header-cell">房间</div>';
    calendar.forEach(day => {
      let headerClass = '';
      if (day.is_holiday) headerClass = 'holiday';
      else if (day.is_weekend) headerClass = 'weekend';
      
      html += `
        <div class="calendar-header-cell ${headerClass}">
          <div class="calendar-date">${day.date.slice(5)}</div>
          <div class="calendar-weekday">${day.weekday}</div>
          ${day.holiday_name ? `<div class="calendar-cell-holiday">${day.holiday_name}</div>` : ''}
        </div>
      `;
    });
    html += '</div>';
    
    for (let i = 0; i < rooms; i++) {
      const room = filteredRooms[i];
      html += '<div class="calendar-row" style="grid-template-columns: 100px repeat(' + days + ', 1fr);">';
      html += `<div class="calendar-room-cell">${room.room_number}<br><span style="font-size:10px;color:#999;">${room.room_type}</span></div>`;
      
      calendar.forEach(day => {
        const roomData = day.rooms.find(r => r.room_id === room.id);
        if (!roomData) return;
        
        const statusClass = roomData.status;
        const guestName = roomData.booking ? roomData.booking.guest_name : '';
        
        let cellClass = statusClass;
        if (day.is_holiday) cellClass += ' holiday';
        else if (day.is_weekend) cellClass += ' weekend';
        
        let priceDisplay = '';
        if (statusClass === 'available' || statusClass === 'booked' || statusClass === 'occupied') {
          const priceClass = roomData.price !== room.base_price ? 'color: #e74c3c;' : 'color: #2ecc71;';
          priceDisplay = `<div class="calendar-cell-price" style="${priceClass}">¥${roomData.price}</div>`;
        }
        
        html += `
          <div class="calendar-cell ${cellClass} calendar-cell-clickable" 
               onclick="showCalendarCellDetail(${room.id}, '${day.date}')"
               title="${roomData.status_text}${guestName ? ' - ' + guestName : ''}${day.holiday_name ? ' - ' + day.holiday_name : ''}">
            <div class="calendar-cell-info">${roomData.status_text}</div>
            ${guestName ? `<div class="calendar-cell-guest">${guestName}</div>` : ''}
            ${priceDisplay}
          </div>
        `;
      });
      
      html += '</div>';
    }
    
    container.innerHTML = html;
  }
}

async function showCalendarCellDetail(roomId, date) {
  const data = await apiRequest(`/calendar/room/${roomId}/date/${date}`);
  
  if (data.success) {
    const detail = data.data;
    const room = detail.room;
    
    const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const weekday = weekdayNames[detail.weekday] || '';
    
    let tagsHtml = '';
    if (detail.is_holiday) tagsHtml += `<span class="price-tag holiday">节假日${detail.holiday ? ' - ' + detail.holiday.name : ''}</span>`;
    if (detail.is_weekend) tagsHtml += `<span class="price-tag weekend">周末</span>`;
    if (detail.rule) tagsHtml += `<span class="price-tag rule">${detail.rule.name || detail.rule.price_type}</span>`;
    
    let bookingsHtml = '';
    if (detail.bookings && detail.bookings.length > 0) {
      bookingsHtml = detail.bookings.map(b => `
        <div class="detail-card">
          <div class="detail-card-header">
            <span>${b.booking_no}</span>
            <span class="badge ${b.status}">${getStatusText(b.status)}</span>
          </div>
          <div class="detail-card-body">
            <p>入住人: ${b.guest_name} ${b.guest_phone || ''}</p>
            <p>入住: ${b.checkin_date} 至 ${b.checkout_date}</p>
            <p>金额: ¥${b.total_amount} | 渠道: ${getChannelText(b.channel)}</p>
          </div>
        </div>
      `).join('');
    } else {
      bookingsHtml = '<div class="detail-empty">暂无订单</div>';
    }
    
    let maintenancesHtml = '';
    if (detail.maintenances && detail.maintenances.length > 0) {
      maintenancesHtml = detail.maintenances.map(m => `
        <div class="detail-card">
          <div class="detail-card-header">
            <span>${m.title}</span>
            <span class="badge ${m.status}">${getStatusText(m.status)}</span>
          </div>
          <div class="detail-card-body">
            <p>${m.description || '无描述'}</p>
            <p>时间: ${m.start_date} 至 ${m.end_date || '无结束日期'}</p>
          </div>
        </div>
      `).join('');
    } else {
      maintenancesHtml = '<div class="detail-empty">暂无维修单</div>';
    }
    
    let cleaningsHtml = '';
    if (detail.cleanings && detail.cleanings.length > 0) {
      cleaningsHtml = detail.cleanings.map(c => `
        <div class="detail-card">
          <div class="detail-card-header">
            <span>清洁任务 #${c.id}</span>
            <span class="badge ${c.status}">${getStatusText(c.status)}</span>
          </div>
          <div class="detail-card-body">
            <p>保洁员: ${c.cleaner_name || '未分配'}</p>
            <p>计划时间: ${c.scheduled_time || '-'}</p>
            ${c.exception ? `<p>异常: ${c.exception}</p>` : ''}
          </div>
        </div>
      `).join('');
    } else {
      cleaningsHtml = '<div class="detail-empty">暂无清洁任务</div>';
    }
    
    const priceClass = detail.price !== detail.base_price ? 'color: #e74c3c;' : 'color: #333;';
    
    const content = `
      <div class="calendar-detail-header">
        <h3>${room.room_number} - ${room.room_type} | ${date} ${weekday}</h3>
        <div class="calendar-detail-info">
          <span>房态: <span class="status-badge ${detail.status}">${detail.status_text}</span></span>
          <span>房价: <strong style="${priceClass}">¥${detail.price}</strong> / 晚 (基础价: ¥${detail.base_price})</span>
          <span>${tagsHtml}</span>
        </div>
      </div>
      
      <div class="detail-section">
        <h4>📝 预订订单</h4>
        ${bookingsHtml}
      </div>
      
      <div class="detail-section">
        <h4>🔧 维修单</h4>
        ${maintenancesHtml}
      </div>
      
      <div class="detail-section">
        <h4>🧹 清洁任务</h4>
        ${cleaningsHtml}
      </div>
      
      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">关闭</button>
        ${detail.status === 'available' ? `<button type="button" class="btn btn-primary" onclick="closeModal(); quickBook(${room.id})">快速预订</button>` : ''}
      </div>
    `;
    
    showModal('房态详情', content);
  }
}

async function showBatchPricingModal() {
  if (calendarRooms.length === 0) {
    const data = await apiRequest('/rooms');
    if (data.success) {
      calendarRooms = data.data;
      calendarRoomTypes = [...new Set(calendarRooms.map(r => r.room_type))];
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().split('T')[0];

  const roomTypeOptions = calendarRoomTypes.map(t => 
    `<option value="${t}">${t}</option>`
  ).join('');

  const roomOptions = calendarRooms.map(r => 
    `<div class="room-select-item" data-room-id="${r.id}">
      <input type="checkbox" id="room-${r.id}" value="${r.id}">
      <label for="room-${r.id}">${r.room_number} - ${r.room_type}</label>
    </div>`
  ).join('');

  const content = `
    <form id="batch-pricing-form" onsubmit="saveBatchPricing(event)">
      <div class="form-group">
        <label>选择方式</label>
        <select name="select_type" id="select-type" onchange="toggleRoomSelection()">
          <option value="room_type">按房型</option>
          <option value="rooms">按房间</option>
        </select>
      </div>

      <div class="form-group" id="room-type-group">
        <label>房型</label>
        <select name="room_type">
          <option value="">请选择房型</option>
          ${roomTypeOptions}
        </select>
      </div>

      <div class="form-group" id="rooms-group" style="display: none;">
        <label>选择房间</label>
        <div class="room-select-grid" id="room-select-grid">
          ${roomOptions}
        </div>
        <div style="margin-top: 5px;">
          <button type="button" class="btn btn-sm btn-default" onclick="selectAllRooms(true)">全选</button>
          <button type="button" class="btn btn-sm btn-default" onclick="selectAllRooms(false)">全不选</button>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>开始日期 *</label>
          <input type="date" name="start_date" value="${today}" required>
        </div>
        <div class="form-group">
          <label>结束日期 *</label>
          <input type="date" name="end_date" value="${nextMonthStr}" required>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>价格类型</label>
          <select name="price_type">
            <option value="seasonal">季节价</option>
            <option value="temporary">临时价</option>
          </select>
        </div>
        <div class="form-group">
          <label>价格(元/晚) *</label>
          <input type="number" name="price" required min="0" step="0.01" placeholder="请输入价格">
        </div>
      </div>

      <div class="form-group">
        <label>规则名称</label>
        <input type="text" name="name" placeholder="如: 暑期旺季、周末加价等">
      </div>

      <div class="form-group">
        <label class="section-title">适用时间</label>
        <div class="checkbox-group">
          <div class="checkbox-item">
            <input type="checkbox" name="apply_weekend" id="apply-weekend">
            <label for="apply-weekend">仅周末（周六、周日）</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="apply_holiday" id="apply-holiday">
            <label for="apply-holiday">仅节假日</label>
          </div>
        </div>
        <div class="checkbox-group" id="weekday-group">
          <label class="section-title" style="width: 100%;">或选择具体星期：</label>
          <div class="checkbox-item">
            <input type="checkbox" name="weekdays" value="1" id="wd-1">
            <label for="wd-1">周一</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="weekdays" value="2" id="wd-2">
            <label for="wd-2">周二</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="weekdays" value="3" id="wd-3">
            <label for="wd-3">周三</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="weekdays" value="4" id="wd-4">
            <label for="wd-4">周四</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="weekdays" value="5" id="wd-5">
            <label for="wd-5">周五</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="weekdays" value="6" id="wd-6">
            <label for="wd-6">周六</label>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="weekdays" value="7" id="wd-7">
            <label for="wd-7">周日</label>
          </div>
        </div>
      </div>

      <div id="price-preview"></div>

      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="button" class="btn btn-info" onclick="previewPricing()">预览价格</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `;

  showModal('批量调价', content);

  setTimeout(() => {
    document.querySelectorAll('#room-select-grid .room-select-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const checkbox = item.querySelector('input[type="checkbox"]');
          checkbox.checked = !checkbox.checked;
          item.classList.toggle('selected', checkbox.checked);
        } else {
          item.classList.toggle('selected', e.target.checked);
        }
      });
    });
  }, 100);
}

function toggleRoomSelection() {
  const selectType = document.getElementById('select-type').value;
  document.getElementById('room-type-group').style.display = selectType === 'room_type' ? 'block' : 'none';
  document.getElementById('rooms-group').style.display = selectType === 'rooms' ? 'block' : 'none';
}

function selectAllRooms(select) {
  document.querySelectorAll('#room-select-grid input[type="checkbox"]').forEach(cb => {
    cb.checked = select;
    const item = cb.closest('.room-select-item');
    if (item) {
      item.classList.toggle('selected', select);
    }
  });
}

async function previewPricing() {
  const form = document.getElementById('batch-pricing-form');
  const formData = new FormData(form);
  
  const startDate = formData.get('start_date');
  const endDate = formData.get('end_date');
  const price = parseFloat(formData.get('price'));
  const selectType = formData.get('select_type');
  const roomType = formData.get('room_type');
  
  if (!startDate || !endDate || !price) {
    showToast('请填写完整的日期和价格', 'warning');
    return;
  }

  let previewRoomId = null;
  if (selectType === 'room_type' && roomType) {
    const room = calendarRooms.find(r => r.room_type === roomType);
    if (room) previewRoomId = room.id;
  } else if (selectType === 'rooms') {
    const selectedRooms = Array.from(form.querySelectorAll('#room-select-grid input[type="checkbox"]:checked')).map(cb => cb.value);
    if (selectedRooms.length > 0) {
      previewRoomId = selectedRooms[0];
    }
  }

  if (!previewRoomId) {
    showToast('请先选择房型或房间', 'warning');
    return;
  }

  const previewData = await apiRequest('/calendar/calculate-price', {
    method: 'POST',
    body: JSON.stringify({
      room_id: previewRoomId,
      checkin_date: startDate,
      checkout_date: endDate
    })
  });

  const previewContainer = document.getElementById('price-preview');
  
  if (previewData.success && previewData.data.details) {
    const details = previewData.data.details;
    const detailsHtml = details.map(d => {
      let tags = '';
      if (d.is_holiday) tags += '<span class="price-tag holiday">节假日</span>';
      if (d.is_weekend) tags += '<span class="price-tag weekend">周末</span>';
      
      const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      
      return `
        <div class="price-breakdown-row">
          <span class="date">${d.date} ${weekdayNames[d.weekday] || ''}</span>
          <span>
            ${tags}
            <span class="price">¥${d.price}</span>
          </span>
        </div>
      `;
    }).join('');

    previewContainer.innerHTML = `
      <div class="price-breakdown">
        <h4>价格预览（以第一个选中房间为例）</h4>
        <div class="price-breakdown-table">
          ${detailsHtml}
        </div>
        <div class="price-total-row">
          <span>${previewData.data.nights}晚总价</span>
          <span>¥${previewData.data.total.toFixed(2)}</span>
        </div>
      </div>
    `;
  }
}

async function saveBatchPricing(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  
  const selectType = formData.get('select_type');
  const startDate = formData.get('start_date');
  const endDate = formData.get('end_date');
  const price = parseFloat(formData.get('price'));
  const priceType = formData.get('price_type');
  const name = formData.get('name');
  const applyWeekend = form.querySelector('[name="apply_weekend"]').checked;
  const applyHoliday = form.querySelector('[name="apply_holiday"]').checked;
  
  const weekdays = Array.from(form.querySelectorAll('[name="weekdays"]:checked')).map(cb => parseInt(cb.value));
  
  let roomIds = [];
  let roomType = null;
  
  if (selectType === 'room_type') {
    roomType = formData.get('room_type');
    if (!roomType) {
      showToast('请选择房型', 'warning');
      return;
    }
  } else {
    roomIds = Array.from(form.querySelectorAll('#room-select-grid input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
    if (roomIds.length === 0) {
      showToast('请选择至少一个房间', 'warning');
      return;
    }
  }

  if (!startDate || !endDate || !price) {
    showToast('请填写完整信息', 'warning');
    return;
  }

  if (priceType === 'temporary' && !name) {
    showToast('临时价需要填写规则名称', 'warning');
    return;
  }

  const requestData = {
    start_date: startDate,
    end_date: endDate,
    price: price,
    price_type: priceType,
    name: name,
    apply_weekend: applyWeekend,
    apply_holiday: applyHoliday,
    apply_weekdays: weekdays.length > 0 ? weekdays : null
  };

  if (roomType) {
    requestData.room_type = roomType;
  } else {
    requestData.room_ids = roomIds;
  }

  const result = await apiRequest('/calendar/pricing/batch', {
    method: 'POST',
    body: JSON.stringify(requestData)
  });

  if (result.success) {
    showToast(result.data.message, 'success');
    closeModal();
    loadCalendar();
  } else {
    showToast(result.message || '保存失败', 'error');
  }
}

async function showBatchStatusModal() {
  if (calendarRooms.length === 0) {
    const data = await apiRequest('/rooms');
    if (data.success) {
      calendarRooms = data.data;
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  const roomOptions = calendarRooms
    .filter(r => r.status !== 'out_of_service')
    .map(r => 
    `<div class="room-select-item" data-room-id="${r.id}">
      <input type="checkbox" id="status-room-${r.id}" value="${r.id}">
      <label for="status-room-${r.id}">${r.room_number} - ${r.room_type} (${getStatusText(r.status)})</label>
    </div>`
  ).join('');

  const content = `
    <form id="batch-status-form" onsubmit="saveBatchStatus(event)">
      <div class="form-group">
        <label>选择房间 *</label>
        <div class="room-select-grid" id="status-room-grid">
          ${roomOptions}
        </div>
        <div style="margin-top: 5px;">
          <button type="button" class="btn btn-sm btn-default" onclick="selectAllStatusRooms(true)">全选</button>
          <button type="button" class="btn btn-sm btn-default" onclick="selectAllStatusRooms(false)">全不选</button>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label>开始日期 *</label>
          <input type="date" name="start_date" value="${today}" required>
        </div>
        <div class="form-group">
          <label>结束日期 *</label>
          <input type="date" name="end_date" value="${nextWeekStr}" required>
        </div>
      </div>

      <div class="form-group">
        <label>设置状态 *</label>
        <select name="status" required>
          <option value="">请选择</option>
          <option value="maintenance">维修</option>
          <option value="out_of_service">停用</option>
        </select>
      </div>

      <div class="form-group">
        <label>原因</label>
        <input type="text" name="reason" placeholder="请输入原因">
      </div>

      <div id="conflict-alert" style="display: none;"></div>

      <div class="modal-footer">
        <button type="button" class="btn btn-default" onclick="closeModal()">取消</button>
        <button type="button" class="btn btn-warning" onclick="checkBatchStatusConflicts()">检查冲突</button>
        <button type="submit" class="btn btn-primary">保存</button>
      </div>
    </form>
  `;

  showModal('批量房态管理', content);

  setTimeout(() => {
    document.querySelectorAll('#status-room-grid .room-select-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const checkbox = item.querySelector('input[type="checkbox"]');
          checkbox.checked = !checkbox.checked;
          item.classList.toggle('selected', checkbox.checked);
        } else {
          item.classList.toggle('selected', e.target.checked);
        }
      });
    });
  }, 100);
}

function selectAllStatusRooms(select) {
  document.querySelectorAll('#status-room-grid input[type="checkbox"]').forEach(cb => {
    cb.checked = select;
    const item = cb.closest('.room-select-item');
    if (item) {
      item.classList.toggle('selected', select);
    }
  });
}

async function checkBatchStatusConflicts() {
  const form = document.getElementById('batch-status-form');
  const formData = new FormData(form);
  
  const roomIds = Array.from(form.querySelectorAll('#status-room-grid input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
  const startDate = formData.get('start_date');
  const endDate = formData.get('end_date');
  const status = formData.get('status');
  
  if (roomIds.length === 0 || !startDate || !endDate || !status) {
    showToast('请填写完整信息', 'warning');
    return;
  }

  const conflictApi = status === 'maintenance' 
    ? '/maintenance/check-conflicts' 
    : '/calendar/check-conflicts';

  const result = await apiRequest(conflictApi, {
    method: 'POST',
    body: JSON.stringify({
      room_ids: roomIds,
      start_date: startDate,
      end_date: endDate,
      operation_type: status
    })
  });

  const alertDiv = document.getElementById('conflict-alert');
  
  if (result.success && result.data.has_conflicts) {
    const conflicts = result.data.conflicts;
    const conflictsHtml = conflicts.map(c => `
      <div class="conflict-item">
        <div class="conflict-item-header">
          <span>${c.room_number} - ${c.guest_name}</span>
          <span class="badge ${c.status}">${getStatusText(c.status)}</span>
        </div>
        <div class="conflict-item-details">
          <span>订单: ${c.booking_no}</span>
          <span>${c.checkin_date} 至 ${c.checkout_date}</span>
          <span>¥${c.total_amount}</span>
        </div>
      </div>
    `).join('');

    alertDiv.innerHTML = `
      <div class="conflict-alert">
        <h4>⚠️ 发现 ${conflicts.length} 个冲突订单</h4>
        <p style="font-size: 12px; color: #666; margin-bottom: 10px;">
          以下订单与您设置的${status === 'maintenance' ? '维修' : '停用'}区间冲突，请先处理这些订单再继续。
        </p>
        <div class="conflict-list">
          ${conflictsHtml}
        </div>
      </div>
    `;
    alertDiv.style.display = 'block';
    showToast(`发现 ${conflicts.length} 个冲突订单`, 'warning');
  } else {
    alertDiv.innerHTML = `
      <div class="conflict-alert" style="background: #e8f5e9; border-color: #4caf50;">
        <h4 style="color: #2e7d32;">✅ 没有发现冲突</h4>
        <p style="font-size: 12px; color: #666;">您可以安全地保存设置。</p>
      </div>
    `;
    alertDiv.style.display = 'block';
    showToast('没有发现冲突', 'success');
  }
}

async function saveBatchStatus(event) {
  event.preventDefault();
  const form = event.target;
  const formData = new FormData(form);
  
  const roomIds = Array.from(form.querySelectorAll('#status-room-grid input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
  const startDate = formData.get('start_date');
  const endDate = formData.get('end_date');
  const status = formData.get('status');
  const reason = formData.get('reason');
  
  if (roomIds.length === 0 || !startDate || !endDate || !status) {
    showToast('请填写完整信息', 'warning');
    return;
  }

  let result;
  
  if (status === 'maintenance' && roomIds.length === 1) {
    result = await apiRequest('/maintenance', {
      method: 'POST',
      body: JSON.stringify({
        room_id: roomIds[0],
        title: reason || '批量维修',
        description: reason || '批量设置维修状态',
        start_date: startDate,
        end_date: endDate,
        check_conflicts: true
      })
    });
  } else {
    result = await apiRequest('/calendar/batch-status', {
      method: 'POST',
      body: JSON.stringify({
        room_ids: roomIds,
        start_date: startDate,
        end_date: endDate,
        status: status,
        reason: reason,
        check_conflicts: true
      })
    });
  }

  if (!result.success && result.conflicts && result.conflicts.length > 0) {
    const conflicts = result.conflicts;
    const conflictsHtml = conflicts.map(c => `
      <div class="conflict-item">
        <div class="conflict-item-header">
          <span>${c.room_number} - ${c.guest_name}</span>
          <span class="badge ${c.status}">${getStatusText(c.status)}</span>
        </div>
        <div class="conflict-item-details">
          <span>订单: ${c.booking_no}</span>
          <span>${c.checkin_date} 至 ${c.checkout_date}</span>
        </div>
      </div>
    `).join('');

    const alertDiv = document.getElementById('conflict-alert');
    alertDiv.innerHTML = `
      <div class="conflict-alert">
        <h4>⚠️ 保存失败！存在 ${conflicts.length} 个冲突订单</h4>
        <p style="font-size: 12px; color: #666; margin-bottom: 10px;">
          ${result.message}
        </p>
        <div class="conflict-list">
          ${conflictsHtml}
        </div>
      </div>
    `;
    alertDiv.style.display = 'block';
    return;
  }

  if (result.success) {
    showToast(result.data?.message || '保存成功', 'success');
    closeModal();
    loadCalendar();
    loadDashboard();
  } else {
    showToast(result.message || '保存失败', 'error');
  }
}

async function updateBookingPricePreview() {
  const roomId = document.querySelector('[name="room_id"]')?.value;
  const checkinDate = document.querySelector('[name="checkin_date"]')?.value;
  const checkoutDate = document.querySelector('[name="checkout_date"]')?.value;
  
  if (!roomId || !checkinDate || !checkoutDate) return;

  const result = await apiRequest('/bookings/check-conflict', {
    method: 'POST',
    body: JSON.stringify({
      room_id: parseInt(roomId),
      checkin_date: checkinDate,
      checkout_date: checkoutDate
    })
  });

  const pricePreviewDiv = document.getElementById('booking-price-preview');
  if (!pricePreviewDiv) return;

  if (result.success && result.data.price_details) {
    const details = result.data.price_details;
    const weekdayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    
    const detailsHtml = details.map(d => {
      let tags = '';
      if (d.is_holiday) tags += '<span class="price-tag holiday">节假日</span>';
      if (d.is_weekend) tags += '<span class="price-tag weekend">周末</span>';
      
      return `
        <div class="price-breakdown-row">
          <span class="date">${d.date} ${weekdayNames[d.weekday] || ''}</span>
          <span>
            ${tags}
            <span class="price">¥${d.price}</span>
          </span>
        </div>
      `;
    }).join('');

    pricePreviewDiv.innerHTML = `
      <div class="price-breakdown">
        <h4>价格明细 (${result.data.nights}晚)</h4>
        <div class="price-breakdown-table">
          ${detailsHtml}
        </div>
        <div class="price-total-row">
          <span>总价</span>
          <span>¥${result.data.total_price.toFixed(2)}</span>
        </div>
      </div>
    `;

    const totalAmountInput = document.querySelector('[name="total_amount"]');
    if (totalAmountInput) {
      totalAmountInput.value = result.data.total_price.toFixed(2);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
