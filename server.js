const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ===== СТРОКА ПОДКЛЮЧЕНИЯ (через переменную окружения) =====
// Локально: задаётся в .env
// На Render: задаётся в Environment Variables
const MONGO_URL = process.env.MONGO_URL;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ===== СХЕМЫ =====
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  stars: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastReward: { type: Date, default: null },
  wallpapers: { type: [String], default: ['default'] },
  activeWallpaper: { type: String, default: 'default' },
  createdAt: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  from: String,
  to: String,
  text: String,
  time: String,
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// ===== ОБОИ =====
const WALLPAPERS = [
  { id: 'default', name: 'Классика (тёмная)', price: 0, emoji: '🌑' },
  { id: 'space', name: 'Космос', price: 5, emoji: '🌌' },
  { id: 'stars', name: 'Звёздное небо', price: 10, emoji: '⭐' },
  { id: 'sunset', name: 'Закат', price: 15, emoji: '🌇' },
  { id: 'ocean', name: 'Океан', price: 20, emoji: '🌊' },
  { id: 'forest', name: 'Лес', price: 25, emoji: '🌲' },
  { id: 'fire', name: 'Огонь', price: 30, emoji: '🔥' },
  { id: 'royal', name: 'Королевские', price: 50, emoji: '👑' }
];

// ===== Пользователи онлайн =====
const users = new Map();

function sendUsersList() {
  const list = [];
  for (const u of users.values()) {
    if (!list.find(x => x.name === u.name)) {
      list.push({ name: u.name, email: u.email });
    }
  }
  io.emit('users-list', list);
}

function daysBetween(d1, d2) {
  const ms = new Date(d2) - new Date(d1);
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ===== API: РЕГИСТРАЦИЯ =====
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.json({ ok: false, error: 'Заполни все поля' });
    if (password.length < 4) return res.json({ ok: false, error: 'Пароль минимум 4 символа' });
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.json({ ok: false, error: 'Такой email уже есть' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email: email.toLowerCase(), password: hash, name });
    res.json({ ok: true, name: user.name, email: user.email });
  } catch (e) {
    console.error('Register error:', e.message);
    res.json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ===== API: ВХОД =====
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ ok: false, error: 'Заполни все поля' });
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ ok: false, error: 'Пользователь не найден' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.json({ ok: false, error: 'Неверный пароль' });
    res.json({ ok: true, name: user.name, email: user.email });
  } catch (e) {
    console.error('Login error:', e.message);
    res.json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ===== API: ДАННЫЕ ПОЛЬЗОВАТЕЛЯ =====
app.get('/api/user/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email.toLowerCase() });
    if (!user) return res.json({ ok: false });
    const canGetReward = !user.lastReward || daysBetween(user.lastReward, new Date()) >= 1;
    res.json({
      ok: true,
      stars: user.stars,
      streak: user.streak,
      lastReward: user.lastReward,
      wallpapers: user.wallpapers,
      activeWallpaper: user.activeWallpaper,
      canGetReward
    });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ===== API: ПОЛУЧИТЬ НАГРАДУ =====
app.post('/api/get-reward', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ ok: false, error: 'Пользователь не найден' });

    if (user.lastReward && daysBetween(user.lastReward, new Date()) < 1) {
      return res.json({ ok: false, error: 'Ты уже получил награду сегодня!' });
    }

    let newStreak = 1;
    if (user.lastReward) {
      const days = daysBetween(user.lastReward, new Date());
      if (days === 1) newStreak = user.streak + 1;
      else newStreak = 1;
    }

    let reward = 1;
    if (newStreak >= 7) reward = 5;
    else if (newStreak >= 3) reward = 3;
    else if (newStreak >= 2) reward = 2;

    user.stars += reward;
    user.streak = newStreak;
    user.lastReward = new Date();
    await user.save();

    res.json({ ok: true, reward, stars: user.stars, streak: user.streak });
  } catch (e) {
    console.error('Reward error:', e.message);
    res.json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ===== API: СПИСОК ОБОЕВ =====
app.get('/api/wallpapers', (req, res) => {
  res.json({ ok: true, wallpapers: WALLPAPERS });
});

// ===== API: КУПИТЬ ОБОИ =====
app.post('/api/buy-wallpaper', async (req, res) => {
  try {
    const { email, wallpaperId } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ ok: false, error: 'Пользователь не найден' });

    const wp = WALLPAPERS.find(w => w.id === wallpaperId);
    if (!wp) return res.json({ ok: false, error: 'Обои не найдены' });

    if (user.wallpapers.includes(wallpaperId)) {
      return res.json({ ok: false, error: 'У тебя уже есть эти обои' });
    }
    if (user.stars < wp.price) {
      return res.json({ ok: false, error: `Не хватает звёзд. Нужно ${wp.price}, у тебя ${user.stars}` });
    }

    user.stars -= wp.price;
    user.wallpapers.push(wallpaperId);
    user.activeWallpaper = wallpaperId;
    await user.save();

    res.json({ ok: true, stars: user.stars, wallpapers: user.wallpapers, activeWallpaper: user.activeWallpaper });
  } catch (e) {
    console.error('Buy error:', e.message);
    res.json({ ok: false, error: 'Ошибка сервера' });
  }
});

// ===== API: ПРИМЕНИТЬ ОБОИ =====
app.post('/api/set-wallpaper', async (req, res) => {
  try {
    const { email, wallpaperId } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ ok: false });
    if (!user.wallpapers.includes(wallpaperId)) {
      return res.json({ ok: false, error: 'Обои не куплены' });
    }
    user.activeWallpaper = wallpaperId;
    await user.save();
    res.json({ ok: true, activeWallpaper: wallpaperId });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ===== API: АДМИН — СПИСОК ПОЛЬЗОВАТЕЛЕЙ =====
app.get('/api/admin/users', async (req, res) => {
  try {
    const list = await User.find({}, 'name email stars').sort({ createdAt: -1 });
    res.json({ ok: true, users: list });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ===== API: АДМИН — ВЫДАТЬ ЗВЁЗДЫ =====
app.post('/api/admin/give-stars', async (req, res) => {
  try {
    const { email, amount, adminPassword } = req.body;
    if (adminPassword !== 'zxcqwe123') {
      return res.json({ ok: false, error: 'Неверный пароль админа' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ ok: false, error: 'Пользователь не найден' });
    user.stars += Number(amount) || 0;
    await user.save();
    res.json({ ok: true, stars: user.stars });
  } catch (e) {
    res.json({ ok: false, error: 'Ошибка' });
  }
});

// ===== API: АДМИН — СБРОСИТЬ STREAK =====
app.post('/api/admin/reset-streak', async (req, res) => {
  try {
    const { email, adminPassword } = req.body;
    if (adminPassword !== 'zxcqwe123') {
      return res.json({ ok: false, error: 'Неверный пароль' });
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.json({ ok: false });
    user.streak = 0;
    user.lastReward = null;
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ===== HEALTH CHECK для Render =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===== Socket.IO =====
io.on('connection', (socket) => {
  console.log('Подключился:', socket.id);

  socket.on('join', ({ name, email }) => {
    users.set(socket.id, { name, email });
    socket.data.name = name;
    socket.data.email = email;
    sendUsersList();
  });

  socket.on('private-message', async ({ to, text }) => {
    const from = socket.data.name;
    if (!from || !to || !text) return;
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const msg = { from, to, text, time };
    try { await Message.create(msg); } catch (e) { console.error(e.message); }
    for (const [id, u] of users.entries()) {
      if (u.name === to) io.to(id).emit('private-message', msg);
    }
    socket.emit('private-message', msg);
  });

  socket.on('get-history', async ({ with: other }) => {
    const me = socket.data.name;
    if (!me || !other) return;
    try {
      const msgs = await Message.find({
        $or: [{ from: me, to: other }, { from: other, to: me }]
      }).sort({ createdAt: 1 }).limit(200);
      socket.emit('chat-history', { with: other, messages: msgs });
    } catch (e) {
      socket.emit('chat-history', { with: other, messages: [] });
    }
  });

  socket.on('typing', ({ to }) => {
    const from = socket.data.name;
    for (const [id, u] of users.entries()) {
      if (u.name === to) io.to(id).emit('typing', { from });
    }
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    sendUsersList();
  });
});

// ===== ПОДКЛЮЧЕНИЕ =====
const PORT = process.env.PORT || 3000;

if (!MONGO_URL) {
  console.error('❌ Не задана переменная MONGO_URL!');
  console.error('Локально: создай файл .env и добавь MONGO_URL=...');
  console.error('На Render: добавь в Environment Variables');
  process.exit(1);
}

mongoose.connect(MONGO_URL)
  .then(() => {
    console.log('✅ MongoDB подключена!');
    server.listen(PORT, () => {
      console.log(`🚀 Сервер запущен на порту ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Ошибка MongoDB:', err.message);
  });