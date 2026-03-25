#!/usr/bin/env bash
set -e

# ── OS check ─────────────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Darwin) ;;
  Linux)  ;;
  *) echo "✗ Unsupported OS: $OS (macOS or Linux required)"; exit 1 ;;
esac

# ── nvm / NODE_BIN ────────────────────────────────────────────────────────────
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

if command -v node &>/dev/null; then
  NODE_BIN="$(command -v node)"
else
  echo "✗ node not found. Install via nvm: nvm install --lts"; exit 1
fi
echo "✓ node: $NODE_BIN"

# ── REPO_DIR ──────────────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "✓ repo: $REPO_DIR"

# ── openclaw.json ─────────────────────────────────────────────────────────────
OPENCLAW_CFG="$HOME/.openclaw/openclaw.json"
mkdir -p "$HOME/.openclaw"
if [ -f "$OPENCLAW_CFG" ]; then
  echo "⚠ $OPENCLAW_CFG уже существует — пропуск (не перезаписываю)"
else
  cp "$REPO_DIR/config/openclaw.example.json" "$OPENCLAW_CFG"
  echo "✓ создан: $OPENCLAW_CFG"
fi

# ── workspace-template → agents/*/workspace ───────────────────────────────────
for agent in 2b 9s 21o; do
  TARGET="$REPO_DIR/agents/$agent/workspace"
  if [ ! -d "$TARGET" ]; then
    cp -R "$REPO_DIR/workspace-template/" "$TARGET"
    echo "✓ workspace создан: $TARGET"
  else
    echo "⚠ workspace уже есть: $TARGET (пропуск)"
  fi
done

# ── npm install ───────────────────────────────────────────────────────────────
for agent in 2b 9s 21o; do
  LISTENER="$REPO_DIR/agents/$agent/mattermost-listener"
  if [ -f "$LISTENER/package.json" ]; then
    echo "→ npm install: $LISTENER"
    (cd "$LISTENER" && npm install --prefer-offline --no-fund --no-audit)
    echo "✓ deps: $LISTENER"
  fi
done

# ── services ──────────────────────────────────────────────────────────────────
if [ "$OS" = "Darwin" ]; then
  LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
  mkdir -p "$LAUNCH_AGENTS_DIR"

  for plist_src in "$REPO_DIR"/launchagents/*.plist; do
    [ -f "$plist_src" ] || continue
    plist_name="$(basename "$plist_src")"
    plist_dst="$LAUNCH_AGENTS_DIR/$plist_name"
    cp "$plist_src" "$plist_dst"

    python3 - "$plist_dst" "$NODE_BIN" "$REPO_DIR" <<'PYEOF'
import sys, plistlib, pathlib
path, node_bin, repo_dir = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "rb") as f:
    pl = plistlib.load(f)
args = pl.get("ProgramArguments", [])
pl["ProgramArguments"] = [node_bin if a == "__NODE_BIN__" else
                           a.replace("__REPO_DIR__", repo_dir) for a in args]
for k in ("WorkingDirectory", "StandardOutPath", "StandardErrorPath"):
    if k in pl:
        pl[k] = pl[k].replace("__REPO_DIR__", repo_dir)
with open(path, "wb") as f:
    plistlib.dump(pl, f)
PYEOF

    launchctl load "$plist_dst" 2>/dev/null || true
    echo "✓ loaded: $plist_name"
  done

else
  # Linux — systemd user services
  SYSTEMD_DIR="$HOME/.config/systemd/user"
  mkdir -p "$SYSTEMD_DIR"

  for agent in 2b 9s 21o; do
    SVC="openclaw-${agent}.service"
    LISTENER="$REPO_DIR/agents/$agent/mattermost-listener"
    [ -f "$LISTENER/index.js" ] || continue

    cat > "$SYSTEMD_DIR/$SVC" <<EOF
[Unit]
Description=OpenClaw agent $agent mattermost-listener
After=network.target

[Service]
ExecStart=$NODE_BIN $LISTENER/index.js
WorkingDirectory=$LISTENER
Restart=on-failure
EnvironmentFile=-$LISTENER/.env

[Install]
WantedBy=default.target
EOF
    systemctl --user enable --now "$SVC" 2>/dev/null || true
    echo "✓ service enabled: $SVC"
  done
fi

# ── checklist ─────────────────────────────────────────────────────────────────
cat <<'EOF'

✅ Готово! Осталось:
  1. Заполнить ~/.openclaw/openclaw.json — токены Telegram, API ключи
  2. Заполнить agents/2b/workspace/TOOLS.md
  3. Заполнить agents/2b/workspace/USER.md
  4. Вписать MM_TOKEN в mattermost-listener/.env
  5. openclaw gateway start
EOF
