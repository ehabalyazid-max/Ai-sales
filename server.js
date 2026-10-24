const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { execSync } = require('child_process');
const pino = require('pino');
const QRCode = require('qrcode');

let baileys = null;
try {
  baileys = require('@whiskeysockets/baileys');
} catch (e) {
  console.warn('Baileys not loaded:', e.message);
}

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'leads_db.json');
const INITIAL_LEADS_FILE = path.join(__dirname, 'ksa_b2b_real_leads.json');

// ================= MASSIVE LEADS DATABASE (SUPPORTS 40,000+ NUMBERS) =================
let leadsDb = [];

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      leadsDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else if (fs.existsSync(INITIAL_LEADS_FILE)) {
      const initial = JSON.parse(fs.readFileSync(INITIAL_LEADS_FILE, 'utf8'));
      leadsDb = initial.map((x, i) => ({
        id: i + 1,
        name: x.name || `عميل #${i + 1}`,
        phone: x.phone,
        category: x.category || 'عميل مستهدف',
        sector: x.sector || 'general',
        city: x.city || 'السعودية',
        status: 'pending' // pending | sent | replied | failed
      }));
      saveDatabase();
    }
  } catch (e) {
    console.error('DB load error:', e.message);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(leadsDb));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

loadDatabase();

// ================= ANTI-BAN SPINTAX & SMART VARIATION ENGINE =================
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateAntiBanMessage(lead, mode = 'safe_hook') {
  const greet = pick([
    'السلام عليكم ورحمة الله 🌸',
    'أهلاً وسهلاً بحضرتك ✨',
    'تحية طيبة ويومكم سعيد 🌿',
    'يا هلا ومرحبا 🌸',
    'مساء الخير والسرور ✨',
    'أسعد الله أوقاتكم بكل خير 🌷'
  ]);

  const namePart = lead.name && !lead.name.startsWith('عميل #')
    ? `إدارة *${lead.name}* الكرام`
    : 'حضرتك';

  // Safe Hook Mode: Ultra-safe first message that triggers customer reply (100% Anti-Ban)
  if (mode === 'safe_hook') {
    const intro = pick([
      `معكم قسم حلول التعطير من شركة *Smell & Smile (سميل أند سمايل)*`,
      `نتواصل معكم من شركة *سميل أند سمايل* للحلول العطرية وأجهزة النانو`,
      `معكم مستشار التعطير الذكي من براند *Smell & Smile*`
    ]);
    const offer = pick([
      `نقدم هذا الأسبوع *تجربة ومعاينة عطرية مجانية لمدة 48 ساعة* للمنشآت والمنازل المميزة، مع عروض خاصة على أنظمة الإيجار والريفيل الشهري أو الشراء بضمان 3 سنوات.`,
      `وفرنا دفعة جديدة من أجهزة التعطير بتقنية النانو الباردة والزيوت الفندقية النقية 100% (بنظام الريفيل الشهري أو الشراء المباشر مع هدية مجانية).`,
      `خصصنا عرض تجربة مجانية لتعطير المكان بروائح الفنادق الخمس نجوم (هوتيل بلس وروح الرياض) بدون أي التزام مالي قبل التجربة.`
    ]);
    const cta = pick([
      `هل يناسبكم إرسال الكتالوج وتفاصيل العرض هنا؟ (فقط أرسل الرقم 1 أو كلمة "تفاصيل") 🤝`,
      `تحب أبعتلك تفاصيل العرض والأسعار؟ (رد بكلمة "نعم" أو "مهتم" وسأرسلها فوراً) 🌸`,
      `هل متاح إرسال كتالوج الأجهزة والزيوت لحضرتك الآن؟ ✨`
    ]);
    return `${greet}\nأهلاً بـ ${namePart}،\n\n${intro}.\n${offer}\n\n${cta}`;
  }

  // Full B2B Rental & Refill Pitch with Spintax
  if (mode === 'b2b_rental') {
    return `${greet}\nتحية طيبة لـ ${namePart}،\n\nمعكم مستشار الحلول العطرية من *Smell & Smile (سميل أند سمايل)* 🌟\nيسعدنا تقديم:\n✅ *${pick(['نظام إيجار/توريد أجهزة التعطير مع الريفيل الشهري', 'عقود التعطير الشهري الشاملة للأجهزة والزيوت والصيانة'])}* أو الشراء بضمان 3 سنوات.\n🎁 مع *${pick(['معاينة وتجربة عطرية مجانية في مكانكم لمدة 48 ساعة', 'زيارة مجانية لتجربة الروائح الفندقية على الطبيعة قبل التعاقد'])}*.\n\n${pick(['هل يناسبكم تنسيق زيارة سريعة للمندوب هذا الأسبوع؟', 'متى يناسبكم التواصل لتنسيق التجربة المجانية؟'])} 🤝`;
  }

  // B2C Home & Perfumes Pitch with Spintax
  return `${greet}\nأهلاً بك من *Smell & Smile* 🌸\n${pick(['حوّل جو بيتك أو سيارتك لرائحة فنادق الـ 5 نجوم!', 'استمتع بثبات عطري يدوم 30 يوماً بتقنية النانو الباردة!'])}\n🔥 ${pick(['خصم 38% على جهاز AC106 الذكي (495 ر.س فقط)', 'زيت عطري 220 مل هدية مجانية مع جهاز AC100 الفاخر'])} + ضمان شامل 3 سنوات.\n\n${pick(['تحب أبعتلك الكتالوج وأرشحلك الجهاز الأنسب لمساحتك؟', 'اكتبلي مساحة المكان عندك وهطلعلك أنسب جهاز فوراً!'])} 🚚`;
}

// ================= WHATSAPP ENGINE STATE =================
let waSocket = null;
let waStatus = 'disconnected';
let lastPairingCode = null;
let lastQrDataUrl = null;
let connectedPhone = null;
let autoReplyEnabled = true;

let campaignState = {
  running: false,
  mode: 'safe_hook',
  minDelaySec: 25,
  maxDelaySec: 55,
  dailyLimit: 250,
  batchPauseEvery: 25,
  batchPauseSec: 180,
  sentThisSession: 0,
  failedThisSession: 0
};
let campaignTimer = null;

let waLogs = [
  `✅ محرك الـ 40,000 رقم جاهز! إجمالي الأرقام المسجلة حالياً: ${leadsDb.length} رقم.`,
  `🛡️ نظام الحماية من الحظر (Anti-Ban Spintax + الفاصل العشوائي البشري + استراحة كل 25 رسالة) مفعّل.`
];

function addLog(msg) {
  const time = new Date().toLocaleTimeString('ar-SA', { hour12: false });
  waLogs.unshift(`[${time}] ${msg}`);
  if (waLogs.length > 80) waLogs.pop();
}

// Built-in AI Sales Reply when Customer Replies to the Campaign!
function generateServerSmartReply(text) {
  const t = (text || '').toLowerCase().trim();

  // If customer replies "1", "نعم", "تفاصيل", "مهتم", "اه", "ابعت", "كتالوج" -> Send the full interactive catalog!
  if (t === '1' || t.includes('نعم') || t.includes('تفاصيل') || t.includes('مهتم') || t.includes('كتالوج') || t.includes('ابعت') || t.includes('تفضل') || t.includes('اوك') || t.includes('تمام')) {
    return `شرف لنا تواصلك مع *Smell & Smile (سميل أند سمايل)* 🌸✨\n\nإليك ملخص حلولنا وعروضنا الحالية (جميع أجهزتنا بتقنية النانو الباردة و*بضمان شامل 3 سنوات*):\n\n1️⃣ *للشركات والعيادات والفنادق والكافيهات (B2B):*\n• متاح *نظام الإيجار/التوريد مع الريفيل الشهري* (شامل الصيانة وتغيير العطور مجاناً).\n• أو *الشراء المباشر* لأجهزة المساحات المتوسطة والكبيرة (AC100 / AC 900 Elite / AC250 ULTRA) وأجهزة التكييف المركزي HVAC (SE2500 & SE5000).\n• 🎁 *ميزة خاصة:* نرسل لك مندوباً لعمل *معاينة وتجربة عطرية مجانية في مكانك*!\n\n2️⃣ *للمنازل والفلل والسيارات (B2C):*\n• جهاز السيارة والمكتب *AC601 Mini* بـ 198 ر.س بدلاً من 346 ر.س.\n• جهاز الشقق والريسبشن *AC106* (شحن + كهرباء) بـ 495 ر.س بدلاً من 815 ر.س.\n• جهاز *AC100* المعدني الفاخر بـ 1104 ر.س + *عبوة زيت 220 مل هدية مجانية تكفي 30 يوماً*!\n• بوكس عينات العطور الشخصية الثابتة بـ 39 ر.س فقط.\n\n👈 *قولي بس: طلبك لـ (منزل / سيارة) ولا (شركة / عيادة / كافيه / فندق)؟ وكم المساحة التقريبية؟* وهرد عليك بالعرض المخصص فوراً! 🤝`;
  }

  if (t.includes('سيار') || t.includes('عربي') || t.includes('601')) {
    return `أهلاً بك في Smell & Smile 🌸\nنرشح لك جهاز تعطير السيارة الذكي *AC601 Mini* بتقنية النانو:\n• يعمل بشحن USB وبطارية تدوم طويلاً\n• يقضي على روائح الدخان والطعام فوراً\n• ضمان شامل 3 سنوات\n• السعر: 198 ر.س فقط بدلاً من 346 ر.س!\nتحب نحجزلك اللون الأسود أم الأبيض؟ 🚗✨`;
  }
  if (t.includes('عياد') || t.includes('فندق') || t.includes('كافيه') || t.includes('مطعم') || t.includes('شرك') || t.includes('ايجار') || t.includes('إيجار') || t.includes('ريفيل') || t.includes('معاين')) {
    return `أهلاً وسهلاً بكم في قسم الشركات والتعطير المركزي بـ *Smell & Smile* 🌟\nنوفر لمقركم:\n1️⃣ نظام توريد/إيجار أجهزة النانو مع الريفيل الشهري والصيانة المجانية.\n2️⃣ الشراء المباشر بضمان 3 سنوات + زيت عطري 220 مل مجاناً.\n3️⃣ أجهزة التكييف المركزي HVAC (SE2500 & SE5000).\n🎁 يسعدنا تقديم (معاينة وتجربة عطرية مجانية في موقعكم لمدة 48 ساعة).\nفضلاً أرسل لنا اسم النشاط والمدينة لتنسيق زيارة المندوب المختص! 🤝`;
  }
  return `أهلاً بك في *Smell & Smile (سميل أند سمايل)* 🌸\nرواد أجهزة التعطير الذكية بتقنية النانو والزيوت العطرية النقية 100% بضمان 3 سنوات.\n• للمنازل والشقق: جهاز AC106 (495 ر.س) أو AC100 مع زيت هدية (1104 ر.س).\n• للفلل والمساحات الكبيرة: AC Home (1252 ر.س) أو AC 900 Elite (1270 ر.س).\n• للشركات والعيادات والفنادق: متاح الشراء أو عقود الإيجار والريفيل الشهري + معاينة مجانية.\nكم مساحة المكان عندك تقريباً لنرشح لك الجهاز والزيت الأنسب؟ ✨`;
}

async function startWhatsAppConnection(phoneForPairing = null) {
  if (!baileys) return { error: 'Baileys not available' };

  try {
    const {
      default: makeWASocket,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      DisconnectReason
    } = baileys;

    const authDir = path.join(__dirname, '.wa_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    let version = [2, 3000, 1015901307];
    try {
      const vRes = await fetchLatestBaileysVersion();
      if (vRes && vRes.version) version = vRes.version;
    } catch (e) {}

    if (waSocket) {
      try { waSocket.end(undefined); } catch (e) {}
      waSocket = null;
    }

    waStatus = 'pairing';
    lastPairingCode = null;
    lastQrDataUrl = null;

    waSocket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        try {
          lastQrDataUrl = await QRCode.toDataURL(qr);
        } catch (e) {}
      }
      if (connection === 'open') {
        waStatus = 'connected';
        lastPairingCode = null;
        lastQrDataUrl = null;
        connectedPhone = waSocket.user?.id?.split(':')[0] || phoneForPairing || 'متصل';
        addLog(`🎉 تم ربط الواتساب بنجاح! الرقم المتصل: ${connectedPhone}`);
      } else if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          waStatus = 'disconnected';
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
        } else {
          waStatus = 'disconnected';
        }
      }
    });

    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || !autoReplyEnabled) return;
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        const senderJid = msg.key.remoteJid;
        if (!senderJid || senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') continue;

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          '';
        if (!text.trim()) continue;

        const senderPhone = senderJid.split('@')[0];
        addLog(`📩 رد جديد من العميل +${senderPhone}: "${text.slice(0, 45)}"`);

        // Mark lead as replied in DB
        const found = leadsDb.find(l => l.phone === senderPhone);
        if (found) {
          found.status = 'replied';
          saveDatabase();
        }

        // Wait 3-6 seconds before auto-replying so it feels 100% human
        const replyDelay = 3000 + Math.floor(Math.random() * 3000);
        setTimeout(async () => {
          try {
            const reply = generateServerSmartReply(text);
            await waSocket.sendMessage(senderJid, { text: reply });
            addLog(`🤖 تم إرسال الكتالوج والرد البيعي تلقائياً إلى +${senderPhone}`);
          } catch (err) {
            addLog(`⚠️ تعذر الرد التلقائي: ${err.message}`);
          }
        }, replyDelay);
      }
    });

    if (phoneForPairing && !waSocket.authState.creds.registered) {
      const cleanNum = phoneForPairing.replace(/[^\d]/g, '');
      addLog(`⏳ جاري استخراج كود الربط (8 أرقام) للرقم +${cleanNum}...`);
      await new Promise(r => setTimeout(r, 2500));
      try {
        const code = await waSocket.requestPairingCode(cleanNum);
        lastPairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
        addLog(`🔑 كود الربط الجاهز: ${lastPairingCode}`);
        return { status: 'pairing_code_ready', pairingCode: lastPairingCode };
      } catch (err) {
        return { status: 'qr_fallback', error: err.message, qr: lastQrDataUrl };
      }
    }

    return { status: waStatus, pairingCode: lastPairingCode, qr: lastQrDataUrl };
  } catch (err) {
    return { error: err.message };
  }
}

// ================= BULK PHONE CLEANER & IMPORTER (HANDLES 40,000+ NUMBERS FAST) =================
function normalizePhoneFast(raw) {
  if (!raw) return '';
  const map = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};
  let s = String(raw).replace(/[٠-٩]/g, d => map[d]).replace(/[^\d]/g, '');
  if (s.startsWith('00')) s = s.slice(2);
  if (s.length === 10 && s.startsWith('05')) return '966' + s.slice(1);
  if (s.length === 9 && s.startsWith('5')) return '966' + s;
  if (s.length === 11 && /^01[0125]/.test(s)) return '2' + s;
  if (s.length === 10 && /^1[0125]/.test(s)) return '20' + s;
  if (s.length >= 11 && s.length <= 15) return s;
  return '';
}

function bulkImportRawText(rawText, defaultCategory = 'قائمة الـ 40 ألف رقم 🎯', defaultCity = 'السعودية / مصر') {
  const existingSet = new Set(leadsDb.map(l => l.phone));
  const lines = rawText.split(/\r?\n/);
  let added = 0;
  let duplicates = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Extract all phone-like sequences from the line
    const matches = line.match(/(?:\+?966[\s-]*5\d[\d\s-]{7,9}|0?5\d[\d\s-]{7,9}|\+?20[\s-]*1[0125]\d[\d\s-]{7,9}|0?1[0125]\d[\d\s-]{7,9}|\d{10,14})/g);
    if (!matches) continue;

    for (const m of matches) {
      const clean = normalizePhoneFast(m);
      if (!clean) continue;
      if (existingSet.has(clean)) {
        duplicates++;
        continue;
      }
      existingSet.add(clean);
      const namePart = line.replace(m, '').replace(/[,;|\t"-]+/g, ' ').trim().slice(0, 50);
      leadsDb.push({
        id: leadsDb.length + 1,
        name: namePart || `عميل #${leadsDb.length + 1}`,
        phone: clean,
        category: defaultCategory,
        sector: 'bulk',
        city: clean.startsWith('966') ? 'السعودية' : (clean.startsWith('20') ? 'مصر' : defaultCity),
        status: 'pending'
      });
      added++;
    }
  }

  if (added > 0) saveDatabase();
  addLog(`📥 استيراد ضخم ناجح: تم إضافة ${added} رقم جديد (تم استبعاد ${duplicates} رقم مكرر). الإجمالي الآن: ${leadsDb.length} رقم!`);
  return { added, duplicates, total: leadsDb.length };
}

// ================= ANTI-BAN SMART CAMPAIGN ENGINE FOR 40,000 NUMBERS =================
function startSmartBulkCampaign(options = {}) {
  if (waStatus !== 'connected' || !waSocket) {
    return { ok: false, error: 'اربط الواتساب بكود الـ 8 أرقام أولاً ليبدأ السيرفر الإرسال التلقائي، أو استخدم الإرسال السريع بالدفعات!' };
  }

  campaignState.running = true;
  campaignState.mode = options.mode || 'safe_hook';
  campaignState.minDelaySec = Math.max(15, parseInt(options.minDelaySec, 10) || 25);
  campaignState.maxDelaySec = Math.max(campaignState.minDelaySec + 10, parseInt(options.maxDelaySec, 10) || 55);
  campaignState.dailyLimit = parseInt(options.dailyLimit, 10) || 250;
  campaignState.sentThisSession = 0;

  addLog(`🚀 انطلقت حملة الـ Anti-Ban الذكية! (الحد الآمن للجلسة: ${campaignState.dailyLimit} رسالة | فاصل عشوائي: ${campaignState.minDelaySec}-${campaignState.maxDelaySec} ثانية | استراحة كل 25 رسالة)`);

  const processNextLead = async () => {
    if (!campaignState.running) return;

    if (campaignState.sentThisSession >= campaignState.dailyLimit) {
      campaignState.running = false;
      addLog(`🛡️ تم الوصول للحد اليومي الآمن (${campaignState.dailyLimit} رسالة) لحماية رقمك من الحظر! يمكنك استكمال الدفعة التالية غداً أو من رقم آخر.`);
      return;
    }

    const nextLead = leadsDb.find(l => l.status === 'pending');
    if (!nextLead) {
      campaignState.running = false;
      addLog('🎉 تم الانتهاء من جميع الأرقام في قاعدة البيانات بالكامل!');
      return;
    }

    const msgText = generateAntiBanMessage(nextLead, campaignState.mode);
    try {
      await waSocket.sendMessage(`${nextLead.phone}@s.whatsapp.net`, { text: msgText });
      nextLead.status = 'sent';
      campaignState.sentThisSession++;
      saveDatabase();
      addLog(`📤 [${campaignState.sentThisSession}/${campaignState.dailyLimit}] تم الإرسال بنجاح بصيغة فريدة إلى: ${nextLead.name} (+${nextLead.phone})`);
    } catch (err) {
      nextLead.status = 'failed';
      campaignState.failedThisSession++;
      saveDatabase();
      addLog(`⚠️ تخطي الرقم +${nextLead.phone}: ${err.message}`);
    }

    if (!campaignState.running) return;

    // Every 25 messages, take a 3-minute human coffee break!
    let nextWaitMs = (campaignState.minDelaySec + Math.floor(Math.random() * (campaignState.maxDelaySec - campaignState.minDelaySec))) * 1000;
    if (campaignState.sentThisSession > 0 && campaignState.sentThisSession % campaignState.batchPauseEvery === 0) {
      nextWaitMs = campaignState.batchPauseSec * 1000;
      addLog(`☕ استراحة حماية ذكية لمدة ${campaignState.batchPauseSec} ثانية بعد إرسال ${campaignState.sentThisSession} رسالة (لمحاكاة السلوك البشري 100%)...`);
    }

    campaignTimer = setTimeout(processNextLead, nextWaitMs);
  };

  processNextLead();
  return { ok: true, campaignState };
}

// ================= GITHUB PUSH HELPER =================
function githubApiRequest(method, apiPath, token, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'Smell-Smile-AI-Agent',
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }); }
        catch (e) { resolve({ status: res.statusCode, data: {} }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function readBody(req, maxBytes = 50 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total <= maxBytes) chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(str || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

// ================= HTTP SERVER =================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Paginated Leads Endpoint (Supports 40,000+ leads smoothly!)
  if (pathname === '/api/leads/page' && req.method === 'GET') {
    const page = Math.max(1, parseInt(parsedUrl.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(parsedUrl.query.limit, 10) || 50));
    const sector = parsedUrl.query.sector || 'all';
    const statusFilter = parsedUrl.query.status || 'all';
    const search = (parsedUrl.query.q || '').trim().toLowerCase();

    const filtered = leadsDb.filter(l => {
      if (sector !== 'all' && l.sector !== sector) return false;
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (search && !l.name.toLowerCase().includes(search) && !l.phone.includes(search) && !(l.city || '').toLowerCase().includes(search)) return false;
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    const counts = {
      total: leadsDb.length,
      pending: leadsDb.filter(l => l.status === 'pending').length,
      sent: leadsDb.filter(l => l.status === 'sent').length,
      replied: leadsDb.filter(l => l.status === 'replied').length
    };

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      page,
      limit,
      total,
      totalPages,
      counts,
      items
    }));
  }

  // 2. Massive Bulk Import Endpoint (40,000+ numbers in 1 second)
  if (pathname === '/api/leads/bulk-import' && req.method === 'POST') {
    const body = await readBody(req);
    const result = bulkImportRawText(body.rawText || '', body.category, body.city);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ...result, logs: waLogs }));
  }

  // 3. Mark Lead Status
  if (pathname === '/api/leads/mark' && req.method === 'POST') {
    const body = await readBody(req);
    const lead = leadsDb.find(l => l.id === body.id || l.phone === body.phone);
    if (lead) {
      lead.status = body.status || 'sent';
      saveDatabase();
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // 4. WhatsApp Status
  if (pathname === '/api/wa/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      status: waStatus,
      pairingCode: lastPairingCode,
      qr: lastQrDataUrl,
      connectedPhone,
      campaignState,
      counts: {
        total: leadsDb.length,
        pending: leadsDb.filter(l => l.status === 'pending').length,
        sent: leadsDb.filter(l => l.status === 'sent').length,
        replied: leadsDb.filter(l => l.status === 'replied').length
      },
      logs: waLogs
    }));
  }

  // 5. WhatsApp Pairing
  if (pathname === '/api/wa/pair' && req.method === 'POST') {
    const body = await readBody(req);
    const result = await startWhatsAppConnection(body.phone || null);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ...result,
      status: waStatus,
      pairingCode: lastPairingCode,
      qr: lastQrDataUrl,
      logs: waLogs
    }));
  }

  // 6. Start / Stop Smart Anti-Ban Campaign
  if (pathname === '/api/wa/campaign' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.action === 'stop') {
      campaignState.running = false;
      if (campaignTimer) clearTimeout(campaignTimer);
      addLog('⏹️ تم إيقاف حملة الإرسال التلقائي وحفظ مكان التوقف.');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, campaignState, logs: waLogs }));
    }

    const resStart = startSmartBulkCampaign(body);
    res.writeHead(resStart.ok ? 200 : 400, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ...resStart, logs: waLogs }));
  }

  // 7. Send Single Message via Connected Server
  if (pathname === '/api/wa/send' && req.method === 'POST') {
    const body = await readBody(req);
    const phone = (body.phone || '').replace(/[^\d]/g, '');
    const message = body.message || '';

    if (waStatus !== 'connected' || !waSocket) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: 'الواتساب غير متصل بالسيرفر حالياً. اربط بالكود أولاً أو اضغط زر واتساب الأخضر!'
      }));
    }

    try {
      await waSocket.sendMessage(`${phone}@s.whatsapp.net`, { text: message });
      const found = leadsDb.find(l => l.phone === phone);
      if (found) { found.status = 'sent'; saveDatabase(); }
      addLog(`✅ تم الإرسال أوتوماتيك إلى +${phone} (${body.name || 'عميل'})`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, logs: waLogs }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // 8. Push to GitHub
  if (pathname === '/api/github/push' && req.method === 'POST') {
    const body = await readBody(req);
    const token = (body.token || '').trim();
    const repoName = (body.repoName || 'smell-smile-ai-agent').trim().replace(/\s+/g, '-');
    const isPrivate = !!body.isPrivate;

    if (!token) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'أدخل مفتاح GitHub Personal Access Token أولاً.' }));
    }

    try {
      const userRes = await githubApiRequest('GET', '/user', token);
      if (userRes.status !== 200 || !userRes.data.login) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'مفتاح GitHub غير صالح.' }));
      }
      const username = userRes.data.login;
      await githubApiRequest('POST', '/user/repos', token, {
        name: repoName,
        description: 'Smell & Smile 40K Bulk WhatsApp AI Sales Agent & Anti-Ban Engine',
        private: isPrivate,
        auto_init: false
      });

      const remoteUrl = `https://${username}:${token}@github.com/${username}/${repoName}.git`;
      execSync(`git add . && git commit -m "Update 40K Bulk Engine" || true`, { cwd: __dirname });
      execSync(`git branch -M main`, { cwd: __dirname });
      try { execSync(`git remote remove github_target`, { cwd: __dirname }); } catch (e) {}
      execSync(`git remote add github_target "${remoteUrl}"`, { cwd: __dirname });
      execSync(`git push -u github_target main --force`, { cwd: __dirname });
      try { execSync(`git remote remove github_target`, { cwd: __dirname }); } catch (e) {}

      const publicUrl = `https://github.com/${username}/${repoName}`;
      addLog(`🐙 تم رفع المشروع بالكامل على GitHub: ${publicUrl}`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, url: publicUrl, username, repoName }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // 9. Export All Leads CSV
  if (pathname === '/ksa_b2b_real_leads.csv') {
    let csv = '\uFEFFالاسم,رقم الواتساب,القطاع,المدينة,الحالة\n';
    for (const l of leadsDb) {
      csv += `"${(l.name || '').replace(/"/g, '""')}",${l.phone},"${l.category || ''}","${l.city || ''}","${l.status || 'pending'}"\n`;
    }
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="smell_smile_leads_export.csv"'
    });
    return res.end(csv);
  }

  if (pathname === '/api/github/download-zip') {
    const zipPath = path.join(__dirname, 'smell-smile-ai-agent-github.zip');
    if (fs.existsSync(zipPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="smell-smile-ai-agent-github.zip"'
      });
      return fs.createReadStream(zipPath).pipe(res);
    }
  }

  const html = fs.readFileSync(path.join(__dirname, 'smell_smile_ai_agent.html'), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Smell & Smile 40K Enterprise AI Agent Server running at http://0.0.0.0:${PORT}`);
});
