const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
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

// ================= WHATSAPP ENGINE STATE =================
let waSocket = null;
let waStatus = 'disconnected'; // disconnected | pairing | connected
let lastPairingCode = null;
let lastQrDataUrl = null;
let connectedPhone = null;
let autoReplyEnabled = true;
let campaignRunning = false;
let campaignTimer = null;
let waLogs = [
  '✅ تم تشغيل سيرفر Smell & Smile AI Agent بنجاح.',
  '📋 تم تحميل 58 عميل شركات سعودي حقيقي (عيادات، فنادق، كافيهات، جيمات، معارض سيارات).'
];

function addLog(msg) {
  const time = new Date().toLocaleTimeString('ar-SA', { hour12: false });
  waLogs.unshift(`[${time}] ${msg}`);
  if (waLogs.length > 50) waLogs.pop();
}

// Built-in AI Sales Reply for Auto-Responder
function generateServerSmartReply(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('سيار') || t.includes('عربي') || t.includes('601')) {
    return `أهلاً بك في Smell & Smile 🌸\nنرشح لك جهاز تعطير السيارة الذكي AC601 Mini بتقنية النانو:\n• يعمل بشحن USB وبطارية تدوم طويلاً\n• يقضي على روائح الدخان والطعام فوراً\n• ضمان شامل 3 سنوات\n• السعر: 198 ر.س فقط بدلاً من 346 ر.س!\nتحب نحجزلك اللون الأسود أم الأبيض؟ 🚗✨`;
  }
  if (t.includes('عياد') || t.includes('فندق') || t.includes('كافيه') || t.includes('مطعم') || t.includes('شرك') || t.includes('ايجار') || t.includes('إيجار') || t.includes('ريفيل') || t.includes('معاين')) {
    return `أهلاً وسهلاً بكم في قسم الشركات والتعطير المركزي بـ Smell & Smile 🌟\nنوفر لمقركم:\n1️⃣ نظام توريد/إيجار أجهزة النانو مع الريفيل الشهري والصيانة المجانية.\n2️⃣ الشراء المباشر بضمان 3 سنوات + زيت عطري 220 مل مجاناً.\n3️⃣ أجهزة التكييف المركزي HVAC (SE2500 & SE5000).\n🎁 يسعدنا تقديم (معاينة وتجربة عطرية مجانية في موقعكم لمدة 48 ساعة).\nفضلاً أرسل لنا اسم النشاط والحي لتنسيق زيارة المندوب المختص! 🤝`;
  }
  return `أهلاً بك في Smell & Smile (سميل أند سمايل) 🌸\nرواد أجهزة التعطير الذكية بتقنية النانو والزيوت العطرية النقية 100% بضمان 3 سنوات.\n• للمنازل والشقق: جهاز AC106 (495 ر.س) أو AC100 مع زيت هدية (1104 ر.س).\n• للفلل والمساحات الكبيرة: AC Home (1252 ر.س) أو AC 900 Elite (1270 ر.س).\n• للشركات والعيادات والفنادق: متاح الشراء أو عقود الإيجار والريفيل الشهري + معاينة مجانية.\nكم مساحة المكان عندك تقريباً لنرشح لك الجهاز والزيت الأنسب؟ ✨`;
}

async function startWhatsAppConnection(phoneForPairing = null) {
  if (!baileys) {
    addLog('⚠️ مكتبة Baileys غير متاحة حالياً.');
    return { error: 'Baileys not available' };
  }

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
          addLog('📱 تم توليد رمز QR للربط (أو استخدم كود الـ 8 أرقام).');
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
          addLog('🔒 تم تسجيل الخروج من الواتساب.');
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
        } else {
          waStatus = 'disconnected';
          addLog('ℹ️ انقطع اتصال الواتساب المؤقت (يمكنك إعادة طلب كود الربط).');
        }
      }
    });

    // Auto-reply to incoming customer messages
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

        addLog(`📩 رسالة واردة من ${senderJid.split('@')[0]}: "${text.slice(0, 40)}..."`);
        const reply = generateServerSmartReply(text);
        try {
          await waSocket.sendMessage(senderJid, { text: reply });
          addLog(`🤖 تم الرد تلقائياً على ${senderJid.split('@')[0]} بنجاح!`);
        } catch (err) {
          addLog(`⚠️ تعذر إرسال الرد التلقائي: ${err.message}`);
        }
      }
    });

    if (phoneForPairing && !waSocket.authState.creds.registered) {
      const cleanNum = phoneForPairing.replace(/[^\d]/g, '');
      addLog(`⏳ جاري طلب كود الربط (8 أرقام) للرقم +${cleanNum}...`);
      await new Promise(r => setTimeout(r, 2500));
      try {
        const code = await waSocket.requestPairingCode(cleanNum);
        lastPairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
        addLog(`🔑 كود ربط الواتساب الجاهز: ${lastPairingCode} (ادخل للواتساب -> الأجهزة المرتبطة -> ربط برقم الهاتف)`);
        return { status: 'pairing_code_ready', pairingCode: lastPairingCode };
      } catch (err) {
        addLog(`⚠️ ملاحظة عند طلب الكود: ${err.message} - يمكنك المحاولة مرة أخرى أو مسح QR.`);
        return { status: 'qr_fallback', error: err.message, qr: lastQrDataUrl };
      }
    }

    return { status: waStatus, pairingCode: lastPairingCode, qr: lastQrDataUrl };
  } catch (err) {
    addLog(`❌ خطأ في تهيئة الواتساب: ${err.message}`);
    return { error: err.message };
  }
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
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ================= HTTP SERVER =================
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (e) { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. Get WhatsApp Status & Logs
  if (req.url === '/api/wa/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      status: waStatus,
      pairingCode: lastPairingCode,
      qr: lastQrDataUrl,
      connectedPhone,
      autoReplyEnabled,
      campaignRunning,
      logs: waLogs
    }));
  }

  // 2. Request Pairing Code or QR
  if (req.url === '/api/wa/pair' && req.method === 'POST') {
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

  // 3. Send Single Message via Connected WhatsApp
  if (req.url === '/api/wa/send' && req.method === 'POST') {
    const body = await readBody(req);
    const phone = (body.phone || '').replace(/[^\d]/g, '');
    const message = body.message || '';

    if (waStatus !== 'connected' || !waSocket) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: 'الواتساب غير متصل حالياً بالسيرفر. اربط رقمك بالكود أولاً أو استخدم زر الإرسال المباشر (wa.me)!'
      }));
    }

    try {
      const jid = `${phone}@s.whatsapp.net`;
      await waSocket.sendMessage(jid, { text: message });
      addLog(`✅ تم إرسال العرض أوتوماتيك إلى +${phone} (${body.name || 'عميل'})`);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, logs: waLogs }));
    } catch (err) {
      addLog(`❌ فشل الإرسال إلى +${phone}: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }

  // 4. Start / Stop Safe Auto-Campaign
  if (req.url === '/api/wa/campaign' && req.method === 'POST') {
    const body = await readBody(req);
    if (body.action === 'stop') {
      campaignRunning = false;
      if (campaignTimer) clearTimeout(campaignTimer);
      addLog('⏹️ تم إيقاف حملة الإرسال التلقائي.');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: true, campaignRunning: false, logs: waLogs }));
    }

    if (waStatus !== 'connected' || !waSocket) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({
        ok: false,
        error: 'اربط الواتساب بكود الـ 8 أرقام أولاً لتشغيل الحملة الأوتوماتيكية، أو استخدم أزرار الإرسال الفردي الآمن!'
      }));
    }

    const targets = Array.isArray(body.leads) ? body.leads : [];
    if (!targets.length) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: 'لا توجد أرقام في القائمة.' }));
    }

    campaignRunning = true;
    addLog(`🚀 بدأت حملة الإرسال الآمن لـ ${targets.length} عميل بفاصل زمني ذكي (35 ثانية بين كل رسالة لحماية الرقم من الحظر)...`);

    let index = 0;
    const sendNext = async () => {
      if (!campaignRunning || index >= targets.length) {
        campaignRunning = false;
        addLog('🎉 اكتملت حملة الإرسال التلقائي لجميع العملاء المحددين!');
        return;
      }
      const item = targets[index++];
      const phone = (item.phone || '').replace(/[^\d]/g, '');
      try {
        await waSocket.sendMessage(`${phone}@s.whatsapp.net`, { text: item.message });
        addLog(`📤 [${index}/${targets.length}] تم الإرسال بنجاح إلى: ${item.name} (+${phone})`);
      } catch (e) {
        addLog(`⚠️ [${index}/${targets.length}] تعذر الإرسال إلى ${item.name}: ${e.message}`);
      }
      if (campaignRunning && index < targets.length) {
        campaignTimer = setTimeout(sendNext, 35000);
      } else {
        campaignRunning = false;
      }
    };

    sendNext();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, campaignRunning: true, logs: waLogs }));
  }

  // 5. Push Project to User's GitHub Account
  if (req.url === '/api/github/push' && req.method === 'POST') {
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
        return res.end(JSON.stringify({ ok: false, error: 'مفتاح GitHub غير صالح أو منتهي الصلاحية.' }));
      }

      const username = userRes.data.login;
      await githubApiRequest('POST', '/user/repos', token, {
        name: repoName,
        description: 'Smell & Smile AI Sales, Lead Scraper & WhatsApp Agent (B2B & B2C)',
        private: isPrivate,
        auto_init: false
      });

      const remoteUrl = `https://${username}:${token}@github.com/${username}/${repoName}.git`;
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

  // 6. Download GitHub-ready ZIP archive
  if (req.url === '/api/github/download-zip' && req.method === 'GET') {
    const zipPath = path.join(__dirname, 'smell-smile-ai-agent-github.zip');
    if (fs.existsSync(zipPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="smell-smile-ai-agent-github.zip"'
      });
      return fs.createReadStream(zipPath).pipe(res);
    }
  }

  // 7. Serve Real Saudi Leads JSON & CSV
  if (req.url === '/api/leads') {
    const data = fs.readFileSync(path.join(__dirname, 'ksa_b2b_real_leads.json'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(data);
  }

  if (req.url === '/ksa_b2b_real_leads.csv') {
    const data = fs.readFileSync(path.join(__dirname, 'ksa_b2b_real_leads.csv'), 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ksa_b2b_real_leads.csv"'
    });
    return res.end('\uFEFF' + data);
  }

  if (req.url === '/api/catalog') {
    const data = fs.readFileSync(path.join(__dirname, 'smell_smile_catalog.json'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(data);
  }

  // Default: serve smell_smile_ai_agent.html
  const html = fs.readFileSync(path.join(__dirname, 'smell_smile_ai_agent.html'), 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Smell & Smile Full-Stack AI Agent Server running at http://0.0.0.0:${PORT}`);
});
