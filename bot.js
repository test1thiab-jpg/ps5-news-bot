// bot.js — بوت تيليجرام: أخبار ألعاب PlayStation مترجمة للعربي
const { Telegraf } = require('telegraf');
const { getNewNews, getLatestNews, formatNews } = require('./news');
const { recordUser, recordGroup, recordUse, getStats } = require('./stats');
const fs = require('fs');
const path = require('path');
const express = require('express');

// التوكن: من المتغير أو من ملف token.txt
let TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  try {
    TOKEN = fs.readFileSync(path.join(__dirname, 'token.txt'), 'utf8').trim();
  } catch {}
}
if (!TOKEN) {
  console.error('❌ ما حصلت على التوكن.');
  console.error('   حط التوكن في ملف token.txt ثم شغّل: node bot.js');
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// سجل داخلي (يُقرأ من /logs على السيرفر للتشخيص)
const recentLogs = [];
function log(...args) {
  const line = new Date().toISOString().slice(11, 19) + ' ' + args.join(' ');
  recentLogs.push(line);
  if (recentLogs.length > 200) recentLogs.shift();
  console.log(line);
}

const GROUP_FILE = path.join(__dirname, 'group.txt');

const WELCOME = `🎮 أهلين بك في بوت نبض فايف — أخبار ألعاب PlayStation!

📰 /news — آخر أخبار ألعاب PS5 مترجمة للعربي
📬 أضف البوت لأي مجموعة وبيفعّل نفسه تلقائياً ويرسل الأخبار كل 15 دقيقة!
❓ /help — طريقة الاستخدام`;

// تسجيل قائمة الأوامر ووصف البوت عشان تظهر في تيليجرام (زر القائمة وزر Help)
bot.telegram
  .setMyCommands([
    { command: 'start', description: '🚀 رسالة البداية' },
    { command: 'news', description: '📰 آخر أخبار ألعاب PS5 مترجمة' },
    { command: 'stats', description: '📊 إحصائيات البوت' },
    { command: 'help', description: '❓ طريقة الاستخدام' },
  ])
  .then(() => console.log('📋 قائمة الأوامر مسجلة عند تيليجرام.'))
  .catch((e) => console.error('فشل تسجيل الأوامر:', e.message));

bot.telegram
  .setMyDescription('🎮 بوت نبض فايف: آخر أخبار ألعاب PlayStation مترجمة للعربي، ترسل تلقائياً لمجموعتك.')
  .catch(() => {});
bot.telegram
  .setMyShortDescription('أخبار ألعاب PlayStation مترجمة 🎮')
  .catch(() => {});

// ------------------------------------------------------------
// أدوات المجموعة
// ------------------------------------------------------------
function getGroupId() {
  try {
    const id = fs.readFileSync(GROUP_FILE, 'utf8').trim();
    return id || null;
  } catch {
    return null;
  }
}

function setGroupId(id) {
  fs.writeFileSync(GROUP_FILE, String(id));
}

// إرسال قائمة أخبار لدردشة معينة
async function sendNewsToChat(chatId, items) {
  for (const item of items) {
    const msg = await formatNews(item);
    await bot.telegram.sendMessage(chatId, msg, { parse_mode: 'HTML' }).catch(() =>
      bot.telegram.sendMessage(chatId, msg)
    );
    await new Promise((r) => setTimeout(r, 400)); // تخفيف الضغط على الترجمة
  }
}

// تفعيل مجموعة تلقائياً وإرسال آخر الأخبار فوراً
async function activateGroup(chatId) {
  const already = getGroupId();
  if (already === String(chatId)) return;
  setGroupId(chatId);
  recordGroup(chatId); // نسجّله في الإحصائيات كمجموعة جديدة
  console.log('🎮 تم تفعيل المجموعة:', chatId);
  await bot.telegram
    .sendMessage(
      chatId,
      '🎮 تم تفعيل أخبار PS5 هنا تلقائياً! ✅\n\n⏳ جاري جلب آخر الأخبار...'
    )
    .catch(() => {});
  try {
    const items = await getLatestNews();
    await sendNewsToChat(chatId, items);
  } catch (e) {
    console.error('خطأ جلب أول أخبار:', e.message);
  }
}

// ------------------------------------------------------------
// أوامر
// ------------------------------------------------------------

// أول ميدلوير: تسجيل كل تحديث + إحصائيات + تفعيل المجموعات تلقائياً
bot.use(async (ctx, next) => {
  try {
    log(
      '📩 تحديث:',
      ctx.updateType,
      '| chat:',
      (ctx.chat && ctx.chat.id) || '-',
      '| from:',
      (ctx.from && ctx.from.id) || '-'
    );
    if (ctx.from) recordUser(ctx.from.id);
    if (ctx.update.message || ctx.update.callback_query) recordUse();
    const chat = ctx.chat;
    if (
      chat &&
      (chat.type === 'group' || chat.type === 'supergroup') &&
      getGroupId() !== String(chat.id)
    ) {
      await activateGroup(chat.id);
    }
  } catch (e) {
    log('⚠️ خطأ ميدلوير:', e.message);
  }
  return next();
});

bot.start((ctx) => ctx.reply(WELCOME));
bot.help((ctx) => ctx.reply(WELCOME));

// عند إضافة البوت لمجموعة جديدة → يفعّل نفسه فوراً
bot.on('my_chat_member', async (ctx) => {
  try {
    const upd = ctx.update.my_chat_member;
    const chat = upd.chat;
    const newStatus = upd.new_chat_member.status;
    if (
      (chat.type === 'group' || chat.type === 'supergroup') &&
      (newStatus === 'member' || newStatus === 'administrator')
    ) {
      await activateGroup(chat.id);
    }
  } catch (e) {
    console.error('خطأ my_chat_member:', e.message);
  }
});

// آخر الأخبار يدوياً
bot.command('news', async (ctx) => {
  try {
    await ctx.reply('⏳ جاري جلب آخر أخبار PS5 وترجمتها...');
    const items = await getLatestNews();
    if (!items.length) {
      return ctx.reply('ما قدرت أجيب أخبار الحين، جرب بعد شوي.').catch(() => {});
    }
    await sendNewsToChat(ctx.chat.id, items);
  } catch (err) {
    console.error('خطأ news:', err.message);
    await ctx.reply('⚠️ صار خطأ في جلب الأخبار، جرب بعد شوي.').catch(() => {});
  }
});

// معرف المطور (يُضبط من متغير OWNER_ID في لوحة Render)
const OWNER_ID = String(process.env.OWNER_ID || '').trim();

// حالة التشغيل (لأمر /status)
const STATUS_FILE = path.join(__dirname, 'status.json');
let lastTickTime = null;
let lastSentTime = null;
try {
  const st = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  lastSentTime = st.lastSent || null;
} catch {}

function saveStatus() {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ lastSent: lastSentTime }));
  } catch {}
}

// معرف المستخدم (أداة مساعدة)
bot.command('myid', async (ctx) => {
  try {
    await ctx.reply('🆔 معرفك: ' + ctx.from.id);
  } catch (e) {
    log('خطأ myid:', e.message);
  }
});

// حالة البوت (للمطور فقط)
bot.command('status', async (ctx) => {
  try {
    if (OWNER_ID && String(ctx.from.id) !== OWNER_ID) {
      return ctx.reply('🔒 هذه الميزة متاحة للمطور فقط.').catch(() => {});
    }
    const groupId = getGroupId();
    let seenCount = 0;
    try {
      seenCount = Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, 'seen.json'), 'utf8'))).length;
    } catch {}
    const fmt = (t) => {
      if (!t) return '—';
      try {
        return new Intl.DateTimeFormat('ar', {
          calendar: 'gregory',
          timeZone: 'Asia/Riyadh',
          day: 'numeric',
          month: 'numeric',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }).format(new Date(t));
      } catch {
        return String(t);
      }
    };
    await ctx.reply(
      '🔧 حالة البوت\n\n' +
        `📬 المجموعة: ${groupId ? 'مفعّلة ✅ (' + groupId + ')' : 'غير مفعّلة ❌'}\n` +
        `⏱️ آخر فحص للأخبار: ${fmt(lastTickTime)}\n` +
        `📤 آخر إرسال للمجموعة: ${fmt(lastSentTime)}\n` +
        `📚 أخبار مسجّلة بالمقروء: ${seenCount}\n` +
        '🌐 السيرفر: Render (سحابي)'
    );
  } catch (e) {
    log('خطأ status:', e.message);
    await ctx.reply('⚠️ صار خطأ في جلب الحالة.').catch(() => {});
  }
});

// إحصائيات البوت (للمطور فقط)
bot.command('stats', async (ctx) => {
  try {
    if (OWNER_ID && String(ctx.from.id) !== OWNER_ID) {
      return ctx.reply('🔒 هذه الميزة متاحة للمطور فقط.').catch(() => {});
    }
    const s = getStats();
    await ctx.reply(
      '📊 إحصائيات بوت نبض فايف\n\n' +
        '📅 اليوم:\n' +
        `👤 مستخدمين استخدموا البوت: ${s.usersToday}\n` +
        `🆕 مجموعات جديدة انضافت: ${s.newGroupsToday}\n` +
        `📈 استخدامات اليوم: ${s.usesToday}\n\n` +
        '🌍 الإجمالي:\n' +
        `👥 إجمالي المستخدمين: ${s.totalUsers}\n` +
        `📁 إجمالي المجموعات: ${s.totalGroups}\n` +
        `🔢 إجمالي الاستخدامات: ${s.totalUses}`
    );
  } catch (err) {
    log('خطأ stats:', err.message);
    await ctx.reply('⚠️ صار خطأ في جلب الإحصائيات.').catch(() => {});
  }
});

// أي رسالة أخرى
bot.on('text', (ctx) => {
  const t = (ctx.message.text || '').trim();
  if (t.startsWith('/')) return;
  return ctx
    .reply('🎮 أرسل /news عشان أجيب لك آخر أخبار ألعاب PS5 مترجمة.')
    .catch(() => {});
});

bot.catch((err) => log('Bot error:', err.message));

// ------------------------------------------------------------
// الجدولة: فحص الأخبار كل 15 دقيقة وإرسالها للمجموعة
// ------------------------------------------------------------
async function newsTick() {
  try {
    const groupId = getGroupId();
    lastTickTime = new Date().toISOString();

    if (!groupId) {
      // لا مجموعة بعد — ما نسجّل الأخبار (ننتظر تفعيل المجموعة عشان ما نفوّت أخبار)
      return;
    }

    const fresh = await getNewNews();
    if (fresh.length) {
      await sendNewsToChat(groupId, fresh);
      lastSentTime = new Date().toISOString();
      saveStatus();
      console.log(`📰 أرسلت ${fresh.length} خبر جديد للمجموعة.`);
    }
  } catch (err) {
    console.error('خطأ في الجدولة:', err.message);
  }
}

setInterval(newsTick, 15 * 60 * 1000);
// أول فحص بعد 10 ثواني من التشغيل
setTimeout(newsTick, 10 * 1000);

// ------------------------------------------------------------
// التشغيل: سحابي (Webhook) إذا فيه منفذ PORT، وإلا محلي (Polling)
// ------------------------------------------------------------
const PORT = process.env.PORT;

if (PORT) {
  // وضع السحابة (Koyeb / Render / أي منصة تعطي PORT)
  const app = express();
  let webhookSet = false;

  // صفحة الفحص: أول زيارة تسجّل الـ webhook تلقائياً
  app.get(['/', '/ping'], async (req, res) => {
    if (!webhookSet && process.env.SKIP_WEBHOOK_SET !== '1') {
      try {
        const base = 'https://' + req.headers.host;
        await bot.telegram.setWebhook(base + '/webhook');
        webhookSet = true;
        console.log('🔗 Webhook مسجل على:', base + '/webhook');
      } catch (e) {
        console.error('فشل تسجيل webhook:', e.message);
      }
    }
    res.send('OK ✅ بوت نبض فايف شغال');
  });

  app.use(bot.webhookCallback('/webhook'));

  // صفحة السجل الداخلي (للتشخيص)
  app.get('/logs', (req, res) => {
    res.type('text/plain').send(recentLogs.slice(-60).join('\n') || '(لا سجلات)');
  });

  app.listen(PORT, () => {
    console.log('🌐 وضع السحابة: الخادم شغال على المنفذ', PORT);
    console.log('   افتح رابط التطبيق مرة وحدة عشان يتسجل الـ webhook.');
  });
} else {
  // وضع محلي: استطلاع مستمر
  bot.launch();
  console.log('✅ البوت شغال (وضع محلي)');
}

console.log('📰 فحص الأخبار: كل 15 دقيقة.');
console.log('📬 أي مجموعة ينضاف لها تتفعّل تلقائياً.');
