// 상태
let allComments = [];
let lastWinnersWithPrizes = []; // {username, text, prize} 형태

// DOM 요소
const sessionIdInput = document.getElementById('sessionId');
const saveSessionCheck = document.getElementById('saveSession');
const postUrlInput = document.getElementById('postUrl');
const fetchBtn = document.getElementById('fetchBtn');
const fetchStatus = document.getElementById('fetchStatus');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const drawSection = document.getElementById('drawSection');
const totalCommentsEl = document.getElementById('totalComments');
const uniqueUsersEl = document.getElementById('uniqueUsers');
const marketNameInput = document.getElementById('marketName');
const keywordInput = document.getElementById('keyword');
const removeDuplicatesCheck = document.getElementById('removeDuplicates');
const drawBtn = document.getElementById('drawBtn');
const resultSection = document.getElementById('resultSection');
const winnerList = document.getElementById('winnerList');
const copyBtn = document.getElementById('copyBtn');
const copyFullBtn = document.getElementById('copyFullBtn');
const redrawBtn = document.getElementById('redrawBtn');
const commentSection = document.getElementById('commentSection');
const commentCount = document.getElementById('commentCount');
const commentList = document.getElementById('commentList');
const toggleSessionBtn = document.getElementById('toggleSession');
const pasteInput = document.getElementById('pasteInput');
const parseBtn = document.getElementById('parseBtn');
const prizeListEl = document.getElementById('prizeList');
const addPrizeBtn = document.getElementById('addPrizeBtn');
const totalWinnersEl = document.getElementById('totalWinners');
const verifyFollowerCheck = document.getElementById('verifyFollower');
const excludeRecentCheck = document.getElementById('excludeRecent');
const excludeDaysSelect = document.getElementById('excludeDays');
const recentCountBadge = document.getElementById('recentCountBadge');
const verifySellerNameEl = document.getElementById('verifySellerName');
const uploadAccountNameEl = document.getElementById('uploadAccountName');

// 탭 전환
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + 'Mode').classList.add('active');
  });
});

// 서버 공유 설정 불러오기 (모든 사용자 동일)
(async function loadSharedConfig() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config.sessionId && !sessionIdInput.value) {
      sessionIdInput.value = config.sessionId;
      saveSessionCheck.checked = true;
    }
    if (config.scriptUrl && scriptUrlInput && !scriptUrlInput.value) {
      scriptUrlInput.value = config.scriptUrl;
      saveScriptUrlCheck.checked = true;
    }
  } catch {}

  // localStorage 백업 (서버 설정이 없을 때)
  const savedSession = localStorage.getItem('ig_session_id');
  if (savedSession && !sessionIdInput.value) {
    sessionIdInput.value = savedSession;
    saveSessionCheck.checked = true;
  }
})();

// 세션 ID 변경 시 서버에도 저장
saveSessionCheck.addEventListener('change', () => {
  if (saveSessionCheck.checked) {
    localStorage.setItem('ig_session_id', sessionIdInput.value);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionIdInput.value }),
    }).catch(() => {});
  } else {
    localStorage.removeItem('ig_session_id');
  }
});

sessionIdInput.addEventListener('input', () => {
  if (saveSessionCheck.checked) {
    localStorage.setItem('ig_session_id', sessionIdInput.value);
  }
});

// 세션 ID 보기/숨기기
toggleSessionBtn.addEventListener('click', () => {
  if (sessionIdInput.type === 'password') {
    sessionIdInput.type = 'text';
    toggleSessionBtn.textContent = '\u{1F648}';
  } else {
    sessionIdInput.type = 'password';
    toggleSessionBtn.textContent = '\u{1F441}';
  }
});

// 상태 표시
function setStatus(msg, type) {
  fetchStatus.textContent = msg;
  fetchStatus.className = 'status ' + (type || '');
  if (type === 'loading') {
    fetchStatus.innerHTML = msg + '<span class="spinner"></span>';
  }
}

// 진행률 표시
function showProgress(show) {
  progressSection.style.display = show ? 'block' : 'none';
}

function updateProgress(collected, hasMore) {
  if (hasMore) {
    // 정확한 총 수를 모르므로 인디터미네이트 + 수집 개수 표시
    progressBar.classList.add('indeterminate');
    progressBar.style.width = '30%';
  } else {
    progressBar.classList.remove('indeterminate');
    progressBar.style.width = '100%';
  }
  progressText.textContent = `${collected.toLocaleString()}개 댓글 수집 중...`;
}

// 댓글 데이터 로드 후 공통 처리
function onCommentsLoaded() {
  const uniqueSet = new Set(allComments.map(c => c.username));
  totalCommentsEl.textContent = allComments.length.toLocaleString();
  uniqueUsersEl.textContent = uniqueSet.size.toLocaleString();
  renderCommentList();
  drawSection.style.display = 'block';
  commentSection.style.display = 'block';
  resultSection.style.display = 'none';
}

// === API 모드: 댓글 불러오기 (SSE 방식) ===
fetchBtn.addEventListener('click', async () => {
  const sessionId = sessionIdInput.value.trim();
  const postUrl = postUrlInput.value.trim();

  if (!sessionId) {
    setStatus('세션 ID를 입력해주세요.', 'error');
    return;
  }
  if (!postUrl) {
    setStatus('게시물 URL을 입력해주세요.', 'error');
    return;
  }

  fetchBtn.disabled = true;
  setStatus('댓글 수집 시작...', 'loading');
  showProgress(true);
  progressBar.classList.add('indeterminate');
  progressText.textContent = '서버에 요청 중...';

  try {
    // 1) 서버에 수집 요청 → jobId 받기
    const res = await fetch('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postUrl, sessionId }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || '댓글 불러오기 실패');
    }

    // 2) SSE 스트림으로 진행상황 수신
    const jobId = data.jobId;
    const eventSource = new EventSource(`/api/comments/stream?jobId=${jobId}`);

    eventSource.addEventListener('progress', (e) => {
      const info = JSON.parse(e.data);
      updateProgress(info.collected, info.hasMore);
    });

    eventSource.addEventListener('complete', (e) => {
      const result = JSON.parse(e.data);
      allComments = result.comments;
      onCommentsLoaded();
      setStatus(`${result.total.toLocaleString()}개 댓글 수집 완료!`, 'success');
      showProgress(false);
      fetchBtn.disabled = false;
      eventSource.close();
    });

    eventSource.addEventListener('error', (e) => {
      try {
        const err = JSON.parse(e.data);
        setStatus(err.message, 'error');
      } catch {
        setStatus('댓글 수집 중 오류가 발생했습니다.', 'error');
      }
      showProgress(false);
      fetchBtn.disabled = false;
      eventSource.close();
    });

    // SSE 자체 연결 에러
    eventSource.onerror = () => {
      // SSE error 이벤트가 아닌 연결 에러
      if (eventSource.readyState === EventSource.CLOSED) return;
      setStatus('서버 연결이 끊어졌습니다.', 'error');
      showProgress(false);
      fetchBtn.disabled = false;
      eventSource.close();
    };

  } catch (err) {
    setStatus(err.message, 'error');
    showProgress(false);
    fetchBtn.disabled = false;
  }
});

// === 붙여넣기 모드: 댓글 파싱 ===
parseBtn.addEventListener('click', () => {
  const raw = pasteInput.value.trim();
  if (!raw) {
    setStatus('댓글을 붙여넣어 주세요.', 'error');
    return;
  }

  const lines = raw.split('\n').filter(l => l.trim());
  allComments = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 형식 1: @아이디 댓글내용
    let match = trimmed.match(/^@?(\S+)\s+(.*)/);
    if (match) {
      allComments.push({
        username: match[1].replace(/^@/, ''),
        text: match[2] || '',
        timestamp: 0,
      });
      continue;
    }

    // 형식 2: 아이디만
    if (/^\S+$/.test(trimmed)) {
      allComments.push({
        username: trimmed.replace(/^@/, ''),
        text: '',
        timestamp: 0,
      });
    }
  }

  if (allComments.length === 0) {
    setStatus('파싱된 댓글이 없습니다. 형식을 확인해주세요.', 'error');
    return;
  }

  onCommentsLoaded();
  setStatus(`${allComments.length}개 댓글 파싱 완료!`, 'success');
});

// 댓글 목록 렌더링
function renderCommentList() {
  commentCount.textContent = allComments.length;
  commentList.innerHTML = allComments.map(c =>
    `<div class="comment-item">
      <span class="username">@${escapeHtml(c.username)}</span>
      <span class="text">${escapeHtml(c.text)}</span>
    </div>`
  ).join('');
}

// === 증정품 관리 ===
function getPrizes() {
  const rows = prizeListEl.querySelectorAll('.prize-row');
  const prizes = [];
  rows.forEach(row => {
    const name = row.querySelector('.prize-name').value.trim();
    const count = parseInt(row.querySelector('.prize-count').value) || 1;
    if (name) {
      prizes.push({ name, count });
    }
  });
  return prizes;
}

function getTotalWinnerCount() {
  const prizes = getPrizes();
  if (prizes.length === 0) {
    // 증정품명 미입력 시 수량만 합산
    let total = 0;
    prizeListEl.querySelectorAll('.prize-count').forEach(el => {
      total += parseInt(el.value) || 1;
    });
    return Math.max(total, 1);
  }
  return prizes.reduce((sum, p) => sum + p.count, 0);
}

function updateTotalWinners() {
  totalWinnersEl.textContent = getTotalWinnerCount();
}

// 증정품 행 추가
addPrizeBtn.addEventListener('click', () => {
  const idx = prizeListEl.children.length;
  const row = document.createElement('div');
  row.className = 'prize-row';
  row.dataset.index = idx;
  row.innerHTML = `
    <input type="text" class="prize-name" placeholder="증정품명 (예: 스킨케어 세트)">
    <input type="number" class="prize-count" placeholder="수량" value="1" min="1">
    <button class="btn-icon prize-remove" title="삭제">&times;</button>
  `;
  prizeListEl.appendChild(row);
  updateTotalWinners();
});

// 증정품 삭제 (이벤트 위임)
prizeListEl.addEventListener('click', (e) => {
  if (e.target.classList.contains('prize-remove')) {
    if (prizeListEl.children.length <= 1) return; // 최소 1개
    e.target.closest('.prize-row').remove();
    updateTotalWinners();
  }
});

// 수량 변경 시 총 당첨자 업데이트
prizeListEl.addEventListener('input', (e) => {
  if (e.target.classList.contains('prize-count') || e.target.classList.contains('prize-name')) {
    updateTotalWinners();
  }
});

// === 최근 당첨자 목록 조회 (시트에서) ===
async function fetchRecentWinners() {
  if (!excludeRecentCheck.checked) return new Set();
  const scriptUrl = scriptUrlInput.value.trim();
  if (!scriptUrl) {
    alert('최근 당첨자 제외 기능을 사용하려면 Apps Script URL을 먼저 입력해주세요.');
    throw new Error('scriptUrl 미입력');
  }
  const days = parseInt(excludeDaysSelect.value, 10) || 30;
  const seller = getSelectedAccountLabel();
  if (!seller) {
    throw new Error('1단계에서 Instagram 계정을 먼저 선택해주세요.');
  }

  recentCountBadge.textContent = '조회 중...';
  recentCountBadge.style.background = '#0071e3';

  const res = await fetch('/api/sheets/recent-winners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptUrl, days, seller }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    recentCountBadge.textContent = '실패';
    recentCountBadge.style.background = '#e8453c';
    throw new Error(data.error || '최근 당첨자 조회 실패');
  }
  const set = new Set((data.usernames || []).map(u => u.toLowerCase()));
  recentCountBadge.textContent = `${days}일 내 ${set.size}명`;
  recentCountBadge.style.background = '#34c759';
  return set;
}

// === 팔로워 검증 ===
async function verifyFollowers(winnersList) {
  const teamUsername = accountSelect.value;
  if (!teamUsername) {
    throw new Error('1단계에서 Instagram 계정을 먼저 선택해주세요.');
  }
  const payload = {
    teamUsername,
    winners: winnersList.map(w => ({ username: w.username, userId: w.userId || null })),
  };
  const res = await fetch('/api/ig/check-followers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || '팔로워 검증 실패');
  }
  return data.followMap; // { username: true/false }
}

// 공통 필터 (키워드 + 중복제거 + 최근 당첨자 제외)
function applyBaseFilters(excludeSet) {
  const keyword = keywordInput.value;
  const removeDuplicates = removeDuplicatesCheck.checked;

  let filtered = [...allComments];

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
  if (excludeSet && excludeSet.size > 0) {
    filtered = filtered.filter(c => !excludeSet.has(c.username.toLowerCase()));
  }
  return filtered;
}

// Fisher-Yates 셔플
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 증정품 배정
function assignPrizes(winners, prizes) {
  const result = [];
  if (prizes.length > 0) {
    let idx = 0;
    for (const prize of prizes) {
      for (let i = 0; i < prize.count && idx < winners.length; i++, idx++) {
        result.push({ ...winners[idx], prize: prize.name });
      }
    }
    while (idx < winners.length) {
      result.push({ ...winners[idx], prize: '' });
      idx++;
    }
  } else {
    return winners.map(w => ({ ...w, prize: '' }));
  }
  return result;
}

// === 추첨 (클라이언트 로컬 + 검증) ===
drawBtn.addEventListener('click', async () => {
  const totalCount = getTotalWinnerCount();
  const prizes = getPrizes();
  const verifyOn = verifyFollowerCheck.checked;

  drawBtn.disabled = true;
  const originalText = drawBtn.textContent;
  drawBtn.textContent = '추첨 중...';

  try {
    // 1) 최근 당첨자 조회
    let excludeSet = new Set();
    try {
      excludeSet = await fetchRecentWinners();
    } catch (err) {
      alert(err.message);
      return;
    }

    // 2) 기본 필터
    const filtered = applyBaseFilters(excludeSet);

    if (filtered.length === 0) {
      alert('조건에 맞는 댓글이 없습니다.');
      return;
    }

    // 3) 셔플
    shuffleArray(filtered);

    let winners;
    if (verifyOn) {
      // 팔로워 검증: 필요한 수만큼 확보될 때까지 풀에서 순차 검증
      const needed = Math.min(totalCount, filtered.length);
      drawBtn.textContent = '팔로워 검증 중...';

      const approved = [];
      const rejected = [];
      let cursor = 0;
      const BATCH_SIZE = Math.min(50, Math.max(needed, 20));

      while (approved.length < needed && cursor < filtered.length) {
        const remainingNeeded = needed - approved.length;
        const batch = filtered.slice(cursor, cursor + Math.max(remainingNeeded * 2, BATCH_SIZE));
        cursor += batch.length;

        const followMap = await verifyFollowers(batch);
        for (const c of batch) {
          if (approved.length >= needed) break;
          const status = followMap[c.username];
          if (status === true) {
            approved.push(c);
          } else {
            rejected.push({ ...c, reason: status === null ? '확인 불가' : '팔로우 안 함' });
          }
        }
      }

      winners = approved;
      if (rejected.length > 0) {
        console.log(`[검증 결과] 통과 ${approved.length}명 / 탈락 ${rejected.length}명`, rejected);
      }
      if (approved.length < needed) {
        alert(`팔로워 검증 결과, 요청한 ${needed}명 중 ${approved.length}명만 확보되었습니다. (${rejected.length}명 탈락)`);
      }
    } else {
      const winnerCount = Math.min(totalCount, filtered.length);
      winners = filtered.slice(0, winnerCount);
    }

    lastWinnersWithPrizes = assignPrizes(winners, prizes);

    renderWinners(lastWinnersWithPrizes);
    resultSection.style.display = 'block';
    postSection.style.display = 'block';
    generateCaption();
    resultSection.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    alert('추첨 중 오류: ' + err.message);
  } finally {
    drawBtn.disabled = false;
    drawBtn.textContent = originalText;
  }
});

// 당첨자 렌더링 (증정품 포함)
function renderWinners(winners) {
  winnerList.innerHTML = winners.map((w, i) =>
    `<div class="winner-item">
      <span class="rank">${i + 1}</span>
      <div class="winner-info">
        <div class="username">@${escapeHtml(w.username)}</div>
        <div class="comment-text">${escapeHtml(w.text)}</div>
        ${w.prize ? `<span class="prize-badge">${escapeHtml(w.prize)}</span>` : ''}
      </div>
    </div>`
  ).join('');

  copyBtn.dataset.winners = JSON.stringify(winners);
  copyFullBtn.dataset.winners = JSON.stringify(winners);
}

// 아이디만 복사
copyBtn.addEventListener('click', () => {
  const winners = JSON.parse(copyBtn.dataset.winners || '[]');
  const text = winners.map(w => '@' + w.username).join('\n');
  copyToClipboard(text);
});

// 전체 복사 (증정품 포함)
copyFullBtn.addEventListener('click', () => {
  const winners = JSON.parse(copyFullBtn.dataset.winners || '[]');
  const text = winners.map((w, i) => {
    let line = `${i + 1}. @${w.username}`;
    if (w.prize) line += ` [${w.prize}]`;
    if (w.text) line += ` - ${w.text}`;
    return line;
  }).join('\n');
  copyToClipboard(text);
});

// 다시 추첨
redrawBtn.addEventListener('click', () => {
  drawBtn.click();
});

// 클립보드 복사
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    alert('클립보드에 복사되었습니다!');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('클립보드에 복사되었습니다!');
  }
}

// === Google Sheets 저장 ===
const scriptUrlInput = document.getElementById('scriptUrl');
const saveScriptUrlCheck = document.getElementById('saveScriptUrl');
const saveToSheetBtn = document.getElementById('saveToSheetBtn');
const sheetStatus = document.getElementById('sheetStatus');

// Apps Script URL (서버 설정에서 이미 로드됨, localStorage는 백업)
(function loadSavedScriptUrl() {
  const saved = localStorage.getItem('apps_script_url');
  if (saved && !scriptUrlInput.value) {
    scriptUrlInput.value = saved;
    saveScriptUrlCheck.checked = true;
  }
})();

saveScriptUrlCheck.addEventListener('change', () => {
  if (saveScriptUrlCheck.checked) {
    localStorage.setItem('apps_script_url', scriptUrlInput.value);
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptUrl: scriptUrlInput.value }),
    }).catch(() => {});
  } else {
    localStorage.removeItem('apps_script_url');
  }
});

scriptUrlInput.addEventListener('input', () => {
  if (saveScriptUrlCheck.checked) {
    localStorage.setItem('apps_script_url', scriptUrlInput.value);
  }
});

saveToSheetBtn.addEventListener('click', async () => {
  const scriptUrl = scriptUrlInput.value.trim();
  if (!scriptUrl) {
    sheetStatus.textContent = 'Apps Script 웹 앱 URL을 입력해주세요.';
    sheetStatus.className = 'status error';
    return;
  }

  if (!lastWinnersWithPrizes || lastWinnersWithPrizes.length === 0) {
    sheetStatus.textContent = '저장할 당첨자가 없습니다. 먼저 추첨을 진행해주세요.';
    sheetStatus.className = 'status error';
    return;
  }

  const seller = getSelectedAccountLabel();
  if (!seller) {
    alert('1단계에서 Instagram 계정을 먼저 선택해주세요.');
    return;
  }

  const marketName = marketNameInput.value.trim() || '미입력';

  // 오늘 날짜 (YYYY-MM-DD)
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // 당첨자만 저장: [진행마켓명, 아이디, 댓글 내용, 선정 유무, 증정품, 추첨일자]
  const rows = lastWinnersWithPrizes.map(w => [
    marketName,
    w.username,
    w.text || '',
    '당첨자',
    w.prize || '',
    dateStr,
  ]);

  saveToSheetBtn.disabled = true;
  sheetStatus.textContent = '시트에 저장 중...';
  sheetStatus.className = 'status loading';

  try {
    const res = await fetch('/api/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scriptUrl, rows, seller }),
    });

    const data = await res.json();

    if (data.success) {
      const sheetName = data.result?.sheet || '탭';
      sheetStatus.textContent = `당첨자 ${rows.length}명 → "${sheetName}" 탭에 저장 완료!`;
      sheetStatus.className = 'status success';
    } else {
      throw new Error(data.error || '시트 저장 실패');
    }
  } catch (err) {
    sheetStatus.textContent = err.message;
    sheetStatus.className = 'status error';
  } finally {
    saveToSheetBtn.disabled = false;
  }
});

// === 4단계: Instagram 게시물 업로드 ===
const postSection = document.getElementById('postSection');
const accountSelect = document.getElementById('accountSelect');
const loginStatusBadge = document.getElementById('loginStatusBadge');
const accountForm = document.getElementById('accountForm');
const toggleAccountBtn = document.getElementById('toggleAccountBtn');
const deleteAccountBtn = document.getElementById('deleteAccountBtn');
const igUsernameInput = document.getElementById('igUsername');
const igLabelInput = document.getElementById('igLabel');
const igCookiesInput = document.getElementById('igCookies');
const saveAccountBtn = document.getElementById('saveAccountBtn');
const loginStatus = document.getElementById('loginStatus');
const captionTitle = document.getElementById('captionTitle');
const captionDeadline = document.getElementById('captionDeadline');
const captionPreview = document.getElementById('captionPreview');
const refreshCaptionBtn = document.getElementById('refreshCaptionBtn');
const copyCaptionBtn = document.getElementById('copyCaptionBtn');
const postImageInput = document.getElementById('postImage');
const imagePreview = document.getElementById('imagePreview');
const publishBtn = document.getElementById('publishBtn');
const publishStatus = document.getElementById('publishStatus');

// 계정 목록 데이터 (별칭 조회용)
let accountsData = [];

// 선택된 계정의 별칭(label) 반환
function getSelectedAccountLabel() {
  const username = accountSelect.value;
  if (!username) return '';
  const acc = accountsData.find(a => a.username === username);
  return (acc && acc.label) ? acc.label : username;
}

// 계정 목록 로드
async function loadAccountList() {
  try {
    const res = await fetch('/api/accounts');
    accountsData = await res.json();
    const prev = accountSelect.value;
    accountSelect.innerHTML = '<option value="">-- 계정 선택 --</option>';
    accountsData.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.username;
      opt.textContent = a.label ? `${a.label} (@${a.username})` : a.username;
      accountSelect.appendChild(opt);
    });
    if (prev) accountSelect.value = prev;
    updateAccountBadge();
  } catch {}
}

function updateAccountBadge() {
  const selected = accountSelect.value;
  if (selected) {
    loginStatusBadge.textContent = '등록됨';
    loginStatusBadge.className = 'login-badge logged-in';
  } else {
    loginStatusBadge.textContent = '미등록';
    loginStatusBadge.className = 'login-badge logged-out';
  }

  // 선택된 계정의 표시 이름
  const opt = accountSelect.options[accountSelect.selectedIndex];
  const display = selected ? (opt ? opt.textContent : `@${selected}`) : '(1단계에서 계정을 선택하세요)';

  // 셀러 본 계정 표시
  const acc = accountsData.find(a => a.username === selected);
  const influencer = acc && acc.influencerUsername ? `@${acc.influencerUsername}` : '';
  const verifyDisplay = selected
    ? (influencer ? `${display} → 팔로워 체크: ${influencer}` : `${display} (셀러 본 계정 미설정)`)
    : '(1단계에서 계정을 선택하세요)';

  if (verifySellerNameEl) verifySellerNameEl.textContent = verifyDisplay;
  if (uploadAccountNameEl) uploadAccountNameEl.textContent = display;
}

accountSelect.addEventListener('change', () => {
  updateAccountBadge();
  // 선택된 계정의 쿠키에서 sessionId 자동 추출
  const acc = accountsData.find(a => a.username === accountSelect.value);
  if (acc && acc.cookies) {
    const m = acc.cookies.match(/sessionid=([^;]+)/);
    if (m) {
      sessionIdInput.value = m[1];
    }
  }
});

// 계정 등록 폼 토글
toggleAccountBtn.addEventListener('click', () => {
  accountForm.style.display = accountForm.style.display === 'none' ? 'block' : 'none';
});

// 계정 저장
const igInfluencerInput = document.getElementById('igInfluencer');

saveAccountBtn.addEventListener('click', async () => {
  const username = igUsernameInput.value.trim();
  const label = igLabelInput.value.trim();
  const cookies = igCookiesInput.value.trim();
  const influencerUsername = igInfluencerInput ? igInfluencerInput.value.trim().replace(/^@/, '') : '';

  if (!username || !cookies) {
    loginStatus.textContent = '계정 아이디와 쿠키는 필수입니다.';
    loginStatus.className = 'status error';
    return;
  }

  try {
    const res = await fetch('/api/accounts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, label, cookies, influencerUsername }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    loginStatus.textContent = `${username} 계정 저장 완료!`;
    loginStatus.className = 'status success';
    accountForm.style.display = 'none';
    igUsernameInput.value = '';
    igLabelInput.value = '';
    igCookiesInput.value = '';
    if (igInfluencerInput) igInfluencerInput.value = '';

    await loadAccountList();
    accountSelect.value = username;
    updateAccountBadge();
  } catch (err) {
    loginStatus.textContent = err.message;
    loginStatus.className = 'status error';
  }
});

// 계정 삭제
deleteAccountBtn.addEventListener('click', async () => {
  const username = accountSelect.value;
  if (!username) { alert('삭제할 계정을 선택해주세요.'); return; }
  if (!confirm(`${username} 계정을 삭제하시겠습니까?`)) return;

  await fetch('/api/accounts/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  loginStatus.textContent = `${username} 계정 삭제됨`;
  loginStatus.className = 'status success';
  await loadAccountList();
  updateAccountBadge();
});

// 캡션 자동 생성
function generateCaption() {
  const title = captionTitle.value.trim() || '{마켓명 이벤트}';
  const deadline = captionDeadline.value.trim() || '{답변 기한}';
  const prizes = getPrizes();

  // 증정품별 당첨자 그룹화
  const prizeGroups = {};
  lastWinnersWithPrizes.forEach(w => {
    const key = w.prize || '미지정';
    if (!prizeGroups[key]) prizeGroups[key] = [];
    prizeGroups[key].push(w.username);
  });

  let caption = `✨${title} 당첨자 발표\n\n`;
  caption += `이벤트에 참여해주신 모든 분들께 진심으로 감사드립니다! 당첨되신 분들께는 개별 DM으로 안내드릴 예정입니다.\n\n`;

  // 증정품별 블록
  for (const [prizeName, users] of Object.entries(prizeGroups)) {
    const prizeInfo = prizes.find(p => p.name === prizeName);
    const eventDesc = '구매완료 댓글 이벤트';
    caption += `✔️${eventDesc} ${users.length}명 : ${prizeName} 증정\n`;
    users.forEach(u => {
      caption += `@${u}\n`;
    });
    caption += `\n`;
  }

  caption += `⚠️ 새로운 사람의 메시지를 요청하지 않는 경우\n`;
  caption += `팀 계정 메시지를 보실 수 없습니다!\n`;
  caption += `꼭 팔로우 후 DM 허용 해주세요\n\n`;
  caption += `📮 이벤트 답변 기한 : ${deadline}\n`;
  caption += `기한 내 DM 답변이 오시지 않는 경우, 당첨이 무효 처리 되는 점 미리 안내드립니다! 꼭 기한 내 답변 부탁드립니다 🥰\n\n`;
  caption += `다시 한 번 당첨을 축하드리며\n`;
  caption += `앞으로도 더 좋은 마켓으로 찾아뵙겠습니다 🤍\n`;
  caption += `감사합니다.`;

  captionPreview.value = caption;
  return caption;
}

// 캡션 관련 이벤트
captionTitle.addEventListener('input', generateCaption);
captionDeadline.addEventListener('input', generateCaption);
refreshCaptionBtn.addEventListener('click', generateCaption);

copyCaptionBtn.addEventListener('click', () => {
  const text = captionPreview.value;
  copyToClipboard(text);
});

// 이미지 미리보기
postImageInput.addEventListener('change', () => {
  const file = postImageInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      imagePreview.innerHTML = `<img src="${e.target.result}" alt="미리보기">`;
    };
    reader.readAsDataURL(file);
  } else {
    imagePreview.innerHTML = '';
  }
});

// 게시물 업로드
publishBtn.addEventListener('click', async () => {
  const username = accountSelect.value;
  const caption = captionPreview.value;
  const imageFile = postImageInput.files[0];

  if (!username) {
    publishStatus.textContent = '계정을 선택해주세요.';
    publishStatus.className = 'status error';
    return;
  }
  if (!imageFile) {
    publishStatus.textContent = '이미지를 선택해주세요.';
    publishStatus.className = 'status error';
    return;
  }
  if (!caption) {
    publishStatus.textContent = '캡션이 비어있습니다.';
    publishStatus.className = 'status error';
    return;
  }

  if (!confirm(`${username} 계정으로 게시물을 업로드하시겠습니까?`)) return;

  publishBtn.disabled = true;
  publishStatus.textContent = '게시물 업로드 중...';
  publishStatus.className = 'status loading';

  try {
    const formData = new FormData();
    formData.append('username', username);
    formData.append('caption', caption);
    formData.append('image', imageFile);

    const res = await fetch('/api/ig/post', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    publishStatus.innerHTML = `게시물 업로드 완료! <a href="${data.url}" target="_blank">${data.url}</a>`;
    publishStatus.className = 'status success';
  } catch (err) {
    publishStatus.textContent = err.message;
    publishStatus.className = 'status error';
  } finally {
    publishBtn.disabled = false;
  }
});

// 페이지 로드 시 계정 목록 불러오기
loadAccountList();

// HTML 이스케이프
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
