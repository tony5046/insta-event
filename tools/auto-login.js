// tools/auto-login.js
// 웹 로그인으로 인스타그램 쿠키 발급받아 auto-accounts.json 업데이트
// 사용법: node tools/auto-login.js (동일 디렉토리에 login-credentials.json 필요)

const https = require('https');
const fs = require('fs');
const path = require('path');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Step 1: csrftoken 얻기
function getInitialCsrf() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.instagram.com',
      path: '/accounts/login/',
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
      },
    }, (res) => {
      const setCookies = res.headers['set-cookie'] || [];
      const cookies = {};
      for (const c of setCookies) {
        const first = c.split(';')[0];
        const eq = first.indexOf('=');
        if (eq > 0) cookies[first.substring(0, eq).trim()] = first.substring(eq + 1).trim();
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ cookies, body }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// Step 2: 로그인 POST
function loginRequest(username, password, initialCookies) {
  return new Promise((resolve, reject) => {
    const csrf = initialCookies.csrftoken;
    const cookieHeader = Object.entries(initialCookies).map(([k, v]) => `${k}=${v}`).join('; ');

    const timestamp = Math.floor(Date.now() / 1000);
    const encPassword = `#PWD_INSTAGRAM_BROWSER:0:${timestamp}:${password}`;

    const body = new URLSearchParams({
      username,
      enc_password: encPassword,
      queryParams: '{}',
      optIntoOneTap: 'false',
      trustedDeviceRecords: '{}',
    }).toString();

    const req = https.request({
      hostname: 'www.instagram.com',
      path: '/api/v1/web/accounts/login/ajax/',
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'Cookie': cookieHeader,
        'X-CSRFToken': csrf,
        'X-IG-App-ID': '936619743392459',
        'X-Instagram-AJAX': '1',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://www.instagram.com',
        'Referer': 'https://www.instagram.com/accounts/login/',
        'Accept': '*/*',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const setCookies = res.headers['set-cookie'] || [];
        const cookies = { ...initialCookies };
        for (const c of setCookies) {
          const first = c.split(';')[0];
          const eq = first.indexOf('=');
          if (eq > 0) {
            const key = first.substring(0, eq).trim();
            const value = first.substring(eq + 1).trim();
            if (value && value !== '""' && value.toLowerCase() !== 'deleted') {
              cookies[key] = value;
            }
          }
        }
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, cookies });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data.substring(0, 300) }, cookies });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function cookiesToString(cookieMap) {
  return Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function loginAndGetCookies(username, password) {
  console.log(`[${username}] 초기 CSRF 토큰 요청...`);
  const initial = await getInitialCsrf();
  if (!initial.cookies.csrftoken) {
    throw new Error('초기 csrftoken 없음');
  }

  console.log(`[${username}] 로그인 시도...`);
  const result = await loginRequest(username, password, initial.cookies);

  if (result.status === 200 && result.data.authenticated) {
    console.log(`[${username}] ✅ 로그인 성공 (user_id: ${result.data.userId})`);
    return {
      success: true,
      cookies: cookiesToString(result.cookies),
      userId: result.data.userId,
    };
  }
  if (result.data.two_factor_required) {
    return { success: false, error: '2단계 인증 필요 (2FA 켜져 있음)' };
  }
  if (result.data.message) {
    return { success: false, error: result.data.message };
  }
  return { success: false, error: `로그인 실패: ${result.status} ${JSON.stringify(result.data).substring(0, 200)}` };
}

function updateAccount(username, cookies, apiBase) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ username, label: '', cookies });
    const url = new URL(apiBase + '/api/auto/accounts/save');
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : require('http');
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// 메인
(async () => {
  const credFile = path.join(__dirname, 'login-credentials.json');
  if (!fs.existsSync(credFile)) {
    console.error('login-credentials.json 파일이 없습니다');
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  // apiBases 배열 지원 (로컬 + Railway 동시 업데이트)
  const apiBases = config.apiBases || [config.apiBase || 'http://localhost:3000'];

  for (const { username, password } of config.accounts) {
    try {
      const result = await loginAndGetCookies(username, password);
      if (result.success) {
        for (const apiBase of apiBases) {
          console.log(`[${username}] ${apiBase} 업데이트 중...`);
          const upd = await updateAccount(username, result.cookies, apiBase);
          console.log(`[${username}] ${apiBase} → ${upd.status}: ${upd.data}`);
        }
      } else {
        console.log(`[${username}] ❌ ${result.error}`);
      }
      // 간격 두기 (IP 블록 방지)
      await new Promise(r => setTimeout(r, 8000));
    } catch (err) {
      console.log(`[${username}] ❌ ${err.message}`);
    }
  }
  console.log('\n완료!');
})();
