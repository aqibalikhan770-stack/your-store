/* Shared store helpers: header, cart (localStorage), formatting */

const Store = {
  config: null,
  categories: [],
  products: [],
  cache: {},

  async init() {
    const [storeRes, catRes] = await Promise.all([
      fetch('/api/store'),
      fetch('/api/products')
    ]);
    const storeData = await storeRes.json();
    this.config = storeData.store;
    this.categories = storeData.categories;
    this.products = await catRes.json();
    this.renderHeader();
    this.renderCartCount();
  },

  formatPrice(n) {
    return this.config.currency + Number(n).toLocaleString('en-PK', { minimumFractionDigits: 0 });
  },

  getProduct(id) {
    return this.products.find((p) => p.id === id);
  },

  async getProductFull(id) {
    if (this.cache[id]) return this.cache[id];
    const res = await fetch(`/api/products/${id}`);
    const data = await res.json();
    this.cache[id] = data;
    return data;
  },

  ratingHTML(p) {
    if (!p.rating) return '';
    const stars = '&#9733;'.repeat(Math.round(p.rating));
    return `<span class="stars">${stars}</span> ${p.rating.toFixed(1)} <span class="muted">(${p.reviews} reviews)</span>`;
  },

  cardHTML(p) {
    const off = p.compareAt > p.price ? Math.round(((p.compareAt - p.price) / p.compareAt) * 100) : 0;
    const badge = p.badge
      ? `<span class="pc-badge ${p.badge === 'Sale' ? 'sale' : p.badge === 'New Launch' ? 'new' : ''}">${p.badge}</span>`
      : '';
    const price = p.compareAt > p.price
      ? `<span class="pc-price">
           <span class="now">${this.formatPrice(p.price)}</span>
           <span class="was">${this.formatPrice(p.compareAt)}</span>
           <span class="off">-${off}%</span>
         </span>`
      : `<span class="pc-price"><span class="now">${this.formatPrice(p.price)}</span></span>`;
    const stock = p.inStock
      ? `<button class="pc-add" onclick="Store.addToCart('${p.id}')">Add to cart</button>`
      : `<button class="pc-add" disabled>Sold out</button>`;
    return `<article class="product-card">
      <a href="/product.html?id=${p.id}" class="pc-media">
        <img src="${p.images[0]}" alt="${p.name}" loading="lazy" onerror="this.src='https://placehold.co/600x600/e8e3d8/6b6b6b?text=Product'">
        ${badge}
      </a>
      <div class="pc-body">
        <a href="/product.html?id=${p.id}" class="pc-name">${p.name}</a>
        <div class="pc-rating">${this.ratingHTML(p)}</div>
        ${price}
        ${stock}
      </div>
    </article>`;
  },

  /* ---------- Cart ---------- */
  getCart() {
    try { return JSON.parse(localStorage.getItem('store_cart') || '[]'); }
    catch (e) { return []; }
  },
  saveCart(cart) {
    localStorage.setItem('store_cart', JSON.stringify(cart));
    this.renderCartCount();
  },
  addToCart(id, qty = 1) {
    const cart = this.getCart();
    const existing = cart.find((i) => i.id === id);
    if (existing) existing.qty += qty;
    else cart.push({ id, qty });
    this.saveCart(cart);
    this.toast('Added to cart');
  },
  updateQty(id, qty) {
    let cart = this.getCart();
    if (qty <= 0) cart = cart.filter((i) => i.id !== id);
    else cart = cart.map((i) => (i.id === id ? { ...i, qty } : i));
    this.saveCart(cart);
    this.renderCartCount();
    this.renderCartPage && this.renderCartPage();
  },
  removeFromCart(id) {
    this.saveCart(this.getCart().filter((i) => i.id !== id));
    this.renderCartCount();
    this.renderCartPage && this.renderCartPage();
  },
  cartCount() {
    return this.getCart().reduce((sum, i) => sum + i.qty, 0);
  },
  cartSubtotal() {
    return this.getCart().reduce((sum, i) => {
      const p = this.getProduct(i.id);
      return p ? sum + p.price * i.qty : sum;
    }, 0);
  },
  renderCartCount() {
    const el = document.getElementById('cart-count');
    if (el) {
      const n = this.cartCount();
      el.textContent = n;
      el.style.display = n ? 'flex' : 'none';
    }
  },

  /* ---------- Header ---------- */
  renderHeader() {
    const nav = document.getElementById('site-nav');
    if (nav) {
      nav.innerHTML = `<a href="/">Home</a>` +
        this.categories.map((c) => `<a href="/collection.html?cat=${c.slug}">${c.name}</a>`).join('') +
        `<a href="/contact.html">Contact</a>`;
    }
    const logo = document.getElementById('site-logo');
    if (logo) {
      const t = (this.config.logoText || this.config.name).trim();
      logo.innerHTML = `<a href="/" class="logo">${t}<span class="dot">&nbsp;Store</span></a>`;
    }
    const ann = document.getElementById('announcement');
    if (ann) ann.textContent = this.config.announcement;
    const phone = document.getElementById('top-phone');
    if (phone && this.config.contact) phone.textContent = this.config.contact.phone || '';
  },

  /* ---------- Hero slider ---------- */
  renderHero() {
    const wrap = document.getElementById('hero-slider');
    if (!wrap) return;
    const slides = (this.config.hero && this.config.hero.length) ? this.config.hero : [{
      image: 'https://placehold.co/1920x700/141414/e8e3d8?text=Your+Banner+Here',
      title: 'Welcome',
      subtitle: 'Edit this banner from the admin panel',
      btnText: 'Shop Now',
      btnLink: '/collection.html?cat=all'
    }];
    wrap.innerHTML = slides.map((s, i) => `
      <div class="slide ${i === 0 ? 'active' : ''}">
        <img src="${s.image}" alt="${s.title}" onerror="this.src='https://placehold.co/1920x700/141414/e8e3d8?text=Banner'">
        <div class="slide-content">
          <h1>${s.title}</h1>
          <p>${s.subtitle}</p>
          ${s.btnText ? `<a href="${s.btnLink}" class="btn">${s.btnText}</a>` : ''}
        </div>
      </div>`).join('');
    if (slides.length > 1) {
      const dots = document.createElement('div');
      dots.className = 'hero-dots';
      dots.innerHTML = slides.map((_, i) => `<span class="${i === 0 ? 'active' : ''}" data-i="${i}"></span>`).join('');
      wrap.parentNode.appendChild(dots);
      dots.addEventListener('click', (e) => {
        if (e.target.dataset.i !== undefined) this.goSlide(+e.target.dataset.i);
      });
      this._heroTimer = setInterval(() => {
        const cur = [...wrap.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('active'));
        this.goSlide((cur + 1) % slides.length);
      }, 5000);
    }
  },

  goSlide(i) {
    const wrap = document.getElementById('hero-slider');
    if (!wrap) return;
    wrap.querySelectorAll('.slide').forEach((s, idx) => s.classList.toggle('active', idx === i));
    const dots = document.querySelector('.hero-dots');
    if (dots) {
      dots.querySelectorAll('span').forEach((d, idx) => d.classList.toggle('active', idx === i));
    }
  },

  renderCartCountEl() {},

  /* ---------- Search ---------- */
  setupSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');
    if (!input || !results) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { results.classList.remove('show'); return; }
      const matches = this.products
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 6);
      if (!matches.length) {
        results.innerHTML = `<div class="sr-empty">No products found for "${input.value}"</div>`;
      } else {
        results.innerHTML = matches.map((p) => `
          <a href="/product.html?id=${p.id}" onclick="this.closest('.search-results').classList.remove('show');document.getElementById('search-input').value=''">
            <img src="${p.images[0]}" onerror="this.src='https://placehold.co/84x84/e8e3d8/6b6b6b?text='">
            <div>
              <div class="sr-name">${p.name}</div>
              <div class="sr-price">${this.formatPrice(p.price)}</div>
            </div>
          </a>`).join('');
      }
      results.classList.add('show');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) results.classList.remove('show');
    });
  },

  /* ---------- Toast ---------- */
  toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  },

  /* ---------- Footer ---------- */
  renderFooter() {
    const footer = document.getElementById('site-footer');
    if (!footer) return;
    const c = this.config;
    const f = c.footer || {};
    const contact = c.contact || {};
    const policies = (f.policyLinks && f.policyLinks.length)
      ? f.policyLinks.map((l) => `<li><a href="${l.url}">${l.text}</a></li>`).join('')
      : `<li><a href="#">Shipping policy</a></li><li><a href="#">Refund policy</a></li><li><a href="#">Privacy policy</a></li><li><a href="#">Terms of service</a></li>`;
    footer.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div>
            <h4>${c.logoText || c.name}</h4>
            <p style="font-size:.85rem;max-width:260px">${f.about || ''}</p>
          </div>
          <div>
            <h4>${f.shopTitle || 'Shop'}</h4>
            <ul>
              ${this.categories.map((cat) => `<li><a href="/collection.html?cat=${cat.slug}">${cat.name}</a></li>`).join('')}
            </ul>
          </div>
          <div>
            <h4>${f.policyTitle || 'Policies'}</h4>
            <ul>${policies}</ul>
          </div>
          <div>
            <h4>${f.contactTitle || 'Need Help?'}</h4>
            <ul>
              <li><a href="tel:${contact.phone || ''}">${contact.phone || ''}</a></li>
              <li><a href="mailto:${contact.email || ''}">${contact.email || ''}</a></li>
              <li style="color:var(--muted)">${contact.address || ''}</li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>&copy; ${new Date().getFullYear()}, ${c.name}</span>
          <span class="links">
            <a href="${c.social.facebook}" target="_blank">Facebook</a>
            <a href="${c.social.instagram}" target="_blank">Instagram</a>
            <a href="${c.social.tiktok}" target="_blank">TikTok</a>
            <a href="/admin.html">Admin</a>
          </span>
        </div>
      </div>`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Store.init();
  Store.setupSearch();
});