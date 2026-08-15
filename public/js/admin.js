const Admin = {
  token: localStorage.getItem('admin_token') || '',
  products: [],
  orders: [],
  categories: [],
  editingId: null,

  init() {
    this.bindEvents();
    this.checkAuth();
  },

  bindEvents() {
    document.getElementById('login-btn').addEventListener('click', () => this.login());
    document.getElementById('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.login();
    });
    document.getElementById('logout-btn').addEventListener('click', () => this.logout());

    document.querySelectorAll('.sidebar nav a').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.showView(a.dataset.view);
      });
    });

    document.getElementById('add-product-btn').addEventListener('click', () => this.openModal());
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-cancel').addEventListener('click', () => this.closeModal());
    document.getElementById('product-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
    document.getElementById('product-form').addEventListener('submit', (e) => this.saveProduct(e));
    document.getElementById('add-img-btn').addEventListener('click', () => this.addImageRow(''));

    document.getElementById('save-store-btn').addEventListener('click', () => this.saveStore());
    document.getElementById('save-pwd-btn').addEventListener('click', () => this.changePassword());

    document.getElementById('orders-table').addEventListener('change', (e) => {
      if (e.target.classList.contains('status-sel')) this.updateStatus(e.target);
    });
  },

  async api(path, opts = {}) {
    const headers = { 'x-auth-token': this.token, ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch('/api/admin' + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') {
      this.logout(true);
      throw new Error('Session expired');
    }
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  async login() {
    const password = document.getElementById('login-password').value;
    const err = document.getElementById('login-error');
    err.textContent = '';
    try {
      const data = await this.api('/login', {
        method: 'POST',
        body: { password }
      });
      this.token = data.token;
      localStorage.setItem('admin_token', this.token);
      this.enterDashboard();
    } catch (e) {
      err.textContent = e.message || 'Login failed';
    }
  },

  logout(silent) {
    if (this.token && !silent) this.api('/logout', { method: 'POST' }).catch(() => {});
    this.token = '';
    localStorage.removeItem('admin_token');
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-password').value = '';
  },

  checkAuth() {
    if (!this.token) {
      document.getElementById('login-screen').style.display = 'flex';
      return;
    }
    this.api('/stats').then(() => this.enterDashboard())
      .catch(() => this.logout(true));
  },

  enterDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'flex';
    this.loadAll();
    this.showView('products');
  },

  showView(view) {
    document.querySelectorAll('.sidebar nav a').forEach((a) =>
      a.classList.toggle('active', a.dataset.view === view));
    const titles = { products: 'Products', orders: 'Orders', settings: 'Settings' };
    document.getElementById('page-title').textContent = titles[view];
    document.getElementById('view-products').style.display = view === 'products' ? 'block' : 'none';
    document.getElementById('view-orders').style.display = view === 'orders' ? 'block' : 'none';
    document.getElementById('view-settings').style.display = view === 'settings' ? 'block' : 'none';
    if (view === 'settings') this.loadSettings();
    if (view === 'orders') this.renderOrders();
  },

  async loadAll() {
    try {
      const [stats, products, orders, store] = await Promise.all([
        this.api('/stats'),
        this.api('/products'),
        this.api('/orders'),
        fetch('/api/store').then((r) => r.json())
      ]);
      this.products = products;
      this.orders = orders;
      this.categories = store.categories;
      this.renderStats(stats);
      this.renderProducts();
      this.renderOrders();
      this.fillCategorySelect();
    } catch (e) {
      this.toast(e.message, true);
    }
  },

  renderStats(stats) {
    document.getElementById('stats-cards').innerHTML = `
      <div class="card"><div class="label">Products</div><div class="value">${stats.products}</div></div>
      <div class="card"><div class="label">Categories</div><div class="value">${stats.categories}</div></div>
      <div class="card"><div class="label">Total Orders</div><div class="value">${stats.orders}</div></div>
      <div class="card"><div class="label">Pending Orders</div><div class="value">${stats.pendingOrders}</div></div>
      <div class="card"><div class="label">Revenue</div><div class="value">Rs.${Number(stats.revenue).toLocaleString()}</div></div>`;
  },

  renderProducts() {
    const tbody = document.getElementById('products-table');
    if (!this.products.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">No products yet. Click "Add Product".</td></tr>`;
      return;
    }
    tbody.innerHTML = this.products.map((p) => {
      const stock = p.inStock
        ? '<span class="pill green">In stock</span>'
        : '<span class="pill red">Sold out</span>';
      return `<tr>
        <td><img class="thumb" src="${p.images[0] || ''}" onerror="this.style.visibility='hidden'"></td>
        <td style="font-weight:600;max-width:280px">${p.name}</td>
        <td>${this.categories.find((c) => c.slug === p.category)?.name || p.category}</td>
        <td>Rs.${p.price.toLocaleString()}</td>
        <td>${p.compareAt ? 'Rs.' + p.compareAt.toLocaleString() : '&mdash;'}</td>
        <td>${stock}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn sm outline" onclick="Admin.openModal('${p.id}')">Edit</button>
          <button class="btn sm danger outline" onclick="Admin.deleteProduct('${p.id}')">Delete</button>
        </td>
      </tr>`;
    }).join('');
  },

  fillCategorySelect() {
    const sel = document.getElementById('f-category');
    sel.innerHTML = this.categories.map((c) => `<option value="${c.slug}">${c.name}</option>`).join('');
  },

  /* ---- Product modal ---- */
  openModal(id) {
    this.editingId = id || null;
    const p = id ? this.products.find((x) => x.id === id) : null;
    document.getElementById('modal-title').textContent = p ? 'Edit Product' : 'Add Product';
    document.getElementById('f-name').value = p ? p.name : '';
    this.fillCategorySelect();
    document.getElementById('f-category').value = p ? p.category : this.categories[0]?.slug;
    document.getElementById('f-badge').value = p ? (p.badge || '') : '';
    document.getElementById('f-price').value = p ? p.price : '';
    document.getElementById('f-compare').value = p ? (p.compareAt || '') : '';
    document.getElementById('f-rating').value = p ? p.rating : '';
    document.getElementById('f-reviews').value = p ? p.reviews : '';
    document.getElementById('f-stock').checked = p ? p.inStock : true;
    document.getElementById('f-short').value = p ? (p.short || '') : '';
    document.getElementById('f-desc').value = p ? (p.description || '') : '';

    const list = document.getElementById('img-list');
    list.innerHTML = '';
    const imgs = p ? (p.images || []) : [];
    if (imgs.length) imgs.forEach((img) => this.addImageRow(img));
    else this.addImageRow('');

    document.getElementById('product-modal').classList.add('show');
  },

  closeModal() {
    document.getElementById('product-modal').classList.remove('show');
  },

  addImageRow(value) {
    const row = document.createElement('div');
    row.className = 'img-row';
    row.innerHTML = `
      <img src="${value || ''}" onerror="this.style.visibility='hidden'">
      <input type="text" class="img-url" value="${value}" placeholder="Image URL">
      <button type="button" class="btn outline sm upload-btn">Upload</button>
      <button type="button" class="btn sm danger outline" onclick="this.closest('.img-row').remove()">&#10005;</button>`;
    row.querySelector('.upload-btn').addEventListener('click', (e) => this.uploadImage(e));
    row.querySelector('.img-url').addEventListener('input', (e) => {
      const img = row.querySelector('img');
      img.src = e.target.value;
      img.style.visibility = e.target.value ? 'visible' : 'hidden';
    });
    document.getElementById('img-list').appendChild(row);
  },

  uploadImage(e) {
    const row = e.target.closest('.img-row');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      if (!input.files[0]) return;
      const fd = new FormData();
      fd.append('image', input.files[0]);
      try {
        const data = await this.api('/upload', { method: 'POST', body: fd });
        const urlInput = row.querySelector('.img-url');
        urlInput.value = data.url;
        const img = row.querySelector('img');
        img.src = data.url;
        img.style.visibility = 'visible';
        this.toast('Image uploaded');
      } catch (err) {
        this.toast(err.message, true);
      }
    };
    input.click();
  },

  async saveProduct(e) {
    e.preventDefault();
    const images = [...document.querySelectorAll('.img-row .img-url')]
      .map((i) => i.value.trim())
      .filter(Boolean);
    const body = {
      name: document.getElementById('f-name').value.trim(),
      category: document.getElementById('f-category').value,
      badge: document.getElementById('f-badge').value,
      price: Number(document.getElementById('f-price').value),
      compareAt: Number(document.getElementById('f-compare').value) || 0,
      rating: Number(document.getElementById('f-rating').value) || 0,
      reviews: Number(document.getElementById('f-reviews').value) || 0,
      inStock: document.getElementById('f-stock').checked,
      short: document.getElementById('f-short').value.trim(),
      description: document.getElementById('f-desc').value.trim(),
      images
    };
    if (!body.name) return this.toast('Name is required', true);
    try {
      if (this.editingId) {
        await this.api('/products/' + this.editingId, { method: 'PUT', body });
        this.toast('Product updated');
      } else {
        await this.api('/products', { method: 'POST', body });
        this.toast('Product added');
      }
      this.closeModal();
      await this.loadAll();
    } catch (err) {
      this.toast(err.message, true);
    }
  },

  async deleteProduct(id) {
    const p = this.products.find((x) => x.id === id);
    if (!confirm(`Delete "${p ? p.name : id}"? This cannot be undone.`)) return;
    try {
      await this.api('/products/' + id, { method: 'DELETE' });
      this.toast('Product deleted');
      await this.loadAll();
    } catch (err) {
      this.toast(err.message, true);
    }
  },

  /* ---- Orders ---- */
  renderOrders() {
    const tbody = document.getElementById('orders-table');
    if (!this.orders.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">No orders yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = this.orders.slice().reverse().map((o) => {
      const items = o.items.map((i) => `${i.name} &times;${i.qty}`).join(', ');
      const pill = { Pending: 'amber', Confirmed: 'amber', Shipped: 'amber', Delivered: 'green', Cancelled: 'red' }[o.status] || 'amber';
      return `<tr>
        <td style="font-weight:600">${o.id}<br><span style="font-size:.74rem;color:var(--muted)">${new Date(o.createdAt).toLocaleString()}</span></td>
        <td>${o.customer.name}<br><span style="font-size:.78rem;color:var(--muted)">${o.customer.phone}</span></td>
        <td style="max-width:220px">${items}</td>
        <td style="font-weight:700">Rs.${o.total.toLocaleString()}</td>
        <td style="text-transform:capitalize">${o.payment}</td>
        <td><span class="pill ${pill}">${o.status}</span></td>
        <td>
          <select class="status-sel" data-id="${o.id}">
            ${['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'].map((s) =>
              `<option ${o.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
      </tr>`;
    }).join('');
  },

  async updateStatus(sel) {
    try {
      await this.api('/orders/' + sel.dataset.id, {
        method: 'PATCH',
        body: { status: sel.value }
      });
      this.toast('Order status updated');
      const orders = await this.api('/orders');
      this.orders = orders;
      this.renderOrders();
      this.api('/stats').then((s) => this.renderStats(s));
    } catch (err) {
      this.toast(err.message, true);
    }
  },

  /* ---- Settings ---- */
  async loadSettings() {
    try {
      const store = (await fetch('/api/store').then((r) => r.json())).store;
      document.getElementById('set-name').value = store.name;
      document.getElementById('set-currency').value = store.currency;
      document.getElementById('set-announcement').value = store.announcement;
      document.getElementById('set-fb').value = store.social.facebook;
      document.getElementById('set-ig').value = store.social.instagram;
      document.getElementById('set-tt').value = store.social.tiktok;
    } catch (e) {
      this.toast('Could not load settings', true);
    }
  },

  async saveStore() {
    try {
      await this.api('/store', {
        method: 'PUT',
        body: {
          name: document.getElementById('set-name').value,
          currency: document.getElementById('set-currency').value,
          announcement: document.getElementById('set-announcement').value,
          social: {
            facebook: document.getElementById('set-fb').value,
            instagram: document.getElementById('set-ig').value,
            tiktok: document.getElementById('set-tt').value
          }
        }
      });
      this.toast('Store settings saved');
    } catch (err) {
      this.toast(err.message, true);
    }
  },

  async changePassword() {
    try {
      await this.api('/password', {
        method: 'POST',
        body: {
          current: document.getElementById('pwd-current').value,
          next: document.getElementById('pwd-next').value
        }
      });
      this.toast('Password changed');
      document.getElementById('pwd-current').value = '';
      document.getElementById('pwd-next').value = '';
    } catch (err) {
      this.toast(err.message, true);
    }
  },

  toast(msg, isError) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(this._t);
    this._t = setTimeout(() => el.classList.remove('show'), 2500);
  }
};

document.addEventListener('DOMContentLoaded', () => Admin.init());