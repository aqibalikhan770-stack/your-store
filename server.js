const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const ADMIN_FILE = path.join(__dirname, 'data', 'admin.json');
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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));

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
  if (b.currency !== undefined) data.store.currency = String(b.currency);
  if (b.announcement !== undefined) data.store.announcement = String(b.announcement);
  if (b.heroTag !== undefined) data.store.heroTag = String(b.heroTag);
  if (b.social !== undefined) data.store.social = { ...data.store.social, ...b.social };
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

app.listen(PORT, () => {
  console.log(`Your store is running at http://localhost:${PORT}`);
  console.log(`Admin panel at http://localhost:${PORT}/admin.html  (default password: admin123)`);
});