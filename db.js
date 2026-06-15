const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'sultaf.db');

// Delete old database if it exists to re-seed (comment this out after first run)
// if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Add columns if upgrading existing database
try { db.exec('ALTER TABLE menu_items ADD COLUMN image TEXT'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE ambiance_items ADD COLUMN image TEXT'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE gallery_items ADD COLUMN image TEXT'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE reservations ADD COLUMN room_type TEXT DEFAULT "non-ac"'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE reservations ADD COLUMN ordered_items TEXT'); } catch (e) { /* already exists */ }
try { db.exec('ALTER TABLE reservations ADD COLUMN total_price TEXT'); } catch (e) { /* already exists */ }

// ── Create Tables ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    description TEXT,
    price TEXT NOT NULL,
    icon TEXT,
    image TEXT,
    sold_out INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    guests INTEGER NOT NULL,
    room_type TEXT DEFAULT 'non-ac',
    ordered_items TEXT,
    total_price TEXT,
    occasion TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    avatar TEXT,
    stars INTEGER DEFAULT 5,
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS restaurant_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ambiance_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    icon TEXT DEFAULT '🕯️',
    image TEXT,
    color TEXT DEFAULT 'linear-gradient(135deg, #d4b46c, var(--gold))',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS gallery_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caption TEXT,
    image TEXT,
    icon TEXT DEFAULT '🍽',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    secret_question TEXT,
    secret_answer TEXT,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );

  CREATE TABLE IF NOT EXISTS recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', '+7 hours'))
  );
`);

// ── Seed Data (only if empty) ──────────────────────────────
const menuCount = db.prepare('SELECT COUNT(*) as count FROM menu_items').get();
if (menuCount.count === 0) {
  const insertMenu = db.prepare(`
    INSERT INTO menu_items (category, name, name_ar, description, price, icon, sold_out, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const menuItems = [
    ['appetizers', 'Aloo Paratha', 'آلو براثا', 'Flaky whole-wheat flatbread stuffed with spiced mashed potatoes, served with yogurt and pickles.', 'Rp 21.000', '🫓', 0, 1],
    ['mains', 'Nasi Biryani', 'ناسي برياني', 'Fragrant basmati rice layered with tender chicken and aromatic Indian spices.', 'Rp 49.000', '🍛', 0, 2],
    ['mains', 'Chicken Karahi', 'دجاج كراهي', 'Spicy chicken simmered in a rich tomato and ginger gravy with traditional spices.', 'Rp 45.000', '🍗', 0, 3],
    ['mains', 'Nasi Zurbiyan', 'ناسي زربيان', 'Yemeni-style spiced rice with slow-cooked chicken — a Middle Eastern classic.', 'Rp 49.000', '🍚', 1, 4],
    ['desserts', 'Kunafa', 'كنافة', 'Crispy shredded phyllo with creamy cheese filling, drizzled with sweet syrup.', 'Rp 57.000', '🍯', 0, 5],
    ['drinks', 'Chai Adeni', 'شاي عدن', 'Aromatic Yemeni tea brewed with cardamom, cinnamon, and a hint of sweet milk.', 'Rp 19.000', '🍵', 0, 6],
  ];

  const insertMany = db.transaction((items) => {
    for (const item of items) insertMenu.run(...item);
  });
  insertMany(menuItems);
  console.log('  ✓ Menu items seeded');
}

const testimonialCount = db.prepare('SELECT COUNT(*) as count FROM testimonials').get();
if (testimonialCount.count === 0) {
  const insertTestimonial = db.prepare(`
    INSERT INTO testimonials (text, name, role, avatar, stars, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const testimonials = [
    ['"The biryani here is incredible — perfectly spiced and so fragrant. My go-to place for Indian food in Jogja!"', 'Aulia R.', 'GoFood Customer', 'AR', 5, 1],
    ['"The kunafa is the best I\'ve had in Indonesia. Crispy, cheesy, sweet — absolutely perfect! Highly recommended."', 'Budi S.', 'Regular Guest', 'BS', 5, 2],
    ['"Chicken karahi and chai adeni are my favorite combo. Authentic flavors that remind me of home. Sultaf is a true gem."', 'Fatima Z.', 'Local Foodie', 'FZ', 5, 3],
  ];

  const insertMany = db.transaction((items) => {
    for (const item of items) insertTestimonial.run(...item);
  });
  insertMany(testimonials);
  console.log('  ✓ Testimonials seeded');
}

const infoCount = db.prepare('SELECT COUNT(*) as count FROM restaurant_info').get();
if (infoCount.count === 0) {
  const insertInfo = db.prepare('INSERT INTO restaurant_info (key, value) VALUES (?, ?)');

  const info = [
    ['address', 'Condogcatur, Sanggrahan, Kec. Depok, Kabupaten Sleman, Yogyakarta 55281, Indonesia'],
    ['phone', '+62 8XX XXXX XXXX'],
    ['hours', 'Everyday: 10:00 AM – 10:00 PM'],
    ['instagram', '@sultafrestaurant'],
    ['instagram_url', 'https://www.instagram.com/sultafrestaurant/'],
    ['gofood_url', 'https://gofood.co.id/yogyakarta/restaurant/sultaf-restaurant-condogcatur-sanggrahan-454f1e48-8a0d-4b56-89c9-4c0ecf2836bb'],
    ['year_established', '2018'],
  ];

  const insertMany = db.transaction((items) => {
    for (const [k, v] of items) insertInfo.run(k, v);
  });
  insertMany(info);
  console.log('  ✓ Restaurant info seeded');
}

// ── Seed Ambiance ──────────────────────────────────────────
const ambianceCount = db.prepare('SELECT COUNT(*) as count FROM ambiance_items').get();
if (ambianceCount.count === 0) {
  const insertAmbiance = db.prepare('INSERT INTO ambiance_items (title, icon, color, sort_order) VALUES (?, ?, ?, ?)');
  const insertMany = db.transaction((items) => {
    for (const item of items) insertAmbiance.run(...item);
  });
  insertMany([
    ['Candlelit Dining', '🕯️', 'linear-gradient(135deg, #d4b46c, #c8a45c)', 1],
    ['Cozy Interior', '🌿', 'linear-gradient(135deg, #a0304a, #800020)', 2],
    ['Warm Hospitality', '🏛️', 'linear-gradient(135deg, #5c0017, #1a0a08)', 3],
  ]);
  console.log('  ✓ Ambiance items seeded');
}

// ── Seed Gallery ───────────────────────────────────────────
const galleryCount = db.prepare('SELECT COUNT(*) as count FROM gallery_items').get();
if (galleryCount.count === 0) {
  const insertGallery = db.prepare('INSERT INTO gallery_items (icon, sort_order) VALUES (?, ?)');
  const insertMany = db.transaction((items) => {
    for (const item of items) insertGallery.run(...item);
  });
  insertMany([
    ['🍛', 1], ['🍗', 2], ['🍯', 3], ['🫓', 4],
    ['🍵', 5], ['🍚', 6], ['🥟', 7], ['🥘', 8],
  ]);
  console.log('  ✓ Gallery items seeded');
}

console.log('  ✓ Database ready at sultaf.db');

module.exports = db;
