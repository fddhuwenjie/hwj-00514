const API_BASE = 'http://localhost:8514/api';

let currentPage = 'dashboard';
let calendarStartDate = new Date();
let currentCheckinTab = 'checkins';

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
    
    if (data.data.available) {
      hint.textContent = `可预订，${data.data.nights}晚，预估总价: ¥${data.data.total_price}`;
      hint.style.color = '#2ecc71';
      if (!amountInput.value) {
        amountInput.value = data.data.total_price;
      }
    } else {
      hint.textContent = '该时间段房间不可预订';
      hint.style.color = '#e74c3c';
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

function changeCalendarWeek(offset) {
  calendarStartDate.setDate(calendarStartDate.getDate() + offset * 7);
  loadCalendar();
}

function goToToday() {
  calendarStartDate = new Date();
  loadCalendar();
}

async function loadCalendar() {
  const start = new Date(calendarStartDate);
  const end = new Date(calendarStartDate);
  end.setDate(end.getDate() + 13);
  
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];
  
  document.getElementById('calendar-date-range').textContent = `${startStr} 至 ${endStr}`;
  
  const data = await apiRequest(`/stats/room-calendar?start_date=${startStr}&end_date=${endStr}`);
  
  if (data.success) {
    const calendar = data.data;
    const container = document.getElementById('calendar-table');
    
    if (calendar.length === 0) {
      container.innerHTML = '<p>暂无数据</p>';
      return;
    }
    
    const days = calendar.length;
    const rooms = calendar[0].rooms.length;
    
    let html = '';
    
    html += '<div class="calendar-header" style="grid-template-columns: 100px repeat(' + days + ', 1fr);">';
    html += '<div class="calendar-header-cell">房间</div>';
    calendar.forEach(day => {
      html += `
        <div class="calendar-header-cell">
          <div class="calendar-date">${day.date.slice(5)}</div>
          <div class="calendar-weekday">${day.weekday}</div>
        </div>
      `;
    });
    html += '</div>';
    
    for (let i = 0; i < rooms; i++) {
      html += '<div class="calendar-row" style="grid-template-columns: 100px repeat(' + days + ', 1fr);">';
      html += `<div class="calendar-room-cell">${calendar[0].rooms[i].room_number}</div>`;
      
      calendar.forEach(day => {
        const roomData = day.rooms[i];
        const statusClass = roomData.status;
        const guestName = roomData.booking ? roomData.booking.guest_name : '';
        
        html += `
          <div class="calendar-cell ${statusClass}" title="${roomData.status_text}${guestName ? ' - ' + guestName : ''}">
            <div class="calendar-cell-info">${roomData.status_text}</div>
            ${guestName ? `<div class="calendar-cell-guest">${guestName}</div>` : ''}
          </div>
        `;
      });
      
      html += '</div>';
    }
    
    container.innerHTML = html;
  }
}

document.addEventListener('DOMContentLoaded', init);
