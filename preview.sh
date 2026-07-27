#!/bin/bash
# ── Preview Server ──────────────────────────────────────────────────────────
# Sobe um servidor HTTP estático para o build de produção (dist/), com
# suporte a SPA fallback (React Router). Usa `screen` para manter o processo
# vivo mesmo após o terminal ser fechado.
#
# Uso:
#   bash preview.sh            → constrói e sobe o servidor
#   bash preview.sh --build    → força rebuild antes de subir
#   bash preview.sh --kill     → mata o servidor em background
#   bash preview.sh --status   → mostra se o servidor está rodando
# ──────────────────────────────────────────────────────────────────────────────

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
SCREEN_NAME="portal-preview"
PORT=4173
SERVER_SCRIPT="$HERE/serve-dist.cjs"
DIST_DIR="$HERE/dist"
URL="http://127.0.0.1:$PORT"

# ── helpers ─────────────────────────────────────────────────────────────────

info()  { printf "\033[1;34m›\033[0m %s\n" "$1"; }
ok()    { printf "\033[1;32m✓\033[0m %s\n" "$1"; }
err()   { printf "\033[1;31m✗\033[0m %s\n" "$1"; }

# ── prerequisites ───────────────────────────────────────────────────────────

command -v screen >/dev/null 2>&1 || {
  err "screen não encontrado. Instale com: brew install screen"
  exit 1
}

command -v node >/dev/null 2>&1 || {
  err "node não encontrado. Instale Node.js 18+"
  exit 1
}

# ── commands ────────────────────────────────────────────────────────────────

kill_server() {
  local pid
  pid="$(lsof -t -i ":$PORT" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    info "Matando processo na porta $PORT (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    # Mata a sessão screen também, se existir
    screen -S "$SCREEN_NAME" -X quit 2>/dev/null || true
    sleep 1
    ok "Servidor anterior finalizado"
  else
    info "Nenhum servidor na porta $PORT"
  fi
}

status_server() {
  local pid
  pid="$(lsof -ti ":$PORT" 2>/dev/null || true)"
  if [ -n "$pid" ]; then
    local http_code
    http_code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/" 2>/dev/null || echo "000")"
    ok "Servidor rodando (PID $pid) — $URL responde HTTP $http_code"
  else
    err "Servidor parado na porta $PORT"
    return 1
  fi
}

build_project() {
  info "Compilando o projeto..."
  cd "$HERE"
  npx tsc -b && npx vite build
  ok "Build concluído"
}

start_server() {
  # Garante que o servidor script existe
  if [ ! -f "$SERVER_SCRIPT" ]; then
    err "Arquivo $SERVER_SCRIPT não encontrado."
    err "Execute este script a partir da raiz do projeto."
    exit 1
  fi

  if [ ! -d "$DIST_DIR" ]; then
    info "Pasta dist/ não encontrada. Compilando..."
    build_project
  fi

  kill_server

  info "Iniciando servidor em $URL ..."
  cd "$HERE"
  screen -dmS "$SCREEN_NAME" node "$SERVER_SCRIPT"

  # Aguarda o servidor ficar pronto (até 10 segundos)
  local attempt=0
  while [ $attempt -lt 10 ]; do
    if curl -s -o /dev/null "$URL/" 2>/dev/null; then
      ok "Servidor pronto! Acesse $URL"
      echo ""
      info "Para ver os logs:  screen -r $SCREEN_NAME"
      info "Para parar:        bash preview.sh --kill"
      info "Para testar rota:  $URL/login"
      info "Admin:             $URL/admin"
      exit 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  err "Servidor não respondeu após 10 segundos."
  # Tenta capturar logs do screen para diagnóstico
  local logfile
  logfile="/tmp/${SCREEN_NAME}-debug.log"
  screen -S "$SCREEN_NAME" -X hardcopy "$logfile" 2>/dev/null || true
  if [ -f "$logfile" ] && [ -s "$logfile" ]; then
    err "Últimas linhas do servidor:"
    head -5 "$logfile" | while IFS= read -r line; do err "  $line"; done
    rm -f "$logfile"
  fi
  err "Tente: bash preview.sh --kill && bash preview.sh --build"
  exit 1
}

# ── main ────────────────────────────────────────────────────────────────────

case "${1:-}" in
  --kill|-k)
    kill_server
    ;;
  --status|-s)
    status_server
    ;;
  --build|-b)
    build_project
    start_server
    ;;
  *)
    start_server
    ;;
esac
