// auto-upload/keep-alive.js
// 각 계정 세션을 주기적으로 활성화 + 쿠키 자동 갱신
// - 매일 3회 (9시, 15시, 21시) 각 계정으로 가벼운 API 요청 전송
// - 인스타 응답의 Set-Cookie에 새 sessionid/csrftoken이 있으면 저장소 업데이트
// - 쿠키 수명 연장 효과 (만료 주기 수 배 연장)

const https = require('https');
const fs = require('fs');
const dataPath = require('../data-path');

const ACCOUNTS_FILE = dataPath.resolve('auto-accounts.json');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IG_APP_ID = '936619743392459';

// ds_user_id 추출 헬퍼
function extractUserId(cookies) {
  const m = cookies.match(/ds_user_id=([^;]+)/);
  return m ? m[1] : '';
}

// 홈 피드 조회 (가장 안정적) — 응답 Set-Cookie에서 갱신된 쿠키 회수
function pingAccount(cookies) {
  return new Promise((resolve) => {
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';
    const userId = extractUserId(cookies);

    // user_id 기반 프로필 조회 (간단하고 안정적)
    const options = {
      hostname: 'i.instagram.com',
      path: `/api/v1/users/${userId}/info/`,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': IG_APP_ID,
        'X-ASBD-ID': '129477',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
        'Accept': '*/*',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const setCookieHeaders = res.headers['set-cookie'] || [];
        resolve({
          status: res.statusCode,
          setCookies: setCookieHeaders,
          body: body.substring(0, 200),
        });
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end();
  });
}

// Set-Cookie 헤더 배열에서 key=value 맵 추출
function parseSetCookies(setCookieArray) {
  const map = {};
  for (const line of setCookieArray) {
    const firstPart = line.split(';')[0];
    const eq = firstPart.indexOf('=');
    if (eq > 0) {
      const key = firstPart.substring(0, eq).trim();
      const value = firstPart.substring(eq + 1).trim();
      if (key && value) map[key] = value;
    }
  }
  return map;
}

// 기존 쿠키 문자열의 특정 키 값을 새 값으로 교체 (없으면 추가)
function mergeCookies(oldCookies, newMap) {
  const existing = {};
  oldCookies.split(';').forEach(p => {
    const eq = p.indexOf('=');
    if (eq > 0) {
      const key = p.substring(0, eq).trim();
      const value = p.substring(eq + 1).trim();
      if (key) existing[key] = value;
    }
  });
  let changed = false;
  for (const [k, v] of Object.entries(newMap)) {
    // deleted 쿠키(빈값)는 무시
    if (!v || v === '""' || v.toLowerCase() === 'deleted') continue;
    if (existing[k] !== v) {
      existing[k] = v;
      changed = true;
    }
  }
  const merged = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('; ');
  return { merged, changed };
}

// 모든 계정에 대해 keep-alive 실행
async function runKeepAlive() {
  const log = [];
  const pushLog = (m) => { const s = `[keep-alive ${new Date().toISOString()}] ${m}`; console.log(s); log.push(s); };

  pushLog('=== Keep-Alive 시작 ===');

  if (!fs.existsSync(ACCOUNTS_FILE)) {
    pushLog('계정 파일 없음');
    return { log };
  }

  let accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  let savedCount = 0;
  let failCount = 0;
  let refreshedCount = 0;

  for (const acc of accounts) {
    try {
      const r = await pingAccount(acc.cookies);
      acc.lastKeepAliveAt = new Date().toISOString();
      acc.lastKeepAliveStatus = r.status;

      if (r.status === 200) {
        const updates = parseSetCookies(r.setCookies || []);
        if (Object.keys(updates).length > 0) {
          const { merged, changed } = mergeCookies(acc.cookies, updates);
          if (changed) {
            acc.cookies = merged;
            acc.lastCookieRefreshAt = new Date().toISOString();
            refreshedCount++;
            pushLog(`@${acc.username}: ✓ 쿠키 갱신됨 (${Object.keys(updates).length}개 필드)`);
          } else {
            pushLog(`@${acc.username}: ✓ 세션 활성 (갱신 없음)`);
          }
        } else {
          pushLog(`@${acc.username}: ✓ 세션 활성`);
        }
      } else if (r.status === 403 || r.status === 401 || /login_required/i.test(r.body || '')) {
        failCount++;
        acc.lastKeepAliveError = 'login_required';
        pushLog(`@${acc.username}: ✗ 쿠키 만료 (${r.status}) - 재로그인 필요`);
      } else {
        acc.lastKeepAliveError = `status ${r.status}: ${(r.error || r.body || '').substring(0, 100)}`;
        pushLog(`@${acc.username}: ? 상태 ${r.status} ${r.error || ''}`);
      }
      savedCount++;

      // 인스타 레이트 리미트 회피: 계정간 3초 지연
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      pushLog(`@${acc.username}: ✗ 에러 ${err.message}`);
    }
  }

  // 파일 저장
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  pushLog(`=== 완료 === 검사: ${savedCount}개 / 쿠키갱신: ${refreshedCount}개 / 만료: ${failCount}개`);

  return {
    log,
    total: accounts.length,
    refreshed: refreshedCount,
    expired: failCount,
  };
}

module.exports = { runKeepAlive };
