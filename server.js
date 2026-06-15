const express = require('express');
const path = require('path');
const os = require('os');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const db = require('./db');

const app = express();
const PORT = 3000;

// ── Seed default admin if not exists ───────────────────────
(function seedAdmin() {
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
  if (adminCount.count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO admin_users (username, password, role) VALUES (?, ?, ?)').run('admin', hash, 'superadmin');
    console.log('  ✓ Default admin: username="admin" password="admin123"');
  }
})();

// ── Session ────────────────────────────────────────────────
app.use(session({
  secret: 'sultaf-secret-key-2026-' + Math.random().toString(36).slice(2),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict'
  }
}));

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (images, etc.)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));

// ── CORS (allow network access) ────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Credentials', 'true');
  next();
});

// ── Note: Admin login handles access. Role-based restrictions below.

// ── Auth Middleware ────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  // If it's an API call, return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Please login.' });
  }
  // If it's a page, redirect to login
  res.redirect('/login.html');
}

function requireAdminAPI(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  res.status(401).json({ success: false, error: 'Unauthorized. Please login.' });
}

function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.role === 'superadmin') {
    return next();
  }
  res.status(403).json({ success: false, error: 'Forbidden. Only the main admin can manage users.' });
}

// ══════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════

// ─── POST /api/auth/login ──────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password, source } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    }

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        return res.status(500).json({ success: false, error: 'Session error.' });
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role;
      res.json({ success: true, message: 'Login successful.', user: { username: user.username, role: user.role } });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed.' });
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed.' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out.' });
  });
});

// ─── GET /api/auth/check ───────────────────────────────────
app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.userId) {
    return res.json({ success: true, authenticated: true, user: { username: req.session.username, role: req.session.role } });
  }
  res.json({ success: true, authenticated: false });
});

// ─── POST /api/auth/change-password ────────────────────────
app.post('/api/auth/change-password', requireAdminAPI, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });
    }
    const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found.' });
    }
    const valid = bcrypt.compareSync(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE admin_users SET password = ? WHERE id = ?').run(hash, req.session.userId);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, error: 'Failed to change password.' });
  }
});

// ─── PUT /api/auth/change-username ──────────────────────────
// Change username (requires login)
app.put('/api/auth/change-username', requireAdminAPI, (req, res) => {
  try {
    const { currentPassword, newUsername } = req.body;
    if (!currentPassword || !newUsername) {
      return res.status(400).json({ success: false, error: 'Current password and new username are required.' });
    }
    if (newUsername.trim().length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.session.userId);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found.' });
    }

    const valid = bcrypt.compareSync(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    // Check if new username already exists
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ? AND id != ?').get(newUsername.trim(), req.session.userId);
    if (existing) {
      return res.status(400).json({ success: false, error: 'Username already taken.' });
    }

    db.prepare('UPDATE admin_users SET username = ? WHERE id = ?').run(newUsername.trim(), req.session.userId);
    req.session.username = newUsername.trim();

    res.json({ success: true, message: 'Username changed successfully! Please login again with your new username.', newUsername: newUsername.trim() });
  } catch (err) {
    console.error('Change username error:', err);
    res.status(500).json({ success: false, error: 'Failed to change username.' });
  }
});

// ─── GET /api/auth/recovery-code ───────────────────────────
// Get a one-time recovery code (only when logged in)
app.get('/api/auth/recovery-code', requireAdminAPI, (req, res) => {
  try {
    // Generate a random 12-character recovery code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    db.prepare('INSERT INTO recovery_codes (code) VALUES (?)').run(code);
    res.json({ success: true, code: code, message: 'Save this code! It will only be shown once.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to generate recovery code.' });
  }
});

// ─── PUT /api/auth/secret-question ─────────────────────────
// Set or update secret question (requires login)
app.put('/api/auth/secret-question', requireAdminAPI, (req, res) => {
  try {
    const { question, answer } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ success: false, error: 'Question and answer are required.' });
    }
    if (answer.length < 2) {
      return res.status(400).json({ success: false, error: 'Answer must be at least 2 characters.' });
    }
    const hashedAnswer = bcrypt.hashSync(answer.toLowerCase().trim(), 10);
    db.prepare('UPDATE admin_users SET secret_question = ?, secret_answer = ? WHERE id = ?').run(question.trim(), hashedAnswer, req.session.userId);
    res.json({ success: true, message: 'Secret question saved!' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to save secret question.' });
  }
});

// ─── GET /api/auth/secret-question ─────────────────────────
// Get the secret question for forgot password (no auth required)
app.get('/api/auth/secret-question', (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ success: false, error: 'Username is required.' });
    const user = db.prepare('SELECT id, secret_question FROM admin_users WHERE username = ?').get(username.trim());
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    if (!user.secret_question) return res.status(404).json({ success: false, error: 'No secret question set. Use a recovery code instead.' });
    res.json({ success: true, question: user.secret_question });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get secret question.' });
  }
});

// ─── POST /api/auth/reset-password ─────────────────────────
// Reset password using secret question answer or recovery code
app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { username, newPassword, method, answer, recoveryCode } = req.body;

    if (!username || !newPassword || !method) {
      return res.status(400).json({ success: false, error: 'Username, new password, and method are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'New password must be at least 6 characters.' });
    }

    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username.trim());
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    if (method === 'question') {
      if (!answer) return res.status(400).json({ success: false, error: 'Answer is required.' });
      if (!user.secret_answer) return res.status(400).json({ success: false, error: 'No secret question set. Use recovery code instead.' });
      const valid = bcrypt.compareSync(answer.toLowerCase().trim(), user.secret_answer);
      if (!valid) return res.status(401).json({ success: false, error: 'Incorrect answer.' });
    } else if (method === 'code') {
      if (!recoveryCode) return res.status(400).json({ success: false, error: 'Recovery code is required.' });
      const rc = db.prepare('SELECT * FROM recovery_codes WHERE code = ? AND used = 0').get(recoveryCode.trim().toUpperCase());
      if (!rc) return res.status(401).json({ success: false, error: 'Invalid or already used recovery code.' });
      // Mark code as used
      db.prepare('UPDATE recovery_codes SET used = 1 WHERE id = ?').run(rc.id);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid method. Use "question" or "code".' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE admin_users SET password = ? WHERE id = ?').run(hash, user.id);

    res.json({ success: true, message: 'Password reset successfully! You can now login with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, error: 'Failed to reset password.' });
  }
});

// ══════════════════════════════════════════════════════════
//  API ROUTES
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  USER MANAGEMENT (superadmin only)
// ══════════════════════════════════════════════════════════

// ─── GET /api/auth/users ────────────────────────────────────
app.get('/api/auth/users', requireSuperAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, role, created_at FROM admin_users ORDER BY id').all();
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch users.' });
  }
});

// ─── POST /api/auth/create-user ─────────────────────────────
app.post('/api/auth/create-user', requireSuperAdmin, (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
    }
    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters.' });
    }

    // Check if username already exists
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username.trim().toLowerCase());
    if (existing) {
      return res.status(400).json({ success: false, error: 'Username already exists.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admin_users (username, password, role) VALUES (?, ?, ?)').run(username.trim().toLowerCase(), hash, 'admin');
    res.json({ success: true, message: 'User "' + username.trim() + '" created successfully! They can now login and manage the menu.' });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ success: false, error: 'Failed to create user.' });
  }
});

// ─── DELETE /api/auth/users/:id ─────────────────────────────
app.delete('/api/auth/users/:id', requireSuperAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    if (userId === req.session.userId) {
      return res.status(400).json({ success: false, error: 'You cannot delete yourself.' });
    }
    db.prepare('DELETE FROM admin_users WHERE id = ? AND role != ?').run(userId, 'superadmin');
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
});

// ─── GET /api/menu ─────────────────────────────────────────
// Get all menu items, or filter by ?category=xxx
app.get('/api/menu', (req, res) => {
  try {
    const { category } = req.query;
    let items;
    if (category && category !== 'all') {
      items = db.prepare('SELECT * FROM menu_items WHERE category = ? ORDER BY sort_order').all(category);
    } else {
      items = db.prepare('SELECT * FROM menu_items ORDER BY sort_order').all();
    }
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Menu error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch menu' });
  }
});

// ─── POST /api/menu ─────────────────────────────────────────
// Add a new menu item
app.post('/api/menu', requireAdminAPI, (req, res) => {
  try {
    const { name, name_ar, category, description, price, icon, image } = req.body;
    if (!name || !price || !category) {
      return res.status(400).json({ success: false, error: 'Name, price, and category are required.' });
    }
    const stmt = db.prepare(`
      INSERT INTO menu_items (category, name, name_ar, description, price, icon, image, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM menu_items))
    `);
    const result = stmt.run(category, name, name_ar || null, description || null, price, icon || null, image || null);
    res.json({ success: true, message: 'Menu item added!', data: { id: result.lastInsertRowid } });
  } catch (err) {
    console.error('Add menu error:', err);
    res.status(500).json({ success: false, error: 'Failed to add menu item.' });
  }
});

// ─── PUT /api/menu/:id ──────────────────────────────────────
// Update a menu item
app.put('/api/menu/:id', requireAdminAPI, (req, res) => {
  try {
    const { id } = req.params;
    const { name, name_ar, category, description, price, icon, image, sold_out } = req.body;
    if (!name || !price) {
      return res.status(400).json({ success: false, error: 'Name and price are required.' });
    }
    const stmt = db.prepare(`
      UPDATE menu_items SET name = ?, name_ar = ?, category = ?, description = ?, price = ?, icon = ?, image = ?, sold_out = ?
      WHERE id = ?
    `);
    stmt.run(name, name_ar || null, category || 'mains', description || null, price, icon || null, image || null, sold_out || 0, id);
    res.json({ success: true, message: 'Menu item updated!' });
  } catch (err) {
    console.error('Update menu error:', err);
    res.status(500).json({ success: false, error: 'Failed to update menu item.' });
  }
});

// ─── DELETE /api/menu/:id ───────────────────────────────────
// Delete a menu item
app.delete('/api/menu/:id', requireAdminAPI, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
    res.json({ success: true, message: 'Menu item deleted.' });
  } catch (err) {
    console.error('Delete menu error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete menu item.' });
  }
});

// ─── POST /api/reservations ────────────────────────────────
// Create a new reservation
app.post('/api/reservations', (req, res) => {
  try {
    const { name, email, phone, date, time, guests, room_type, ordered_items, total_price, occasion, notes } = req.body;

    // Validation
    if (!name || !email || !date || !time || !guests) {
      return res.status(400).json({ success: false, error: 'Name, email, date, time, and guests are required.' });
    }

    const stmt = db.prepare(`
      INSERT INTO reservations (name, email, phone, date, time, guests, room_type, ordered_items, total_price, occasion, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(name, email, phone || null, date, time, parseInt(guests), room_type || 'non-ac', ordered_items || null, total_price || null, occasion || null, notes || null);

    res.json({
      success: true,
      message: 'Reservation confirmed! We look forward to serving you.',
      data: { id: result.lastInsertRowid }
    });
  } catch (err) {
    console.error('Reservation error:', err);
    res.status(500).json({ success: false, error: 'Failed to create reservation. Please try again.' });
  }
});

// ─── GET /api/testimonials ─────────────────────────────────
app.get('/api/testimonials', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM testimonials ORDER BY sort_order').all();
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Testimonials error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch testimonials' });
  }
});

// ─── POST /api/contact ─────────────────────────────────────
// Contact form submission
app.post('/api/contact', (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ success: false, error: 'Name, email, and message are required.' });
    }

    const stmt = db.prepare(`
      INSERT INTO contact_messages (name, email, subject, message)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(name, email, subject || null, message);

    res.json({ success: true, message: 'Thank you for your message! We will get back to you soon.' });
  } catch (err) {
    console.error('Contact error:', err);
    res.status(500).json({ success: false, error: 'Failed to send message. Please try again.' });
  }
});

// ─── GET /api/ambiance ─────────────────────────────────────
app.get('/api/ambiance', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM ambiance_items ORDER BY sort_order').all();
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Ambiance error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch ambiance' });
  }
});

// ─── PUT /api/ambiance/:id ─────────────────────────────────
app.put('/api/ambiance/:id', requireAdminAPI, (req, res) => {
  try {
    const { id } = req.params;
    const { title, icon, image, color } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'Title is required.' });
    const stmt = db.prepare('UPDATE ambiance_items SET title = ?, icon = ?, image = ?, color = ? WHERE id = ?');
    stmt.run(title, icon || null, image || null, color || null, id);
    res.json({ success: true, message: 'Ambiance updated!' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update ambiance.' });
  }
});

// ─── GET /api/gallery ──────────────────────────────────────
app.get('/api/gallery', (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM gallery_items ORDER BY sort_order').all();
    res.json({ success: true, data: items });
  } catch (err) {
    console.error('Gallery error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch gallery' });
  }
});

// ─── PUT /api/gallery/:id ──────────────────────────────────
app.put('/api/gallery/:id', requireAdminAPI, (req, res) => {
  try {
    const { id } = req.params;
    const { caption, image, icon } = req.body;
    const stmt = db.prepare('UPDATE gallery_items SET caption = ?, image = ?, icon = ? WHERE id = ?');
    stmt.run(caption || null, image || null, icon || null, id);
    res.json({ success: true, message: 'Gallery item updated!' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update gallery.' });
  }
});

// ─── POST /api/gallery ─────────────────────────────────────
app.post('/api/gallery', requireAdminAPI, (req, res) => {
  try {
    const { caption, image, icon } = req.body;
    if (!image && !icon) return res.status(400).json({ success: false, error: 'Image or icon is required.' });
    const stmt = db.prepare('INSERT INTO gallery_items (caption, image, icon, sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM gallery_items))');
    const result = stmt.run(caption || null, image || null, icon || '🍽');
    res.json({ success: true, message: 'Gallery item added!', data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to add gallery item.' });
  }
});

// ─── DELETE /api/gallery/:id ────────────────────────────────
app.delete('/api/gallery/:id', requireAdminAPI, (req, res) => {
  try {
    db.prepare('DELETE FROM gallery_items WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete.' });
  }
});

// ─── GET /api/restaurant-info ──────────────────────────────
app.get('/api/restaurant-info', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM restaurant_info').all();
    const info = {};
    rows.forEach(row => { info[row.key] = row.value; });
    res.json({ success: true, data: info });
  } catch (err) {
    console.error('Info error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch restaurant info' });
  }
});

// ─── PUT /api/restaurant-info ──────────────────────────────
app.put('/api/restaurant-info', requireAdminAPI, (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ success: false, error: 'Key and value are required.' });
    }
    // Check if key exists
    const existing = db.prepare('SELECT id FROM restaurant_info WHERE key = ?').get(key);
    if (existing) {
      db.prepare('UPDATE restaurant_info SET value = ? WHERE key = ?').run(value, key);
    } else {
      db.prepare('INSERT INTO restaurant_info (key, value) VALUES (?, ?)').run(key, value);
    }
    res.json({ success: true, message: 'Updated!' });
  } catch (err) {
    console.error('Info update error:', err);
    res.status(500).json({ success: false, error: 'Failed to update.' });
  }
});

// ══════════════════════════════════════════════════════════
//  PROTECTED ADMIN DATA
// ══════════════════════════════════════════════════════════

// ─── GET /api/admin/reservations ───────────────────────────
app.get('/api/admin/reservations', requireAdminAPI, (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM reservations ORDER BY created_at DESC').all();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch reservations' });
  }
});

// ─── PUT /api/admin/reservations/:id ───────────────────────
app.put('/api/admin/reservations/:id', requireAdminAPI, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'Status is required.' });
    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, id);
    res.json({ success: true, message: 'Reservation updated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update reservation.' });
  }
});

// ─── DELETE /api/admin/reservations/:id ─────────────────────
app.delete('/api/admin/reservations/:id', requireAdminAPI, (req, res) => {
  try {
    const { id } = req.params;
    db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
    res.json({ success: true, message: 'Reservation deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete reservation.' });
  }
});

// ─── GET /api/admin/messages ───────────────────────────────
app.get('/api/admin/messages', requireAdminAPI, (req, res) => {
  try {
    const items = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC').all();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

// ─── Fallback: serve index.html for all other routes ───────
app.use((req, res) => {
  // Only handle GET requests for HTML pages, skip API/static
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ success: false, error: 'Not found' });
  }
});

// ══════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║    ✦ Sultaf Restaurant — Full Stack    ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  console.log(`  📍 Local:      http://localhost:${PORT}`);
  console.log(`  🌐 Network:    http://${getLocalIP()}:${PORT}`);
  console.log('');
  console.log('  API Endpoints:');
  console.log(`     GET  /api/menu             Menu items`);
  console.log(`     POST /api/reservations     Book a table`);
  console.log(`     GET  /api/testimonials     Reviews`);
  console.log(`     POST /api/contact          Contact form`);
  console.log(`     GET  /api/restaurant-info  Restaurant info`);
  console.log('');
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});
