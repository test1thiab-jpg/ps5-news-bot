// stats.js — تتبع إحصائيات استخدام البوت
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'stats.json');

let stats = null;

function load() {
  if (stats) return stats;
  try {
    stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch {
    stats = { users: {}, groups: {}, totalUses: 0, days: {} };
  }
  return stats;
}

function save() {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats));
}

// تاريخ اليوم بتوقيت السعودية
function todayKey() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function day() {
  const s = load();
  const k = todayKey();
  if (!s.days[k]) s.days[k] = { users: {}, newGroups: {}, uses: 0 };
  return s.days[k];
}

// تسجيل مستخدم (فريد)
function recordUser(id) {
  const s = load();
  const d = day();
  const key = String(id);
  if (!s.users[key]) s.users[key] = 1;
  if (!d.users[key]) d.users[key] = 1;
  save();
}

// تسجيل مجموعة (تحسب كجديدة أول مرة فقط)
function recordGroup(chatId) {
  const s = load();
  const d = day();
  const key = String(chatId);
  if (!s.groups[key]) {
    s.groups[key] = 1;
    d.newGroups[key] = 1;
  }
  save();
}

// تسجيل استخدام (أي رسالة أو أمر)
function recordUse() {
  const s = load();
  s.totalUses++;
  day().uses++;
  save();
}

// ملخص الإحصائيات
function getStats() {
  const s = load();
  const d = day();
  return {
    usersToday: Object.keys(d.users).length,
    newGroupsToday: Object.keys(d.newGroups).length,
    usesToday: d.uses,
    totalUsers: Object.keys(s.users).length,
    totalGroups: Object.keys(s.groups).length,
    totalUses: s.totalUses,
  };
}

module.exports = { recordUser, recordGroup, recordUse, getStats };
