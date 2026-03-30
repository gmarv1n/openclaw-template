#!/usr/bin/env node
/**
 * Оператор 21O — Mattermost WebSocket Listener
 * Слушает упоминания @YOUR_BOT_USERNAME и пишет в inbox-файл для обработки OpenClaw
 */

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const CONFIG = {
  serverURL: 'https://YOUR_MATTERMOST_HOST',
  wsURL: 'wss://YOUR_MATTERMOST_HOST/api/v4/websocket',
  token: process.env.MM_TOKEN || 'YOUR_MM_TOKEN',
  botUserId: 'YOUR_BOT_USER_ID',
  botTag: 'YOUR_BOT_USERNAME',
  inboxFile: path.join(process.env.HOME, '.openclaw', 'mattermost-inbox.json'),
  logFile: path.join(process.env.HOME, 'projects', 'agent-21o-workspace', 'mattermost-listener', 'listener.log'),
  // Telegram — для мгновенного уведомления 21O
  telegramBotToken: process.env.TG_BOT_TOKEN || 'YOUR_TG_BOT_TOKEN',
  telegramChatId: process.env.TG_CHAT_ID || 'YOUR_TG_CHAT_ID',
  reconnectDelay: 5000,
  maxReconnectDelay: 60000,
  // OpenClaw gateway token (из openclaw.json → gateway.auth.token)
  openclawToken: process.env.OPENCLAW_TOKEN || 'YOUR_OPENCLAW_TOKEN',
};

// Убедимся, что директория для inbox существует
const inboxDir = path.dirname(CONFIG.inboxFile);
if (!fs.existsSync(inboxDir)) {
  fs.mkdirSync(inboxDir, { recursive: true });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(CONFIG.logFile, line + '\n');
  } catch {}
}

function writeToInbox(event) {
  let inbox = [];
  try {
    if (fs.existsSync(CONFIG.inboxFile)) {
      inbox = JSON.parse(fs.readFileSync(CONFIG.inboxFile, 'utf8'));
    }
  } catch {}

  inbox.push(event);

  // Ограничиваем очередь 100 сообщениями
  if (inbox.length > 100) inbox = inbox.slice(-100);

  fs.writeFileSync(CONFIG.inboxFile, JSON.stringify(inbox, null, 2));
  log(`📥 Записано в inbox: ${event.type} от ${event.username} в канале ${event.channelId}`);
}

function markInboxProcessed(postId) {
  try {
    if (!fs.existsSync(CONFIG.inboxFile)) return;
    const inbox = JSON.parse(fs.readFileSync(CONFIG.inboxFile, 'utf8'));
    let changed = false;
    for (const item of inbox) {
      if (item.postId === postId && !item.processed) {
        item.processed = true;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(CONFIG.inboxFile, JSON.stringify(inbox, null, 2));
      log(`✅ Inbox помечен processed для postId=${postId}`);
    }
  } catch (err) {
    log(`⚠️ Не удалось пометить inbox processed: ${err.message}`);
  }
}

function notifyOpenClaw(event) {
  const body = JSON.stringify({
    tool: 'sessions_send',
    args: {
      sessionKey: 'agent:21o:main',
      message: `[MATTERMOST_EVENT] ${JSON.stringify(event)}`,
    },
  });

  const req = http.request({
    hostname: '127.0.0.1',
    port: 18789,
    path: '/tools/invoke',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${CONFIG.openclawToken}`,
    },
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        log(`✅ OpenClaw уведомлён`);
        // Сразу помечаем как processed — чтобы heartbeat не обработал повторно
        markInboxProcessed(event.postId);
      } else {
        log(`⚠️ OpenClaw ответил ${res.statusCode}: ${data.slice(0, 200)}`);
        // Не помечаем — пусть heartbeat подберёт как fallback
      }
    });
  });

  req.on('error', (err) => {
    log(`❌ Не удалось уведомить OpenClaw: ${err.message}`);
    // Не помечаем — heartbeat подберёт
  });
  req.write(body);
  req.end();
}

function notifyViaTelegram(event) {
  const text = `[MATTERMOST_EVENT] ${JSON.stringify(event)}`;
  const body = JSON.stringify({
    chat_id: CONFIG.telegramChatId,
    text,
  });

  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${CONFIG.telegramBotToken}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        log(`✅ Telegram уведомлён`);
      } else {
        log(`⚠️ Telegram ответил ${res.statusCode}: ${data.slice(0, 100)}`);
      }
    });
  });

  req.on('error', (err) => log(`❌ Не удалось уведомить через Telegram: ${err.message}`));
  req.write(body);
  req.end();
}

async function getChannelInfo(channelId) {
  return new Promise((resolve) => {
    const url = new URL(`/api/v4/channels/${channelId}`, CONFIG.serverURL);
    const req = https.request(url, {
      headers: { Authorization: `Bearer ${CONFIG.token}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function getUserInfo(userId) {
  return new Promise((resolve) => {
    const url = new URL(`/api/v4/users/${userId}`, CONFIG.serverURL);
    const req = https.request(url, {
      headers: { Authorization: `Bearer ${CONFIG.token}` }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function postToMattermost(channelId, message, rootId) {
  return new Promise((resolve) => {
    const payload = { channel_id: channelId, message };
    if (rootId) payload.root_id = rootId;
    const body = JSON.stringify(payload);
    const mmHost = new URL(CONFIG.serverURL).hostname;
    const req = https.request({
      hostname: mmHost,
      path: '/api/v4/posts',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CONFIG.token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function handleDMRedirect(event) {
  const TEAM_INTERNAL = 'YOUR_TEAM_CHANNEL_ID';
  const username = event.username;
  const msg = event.message;

  // 1. Ответ в DM
  await postToMattermost(
    event.channelId,
    'В личке вопросы не обсуждаю — пожалуйста, обратись в канал team-recirculation. 📡'
  );

  // 2. Вынести в team-internal
  await postToMattermost(
    TEAM_INTERNAL,
    `@${username} написал мне в личку: «${msg}». В личке никакие вопросы не обсуждаю, только здесь в общем канале в треде. 📡`
  );

  // 3. Уведомить 21O чтобы она написала Грише в Telegram кратко
  notifyOpenClaw({
    ...event,
    type: 'dm_redirect_done',
    note: `DM от @${username} вынесен в team-internal. Сообщение: «${msg.slice(0, 150)}»`,
  });

  log(`🔀 DM от @${username} вынесен в team-internal`);

  // Помечаем processed
  markInboxProcessed(event.postId);
}

async function handlePost(post) {
  // Игнорируем сообщения от самого бота
  if (post.user_id === CONFIG.botUserId) return;

  const mention = `@${CONFIG.botTag}`;

  // Проверяем — это прямое сообщение (DM) или упоминание в канале
  const channelInfo = await getChannelInfo(post.channel_id);
  const isDirect = channelInfo && (channelInfo.type === 'D' || channelInfo.type === 'G');
  const hasMention = post.message && post.message.toLowerCase().includes(mention.toLowerCase());

  if (!hasMention && !isDirect) return;

  const userInfo = await getUserInfo(post.user_id);

  const event = {
    type: isDirect ? 'direct_message' : 'mention',
    postId: post.id,
    rootId: post.root_id || post.id,
    channelId: post.channel_id,
    channelName: channelInfo ? channelInfo.name : post.channel_id,
    channelType: channelInfo ? channelInfo.type : 'unknown',
    userId: post.user_id,
    username: userInfo ? userInfo.username : post.user_id,
    message: post.message,
    timestamp: new Date().toISOString(),
    processed: false,
  };

  writeToInbox(event);

  // DM не от владельца — обрабатываем прямо здесь, без агента
  if (event.type === 'direct_message' && event.username !== 'YOUR_OWNER_USERNAME') {
    await handleDMRedirect(event);
    return;
  }

  notifyOpenClaw(event);
}

let ws = null;
let reconnectDelay = CONFIG.reconnectDelay;
let pingInterval = null;

function connect() {
  log(`🔌 Подключаюсь к ${CONFIG.wsURL}...`);

  ws = new WebSocket(CONFIG.wsURL, {
    headers: { Authorization: `Bearer ${CONFIG.token}` }
  });

  ws.on('open', () => {
    log('✅ WebSocket подключён');
    reconnectDelay = CONFIG.reconnectDelay;

    // Аутентификация
    ws.send(JSON.stringify({
      seq: 1,
      action: 'authentication_challenge',
      data: { token: CONFIG.token }
    }));

    // Mattermost application-level keepalive каждые 15 секунд
    let pingSeq = 100;
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ seq: pingSeq++, action: 'ping', data: {} }));
      }
    }, 15000);
  });

  ws.on('message', (data) => {
    try {
      const event = JSON.parse(data.toString());

      if (event.event === 'posted' && event.data && event.data.post) {
        const post = JSON.parse(event.data.post);
        handlePost(post).catch(err => log(`❌ Ошибка обработки поста: ${err.message}`));
      }
    } catch (err) {
      log(`❌ Ошибка парсинга события: ${err.message}`);
    }
  });

  ws.on('close', (code, reason) => {
    log(`🔴 WebSocket закрыт: ${code} ${reason}`);
    clearInterval(pingInterval);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log(`❌ WebSocket ошибка: ${err.message}`);
  });
}

function scheduleReconnect() {
  log(`⏳ Переподключение через ${reconnectDelay / 1000}s...`);
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, CONFIG.maxReconnectDelay);
    connect();
  }, reconnectDelay);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('👋 SIGTERM получен, завершаю...');
  if (ws) ws.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  log('👋 SIGINT получен, завершаю...');
  if (ws) ws.close();
  process.exit(0);
});

log('📡 Mattermost Listener запускается...');
connect();
