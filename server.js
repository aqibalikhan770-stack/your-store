const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');
const SHIPMENTS_FILE = path.join(__dirname, 'data', 'shipments.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function loadOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8')); }
  catch (e) { return []; }
}
function saveOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}
function loadAdmin() {
  try { return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf-8')); }
  catch (e) { return { password: 'admin123' }; }
}
function loadShipments() {
  try { return JSON.parse(fs.readFileSync(SHIPMENTS_FILE, 'utf-8')); }
  catch (e) { return []; }
}
function saveShipments(list) {
  fs.writeFileSync(SHIPMENTS_FILE, JSON.stringify(list, null, 2));
}

/* ---- Admin auth ---- */
const tokens = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers['x-auth-token'];
  if (!token || !tokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/* ---- Image upload ---- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp|gif|jpg)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

/* ================= Leopards MUX zone Meeting Room ================= */
app.get('/meet', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'meet.html'));
});
app.get('/meet/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'meet.html'));
});

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e6
});

const meetRooms = new Map();

function meetRoom(roomId) {
  if (!meetRooms.has(roomId)) {
    meetRooms.set(roomId, { hostId: null, users: new Map() });
  }
  return meetRooms.get(roomId);
}

function meetLeave(socket, roomId) {
  const room = meetRooms.get(roomId);
  if (!room) return;
  room.users.delete(socket.id);
  if (room.hostId === socket.id) {
    const next = room.users.keys().next().value || null;
    room.hostId = next;
    if (next) io.to(next).emit('meet:you-are-host', { name: room.users.get(next).name });
  }
  socket.to(roomId).emit('meet:user-left', { id: socket.id, newHostId: room.hostId });
  if (room.users.size === 0) meetRooms.delete(roomId);
}

io.on('connection', (socket) => {
  socket.on('meet:join', ({ roomId, name }, ack) => {
    const rid = String(roomId || '').trim().slice(0, 32) || 'default';
    const room = meetRoom(rid);
    const safeName = String(name || 'Guest').trim().slice(0, 40) || 'Guest';
    if (room.users.has(socket.id)) return;
    room.users.set(socket.id, { name: safeName, joinedAt: Date.now() });
    if (!room.hostId) room.hostId = socket.id;
    socket.join(rid);
    const users = [...room.users.entries()].map(([id, u]) => ({
      id,
      name: u.name,
      isHost: id === room.hostId
    }));
    ack({ you: socket.id, roomId: rid, isHost: socket.id === room.hostId, users });
    socket.to(rid).emit('meet:user-joined', {
      id: socket.id,
      name: safeName,
      isHost: socket.id === room.hostId
    });
  });

  socket.on('meet:signal', ({ roomId, target, data }) => {
    io.to(target).emit('meet:signal', { from: socket.id, data });
  });

  socket.on('meet:chat', ({ roomId, message }) => {
    const room = meetRooms.get(roomId);
    const u = room && room.users.get(socket.id);
    socket.to(roomId).emit('meet:chat', {
      from: u ? u.name : 'Guest',
      message: String(message || '').slice(0, 2000),
      at: Date.now()
    });
  });

  socket.on('meet:screen-state', ({ roomId, sharing }) => {
    socket.to(roomId).emit('meet:screen-state', { id: socket.id, sharing: !!sharing });
  });

  socket.on('meet:host-mute', ({ roomId, target }) => {
    const room = meetRooms.get(roomId);
    if (!room || room.hostId !== socket.id || !room.users.has(target)) return;
    io.to(target).emit('meet:host-action', { type: 'mute' });
  });
  socket.on('meet:host-unmute', ({ roomId, target }) => {
    const room = meetRooms.get(roomId);
    if (!room || room.hostId !== socket.id || !room.users.has(target)) return;
    io.to(target).emit('meet:host-action', { type: 'unmute' });
  });
  socket.on('meet:host-camera-off', ({ roomId, target }) => {
    const room = meetRooms.get(roomId);
    if (!room || room.hostId !== socket.id || !room.users.has(target)) return;
    io.to(target).emit('meet:host-action', { type: 'camera-off' });
  });
  socket.on('meet:host-kick', ({ roomId, target }) => {
    const room = meetRooms.get(roomId);
    if (!room || room.hostId !== socket.id || !room.users.has(target)) return;
    room.users.delete(target);
    io.to(target).emit('meet:host-action', { type: 'kick' });
    io.to(target).emit('meet:kicked', { by: room.users.get(socket.id).name });
    socket.to(roomId).emit('meet:user-left', { id: target, newHostId: room.hostId });
    io.sockets.sockets.get(target)?.disconnect(true);
  });

  socket.on('meet:leave', ({ roomId }) => {
    meetLeave(socket, roomId);
  });

  socket.on('disconnect', () => {
    for (const [roomId, room] of meetRooms.entries()) {
      if (room.users.has(socket.id)) {
        meetLeave(socket, roomId);
        break;
      }
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

/* ================= Manual Shipments (amount + bag details) ================= */
app.get('/api/shipments', (req, res) => {
  const cn = String(req.query.cn || '').trim();
  const list = loadShipments();
  if (cn) {
    const item = list.find((s) => s.cn === cn);
    return res.json(item || { found: false });
  }
  res.json(list);
});

app.post('/api/shipments', requireAdmin, (req, res) => {
  const cn = String(req.body.cn || '').trim();
  if (!cn) return res.status(400).json({ error: 'CN number is required' });
  const list = loadShipments();
  if (list.some((s) => s.cn === cn)) {
    return res.status(400).json({ error: 'CN already exists' });
  }
  const item = {
    cn,
    amount: String(req.body.amount || '').trim(),
    bagDetail: String(req.body.bagDetail || '').trim(),
    customerName: String(req.body.customerName || '').trim(),
    phone: String(req.body.phone || '').trim(),
    city: String(req.body.city || '').trim(),
    remarks: String(req.body.remarks || '').trim(),
    updatedAt: new Date().toISOString()
  };
  list.push(item);
  saveShipments(list);
  res.json(item);
});

app.put('/api/shipments/:cn', requireAdmin, (req, res) => {
  const list = loadShipments();
  const idx = list.findIndex((s) => s.cn === req.params.cn);
  if (idx === -1) return res.status(404).json({ error: 'CN not found' });
  const cur = list[idx];
  const patch = req.body || {};
  ['amount', 'bagDetail', 'customerName', 'phone', 'city', 'remarks'].forEach((k) => {
    if (patch[k] !== undefined) cur[k] = String(patch[k] || '').trim();
  });
  cur.updatedAt = new Date().toISOString();
  saveShipments(list);
  res.json(cur);
});

app.delete('/api/shipments/:cn', requireAdmin, (req, res) => {
  const list = loadShipments();
  const before = list.length;
  const filtered = list.filter((s) => s.cn !== req.params.cn);
  if (filtered.length === before) return res.status(404).json({ error: 'CN not found' });
  saveShipments(filtered);
  res.json({ success: true });
});

/* ================= Leopards Courier Tracking ================= */
const LEOPARDS_BASE = 'https://pk.leopardscourier.com';

function extractText(html, startMarker, endMarker, fromIndex) {
  const start = html.indexOf(startMarker, fromIndex);
  if (start === -1) return null;
  const valueStart = start + startMarker.length;
  const end = html.indexOf(endMarker, valueStart);
  if (end === -1) return null;
  return html.substring(valueStart, end)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCell(text) {
  return (text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTrackingHtml(html) {
  const result = {
    consignmentNo: null,
    currentStatus: null,
    statusDate: null,
    steps: [],
    activeStep: 0,
    shipment: {
      origin: null, destination: null, shipper: null,
      consignee: null, referenceNo: null, bookingDate: null, pieces: null
    },
    history: []
  };

  const invalidMsg = html.match(/appeared to be invalid \/ record not found/i);
  if (invalidMsg) {
    result.invalid = true;
    return result;
  }

  const consNo = html.match(/Consignment No\.?\s*:\s*<\/td>\s*<td[^>]*>\s*([A-Z0-9]+)/i) ||
                 html.match(/Consignment No\.?\s*:\s*([A-Z0-9]+)/i);
  if (consNo) result.consignmentNo = consNo[1];

  const stepsMatch = html.match(/id="bar-progress"([\s\S]*?)(?=<div class="col-lg-12|<\/div>\s*<\/div>\s*<\/div>)/);
  if (stepsMatch) {
    const stepRe = /<div class="step\s*([^"]*)">[\s\S]*?<span class="number">(\d+)<\/span>[\s\S]*?<\/span>\s*([\s\S]*?)\s*<\/div>/g;
    let m;
    let active = 0;
    const steps = [];
    while ((m = stepRe.exec(stepsMatch[1])) !== null) {
      const isActive = (m[1] || '').indexOf('step-active') !== -1;
      steps.push({ step: Number(m[2]), label: cleanCell(m[3]), active: isActive });
      if (isActive) active = Number(m[2]);
    }
    result.steps = steps;
    result.activeStep = active;
  }

  const statusMatch = html.match(/Current Status\/Reason\s*:\s*<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>\s*<b>\s*Dated:\s*<\/b>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (statusMatch) {
    result.currentStatus = cleanCell(statusMatch[1]);
    result.statusDate = cleanCell(statusMatch[2]);
  }

  const field = (label) => {
    const re = new RegExp('<b>' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*</b>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>');
    const m = html.match(re);
    return m ? cleanCell(m[1]) : null;
  };

  result.shipment.origin = field('Origin');
  result.shipment.destination = field('Destination');
  result.shipment.shipper = field('Shipper');
  result.shipment.consignee = field('Consignee');
  result.shipment.referenceNo = field('Reference No.');
  result.shipment.bookingDate = field('Booking Date');
  result.shipment.pieces = field('Pieces');

  const histStart = html.indexOf('<div class="tracking-list">');
  if (histStart !== -1) {
    const tdClose = html.indexOf('</td>', histStart);
    const histSection = html.substring(histStart, tdClose);
    if (histSection.includes('History detail not available.')) {
      result.history = [];
    } else {
      const items = histSection.match(/<div class="tracking-item">([\s\S]*?)<\/div>\s*<\/div>/g) || [];
      for (const rawItem of items) {
        const dateM = rawItem.match(/<div class="tracking-date"[^>]*>([\s\S]*?)<\/div>/);
        const contentM = rawItem.match(/<div class="tracking-content"[^>]*>([\s\S]*?)<\/div>/);
        const date = dateM ? cleanCell(dateM[1]) : '';
        const contentHtml = contentM ? contentM[1] : '';
        const firstSpan = contentHtml.indexOf('<span');
        const status = firstSpan === -1 ? cleanCell(contentHtml) : cleanCell(contentHtml.substring(0, firstSpan));
        const detail = contentM ? cleanCell(contentHtml.replace(/<[^>]+>/g, ' ').replace(status, '')) : '';
        result.history.push({ date, status, detail });
      }
    }
  }
  if (!result.history.length) {
    const noHist = html.match(/History detail not available/);
    if (noHist) result.history = [];
  }

  return result;
}

app.get('/api/track', async (req, res) => {
  const cn = String(req.query.cn || '').trim();
  if (!cn) return res.status(400).json({ error: 'Tracking number (CN) is required' });

  let cookies = '';
  const agent = null;

  try {
    const step1 = await fetch(`${LEOPARDS_BASE}/shipment_tracking-new?cn_number=${encodeURIComponent(cn)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        ...(cookies ? { Cookie: cookies } : {})
      },
      redirect: 'manual'
    });

    const setCookieRaw = step1.headers.get('set-cookie');
    if (setCookieRaw) {
      cookies = setCookieRaw
        .split(',')
        .map((c) => c.split(';')[0].trim())
        .join('; ');
    }
    const body1 = await step1.text();
    let ok = false;
    try { ok = JSON.parse(body1).success === true; } catch (e) { ok = body1.includes('"success":true'); }

    if (!ok) {
      return res.json({ found: false, invalid: true, error: 'No shipment data found for this CN number.' });
    }

    const step2 = await fetch(`${LEOPARDS_BASE}/shipment_tracking_view`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'text/html',
        ...(cookies ? { Cookie: cookies } : {})
      }
    });

    const html = await step2.text();
    if (html.includes('appeared to be invalid / record not found')) {
      return res.json({ found: false, invalid: true, error: 'No shipment data found for this CN number.' });
    }

    const data = parseTrackingHtml(html);
    data.found = true;
    data.invalid = false;

    const manual = loadShipments().find((s) => s.cn === cn) || null;
    data.manual = manual;
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Leopards tracking service', detail: err.message });
  }
});

/* ================= Public API ================= */
app.get('/api/store', (req, res) => {
  const data = loadData();
  res.json({ store: data.store, categories: data.categories });
});

app.get('/api/products', (req, res) => {
  const data = loadData();
  let products = data.products;
  const { category, q } = req.query;
  if (category && category !== 'all') {
    products = products.filter((p) => p.category === category);
  }
  if (q) {
    const term = q.toLowerCase();
    products = products.filter((p) =>
      p.name.toLowerCase().includes(term) || p.short.toLowerCase().includes(term)
    );
  }
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const data = loadData();
  const product = data.products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const reviews = data.reviews.filter((r) => r.product === product.id);
  res.json({ product, reviews });
});

app.get('/api/reviews', (req, res) => {
  const data = loadData();
  res.json(data.reviews);
});

app.post('/api/orders', (req, res) => {
  const order = req.body;
  if (!order || !order.items || order.items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }
  const orders = loadOrders();
  order.id = 'ORD-' + Date.now();
  order.status = 'Pending';
  order.createdAt = new Date().toISOString();
  orders.push(order);
  saveOrders(orders);
  res.json({ success: true, id: order.id });
});

/* ================= Admin API ================= */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const admin = loadAdmin();
  if (password === admin.password) {
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  const token = req.headers['x-auth-token'];
  tokens.delete(token);
  res.json({ success: true });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const data = loadData();
  const orders = loadOrders();
  const revenue = orders.filter((o) => o.status !== 'Cancelled')
    .reduce((s, o) => s + (o.total || 0), 0);
  res.json({
    products: data.products.length,
    categories: data.categories.length,
    orders: orders.length,
    revenue,
    pendingOrders: orders.filter((o) => o.status === 'Pending').length
  });
});

/* ---- Products CRUD ---- */
function normalizeProduct(body) {
  const slug = (s) => String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const id = slug(body.id) || slug(body.name) || 'product-' + Date.now();
  return {
    id,
    name: String(body.name || '').trim(),
    category: String(body.category || 'skincare').trim(),
    price: Number(body.price) || 0,
    compareAt: Number(body.compareAt) || 0,
    rating: Number(body.rating) || 0,
    reviews: Number(body.reviews) || 0,
    inStock: body.inStock === true || body.inStock === 'true',
    badge: String(body.badge || '').trim(),
    short: String(body.short || '').trim(),
    description: String(body.description || '').trim(),
    images: Array.isArray(body.images) ? body.images.filter(Boolean) : []
  };
}

app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json(loadData().products);
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const data = loadData();
  const product = normalizeProduct(req.body);
  if (!product.name) return res.status(400).json({ error: 'Name is required' });
  if (data.products.some((p) => p.id === product.id)) {
    return res.status(400).json({ error: 'Product id already exists' });
  }
  data.products.push(product);
  saveData(data);
  res.json(product);
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const data = loadData();
  const idx = data.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  const current = data.products[idx];
  const updated = normalizeProduct({ ...req.body, id: current.id });
  if (!updated.name) return res.status(400).json({ error: 'Name is required' });
  data.products[idx] = updated;
  saveData(data);
  res.json(updated);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const data = loadData();
  const before = data.products.length;
  data.products = data.products.filter((p) => p.id !== req.params.id);
  if (data.products.length === before) return res.status(404).json({ error: 'Product not found' });
  saveData(data);
  res.json({ success: true });
});

app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/uploads/' + req.file.filename });
});

/* ---- Categories ---- */
app.put('/api/admin/categories', requireAdmin, (req, res) => {
  const data = loadData();
  const cats = Array.isArray(req.body.categories) ? req.body.categories : [];
  const cleaned = cats
    .map((c) => ({
      slug: String(c.slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
      name: String(c.name || '').trim()
    }))
    .filter((c) => c.slug && c.name);
  if (!cleaned.length) return res.status(400).json({ error: 'At least one category required' });
  data.categories = cleaned;
  saveData(data);
  res.json(data.categories);
});

/* ---- Store settings ---- */
app.put('/api/admin/store', requireAdmin, (req, res) => {
  const data = loadData();
  const b = req.body;
  if (b.name !== undefined) data.store.name = String(b.name).trim();
  if (b.logoText !== undefined) data.store.logoText = String(b.logoText).trim();
  if (b.currency !== undefined) data.store.currency = String(b.currency);
  if (b.announcement !== undefined) data.store.announcement = String(b.announcement);
  if (b.heroTag !== undefined) data.store.heroTag = String(b.heroTag);
  if (b.hero !== undefined) {
    data.store.hero = Array.isArray(b.hero)
      ? b.hero.map((h) => ({
          image: String(h.image || ''),
          title: String(h.title || ''),
          subtitle: String(h.subtitle || ''),
          btnText: String(h.btnText || ''),
          btnLink: String(h.btnLink || '/collection.html?cat=all')
        })).filter((h) => h.image)
      : data.store.hero;
  }
  if (b.contact !== undefined) data.store.contact = { ...data.store.contact, ...b.contact };
  if (b.social !== undefined) data.store.social = { ...data.store.social, ...b.social };
  if (b.footer !== undefined) {
    data.store.footer = {
      ...data.store.footer,
      ...b.footer,
      policyLinks: Array.isArray(b.footer.policyLinks)
        ? b.footer.policyLinks.filter((l) => l && l.text)
        : data.store.footer.policyLinks
    };
  }
  saveData(data);
  res.json(data.store);
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const admin = loadAdmin();
  const { current, next } = req.body || {};
  if (current !== admin.password) return res.status(401).json({ error: 'Current password is wrong' });
  if (!next || next.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  fs.writeFileSync(ADMIN_FILE, JSON.stringify({ password: next }, null, 2));
  res.json({ success: true });
});

/* ---- Orders ---- */
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json(loadOrders());
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const orders = loadOrders();
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found' });
  const status = String(req.body.status || '').trim();
  const allowed = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  orders[idx].status = status;
  saveOrders(orders);
  res.json(orders[idx]);
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Upload error: ' + err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

server.listen(PORT, () => {
  console.log(`Your store is running at http://localhost:${PORT}`);
  console.log(`Admin panel at http://localhost:${PORT}/admin.html  (default password: admin123)`);
  console.log(`Leopards MUX zone Meeting Room at http://localhost:${PORT}/meet`);
});