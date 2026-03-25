# 🤖 OpenClaw Template — установка с нуля

Публичный шаблон для развёртывания [OpenClaw](https://github.com/openclaw) с нуля. Все токены заменены на плейсхолдеры — никаких секретов в репо.

## Структура папок

```
openclaw-template/
├── config/
│   └── openclaw.example.json     # Конфиг gateway (скопировать в ~/.openclaw/)
├── workspace-template/
│   ├── TOOLS.md.example          # Локальные заметки агента (камеры, SSH и т.д.)
│   ├── USER.md.example           # Контекст о пользователе
│   └── IDENTITY.md.example       # Личность агента
├── mattermost-listener/
│   ├── listener.js               # Слушатель WebSocket для Mattermost
│   └── .env.example              # MM_TOKEN и прочее
└── launchagents/
    └── com.openclaw.gateway.plist.example
```

## Установка

### 1. Node.js через nvm

```bash
nvm install 25.8.0
nvm use 25.8.0
nvm alias default 25.8.0
```

### 2. Установить OpenClaw

```bash
npm install -g openclaw
```

### 3. Клонировать этот репо

```bash
git clone <this-repo-url> ~/clawd
```

### 4. Настроить конфиг gateway

```bash
cp ~/clawd/config/openclaw.example.json ~/.openclaw/openclaw.json
```

Открыть `~/.openclaw/openclaw.json` и заполнить токены:

```json
{
  "agents": [
    {
      "name": "my-agent",
      "telegram": { "token": "YOUR_BOT_TOKEN" },
      "anthropic": { "apiKey": "YOUR_ANTHROPIC_KEY" },
      "contextTokens": 150000
    }
  ]
}
```

> **Про `contextTokens`:** рекомендуется `150000`. Не ставьте слишком маленькое значение — агент начнёт терять контекст.

### 5. Настроить workspace агента

```bash
cp -r ~/clawd/workspace-template/ ~/clawd/workspace/
```

Заполнить файлы по шаблонам:
- `TOOLS.md` — локальные детали (SSH-хосты, устройства и т.д.)
- `USER.md` — кто пользователь, как к нему обращаться
- `IDENTITY.md` — имя и характер агента

### 6. Mattermost listener (опционально)

```bash
cd ~/clawd/mattermost-listener
cp .env.example .env
# Вписать MM_TOKEN в .env
npm install ws
node listener.js
```

### 7. LaunchAgent (автозапуск на macOS)

```bash
cp ~/clawd/launchagents/com.openclaw.gateway.plist.example \
   ~/Library/LaunchAgents/com.openclaw.gateway.plist
```

Открыть plist и поправить пути под свой username. Затем:

```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.gateway.plist
```

### 8. Запуск

```bash
openclaw gateway start
```

### 9. Smoke test

Напишите своему Telegram-боту. Он должен ответить.

---

## ⚠️ Cooldown-ловушка при настройке

При первом запуске или смене токена агент может попасть в **cooldown** — временный запрет на ответы (Gateway считает, что агент флудит). Симптомы: бот молчит, в логах `cooldown`.

**Решение:** подождать 60 секунд после старта, прежде чем слать тестовые сообщения. Не перезапускайте gateway в панике — это сбрасывает таймер заново.

---

## Переменные-плейсхолдеры

| Плейсхолдер | Что вписать |
|---|---|
| `YOUR_BOT_TOKEN` | Telegram Bot API token (от @BotFather) |
| `YOUR_ANTHROPIC_KEY` | Anthropic API key или прокси-URL |
| `YOUR_MM_TOKEN` | Mattermost personal access token |
| `YOUR_USERNAME` | Ваш системный username (macOS) |
