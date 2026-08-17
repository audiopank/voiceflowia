#!/usr/bin/env bash
# Backup do banco de producao do VoiceFlow IA (Supabase).
#
# Por que existe: o projeto esta no Free Plan, que NAO faz backup nenhum
# ("No backups" no painel). Em 15/08/2026 vimos um banco Supabase de producao
# sumir do DNS sem aviso — este script e a copia que a gente controla.
#
# Como rodar:   bash backup-db.sh
# Precisa de:   Docker Desktop aberto + VOICEFLOW_DB_URL no .env.local
#
# A connection string NUNCA aparece na linha de comando: o script le do
# .env.local e passa pro container por variavel de ambiente.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$RAIZ/.env.local"
# Fora do repositorio de proposito: o dump tem dado de cliente e nao pode
# entrar em commit nenhum.
DESTINO="${VOICEFLOW_BACKUP_DIR:-/d/backups-voiceflow}"
IMAGEM="postgres:17"

falhar() { echo "ERRO: $*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || falhar "nao achei $ENV_FILE"

# Le so a variavel que interessa, sem imprimir o valor.
DB_URL="$(grep -E '^[[:space:]]*VOICEFLOW_DB_URL[[:space:]]*=' "$ENV_FILE" \
  | head -1 | cut -d= -f2- | tr -d '"'"'"'\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

[ -n "$DB_URL" ] || falhar "VOICEFLOW_DB_URL nao esta no .env.local
  Pegue em: Supabase > Project Settings > Database > Connection string > Session
  e cole no .env.local como VOICEFLOW_DB_URL=postgresql://..."

docker info >/dev/null 2>&1 || falhar "Docker nao esta rodando. Abra o Docker Desktop e tente de novo."

mkdir -p "$DESTINO"
CARIMBO="$(date +%Y-%m-%d_%H%M)"
ARQUIVO="$DESTINO/voiceflow_${CARIMBO}.sql"

echo "Baixando/conferindo a imagem $IMAGEM..."
docker pull -q "$IMAGEM" >/dev/null

echo "Gerando o dump (schemas public, auth e storage)..."
# --no-owner/--no-privileges: o dump restaura em qualquer projeto novo, sem
#   depender dos roles internos do Supabase.
# --clean --if-exists: o arquivo sabe se limpar antes de recriar, entao da pra
#   restaurar por cima sem erro de "ja existe".
# auth = seus usuarios; public = seus dados; storage = metadados dos arquivos.
DB_URL="$DB_URL" docker run --rm -i -e DB_URL --entrypoint sh "$IMAGEM" -c '
  pg_dump "$DB_URL" \
    --schema=public --schema=auth --schema=storage \
    --no-owner --no-privileges --clean --if-exists \
    --quote-all-identifiers
' > "$ARQUIVO"

# Um pg_dump completo termina com esta linha. Sem ela, o arquivo esta truncado
# e nao serve como backup — melhor falhar alto do que guardar copia quebrada.
if ! tail -5 "$ARQUIVO" | grep -q "PostgreSQL database dump complete"; then
  falhar "dump incompleto (o arquivo ficou em $ARQUIVO, mas nao confie nele)"
fi

TAM="$(du -h "$ARQUIVO" | cut -f1)"
TABELAS="$(grep -c '^CREATE TABLE' "$ARQUIVO" || true)"
echo
echo "OK — backup gravado"
echo "  arquivo : $ARQUIVO"
echo "  tamanho : $TAM"
echo "  tabelas : $TABELAS"
echo
echo "Copias existentes em $DESTINO:"
ls -1t "$DESTINO" | head -10
