const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { IgApiClient } = require('instagram-private-api');
const multer = require('multer');
const autoUpload = require('./auto-upload');
const rotation = require('./auto-upload/rotation');
const dataPath = require('./data-path');

// 서버 시작 시 기존 데이터 파일들을 Volume으로 마이그레이션 (Volume 사용 시)
dataPath.migrateAll();

const app = express();
const PORT = process.env.PORT || 3000;

// 파일 업로드 설정
const upload = multer({ dest: path.join(__dirname, 'uploads/') });

// uploads 폴더 생성
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === 공유 설정 (모든 사용자가 동일한 설정 사용) ===
const SHARED_CONFIG_FILE = path.join(__dirname, 'shared-config.json');

function loadSharedConfig() {
  try {
    if (fs.existsSync(SHARED_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(SHARED_CONFIG_FILE, 'utf8'));
    }
    // Railway 등 클라우드: 환경변수에서 로드
    if (process.env.SHARED_CONFIG_JSON) {
      return JSON.parse(process.env.SHARED_CONFIG_JSON);
    }
  } catch {}
  return { sessionId: '', scriptUrl: '' };
}

function saveSharedConfig(config) {
  fs.writeFileSync(SHARED_CONFIG_FILE, JSON.stringify(config, null, 2));
}

app.get('/api/config', (req, res) => {
  res.json(loadSharedConfig());
});

app.post('/api/config', (req, res) => {
  const current = loadSharedConfig();
  const next = { ...current, ...req.body };
  saveSharedConfig(next);
  res.json({ success: true, config: next });
});

// === Shortcode → Media ID 변환 (로컬 계산) ===
function shortcodeToMediaId(shortcode) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let mediaId = BigInt(0);
  for (const char of shortcode) {
    mediaId = mediaId * BigInt(64) + BigInt(alphabet.indexOf(char));
  }
  return mediaId.toString();
}

// === Instagram API 요청 헬퍼 (재시도 포함) ===
async function igRequest(url, sessionId, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await _igFetch(url, sessionId);
      return result;
    } catch (err) {
      console.log(`[시도 ${attempt}/${retries}] ${err.message}`);
      if (attempt === retries) throw err;
      // 지수 백오프: 2초, 4초, 8초...
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`[대기] ${delay / 1000}초 후 재시도...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function _igFetch(url, sessionId) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': `sessionid=${sessionId}`,
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
        'X-ASBD-ID': '129477',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/',
        'Accept': '*/*',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          const location = res.headers.location || '';
          if (location.includes('/accounts/login')) {
            reject(new Error('세션 ID가 만료되었습니다. 브라우저에서 인스타그램에 다시 로그인 후 새 sessionid를 복사해주세요.'));
          } else {
            reject(new Error(`Instagram 리다이렉트 (${res.statusCode})`));
          }
          return;
        }
        if (res.statusCode === 429) {
          reject(new Error('Instagram 요청 제한 (429). 잠시 후 재시도합니다.'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Instagram API 오류 (${res.statusCode}): ${data.substring(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Instagram 응답 파싱 실패. 세션 ID를 확인해주세요.'));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// === 게시물 URL에서 shortcode 추출 ===
function extractShortcode(postUrl) {
  const patterns = [
    /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
    /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = postUrl.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// === SSE: 댓글 수집 (실시간 진행상황) ===
const activeJobs = new Map();

app.get('/api/comments/stream', (req, res) => {
  const jobId = req.query.jobId;
  if (!jobId || !activeJobs.has(jobId)) {
    res.status(400).json({ error: 'Invalid job ID' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const job = activeJobs.get(jobId);
  job.clients.push(res);

  req.on('close', () => {
    job.clients = job.clients.filter(c => c !== res);
  });
});

app.post('/api/comments', async (req, res) => {
  try {
    const { postUrl, sessionId } = req.body;

    if (!postUrl || !sessionId) {
      return res.status(400).json({ error: '게시물 URL과 세션 ID가 필요합니다.' });
    }

    const cleanSessionId = sessionId.replace(/[\s"';\r\n\t]+/g, '').trim();
    if (!cleanSessionId) {
      return res.status(400).json({ error: '유효하지 않은 세션 ID입니다.' });
    }

    const shortcode = extractShortcode(postUrl);
    if (!shortcode) {
      return res.status(400).json({ error: '올바른 인스타그램 게시물 URL이 아닙니다.' });
    }

    const mediaId = shortcodeToMediaId(shortcode);
    console.log(`[댓글 수집] shortcode: ${shortcode} -> mediaId: ${mediaId}`);

    // SSE Job 생성
    const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    activeJobs.set(jobId, { clients: [], comments: [] });

    // jobId 먼저 반환 → 클라이언트가 SSE 연결
    res.json({ jobId, mediaId });

    // 백그라운드에서 댓글 수집 시작
    fetchAllCommentsWithProgress(mediaId, cleanSessionId, jobId);
  } catch (err) {
    console.error('[오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

function sendSSE(jobId, event, data) {
  const job = activeJobs.get(jobId);
  if (!job) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  job.clients.forEach(client => client.write(msg));
}

async function fetchAllCommentsWithProgress(mediaId, sessionId, jobId) {
  const comments = [];
  let nextMinId = null;
  let hasMore = true;
  let page = 0;

  try {
    while (hasMore) {
      page++;
      let url = `https://www.instagram.com/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false`;
      if (nextMinId) {
        url += `&min_id=${nextMinId}`;
      }

      const data = await igRequest(url, sessionId);

      if (data.comments) {
        for (const comment of data.comments) {
          comments.push({
            username: comment.user.username,
            text: comment.text,
            timestamp: comment.created_at,
            userId: comment.user.pk,
          });
        }
      }

      hasMore = data.has_more_comments || data.has_more_headload_comments || false;
      nextMinId = data.next_min_id || null;
      if (!nextMinId) hasMore = false;

      // 진행상황 전송
      sendSSE(jobId, 'progress', {
        page,
        collected: comments.length,
        hasMore,
      });

      console.log(`[페이지 ${page}] ${comments.length}개 수집 (더 있음: ${hasMore})`);

      if (hasMore) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // 완료
    const job = activeJobs.get(jobId);
    if (job) job.comments = comments;

    sendSSE(jobId, 'complete', {
      total: comments.length,
      comments,
    });

    console.log(`[완료] 총 ${comments.length}개 댓글 수집`);
  } catch (err) {
    console.error('[수집 오류]', err.message);
    sendSSE(jobId, 'error', { message: err.message });
  }

  // 5분 후 job 정리
  setTimeout(() => activeJobs.delete(jobId), 5 * 60 * 1000);
}

// === 추첨 API ===
app.post('/api/draw', (req, res) => {
  try {
    const { comments, count, keyword, removeDuplicates } = req.body;

    if (!comments || !count) {
      return res.status(400).json({ error: '댓글 목록과 당첨자 수가 필요합니다.' });
    }

    let filtered = [...comments];

    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      filtered = filtered.filter(c => c.text.toLowerCase().includes(kw));
    }

    if (removeDuplicates) {
      const seen = new Set();
      filtered = filtered.filter(c => {
        if (seen.has(c.username)) return false;
        seen.add(c.username);
        return true;
      });
    }

    if (filtered.length === 0) {
      return res.json({ winners: [], message: '조건에 맞는 댓글이 없습니다.' });
    }

    const winnerCount = Math.min(count, filtered.length);

    for (let i = filtered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
    }

    const winners = filtered.slice(0, winnerCount);
    res.json({ winners, totalFiltered: filtered.length });
  } catch (err) {
    console.error('[추첨 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Google Sheets 전송 API (리다이렉트 체인 지원) ===
function httpsRequest(url, method, postData, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    if (postData && method === 'POST') {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        const redirectUrl = response.headers.location;
        console.log(`[시트 리다이렉트] ${response.statusCode} -> ${redirectUrl.substring(0, 80)}...`);
        // 303은 GET으로 변경, 나머지는 GET으로 따라감 (Apps Script 패턴)
        resolve(httpsRequest(redirectUrl, 'GET', null, maxRedirects - 1));
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body: data });
      });
    });

    req.on('error', reject);
    if (postData && method === 'POST') {
      req.write(postData);
    }
    req.end();
  });
}

// === 최근 N일 이내 당첨자 조회 (Apps Script doGet) ===
function httpsRequestGet(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
    };

    const req = https.request(options, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        const redirectUrl = response.headers.location;
        resolve(httpsRequestGet(redirectUrl, maxRedirects - 1));
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

app.post('/api/sheets/recent-winners', async (req, res) => {
  try {
    const { scriptUrl, days, seller } = req.body;
    if (!scriptUrl) {
      return res.status(400).json({ error: 'Apps Script URL이 필요합니다.' });
    }
    const d = parseInt(days, 10) || 30;
    const sep = scriptUrl.includes('?') ? '&' : '?';
    let queryUrl = `${scriptUrl}${sep}action=recent&days=${d}`;
    if (seller) queryUrl += `&seller=${encodeURIComponent(seller)}`;

    console.log(`[최근 당첨자 조회] ${d}일 이내 -> ${queryUrl.substring(0, 80)}...`);
    const result = await httpsRequestGet(queryUrl);

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      if (result.body.includes('액세스') || result.body.includes('denied') || result.body.includes('Access')) {
        return res.status(403).json({ error: 'Apps Script 액세스가 거부되었습니다. 배포 설정을 확인해주세요.' });
      }
      return res.status(500).json({ error: '응답 파싱 실패', raw: result.body.substring(0, 200) });
    }

    console.log(`[최근 당첨자 조회] ${parsed.count || 0}명 반환`);
    res.json(parsed);
  } catch (err) {
    console.error('[최근 당첨자 조회 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === 팔로워 검증 API ===
// 팀 계정으로 로그인 → 셀러 본 계정의 팔로워 목록을 긁어와서 → 당첨자와 대조
app.post('/api/ig/check-followers', async (req, res) => {
  try {
    const { teamUsername, winners } = req.body;
    // winners: [{ username, userId }]
    if (!teamUsername || !Array.isArray(winners)) {
      return res.status(400).json({ error: '팀 계정과 당첨자 목록이 필요합니다.' });
    }

    const accounts = loadAccounts();
    const teamAccount = accounts.find(a => a.username === teamUsername);
    if (!teamAccount || !teamAccount.cookies) {
      return res.status(401).json({ error: `${teamUsername} 계정의 쿠키가 등록되어 있지 않습니다.` });
    }

    const influencerUsername = teamAccount.influencerUsername;
    if (!influencerUsername) {
      return res.status(400).json({ error: `${teamUsername} 계정에 셀러 본 계정 아이디가 설정되어 있지 않습니다. 계정을 다시 등록해주세요.` });
    }

    console.log(`[팔로워 검증] 팀: ${teamUsername} → 셀러 본 계정: ${influencerUsername}`);

    // 1) 셀러 본 계정의 userId 조회 (캐시 활용)
    let influencerUserId = teamAccount.influencerUserId || null;
    if (!influencerUserId) {
      influencerUserId = await resolveUserIdWithRetry(influencerUsername, teamAccount.cookies, 3);
      if (!influencerUserId) {
        return res.status(400).json({ error: `셀러 본 계정 ${influencerUsername}을(를) 찾을 수 없습니다. 인스타그램 요청 제한일 수 있으니 1-2분 후 다시 시도해주세요.` });
      }
      // userId 캐싱 (다음부터 재조회 불필요)
      teamAccount.influencerUserId = influencerUserId;
      saveAccounts(accounts);
      console.log(`[팔로워 검증] ${influencerUsername} userId: ${influencerUserId} (캐시 저장)`);
    } else {
      console.log(`[팔로워 검증] ${influencerUsername} userId: ${influencerUserId} (캐시)`);
    }

    // 2) 각 당첨자의 팔로잉 목록에서 인플루언서 검색
    console.log(`[팔로워 검증] 당첨자 ${winners.length}명의 팔로잉에서 ${influencerUsername} 검색 시작...`);

    const followMap = {};
    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      // userId 필요 - 없으면 조회
      let wUserId = w.userId;
      if (!wUserId) {
        wUserId = await resolveUserIdWithRetry(w.username, teamAccount.cookies, 2);
        if (!wUserId) {
          console.log(`[팔로워 검증] ${w.username} userId 조회 실패 → 건너뜀`);
          followMap[w.username] = null;
          continue;
        }
      }

      try {
        const isFollowing = await checkUserFollowing(wUserId, influencerUsername, teamAccount.cookies);
        followMap[w.username] = isFollowing;
        console.log(`[팔로워 검증] ${i + 1}/${winners.length} ${w.username} → ${isFollowing ? '✅ 팔로우' : '❌ 미팔로우'}`);
      } catch (err) {
        console.log(`[팔로워 검증] ${w.username} 검증 오류: ${err.message}`);
        if (err.message.includes('429')) {
          console.log('[팔로워 검증] 레이트 리밋 → 5초 대기 후 재시도');
          await new Promise(r => setTimeout(r, 5000));
          i--; // 재시도
          continue;
        }
        followMap[w.username] = null;
      }

      // 요청 간격
      if (i < winners.length - 1) {
        await new Promise(r => setTimeout(r, 800));
      }
    }

    const followCount = Object.values(followMap).filter(v => v === true).length;
    console.log(`[팔로워 검증] 결과: ${followCount}/${winners.length}명 팔로우 확인`);

    res.json({ success: true, followMap, checked: winners.length });
  } catch (err) {
    console.error('[팔로워 검증 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 당첨자(userId)의 팔로잉 목록에서 인플루언서(username) 검색
// → 당첨자 프로필 > 팔로잉 > 검색 방식
function checkUserFollowing(userId, influencerUsername, cookies) {
  return new Promise((resolve, reject) => {
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const query = encodeURIComponent(influencerUsername);
    const url = `https://www.instagram.com/api/v1/friendships/${userId}/following/?count=50&query=${query}`;

    const options = {
      hostname: 'www.instagram.com',
      path: new URL(url).pathname + new URL(url).search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/',
        'Accept': '*/*',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          return reject(new Error('Instagram 요청 제한 (429)'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`following 조회 실패 (${res.statusCode})`));
        }
        try {
          const parsed = JSON.parse(data);
          const users = parsed.users || [];
          // 검색 결과에 인플루언서가 있으면 팔로우 중
          const found = users.some(u =>
            u.username.toLowerCase() === influencerUsername.toLowerCase()
          );
          resolve(found);
        } catch {
          reject(new Error('following 응답 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// 쿠키 기반 Instagram API 요청
function igRequestWithCookies(url, cookies, csrfToken) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'X-CSRFToken': csrfToken || '',
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/',
        'Accept': '*/*',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          return reject(new Error('Instagram 요청 제한 (429)'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Instagram API 오류 (${res.statusCode}): ${data.substring(0, 150)}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('응답 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// userId 조회 + 429 재시도
async function resolveUserIdWithRetry(username, cookies, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await resolveUserIdByUsername(username, cookies);
    if (result) return result;

    if (attempt < maxRetries) {
      const wait = attempt * 5000; // 5초, 10초, 15초
      console.log(`[userId 조회] ${username} 실패 → ${wait / 1000}초 후 재시도 (${attempt}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  return null;
}

// username으로 userId 조회 (방법1: search API, 방법2: web_profile_info)
async function resolveUserIdByUsername(username, cookies) {
  // 방법 1: 검색 API (레이트 리밋 덜 걸림)
  const searchResult = await _resolveViaSearch(username, cookies);
  if (searchResult) return searchResult;

  // 방법 2: web_profile_info (백업)
  const profileResult = await _resolveViaProfile(username, cookies);
  return profileResult;
}

function _resolveViaSearch(username, cookies) {
  return new Promise((resolve) => {
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const options = {
      hostname: 'www.instagram.com',
      path: `/api/v1/web/search/topsearch/?query=${encodeURIComponent(username)}&context=blended`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': '936619743392459',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/',
        'Accept': '*/*',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`[userId 검색] ${username} → 응답: ${res.statusCode}`);
        if (res.statusCode !== 200) return resolve(null);
        try {
          const parsed = JSON.parse(data);
          const users = parsed.users || [];
          const match = users.find(u => u.user && u.user.username.toLowerCase() === username.toLowerCase());
          if (match) {
            console.log(`[userId 검색] ${username} → userId: ${match.user.pk}`);
            return resolve(String(match.user.pk));
          }
          resolve(null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function _resolveViaProfile(username, cookies) {
  return new Promise((resolve) => {
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const options = {
      hostname: 'www.instagram.com',
      path: `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': `https://www.instagram.com/${username}/`,
        'Origin': 'https://www.instagram.com',
        'Accept': '*/*',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log(`[userId 프로필] ${username} → 응답: ${res.statusCode}`);
        if (res.statusCode !== 200) return resolve(null);
        try {
          const parsed = JSON.parse(data);
          const uid = parsed.data?.user?.id || null;
          if (uid) console.log(`[userId 프로필] ${username} → userId: ${uid}`);
          resolve(uid);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// show_many: 여러 user_id에 대한 친구관계 상태 조회
function igShowMany(userIdsCommaSeparated, cookies) {
  return new Promise((resolve, reject) => {
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    const bodyData = `user_ids=${encodeURIComponent(userIdsCommaSeparated)}`;

    const options = {
      hostname: 'www.instagram.com',
      path: '/api/v1/friendships/show_many/',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '129477',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyData),
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com',
        'Accept': '*/*',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`show_many 실패 (${res.statusCode}): ${data.substring(0, 150)}`));
        }
        try {
          const parsed = JSON.parse(data);
          // 응답 형식: { friendship_statuses: { "<userId>": { following, followed_by, ... } } }
          resolve(parsed.friendship_statuses || {});
        } catch (e) {
          reject(new Error('show_many 파싱 실패'));
        }
      });
    });
    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

app.post('/api/sheets', async (req, res) => {
  try {
    const { scriptUrl, rows, seller } = req.body;

    if (!scriptUrl || !rows || !rows.length) {
      return res.status(400).json({ error: 'Apps Script URL과 데이터가 필요합니다.' });
    }

    console.log(`[시트 전송] ${rows.length}행 -> 셀러: ${seller || '(미지정)'} -> ${scriptUrl.substring(0, 60)}`);

    const postData = JSON.stringify({ rows, seller: seller || '' });
    const result = await httpsRequest(scriptUrl, 'POST', postData);

    console.log(`[시트 전송] 응답 (${result.statusCode}):`, result.body.substring(0, 200));

    let parsed;
    try {
      parsed = JSON.parse(result.body);
    } catch {
      // HTML 응답인 경우 (에러 페이지)
      if (result.body.includes('액세스') || result.body.includes('denied')) {
        return res.status(403).json({ error: 'Apps Script 액세스가 거부되었습니다. 배포 설정에서 "모든 사용자"로 변경해주세요.' });
      }
      parsed = { success: true, raw: result.body.substring(0, 100) };
    }

    res.json({ success: parsed.success !== false, result: parsed });
  } catch (err) {
    console.error('[시트 오류]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// === Instagram 게시물 업로드 API (쿠키 기반) ===

// 계정 목록 저장/불러오기
const ACCOUNTS_FILE = dataPath.resolve('accounts.json');

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
    // Railway 등 클라우드: 환경변수에서 초기 데이터 로드
    if (process.env.ACCOUNTS_JSON) {
      const accounts = JSON.parse(process.env.ACCOUNTS_JSON);
      // 파일로 저장해서 이후 수정 가능하게
      fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
      return accounts;
    }
  } catch {}
  return [];
}

function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

app.get('/api/accounts', (req, res) => {
  res.json(loadAccounts());
});

app.post('/api/accounts/save', (req, res) => {
  const { username, label, cookies, influencerUsername } = req.body;
  if (!username || !cookies) {
    return res.status(400).json({ error: '계정명과 쿠키가 필요합니다.' });
  }
  const accounts = loadAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  const account = {
    username,
    label: label || '',
    cookies: cookies.trim(),
    influencerUsername: (influencerUsername || '').trim(),
  };
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  saveAccounts(accounts);
  res.json({ success: true });
});

app.post('/api/accounts/delete', (req, res) => {
  const { username } = req.body;
  let accounts = loadAccounts();
  accounts = accounts.filter(a => a.username !== username);
  saveAccounts(accounts);
  res.json({ success: true });
});

// Instagram 이미지 업로드 + 게시물 발행 (쿠키 인증)
app.post('/api/ig/post', upload.single('image'), async (req, res) => {
  try {
    const { username, caption } = req.body;
    const imageFile = req.file;

    if (!username) {
      return res.status(400).json({ error: '계정을 선택해주세요.' });
    }
    if (!imageFile) {
      return res.status(400).json({ error: '이미지를 선택해주세요.' });
    }
    // 캡션은 선택 사항 (빈 문자열 허용)
    const finalCaption = caption || '';

    // 저장된 계정에서 쿠키 가져오기
    const accounts = loadAccounts();
    const account = accounts.find(a => a.username === username);
    if (!account || !account.cookies) {
      return res.status(401).json({ error: `${username} 계정의 쿠키가 없습니다. 쿠키를 등록해주세요.` });
    }

    const cookies = account.cookies;
    // csrftoken 추출
    const csrfMatch = cookies.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    console.log(`[IG 업로드] ${username} 게시물 업로드 시작... (csrf: ${csrfToken ? 'OK' : 'MISSING'})`);

    const imageBuffer = fs.readFileSync(imageFile.path);

    // Step 1: 이미지 업로드 (rupload)
    const uploadId = Date.now().toString();
    const uploadName = `${uploadId}_0_${Math.floor(Math.random() * 9000000000 + 1000000000)}`;

    const uploadResult = await igUploadPhoto(imageBuffer, uploadName, uploadId, cookies, csrfToken);
    console.log(`[IG 업로드] 이미지 업로드 완료: ${uploadResult.status}`);

    // Step 2: 게시물 발행 (configure)
    const configureResult = await igConfigurePost(uploadId, finalCaption, cookies, csrfToken);
    console.log(`[IG 업로드] 게시물 발행 완료`);

    // 임시 파일 삭제
    fs.unlinkSync(imageFile.path);

    const mediaCode = configureResult.media?.code || '';
    res.json({
      success: true,
      mediaId: configureResult.media?.id || '',
      code: mediaCode,
      url: mediaCode ? `https://www.instagram.com/p/${mediaCode}/` : '',
    });
  } catch (err) {
    console.error('[IG 업로드 오류]', err.message);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: err.message });
  }
});

// Instagram 사진 업로드 (www.instagram.com 웹 API)
function igUploadPhoto(imageBuffer, uploadName, uploadId, cookies, csrfToken) {
  return new Promise((resolve, reject) => {
    const photoUploadParams = JSON.stringify({
      media_type: 1,
      upload_id: uploadId,
      upload_media_height: 1080,
      upload_media_width: 1080,
      xsharing_user_ids: '[]',
      image_compression: JSON.stringify({ lib_name: 'moz', lib_version: '3.1.m', quality: '80' }),
    });

    const options = {
      hostname: 'www.instagram.com',
      path: `/rupload_igphoto/${uploadName}`,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': '936619743392459',
        'X-IG-WWW-Claim': 'hmac.AR3W0DThY2Mu5Fag4sW5u3RhaR3qhFD_5it9HpNqa_77bWtX',
        'X-Instagram-Rupload-Params': photoUploadParams,
        'X-Entity-Type': 'image/jpeg',
        'X-Entity-Name': uploadName,
        'X-Entity-Length': imageBuffer.length,
        'Content-Type': 'image/jpeg',
        'Content-Length': imageBuffer.length,
        'Offset': '0',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/create/style/',
        'Origin': 'https://www.instagram.com',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[IG rupload] ${res.statusCode}: ${data.substring(0, 200)}`);
        if (res.statusCode !== 200) {
          reject(new Error(`이미지 업로드 실패 (${res.statusCode}): ${data.substring(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('이미지 업로드 응답 파싱 실패'));
        }
      });
    });

    req.on('error', reject);
    req.write(imageBuffer);
    req.end();
  });
}

// Instagram 게시물 발행 (www.instagram.com 웹 API)
function igConfigurePost(uploadId, caption, cookies, csrfToken) {
  return new Promise((resolve, reject) => {
    const configData = JSON.stringify({
      source_type: 'library',
      caption: caption,
      upload_id: uploadId,
      disable_comments: '0',
      like_and_view_counts_disabled: false,
      igtv_share_preview_to_feed: false,
      is_unified_video: false,
      video_subtitles_enabled: false,
    });

    const bodyData = `signed_body=SIGNATURE.${encodeURIComponent(configData)}`;

    const options = {
      hostname: 'www.instagram.com',
      path: '/api/v1/media/configure/',
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookies,
        'X-CSRFToken': csrfToken,
        'X-IG-App-ID': '936619743392459',
        'X-IG-WWW-Claim': 'hmac.AR3W0DThY2Mu5Fag4sW5u3RhaR3qhFD_5it9HpNqa_77bWtX',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyData),
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://www.instagram.com/create/details/',
        'Origin': 'https://www.instagram.com',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`[IG configure] ${res.statusCode}: ${data.substring(0, 300)}`);
        if (res.statusCode !== 200) {
          reject(new Error(`게시물 발행 실패 (${res.statusCode}): ${data.substring(0, 200)}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed.status !== 'ok') {
            reject(new Error(`게시물 발행 실패: ${parsed.message || data.substring(0, 200)}`));
            return;
          }
          resolve(parsed);
        } catch {
          reject(new Error('게시물 발행 응답 파싱 실패'));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

// ============================================================
// === 자동 업로드 API ========================================
// ============================================================

// === 자동 업로드 전용 계정 관리 (이벤트 추첨 계정과 별도) ===
const AUTO_ACCOUNTS_FILE = dataPath.resolve('auto-accounts.json');

function loadAutoAccounts() {
  try {
    if (fs.existsSync(AUTO_ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(AUTO_ACCOUNTS_FILE, 'utf8'));
    }
    // Railway 등 클라우드: 환경변수에서 로드
    if (process.env.AUTO_ACCOUNTS_JSON) {
      const accounts = JSON.parse(process.env.AUTO_ACCOUNTS_JSON);
      fs.writeFileSync(AUTO_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
      return accounts;
    }
  } catch {}
  return [];
}

function saveAutoAccounts(accounts) {
  fs.writeFileSync(AUTO_ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

app.get('/api/auto/accounts', (req, res) => {
  // 쿠키 값은 마스킹해서 반환 (보안)
  const accounts = loadAutoAccounts();
  const safe = accounts.map((a, i) => ({
    index: i,
    username: a.username,
    label: a.label || '',
    hasCookies: !!a.cookies,
    cookiePreview: a.cookies ? a.cookies.substring(0, 30) + '...' : '(없음)',
    lastKeepAliveAt: a.lastKeepAliveAt || null,
    lastKeepAliveStatus: a.lastKeepAliveStatus || null,
    lastCookieRefreshAt: a.lastCookieRefreshAt || null,
    lastKeepAliveError: a.lastKeepAliveError || null,
  }));
  res.json(safe);
});

// Keep-Alive 수동 실행
app.post('/api/auto/keep-alive', async (req, res) => {
  try {
    const result = await autoUpload.runKeepAlive();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auto/accounts/save', (req, res) => {
  const { username, label, cookies } = req.body;
  if (!username || !cookies) {
    return res.status(400).json({ error: '계정명과 쿠키가 필요합니다.' });
  }
  const accounts = loadAutoAccounts();
  const idx = accounts.findIndex(a => a.username === username);
  const account = { username: username.trim(), label: label || '', cookies: cookies.trim() };
  if (idx >= 0) {
    accounts[idx] = account;
  } else {
    accounts.push(account);
  }
  saveAutoAccounts(accounts);
  res.json({ success: true, count: accounts.length });
});

app.post('/api/auto/accounts/delete', (req, res) => {
  const { username } = req.body;
  let accounts = loadAutoAccounts();
  accounts = accounts.filter(a => a.username !== username);
  saveAutoAccounts(accounts);
  res.json({ success: true, count: accounts.length });
});

// 계정 순서 변경 (드래그 등)
app.post('/api/auto/accounts/reorder', (req, res) => {
  const { order } = req.body; // ["username1", "username2", ...]
  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order 배열 필요' });
  }
  const accounts = loadAutoAccounts();
  const map = {};
  accounts.forEach(a => map[a.username] = a);
  const reordered = order.filter(u => map[u]).map(u => map[u]);
  // 혹시 빠진 계정 추가
  accounts.forEach(a => { if (!order.includes(a.username)) reordered.push(a); });
  saveAutoAccounts(reordered);
  res.json({ success: true, count: reordered.length });
});

// 현재 설정 조회
app.get('/api/auto/config', (req, res) => {
  try {
    const cfg = autoUpload.loadConfig();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 설정 저장 (스케줄 시간 / 활성화 / 이미지 폴더)
app.post('/api/auto/config', (req, res) => {
  try {
    const { enabled, cronExpression, imageFolder, delayBetweenUploads } = req.body;
    const current = autoUpload.loadConfig();
    const next = {
      ...current,
      ...(typeof enabled === 'boolean' ? { enabled } : {}),
      ...(cronExpression ? { cronExpression } : {}),
      ...(imageFolder ? { imageFolder } : {}),
      ...(typeof delayBetweenUploads === 'number' ? { delayBetweenUploads } : {}),
    };
    autoUpload.saveConfig(next);
    // 스케줄러 재시작
    autoUpload.startScheduler();
    res.json({ success: true, config: next });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 상태 조회 (state.json + 이미지 폴더 정보)
app.get('/api/auto/state', (req, res) => {
  try {
    const state = rotation.loadState();
    const cfg = autoUpload.loadConfig();
    const images = autoUpload.scanImages(cfg.imageFolder);
    const accounts = loadAutoAccounts();

    // 계정별 사용 통계
    const perAccountUsage = {};
    for (const acc of accounts) {
      const used = state.usedImages?.[acc.username] || [];
      perAccountUsage[acc.username] = {
        used: used.length,
        remaining: Math.max(0, images.length - used.length),
      };
    }

    res.json({
      state: {
        nextFeedIndex: state.nextFeedIndex,
        history: (state.history || []).slice(0, 50),
      },
      config: cfg,
      imageFolder: cfg.imageFolder,
      imageCount: images.length,
      accountCount: accounts.length,
      perAccountUsage,
      today: rotation.shouldSkipToday(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 앞으로 N일 예정 미리보기
app.get('/api/auto/preview', (req, res) => {
  try {
    const days = parseInt(req.query.days || '14', 10);
    const preview = autoUpload.previewSchedule(days);
    res.json({ preview });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 수동 실행 (즉시 업로드 - 주말/공휴일 무시)
app.post('/api/auto/run', async (req, res) => {
  try {
    const { force } = req.body || {};
    const result = await autoUpload.runAutoUpload({ forceRun: !!force });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 이미지 목록
app.get('/api/auto/images', (req, res) => {
  try {
    const cfg = autoUpload.loadConfig();
    const images = autoUpload.scanImages(cfg.imageFolder);
    res.json({ folder: cfg.imageFolder, images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 이미지 업로드 (웹에서 드래그 앤 드롭)
const autoImageUpload = multer({
  dest: dataPath.resolve('auto-images-tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (/\.(jpe?g|png|webp)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('jpg, png, webp만 허용'));
  },
});

app.post('/api/auto/images/upload', autoImageUpload.array('images', 50), (req, res) => {
  try {
    const cfg = autoUpload.loadConfig();
    const destFolder = cfg.imageFolder || autoUpload.IMAGE_FOLDER;
    if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

    const results = [];
    for (const file of (req.files || [])) {
      const dest = path.join(destFolder, file.originalname);
      fs.renameSync(file.path, dest);
      results.push(file.originalname);
    }
    res.json({ success: true, uploaded: results.length, files: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 이미지 삭제
app.post('/api/auto/images/delete', (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: '파일명 필요' });
    const cfg = autoUpload.loadConfig();
    const filePath = path.join(cfg.imageFolder || autoUpload.IMAGE_FOLDER, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 이미지 미리보기 (썸네일)
app.get('/api/auto/images/preview/:filename', (req, res) => {
  try {
    const cfg = autoUpload.loadConfig();
    const filePath = path.join(cfg.imageFolder || autoUpload.IMAGE_FOLDER, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('not found');
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).send('error');
  }
});

// 이미지 폴더 열기 (Windows 탐색기)
app.post('/api/auto/open-folder', (req, res) => {
  try {
    const cfg = autoUpload.loadConfig();
    if (!fs.existsSync(cfg.imageFolder)) {
      fs.mkdirSync(cfg.imageFolder, { recursive: true });
    }
    const { exec } = require('child_process');
    // Windows: explorer, macOS: open, Linux: xdg-open
    const cmd = process.platform === 'win32'
      ? `explorer "${cfg.imageFolder}"`
      : process.platform === 'darwin'
        ? `open "${cfg.imageFolder}"`
        : `xdg-open "${cfg.imageFolder}"`;
    exec(cmd);
    res.json({ success: true, folder: cfg.imageFolder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 사용 기록 초기화 (특정 계정 또는 전체)
app.post('/api/auto/reset-used', (req, res) => {
  try {
    const { username } = req.body || {};
    const state = rotation.loadState();
    if (username) {
      if (state.usedImages) state.usedImages[username] = [];
    } else {
      state.usedImages = {};
    }
    rotation.saveState(state);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 다음 피드 인덱스 설정 (로테이션 위치 수동 조정)
app.post('/api/auto/set-index', (req, res) => {
  try {
    const { nextFeedIndex } = req.body;
    if (typeof nextFeedIndex !== 'number') {
      return res.status(400).json({ error: 'nextFeedIndex 숫자 필요' });
    }
    const state = rotation.loadState();
    state.nextFeedIndex = nextFeedIndex;
    rotation.saveState(state);
    res.json({ success: true, nextFeedIndex });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 공휴일 목록
app.get('/api/auto/holidays', (req, res) => {
  try {
    const holidays = rotation.loadHolidays();
    res.json({ holidays });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 0.0.0.0으로 열면 같은 네트워크의 다른 기기에서도 접속 가능
app.listen(PORT, '0.0.0.0', () => {
  // 내 IP 주소 자동 감지
  const os = require('os');
  const nets = os.networkInterfaces();
  let myIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        myIP = net.address;
        break;
      }
    }
    if (myIP !== 'localhost') break;
  }

  console.log(`\n🎯 인스타 이벤트 & 자동 업로드 서버`);
  console.log(`   ────────────────────────────────`);
  console.log(`   이 컴퓨터:  http://localhost:${PORT}`);
  console.log(`   다른 기기:  http://${myIP}:${PORT}`);
  console.log(`   ────────────────────────────────`);
  console.log(`   - 추첨 도구:     /index.html`);
  console.log(`   - 자동 업로드:    /auto.html\n`);

  // 스케줄러 시작
  try {
    autoUpload.startScheduler();
  } catch (err) {
    console.error('[scheduler] 시작 실패:', err.message);
  }
});
