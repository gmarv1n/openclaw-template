# ARCHITECTURE.md — Multi-Agent OpenClaw Template

## Обзор

Несколько агентов на одной машине (Linux/macOS), управляемые через OpenClaw:

| Агент | Роль | Канал |
|-------|------|-------|
| Agent-A | Личный ассистент | Telegram |
| Agent-B | Командный ассистент | Mattermost |
| Agent-C | Командный ассистент | Mattermost |

---

## Получение сообщений

```
Telegram → OpenClaw gateway → сессия Agent-A

Mattermost → WebSocket listener → openclaw gateway sessions_send → сессия Agent-B / Agent-C
```

- **Telegram:** gateway слушает напрямую по bot token.
- **Mattermost:** каждый агент имеет `mattermost-listener/` — Node.js процесс на WebSocket `wss://YOUR_MM_HOST`. Упоминание username → `openclaw gateway sessions_send`.

---

## Структура workspace агента

```
openclaw-template/
└── {agent}/
    ├── SOUL.md              # личность, правила поведения
    ├── AGENTS.md            # инструкции агента
    ├── TOOLS.md             # локальные заметки
    ├── MEMORY.md            # долгосрочная память
    ├── CONTEXT.md           # текущий контекст (опционально)
    ├── memory/
    │   └── YYYY-MM-DD.md   # ежедневные заметки
    ├── inbox/               # входящие от других агентов
    └── mattermost-listener/ # WebSocket listener (для MM-агентов)
```

---

## mattermost-listener

- Подключение: `wss://YOUR_MM_HOST/api/v4/websocket`
- Фильтр: событие `posted` + упоминание username агента
- Доставка: `openclaw gateway sessions_send --session <agent-session>`
- Keepalive: ping каждые 15 секунд
- Автореконнект: экспоненциальный backoff

---

## Автозапуск (macOS LaunchAgents / Linux systemd)

**macOS** — plist в `~/Library/LaunchAgents/` с `KeepAlive: true`:
```
com.yourorg.agent-b.listener
com.yourorg.agent-c.listener
```

**Linux** — systemd user units с `Restart=always`.

---

## Память агентов

| Файл | Назначение |
|------|-----------|
| `memory/YYYY-MM-DD.md` | Сырые заметки за день |
| `MEMORY.md` | Долгосрочная кураторская память |
| `CONTEXT.md` | Текущий рабочий контекст |

---

## Межагентное взаимодействие

- **inbox/**: асинхронная доставка файлом в папку другого агента.
- **sessions_send**: синхронная доставка если агент онлайн.

---

## OpenClaw конфиг

**`openclaw.json`**:
```json
{
  "agents": {
    "list": [
      { "name": "agent-a", "workspace": "/path/to/agent-a" },
      { "name": "agent-b", "workspace": "/path/to/agent-b" }
    ]
  },
  "contextTokens": 150000
}
```

Каждый агент = workspace путь. Gateway маршрутизирует по каналу (Telegram token / Mattermost username).
