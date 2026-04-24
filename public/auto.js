// 자동 업로드 관리 페이지 스크립트

const $ = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`[${res.status}] ${errText.substring(0, 200)}`);
  }
  return res.json();
}

// === 계정 관리 ===
function fmtRelTime(iso) {
  if (!iso) return '<span style="color:#999;">아직 없음</span>';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return min + '분 전';
  const h = Math.floor(min / 60);
  if (h < 24) return h + '시간 전';
  const d = Math.floor(h / 24);
  return d + '일 전';
}

async function loadAccountList() {
  const accounts = await api('/api/auto/accounts');
  const rows = accounts.map(a => {
    let cookieStatus = '<span class="tag fail">없음</span>';
    if (a.hasCookies) {
      if (a.lastKeepAliveError === 'login_required') {
        cookieStatus = '<span class="tag fail">만료됨</span>';
      } else if (a.lastKeepAliveStatus === 200) {
        cookieStatus = '<span class="tag ok">활성</span>';
      } else {
        cookieStatus = '<span class="tag ok">등록됨</span>';
      }
    }
    const lastActive = a.lastKeepAliveAt
      ? fmtRelTime(a.lastKeepAliveAt) + (a.lastCookieRefreshAt ? ' <span style="color:#0095f6;font-size:10px;">🔄갱신</span>' : '')
      : '<span style="color:#999;font-size:11px;">미확인</span>';
    return `
    <tr>
      <td>${a.index}</td>
      <td>@${escapeHtml(a.username)}</td>
      <td>${escapeHtml(a.label)}</td>
      <td>${cookieStatus}</td>
      <td style="font-size:12px;">${lastActive}</td>
      <td><button class="btn btn-outline btn-sm del-acc-btn" data-user="${escapeHtml(a.username)}">삭제</button></td>
    </tr>
  `;
  }).join('');
  $('accountListBody').innerHTML = rows || `<tr><td colspan="5" style="text-align:center;color:#6e6e73;">등록된 계정이 없습니다.</td></tr>`;
  $('accountCountText').textContent = `총 ${accounts.length}개 계정 등록됨 (최소 2개 필요)`;

  // 삭제 버튼 연결
  document.querySelectorAll('.del-acc-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`@${btn.dataset.user} 계정을 삭제하시겠습니까?`)) return;
      await api('/api/auto/accounts/delete', { method: 'POST', body: { username: btn.dataset.user } });
      await loadAccountList();
      await refreshAll();
    };
  });
}

async function saveNewAccount() {
  const username = $('newUsername').value.trim();
  const label = $('newLabel').value.trim();
  const cookies = $('newCookies').value.trim();

  if (!username) { setStatus('accountSaveStatus', '아이디를 입력해주세요.', 'error'); return; }
  if (!cookies) { setStatus('accountSaveStatus', '쿠키를 붙여넣어주세요.', 'error'); return; }

  try {
    await api('/api/auto/accounts/save', { method: 'POST', body: { username, label, cookies } });
    setStatus('accountSaveStatus', `✅ @${username} 저장 완료!`, 'ok');
    $('newUsername').value = '';
    $('newLabel').value = '';
    $('newCookies').value = '';
    $('accountFormSection').style.display = 'none';
    $('addAccountBtn').style.display = '';
    await loadAccountList();
    cachedAccounts = null;
    await refreshAll();
  } catch (err) {
    setStatus('accountSaveStatus', `❌ ${err.message}`, 'error');
  }
}

// === 이미지 업로드/관리 ===
async function loadImages() {
  const { images } = await api('/api/auto/images');
  $('imageCountBadge').textContent = images.length + '개';

  if (!images.length) {
    $('imageList').innerHTML = '<p style="color:#6e6e73;font-size:13px;">이미지가 없습니다. 위에서 업로드해주세요.</p>';
    return;
  }
  const html = images.map(name => `
    <div class="img-item">
      <img src="/api/auto/images/preview/${encodeURIComponent(name)}" alt="${escapeHtml(name)}" loading="lazy">
      <span class="img-name">${escapeHtml(name)}</span>
      <button class="img-del" data-name="${escapeHtml(name)}" title="삭제">&times;</button>
    </div>
  `).join('');
  $('imageList').innerHTML = html;

  document.querySelectorAll('.img-del').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`${btn.dataset.name} 삭제할까요?`)) return;
      await api('/api/auto/images/delete', { method: 'POST', body: { filename: btn.dataset.name } });
      await loadImages();
      await refreshAll();
    };
  });
}

function setupDropZone() {
  const zone = $('dropZone');
  const input = $('imageInput');

  zone.onclick = () => input.click();

  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = () => zone.classList.remove('dragover');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    uploadFiles(e.dataTransfer.files);
  };
  input.onchange = () => { if (input.files.length) uploadFiles(input.files); };
}

async function uploadFiles(fileList) {
  const files = Array.from(fileList).filter(f => /\.(jpe?g|png|webp)$/i.test(f.name));
  if (!files.length) { setStatus('uploadProgress', '지원하지 않는 형식입니다 (jpg, png, webp만)', 'error'); return; }

  setStatus('uploadProgress', `${files.length}개 업로드 중...`, '');
  const formData = new FormData();
  files.forEach(f => formData.append('images', f));

  try {
    const res = await fetch('/api/auto/images/upload', { method: 'POST', body: formData });
    const result = await res.json();
    if (result.success) {
      setStatus('uploadProgress', `✅ ${result.uploaded}개 업로드 완료!`, 'ok');
      $('imageInput').value = '';
      await loadImages();
      await refreshAll();
    } else {
      setStatus('uploadProgress', '❌ ' + (result.error || '업로드 실패'), 'error');
    }
  } catch (err) {
    setStatus('uploadProgress', '❌ ' + err.message, 'error');
  }
}

// === 설정 로드/저장 ===
async function loadConfig() {
  const cfg = await api('/api/auto/config');
  $('cfgEnabled').checked = !!cfg.enabled;
  $('cfgCron').value = cfg.cronExpression || '0 10 * * *';
  $('cfgDelay').value = cfg.delayBetweenUploads ?? 30;
  $('cfgFolder').value = cfg.imageFolder || '';
}

async function saveConfig() {
  try {
    const body = {
      enabled: $('cfgEnabled').checked,
      cronExpression: $('cfgCron').value.trim() || '0 10 * * *',
      delayBetweenUploads: parseInt($('cfgDelay').value || '30', 10),
      imageFolder: $('cfgFolder').value.trim(),
    };
    const result = await api('/api/auto/config', { method: 'POST', body });
    setStatus('configStatus', '✅ 저장 완료 (스케줄러 재시작됨)', 'ok');
    await refreshAll();
  } catch (err) {
    setStatus('configStatus', `❌ ${err.message}`, 'error');
  }
}

function setStatus(id, msg, kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status ${kind}`;
  if (kind === 'ok') {
    setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 4000);
  }
}

// === 오늘 상태 & 사용 현황 ===
async function loadState() {
  const data = await api('/api/auto/state');

  // 오늘 상태
  const today = data.today;
  const skipInfo = today.skip
    ? `<span class="value skip">건너뜀 (${today.reason})</span>`
    : `<span class="value ok">업로드 예정</span>`;

  const nextFeedUser = data.accountCount > 0
    ? `@${getAccountAt(data.state.nextFeedIndex, data)}`
    : '(계정 없음)';
  const nextStoryUser = data.accountCount > 1
    ? `@${getAccountAt((data.state.nextFeedIndex + 1) % data.accountCount, data)}`
    : '(계정 부족)';

  $('todayInfo').innerHTML = `
    <div class="item"><span class="label">오늘</span>${skipInfo}</div>
    <div class="item"><span class="label">다음 피드</span><span class="value">${nextFeedUser}</span></div>
    <div class="item"><span class="label">다음 스토리</span><span class="value">${nextStoryUser}</span></div>
    <div class="item"><span class="label">등록된 계정</span><span class="value">${data.accountCount}개</span></div>
    <div class="item"><span class="label">이미지</span><span class="value">${data.imageCount}개</span></div>
    <div class="item"><span class="label">이미지 폴더</span><span class="value" style="font-size:12px;word-break:break-all;">${escapeHtml(data.imageFolder)}</span></div>
  `;

  // 계정별 사용 현황 표
  const usage = data.perAccountUsage || {};
  const accounts = Object.keys(usage);
  const totalImages = data.imageCount || 1;

  const rows = accounts.map((u, i) => {
    const { used, remaining } = usage[u];
    const pct = Math.round((used / Math.max(1, totalImages)) * 100);
    return `
      <tr>
        <td>${i}</td>
        <td>@${escapeHtml(u)}</td>
        <td>
          ${used}
          <span class="progress-bar-mini"><div style="width:${pct}%"></div></span>
        </td>
        <td>${remaining}</td>
        <td><button class="btn btn-outline btn-sm reset-btn" data-user="${escapeHtml(u)}">초기화</button></td>
      </tr>
    `;
  }).join('');
  $('usageTableBody').innerHTML = rows || `<tr><td colspan="5" style="text-align:center;color:#6e6e73;">등록된 계정이 없습니다.</td></tr>`;

  // 개별 리셋 버튼 연결
  document.querySelectorAll('.reset-btn').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm(`@${btn.dataset.user} 계정의 사용 기록을 초기화하시겠습니까?`)) return;
      await api('/api/auto/reset-used', { method: 'POST', body: { username: btn.dataset.user } });
      await refreshAll();
    };
  });

  // 다음 피드 인덱스
  $('nextIdx').value = data.state.nextFeedIndex;

  // 실행 이력
  renderHistory(data.state.history || []);
}

// 계정 목록 캐시 (자동 업로드 전용)
let cachedAccounts = null;
async function getAccounts() {
  if (!cachedAccounts) {
    cachedAccounts = await api('/api/auto/accounts');
  }
  return cachedAccounts;
}
function getAccountAt(idx, data) {
  // data.perAccountUsage는 객체(순서 보장되지 않을 수 있음). 캐시된 계정 순서 기준으로 표시
  if (!cachedAccounts) return '(로드중)';
  const acc = cachedAccounts[idx];
  return acc ? acc.username : '(없음)';
}

// === 예정 미리보기 ===
async function loadPreview() {
  const { preview } = await api('/api/auto/preview?days=14');
  const rows = preview.map(p => {
    if (p.skip) {
      return `
        <tr>
          <td>${p.date}</td>
          <td>${p.dayOfWeek}</td>
          <td colspan="2" style="color:#6e6e73;">-</td>
          <td><span class="tag skip">${escapeHtml(p.reason)}</span></td>
        </tr>
      `;
    }
    return `
      <tr>
        <td>${p.date}</td>
        <td>${p.dayOfWeek}</td>
        <td>@${escapeHtml(p.feed || '')}</td>
        <td>@${escapeHtml(p.story || '')}</td>
        <td><span class="tag ok">예정</span></td>
      </tr>
    `;
  }).join('');
  $('previewBody').innerHTML = rows;
}

// === 실행 이력 렌더링 ===
function renderHistory(history) {
  if (!history.length) {
    $('historyBody').innerHTML = `<tr><td colspan="4" style="text-align:center;color:#6e6e73;">실행 이력이 없습니다.</td></tr>`;
    return;
  }
  const rows = history.map(h => {
    const time = new Date(h.timestamp).toLocaleString('ko-KR', { hour12: false });
    let typeTag = '';
    let result = '';
    if (h.type === 'feed') {
      typeTag = '<span class="tag feed">피드</span>';
      result = h.url ? `<a href="${h.url}" target="_blank">${h.image || '보기'}</a>` : (h.image || '');
    } else if (h.type === 'story') {
      typeTag = '<span class="tag story">스토리</span>';
      result = h.image || '';
    } else if (h.type === 'feed-fail' || h.type === 'story-fail') {
      typeTag = `<span class="tag fail">${h.type === 'feed-fail' ? '피드' : '스토리'}실패</span>`;
      result = escapeHtml(h.error || '');
    } else if (h.type === 'skip') {
      typeTag = '<span class="tag skip">스킵</span>';
      result = escapeHtml(h.reason || '');
    } else {
      typeTag = `<span class="tag">${escapeHtml(h.type)}</span>`;
    }
    return `
      <tr>
        <td>${time}</td>
        <td>${typeTag}</td>
        <td>${h.username ? '@' + escapeHtml(h.username) : '-'}</td>
        <td>${result}</td>
      </tr>
    `;
  }).join('');
  $('historyBody').innerHTML = rows;
}

// === 지금 실행 ===
async function runNow() {
  if (!confirm('지금 즉시 업로드를 실행하시겠습니까?\n(주말/공휴일 체크는 무시됩니다)')) return;
  const btn = $('runNowBtn');
  btn.disabled = true;
  btn.textContent = '실행 중...';
  try {
    const result = await api('/api/auto/run', { method: 'POST', body: { force: true } });
    const lines = (result.log || []).join('\n');
    alert(result.success ? '✅ 실행 완료\n\n' + lines : '⚠ 일부 실패\n\n' + lines);
    await refreshAll();
  } catch (err) {
    alert('❌ 실행 실패: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 지금 바로 실행 (스킵 무시)';
  }
}

// === 인덱스 설정 ===
async function saveIndex() {
  const v = parseInt($('nextIdx').value, 10);
  if (isNaN(v) || v < 0) {
    alert('유효한 숫자를 입력해주세요.');
    return;
  }
  try {
    await api('/api/auto/set-index', { method: 'POST', body: { nextFeedIndex: v } });
    await refreshAll();
    alert('저장되었습니다.');
  } catch (err) {
    alert('❌ ' + err.message);
  }
}

// === 유틸 ===
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function refreshAll() {
  cachedAccounts = null;
  await getAccounts();
  await Promise.all([loadState(), loadPreview()]);
}

// === 이벤트 바인딩 ===
// 계정 등록 UI
$('addAccountBtn').onclick = () => {
  $('accountFormSection').style.display = '';
  $('addAccountBtn').style.display = 'none';
  $('newUsername').focus();
};
$('cancelAccountBtn').onclick = () => {
  $('accountFormSection').style.display = 'none';
  $('addAccountBtn').style.display = '';
};
$('saveNewAccountBtn').onclick = saveNewAccount;

// Keep-Alive 수동 실행
$('keepAliveBtn').onclick = async () => {
  if (!confirm('모든 계정의 쿠키를 지금 갱신하시겠습니까?\n(20개 계정 기준 1분 정도 소요)')) return;
  const btn = $('keepAliveBtn');
  btn.disabled = true;
  btn.textContent = '실행 중...';
  try {
    const result = await api('/api/auto/keep-alive', { method: 'POST' });
    alert(`✅ 완료!\n\n검사: ${result.total}개\n쿠키 갱신: ${result.refreshed}개\n만료: ${result.expired}개`);
    await loadAccountList();
  } catch (err) {
    alert('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 쿠키 지금 갱신 (Keep-Alive)';
  }
};

$('saveConfigBtn').onclick = saveConfig;
$('runNowBtn').onclick = runNow;
$('saveIdxBtn').onclick = saveIndex;
$('openFolderBtn').onclick = async () => {
  try {
    await api('/api/auto/open-folder', { method: 'POST' });
  } catch (err) {
    alert('폴더 열기 실패: ' + err.message);
  }
};
$('resetAllUsedBtn').onclick = async () => {
  if (!confirm('모든 계정의 사용 기록을 초기화하시겠습니까?')) return;
  await api('/api/auto/reset-used', { method: 'POST', body: {} });
  await refreshAll();
};

// 초기 로드
(async () => {
  try {
    setupDropZone();
    await loadAccountList();
    await loadImages();
    await loadConfig();
    await refreshAll();
  } catch (err) {
    alert('초기 로드 실패: ' + err.message);
  }
})();

// 30초마다 자동 새로고침
setInterval(() => { refreshAll().catch(() => {}); }, 30000);
