#!/bin/bash
# ─────────────────────────────────────────────────────────────
# RetailMind Load Test Script
# Hits CloudFront + API Gateway at varying concurrency levels
# Outputs CSV for graphing (Excel, Google Sheets, Python, etc.)
# ─────────────────────────────────────────────────────────────
#
# Usage:
#   bash scripts/load-test.sh
#
# Before running:
#   1. Set CLOUDFRONT_URL and API_URL below
#   2. Set TOKEN to your Cognito ID token (grab from browser dev tools → Network → Authorization header)
#   3. Optionally adjust CONCURRENCY_LEVELS and REQUESTS_PER_LEVEL
#
# Output:
#   results/load-test-results.csv   — raw data (one row per request)
#   results/load-test-summary.csv   — aggregated stats per endpoint + concurrency
#   Terminal prints a summary table when done
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ═══════ CONFIGURE THESE ═══════
CLOUDFRONT_URL="${CLOUDFRONT_URL:-https://dquehu2ohxwqm.cloudfront.net}"
API_URL="${API_URL:-https://xou98cxmqe.execute-api.ap-southeast-1.amazonaws.com/prod}"
TOKEN="${COGNITO_TOKEN:-}"            # Cognito ID token — grab from browser: Dev Tools → Network → any API request → Authorization header (paste the part after "Bearer ")

# Test parameters
CONCURRENCY_LEVELS=(1 10 25 50 100)
REQUESTS_PER_LEVEL=50   # requests per concurrency level per endpoint
# ════════════════════════════════

RESULTS_DIR="results"
RAW_CSV="$RESULTS_DIR/load-test-results.csv"
SUMMARY_CSV="$RESULTS_DIR/load-test-summary.csv"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

mkdir -p "$RESULTS_DIR"

# CSV headers
echo "timestamp,endpoint,endpoint_type,concurrency,request_num,http_code,time_total,time_connect,time_starttfb,size_download" > "$RAW_CSV"

# ─────────────────────────────────────────────────────────────
# Define endpoints to test
# Format: "name|url|type|needs_auth"
# ─────────────────────────────────────────────────────────────
ENDPOINTS=()

# Always test CloudFront (no auth needed)
ENDPOINTS+=("CloudFront_Home|${CLOUDFRONT_URL}/|frontend|no")

# If API_URL is set, add API endpoints
if [ -n "$API_URL" ]; then
  ENDPOINTS+=("API_ListPreloaded|${API_URL}/preloaded-datasets|api_read|yes")
  ENDPOINTS+=("API_ListProjects|${API_URL}/projects|api_read|yes")

  # POST endpoint (chat) — uncomment if you want to test write endpoints
  # ENDPOINTS+=("API_Chat|${API_URL}/chat|api_write|yes")
fi

if [ ${#ENDPOINTS[@]} -eq 0 ]; then
  echo "ERROR: No endpoints configured. Set CLOUDFRONT_URL or API_URL."
  exit 1
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║           RetailMind Load Test                          ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Endpoints:    ${#ENDPOINTS[@]}                                        ║"
echo "║  Concurrency:  ${CONCURRENCY_LEVELS[*]}"
echo "║  Requests/lvl: $REQUESTS_PER_LEVEL                                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─────────────────────────────────────────────────────────────
# Run a batch of concurrent curl requests
# Args: $1=endpoint_name $2=url $3=type $4=needs_auth $5=concurrency
# ─────────────────────────────────────────────────────────────
run_batch() {
  local name="$1" url="$2" type="$3" needs_auth="$4" concurrency="$5"
  local auth_header=""

  if [ "$needs_auth" = "yes" ] && [ -n "$TOKEN" ]; then
    auth_header="-H \"Authorization: Bearer $TOKEN\""
  elif [ "$needs_auth" = "yes" ] && [ -z "$TOKEN" ]; then
    echo "  ⚠ Skipping $name (no TOKEN set)"
    return
  fi

  local pids=()
  local batch_start=$(date +%s%N)

  for i in $(seq 1 "$REQUESTS_PER_LEVEL"); do
    (
      if [ -n "$auth_header" ]; then
        result=$(curl -o /dev/null -s -w "%{http_code},%{time_total},%{time_connect},%{time_starttfb},%{size_download}" \
          -H "Authorization: Bearer $TOKEN" "$url" 2>/dev/null)
      else
        result=$(curl -o /dev/null -s -w "%{http_code},%{time_total},%{time_connect},%{time_starttfb},%{size_download}" \
          "$url" 2>/dev/null)
      fi
      echo "$TIMESTAMP,$name,$type,$concurrency,$i,$result" >> "$RAW_CSV"
    ) &

    # Throttle: only allow $concurrency parallel jobs
    pids+=($!)
    if [ ${#pids[@]} -ge "$concurrency" ]; then
      wait "${pids[0]}" 2>/dev/null
      pids=("${pids[@]:1}")
    fi
  done

  # Wait for remaining
  wait 2>/dev/null

  local batch_end=$(date +%s%N)
  local batch_ms=$(( (batch_end - batch_start) / 1000000 ))
  echo "  ✓ $name @ c=$concurrency — ${batch_ms}ms total"
}

# ─────────────────────────────────────────────────────────────
# Main test loop
# ─────────────────────────────────────────────────────────────
total_tests=$(( ${#ENDPOINTS[@]} * ${#CONCURRENCY_LEVELS[@]} ))
current=0

for endpoint_str in "${ENDPOINTS[@]}"; do
  IFS='|' read -r name url type needs_auth <<< "$endpoint_str"
  echo ""
  echo "── Testing: $name ($url)"

  for conc in "${CONCURRENCY_LEVELS[@]}"; do
    current=$((current + 1))
    echo "  [$current/$total_tests] Concurrency: $conc"
    run_batch "$name" "$url" "$type" "$needs_auth" "$conc"
    sleep 1  # brief pause between levels
  done
done

echo ""
echo "── Raw results saved to: $RAW_CSV"

# ─────────────────────────────────────────────────────────────
# Generate summary CSV (aggregated stats)
# ─────────────────────────────────────────────────────────────
echo "endpoint,endpoint_type,concurrency,total_requests,success_count,fail_count,avg_ms,min_ms,max_ms,p50_ms,p95_ms,p99_ms" > "$SUMMARY_CSV"

# Process with awk
awk -F',' 'NR>1 {
  key = $2 "," $3 "," $4
  count[key]++
  total_time[key] += $7
  if ($6 >= 200 && $6 < 400) success[key]++; else fail[key]++

  # Store all times for percentile calculation
  times[key][count[key]] = $7

  if (!(key in min_time) || $7 < min_time[key]) min_time[key] = $7
  if (!(key in max_time) || $7 > max_time[key]) max_time[key] = $7
}
END {
  for (key in count) {
    n = count[key]
    avg = (total_time[key] / n) * 1000
    mn = min_time[key] * 1000
    mx = max_time[key] * 1000
    s = (success[key]+0)
    f = (fail[key]+0)

    # Sort times for percentiles
    for (i = 1; i <= n; i++) arr[i] = times[key][i]
    for (i = 1; i <= n; i++)
      for (j = i+1; j <= n; j++)
        if (arr[i] > arr[j]) { tmp=arr[i]; arr[i]=arr[j]; arr[j]=tmp }

    p50_idx = int(n * 0.50); if (p50_idx < 1) p50_idx = 1
    p95_idx = int(n * 0.95); if (p95_idx < 1) p95_idx = 1
    p99_idx = int(n * 0.99); if (p99_idx < 1) p99_idx = 1

    p50 = arr[p50_idx] * 1000
    p95 = arr[p95_idx] * 1000
    p99 = arr[p99_idx] * 1000

    printf "%s,%d,%d,%d,%.1f,%.1f,%.1f,%.1f,%.1f,%.1f\n", key, n, s, f, avg, mn, mx, p50, p95, p99
  }
}' "$RAW_CSV" | sort -t',' -k1,1 -k3,3n >> "$SUMMARY_CSV"

echo "── Summary saved to: $SUMMARY_CSV"

# ─────────────────────────────────────────────────────────────
# Print summary table to terminal
# ─────────────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════════════════════════════════╗"
echo "║                            LOAD TEST RESULTS                                      ║"
echo "╠═══════════════════════╦══════╦═══════╦════════╦════════╦════════╦════════╦═════════╣"
echo "║ Endpoint              ║ Conc ║ OK/Err║ Avg ms ║ Min ms ║ P95 ms ║ P99 ms ║ Max ms  ║"
echo "╠═══════════════════════╬══════╬═══════╬════════╬════════╬════════╬════════╬═════════╣"

tail -n +2 "$SUMMARY_CSV" | while IFS=',' read -r ep type conc total ok fail avg mn mx p50 p95 p99; do
  printf "║ %-21s ║ %4s ║ %2s/%-2s ║ %6.1f ║ %6.1f ║ %6.1f ║ %6.1f ║ %7.1f ║\n" \
    "$ep" "$conc" "$ok" "$fail" "$avg" "$mn" "$p95" "$p99" "$mx"
done

echo "╚═══════════════════════╩══════╩═══════╩════════╩════════╩════════╩════════╩═════════╝"
echo ""
echo "Raw data:    $RAW_CSV"
echo "Summary:     $SUMMARY_CSV"
echo ""
echo "To plot: open $SUMMARY_CSV in Excel/Google Sheets, or run:"
echo "  python scripts/plot-load-test.py"
