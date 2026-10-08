// news.js — جلب أخبار PS5 وترجمتها للعربية بجودة أعلى
const fs = require('fs');
const path = require('path');

const SEEN_FILE = path.join(__dirname, 'seen.json');

// مصادر الأخبار
const FEEDS = [
  { name: 'PlayStation Blog', url: 'https://blog.playstation.com/feed/' },
  { name: 'Push Square', url: 'https://www.pushsquare.com/feeds/latest' },
];

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

// ------------------------------------------------------------
// تنظيف النصوص
// ------------------------------------------------------------
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// قص الوصف عند نهاية جملة كاملة (أقصى جملتين أو 280 حرف)
function truncateDesc(s, maxLen = 280, maxSent = 2) {
  const sentences = String(s || '').split(/(?<=[.!?])\s+/);
  let out = '';
  let count = 0;
  for (const sent of sentences) {
    if (count >= maxSent) break;
    const candidate = out ? out + ' ' + sent : sent;
    if (candidate.length > maxLen) {
      if (!out) out = candidate.slice(0, maxLen).trimEnd() + '…';
      break;
    }
    out = candidate;
    count++;
  }
  return out.trim();
}

// ------------------------------------------------------------
// تحليل RSS و Atom
// ------------------------------------------------------------
function parseFeed(xml) {
  const items = [];
  let re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  let usedAtom = false;

  while ((m = re.exec(xml))) {
    const b = m[1];
    const title = stripHtml((b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1]);
    const link = stripHtml((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
    const rawDesc =
      (b.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] ||
      (b.match(/<content:encoded>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/) || [])[1];
    const pubDate = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
    if (title && link) {
      items.push({
        title,
        link,
        description: truncateDesc(stripHtml(rawDesc)),
        date: pubDate ? new Date(pubDate).toISOString() : null,
      });
    }
  }

  if (items.length === 0) {
    usedAtom = true;
    re = /<entry>([\s\S]*?)<\/entry>/g;
    while ((m = re.exec(xml))) {
      const b = m[1];
      const title = stripHtml((b.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]);
      const link = (b.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
      const rawDesc = (b.match(/<(?:content|summary)[^>]*>([\s\S]*?)<\/(?:content|summary)>/) || [])[1];
      const updated = (b.match(/<updated>([^<]+)/) || [])[1];
      if (title && link) {
        items.push({
          title,
          link,
          description: truncateDesc(stripHtml(rawDesc)),
          date: updated ? new Date(updated).toISOString() : null,
        });
      }
    }
  }

  return items;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} من ${feed.name}`);
  const xml = await res.text();
  const items = parseFeed(xml);
  return items.map((i) => ({ ...i, source: feed.name }));
}

// ------------------------------------------------------------
// الترجمة
// ------------------------------------------------------------
// تنظيف مخرجات الترجمة: هاشتاقات، مسافات زايدة، روابط معلقة
function cleanArabic(s) {
  return String(s)
    .replace(/\s?#\s?[A-Za-z0-9_]+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// مسجّل خارجي (يربطه bot.js بسجله الدائم)
let logger = (...args) => console.log(...args);
function setLogger(fn) {
  logger = fn;
}

// آخر مترجم نجح (للتشخيص)
let lastBackend = 'none';
let lastAttempts = [];

async function translate(text, target = 'ar') {
  const t = String(text).trim();
  if (!t) return '';
  lastAttempts = [];

  const tryGoogle = async (url) => {
    try {
      const res = await fetch(url, { headers: UA });
      if (res.ok) {
        const data = await res.json();
        const out = cleanArabic((data[0] || []).map((seg) => seg[0]).join(''));
        if (out) return out;
        lastAttempts.push('google: json فارغ');
      } else {
        lastAttempts.push('google: HTTP ' + res.status);
      }
    } catch (e) {
      lastAttempts.push('google: ' + e.message);
    }
    return null;
  };

  // 1) جوجل gtx
  let out = await tryGoogle(
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      target + '&dt=t&q=' + encodeURIComponent(t)
  );
  if (out) { lastBackend = 'google'; return out; }

  // 2) جوجل dict-chrome-ex (يشتغل غالباً حتى لو الأول محجوب)
  out = await tryGoogle(
    'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=' +
      target + '&q=' + encodeURIComponent(t)
  );
  if (out) { lastBackend = 'google-chrome'; return out; }

  // 3) DeepL (موثوق من السيرفرات السحابية — مفتاح مجاني من deepl.com)
  const deepLKey = String(process.env.DEEPL_KEY || '').trim();
  if (deepLKey) {
    try {
      const body = new URLSearchParams();
      body.append('text', t);
      body.append('target_lang', target.toUpperCase() === 'AR' ? 'AR' : target.toUpperCase());
      const res = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...UA },
        body: body.toString(),
      });
      if (res.ok) {
        const data = await res.json();
        const out = data.translations && data.translations[0] && data.translations[0].text;
        if (out) {
          lastBackend = 'deepl';
          return cleanArabic(out);
        }
        lastAttempts.push('deepl: استجابة بدون ترجمة');
      } else {
        lastAttempts.push('deepl: HTTP ' + res.status);
      }
    } catch (e) {
      lastAttempts.push('deepl: ' + e.message);
    }
  }

  // 4) احتياطي MyMemory
  try {
    const url =
      'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(t) + '&langpair=en|' + target;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.responseData && data.responseData.translatedText) {
        lastBackend = 'mymemory';
        return cleanArabic(data.responseData.translatedText);
      }
      lastAttempts.push('mymemory: استجابة بدون ترجمة');
    } else {
      lastAttempts.push('mymemory: HTTP ' + res.status);
    }
  } catch (e) {
    lastAttempts.push('mymemory: ' + e.message);
  }

  // 5) احتياطي LibreTranslate (مثيلات عامة)
  const libreHosts = [
    'https://translate.argosopentech.com',
    'https://libretranslate.de',
    'https://translate.fedilab.app',
  ];
  for (const host of libreHosts) {
    try {
      const res = await fetch(host + '/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...UA },
        body: JSON.stringify({ q: t, source: 'auto', target, format: 'text' }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.translatedText) {
          lastBackend = 'libretranslate';
          return cleanArabic(data.translatedText);
        }
        lastAttempts.push(host + ': بدون ترجمة');
      } else {
        lastAttempts.push(host + ': HTTP ' + res.status);
      }
    } catch (e) {
      lastAttempts.push(host + ': ' + e.message);
    }
  }

  logger('⚠️ فشلت كل المترجمين — النص يرجع بالأصل:', t.slice(0, 60));
  lastBackend = 'failed';
  return t;
}

/**
 * ترجمة العنوان والوصف معاً في طلب واحد (سياق أفضل وجودة أعلى)
 * نستخدم ||| كفاصل ثم نقسم الناتج
 */
async function translatePair(title, desc, target = 'ar') {
  if (!desc) {
    return { title: await translate(title, target), desc: '' };
  }

  const combined = `${title}\n|||\n${desc}`;
  const out = await translate(combined, target);
  const parts = out.split(/\s*\|\|\|\s*/);
  if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
    return { title: parts[0].trim(), desc: parts[1].trim() };
  }

  // إذا انكسر الفاصل نترجم كل واحد لحاله
  return {
    title: await translate(title, target),
    desc: await translate(desc, target),
  };
}

// ------------------------------------------------------------
// إدارة الأخبار المقروءة (حالة دائمة على القرص تتحمل إعادة التشغيل والنوم)
// ------------------------------------------------------------
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && 'initialized' in raw) {
      return { initialized: !!raw.initialized, seen: raw.seen || {} };
    }
    // صيغة قديمة: نعتبرها مهيأة
    return { initialized: true, seen: raw || {} };
  } catch {
    return { initialized: false, seen: {} };
  }
}

function saveState(st) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify(st));
}

// مواضيع نعتبرها غير "أخبار" ونتجاهلها (بودكاست وحصص تفاعلية وغيرها)
const EXCLUDE = [
  /podcast/i,
  /share of the week/i,
  /what are you playing this weekend/i,
  /poll\s*[:(]/i,
];

async function collectNews() {
  const all = [];
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      all.push(...items);
    } catch (e) {
      console.error('فشل جلب', feed.name, ':', e.message);
    }
  }
  const uniq = [];
  const links = new Set();
  for (const i of all) {
    if (EXCLUDE.some((re) => re.test(i.title))) continue;
    if (!links.has(i.link)) {
      links.add(i.link);
      uniq.push(i);
    }
  }
  return uniq;
}

/** الأخبار الجديدة فقط (التهيئة الصامتة مرة واحدة وتُحفظ، فلا تتكرر بعد النوم) */
async function getNewNews() {
  const st = loadState();
  const all = await collectNews();

  const fresh = all.filter((i) => !st.seen[i.link]);

  if (!st.initialized) {
    // أول تشغيل على الإطلاق: نسجّل الحالي بدون إرسال
    fresh.forEach((i) => (st.seen[i.link] = true));
    st.initialized = true;
    saveState(st);
    return [];
  }

  fresh.forEach((i) => (st.seen[i.link] = true));
  saveState(st);
  return fresh.slice(0, 5);
}

/** آخر الأخبار بغض النظر عن المقروء (لأمر /news) */
async function getLatestNews() {
  const all = await collectNews();
  return all.slice(0, 5);
}

// ------------------------------------------------------------
// تنسيق الرسالة
// ------------------------------------------------------------
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// التاريخ بالعربي وبتوقيت السعودية
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('ar', {
      calendar: 'gregory',
      timeZone: 'Asia/Riyadh',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

/** تجهيز خبر كرسالة HTML جاهزة للإرسال */
async function formatNews(item) {
  const { title, desc } = await translatePair(item.title, item.description || '');
  const dateStr = formatDate(item.date);

  let text = `<b>🎮 ${esc(title)}</b>`;
  if (desc) text += `\n\n${esc(desc)}`;
  text += `\n\n🔗 <a href="${esc(item.link)}">الخبر الأصلي</a>`;
  if (dateStr) text += `\n🗓️ ${dateStr}`;
  text += `\n📰 المصدر: ${esc(item.source)}`;
  return text;
}

module.exports = {
  getNewNews,
  getLatestNews,
  formatNews,
  translate,
  setLogger,
  get lastBackend() { return lastBackend; },
  get lastAttempts() { return lastAttempts; },
};
