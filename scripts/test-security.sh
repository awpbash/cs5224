#!/bin/bash
# ─────────────────────────────────────────────────────────────
# RetailMind - Security & API Test Suite
# Tests auth, data isolation, endpoint responses, cold starts
# ─────────────────────────────────────────────────────────────
#
# Usage:  bash scripts/test-security.sh
# Output: results/security-test-results.csv
#         results/api-response-times.csv
#         Then run: python scripts/plot-tests.py
# ─────────────────────────────────────────────────────────────

set -uo pipefail

API="${API_URL:-https://xou98cxmqe.execute-api.ap-southeast-1.amazonaws.com/prod}"
TOKEN="${COGNITO_TOKEN:-}"  # Set via: export COGNITO_TOKEN="your-jwt-here"

RESULTS_DIR="results"
SEC_CSV="$RESULTS_DIR/security-test-results.csv"
API_CSV="$RESULTS_DIR/api-response-times.csv"

mkdir -p "$RESULTS_DIR"

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
pass_count=0
fail_count=0
total_count=0

echo "test_name,category,expected_code,actual_code,passed,response_time_ms,details" > "$SEC_CSV"
echo "endpoint,method,description,http_code,time_total_ms,time_connect_ms,time_ttfb_ms,size_bytes" > "$API_CSV"

run_security_test() {
  local name="$1" category="$2" expected="$3" method="$4" url="$5" auth="$6" body="${7:-}"
  total_count=$((total_count + 1))

  local curl_cmd="curl -s -o /tmp/test_resp.txt -w '%{http_code},%{time_total}' -X $method"

  if [ "$auth" = "valid" ]; then
    curl_cmd="$curl_cmd -H 'Authorization: Bearer $TOKEN'"
  elif [ "$auth" = "invalid" ]; then
    curl_cmd="$curl_cmd -H 'Authorization: Bearer totally.invalid.token.here'"
  elif [ "$auth" = "empty" ]; then
    curl_cmd="$curl_cmd -H 'Authorization: Bearer '"
  elif [ "$auth" = "missing" ]; then
    : # no auth header
  fi

  if [ -n "$body" ]; then
    curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$body'"
  fi

  curl_cmd="$curl_cmd '$url'"

  result=$(eval $curl_cmd 2>/dev/null)
  code=$(echo "$result" | cut -d',' -f1)
  time_s=$(echo "$result" | cut -d',' -f2)
  time_ms=$(echo "$time_s" | awk '{printf "%.1f", $1 * 1000}')
  resp_body=$(cat /tmp/test_resp.txt 2>/dev/null | head -c 200 | tr ',' ';' | tr '\n' ' ')

  if [ "$code" = "$expected" ]; then
    passed="PASS"
    pass_count=$((pass_count + 1))
    icon="✓"
  else
    passed="FAIL"
    fail_count=$((fail_count + 1))
    icon="✗"
  fi

  echo "$name,$category,$expected,$code,$passed,$time_ms,$resp_body" >> "$SEC_CSV"
  printf "  %s %-45s expected=%s got=%s (%sms)\n" "$icon" "$name" "$expected" "$code" "$time_ms"
}

run_api_test() {
  local endpoint="$1" method="$2" desc="$3" body="${4:-}"

  local curl_cmd="curl -s -o /dev/null -w '%{http_code},%{time_total},%{time_connect},%{time_starttfb},%{size_download}'"
  curl_cmd="$curl_cmd -X $method -H 'Authorization: Bearer $TOKEN'"

  if [ -n "$body" ]; then
    curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$body'"
  fi

  curl_cmd="$curl_cmd '${API}${endpoint}'"

  result=$(eval $curl_cmd 2>/dev/null)
  IFS=',' read -r code t_total t_connect t_ttfb size <<< "$result"

  t_total_ms=$(echo "$t_total" | awk '{printf "%.1f", $1 * 1000}')
  t_connect_ms=$(echo "$t_connect" | awk '{printf "%.1f", $1 * 1000}')
  t_ttfb_ms=$(echo "$t_ttfb" | awk '{printf "%.1f", $1 * 1000}')

  echo "$endpoint,$method,$desc,$code,$t_total_ms,$t_connect_ms,$t_ttfb_ms,$size" >> "$API_CSV"
  printf "  %-35s %s  %4sms  (ttfb: %sms)\n" "$desc" "$code" "$t_total_ms" "$t_ttfb_ms"
}

# ═════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║       RetailMind - Security & API Test Suite         ║"
echo "╚══════════════════════════════════════════════════════╝"

# ─────────────────────────────────────────────────────────────
# 1. AUTHENTICATION TESTS
# ─────────────────────────────────────────────────────────────
echo ""
echo "── 1. Authentication Tests"

run_security_test "No auth header" "auth" "401" "GET" "$API/projects" "missing"
run_security_test "Empty bearer token" "auth" "401" "GET" "$API/projects" "empty"
run_security_test "Invalid JWT token" "auth" "401" "GET" "$API/projects" "invalid"
run_security_test "Valid token - projects" "auth" "200" "GET" "$API/projects" "valid"
run_security_test "Valid token - preloaded" "auth" "200" "GET" "$API/preloaded-datasets" "valid"

# ─────────────────────────────────────────────────────────────
# 2. DATA ISOLATION TESTS (cross-tenant)
# ─────────────────────────────────────────────────────────────
echo ""
echo "── 2. Data Isolation Tests (cross-tenant access)"

# Try accessing a fake project ID that doesn't belong to us
FAKE_PROJECT="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
FAKE_JOB="11111111-2222-3333-4444-555555555555"

run_security_test "Get other user's project" "isolation" "404" "GET" "$API/projects/$FAKE_PROJECT" "valid"
run_security_test "Delete other user's project" "isolation" "404" "DELETE" "$API/projects/$FAKE_PROJECT" "valid"
run_security_test "Train other user's project" "isolation" "404" "POST" "$API/projects/$FAKE_PROJECT/train" "valid"
run_security_test "Upload to other user's project" "isolation" "404" "POST" "$API/projects/$FAKE_PROJECT/upload-url" "valid" '{"filename":"hack.csv"}'
run_security_test "Infer on other user's job" "isolation" "404" "POST" "$API/projects/$FAKE_PROJECT/jobs/$FAKE_JOB/infer" "valid" '{"features":{"col1":1}}'
run_security_test "Get other user's job status" "isolation" "404" "GET" "$API/projects/$FAKE_PROJECT/jobs/$FAKE_JOB" "valid"

# ─────────────────────────────────────────────────────────────
# 3. INPUT VALIDATION TESTS
# ─────────────────────────────────────────────────────────────
echo ""
echo "── 3. Input Validation Tests"

run_security_test "Create project - empty body" "validation" "400" "POST" "$API/projects" "valid" '{}'
run_security_test "Create project - missing name" "validation" "400" "POST" "$API/projects" "valid" '{"taskType":"classification"}'
run_security_test "Chat - empty message" "validation" "400" "POST" "$API/chat" "valid" '{"message":""}'
run_security_test "Nonexistent endpoint" "validation" "403" "GET" "$API/nonexistent" "valid"
run_security_test "SQL injection in path" "validation" "404" "GET" "$API/projects/1;DROP%20TABLE" "valid"
run_security_test "XSS in project name" "validation" "200" "POST" "$API/projects" "valid" '{"projectName":"<script>alert(1)</script>","taskType":"classification","useCase":"custom"}'

# ─────────────────────────────────────────────────────────────
# 4. API ENDPOINT RESPONSE TIMES
# ─────────────────────────────────────────────────────────────
echo ""
echo "── 4. API Response Times (3 runs each)"

ENDPOINTS=(
  "/preloaded-datasets|GET|List preloaded datasets"
  "/projects|GET|List projects"
  "/chat|POST|Chat with Bedrock|{\"message\":\"What is customer churn?\",\"projectId\":\"test\"}"
)

for round in 1 2 3; do
  echo "  --- Round $round ---"
  for ep_str in "${ENDPOINTS[@]}"; do
    IFS='|' read -r path method desc body <<< "$ep_str"
    run_api_test "$path" "$method" "$desc (r$round)" "$body"
  done
  sleep 2
done

# ─────────────────────────────────────────────────────────────
# 5. COLD START TEST
# ─────────────────────────────────────────────────────────────
echo ""
echo "── 5. Cold Start Comparison"
echo "  (First call vs subsequent - Lambda may be warm already)"

for ep in "/preloaded-datasets" "/projects"; do
  echo "  --- $ep ---"
  for i in 1 2 3 4 5; do
    run_api_test "$ep" "GET" "$ep call #$i"
    sleep 0.5
  done
  sleep 1
done

# ─────────────────────────────────────────────────────────────
# 6. CORS TEST
# ─────────────────────────────────────────────────────────────
echo ""
echo "── 6. CORS Tests"

# Preflight OPTIONS request
cors_result=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS \
  -H "Origin: https://dquehu2ohxwqm.cloudfront.net" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization,Content-Type" \
  "$API/projects")
echo "  OPTIONS preflight: $cors_result (expect 200 or 204)"

# Check CORS headers on actual response
cors_headers=$(curl -s -D - -o /dev/null \
  -H "Authorization: Bearer $TOKEN" \
  -H "Origin: https://dquehu2ohxwqm.cloudfront.net" \
  "$API/preloaded-datasets" 2>/dev/null | grep -i "access-control")
echo "  CORS headers returned:"
echo "$cors_headers" | while read -r line; do echo "    $line"; done

# ─────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                    RESULTS                           ║"
echo "╠══════════════════════════════════════════════════════╣"
printf "║  Tests run:   %-5s                                  ║\n" "$total_count"
printf "║  Passed:      %-5s                                  ║\n" "$pass_count"
printf "║  Failed:      %-5s                                  ║\n" "$fail_count"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Security:  $SEC_CSV           ║"
echo "║  Timing:    $API_CSV          ║"
echo "║                                                      ║"
echo "║  Plot:  python scripts/plot-tests.py                 ║"
echo "╚══════════════════════════════════════════════════════╝"

# Cleanup
rm -f /tmp/test_resp.txt
