#!/usr/bin/env bash
set -euo pipefail
OUT="${1:?usage: monitor.sh OUTPUT.csv}"
mkdir -p "$(dirname -- "$OUT")"
printf 'utc_epoch,mem_available_kib,swap_free_kib,gpu_util_pct,temp_c,power_w\n' > "$OUT"
while :; do
  TS="$(date -u +%s)"
  MEM="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
  SWAP="$(awk '/SwapFree:/ {print $2}' /proc/meminfo)"
  GPU='NA,NA,NA'
  if command -v nvidia-smi >/dev/null 2>&1; then
    GPU="$(nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ' || printf 'NA,NA,NA')"
  fi
  printf '%s,%s,%s,%s\n' "$TS" "$MEM" "$SWAP" "$GPU" >> "$OUT"
  sleep 2
done
