#!/usr/bin/env bash
set -euo pipefail
output="${1:?usage: monitor_host.sh OUTPUT.csv}"
interval="${2:-1}"
printf 'timestamp_utc,mem_available_kb,swap_free_kb,load1,gpu_util_pct,gpu_temp_c,gpu_power_w\n' > "$output"
while :; do
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mem="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
  swap="$(awk '/SwapFree:/ {print $2}' /proc/meminfo)"
  load="$(awk '{print $1}' /proc/loadavg)"
  gpu="$(nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ' || true)"
  [ -n "$gpu" ] || gpu='NA,NA,NA'
  printf '%s,%s,%s,%s,%s\n' "$ts" "$mem" "$swap" "$load" "$gpu" >> "$output"
  sleep "$interval"
done
