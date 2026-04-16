// auto-upload/rotation.js
// 계정/이미지 로테이션 관리
// - 매일 피드 1계정 + 스토리 1계정 선택 (인접한 2개, 매일 1칸씩 이동)
// - 각 계정별로 이미지 사용 기록을 유지해 100장 다 쓰기 전에는 중복 금지

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state.json');
const HOLIDAYS_FILE = path.join(__dirname, '..', 'holidays.json');

// 기본 상태 구조
function defaultState() {
  return {
    // 다음 실행 시 피드 업로드할 계정의 인덱스 (accounts.json 순서 기준)
    nextFeedIndex: 0,
    // 계정별 사용한 이미지 파일명 목록 (100장 다 쓰면 초기화)
    usedImages: {
      // "username": ["img1.jpg", "img2.jpg", ...]
    },
    // 실행 이력
    history: [],
  };
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return { ...defaultState(), ...data };
    }
  } catch (e) {
    console.error('[state] 로드 실패, 초기화:', e.message);
  }
  return defaultState();
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// === 공휴일/주말 체크 ===
function loadHolidays() {
  try {
    if (fs.existsSync(HOLIDAYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(HOLIDAYS_FILE, 'utf8'));
      const all = [];
      for (const year of Object.keys(data)) {
        if (year.startsWith('_')) continue;
        if (Array.isArray(data[year])) all.push(...data[year]);
      }
      return all;
    }
  } catch (e) {
    console.error('[holidays] 로드 실패:', e.message);
  }
  return [];
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 오늘이 업로드 건너뛸 날인지 판정
function shouldSkipToday(date = new Date()) {
  const day = date.getDay(); // 0=일, 6=토
  if (day === 0) return { skip: true, reason: '일요일' };
  if (day === 6) return { skip: true, reason: '토요일' };

  const today = formatDate(date);
  const holidays = loadHolidays();
  const match = holidays.find(h => h.date === today);
  if (match) return { skip: true, reason: `공휴일(${match.name})` };

  return { skip: false, reason: '' };
}

// === 계정 선택 ===
// 패턴: 1일 A피드+B스토리, 2일 B피드+C스토리, 3일 C피드+D스토리...
// nextFeedIndex 저장 → 실행 후 +1 증가
function pickAccounts(accounts, state) {
  if (!accounts.length) {
    throw new Error('등록된 계정이 없습니다.');
  }
  const n = accounts.length;
  if (n < 2) {
    throw new Error('최소 2개 이상의 계정이 필요합니다 (피드 + 스토리 각각 1개).');
  }

  const feedIdx = ((state.nextFeedIndex % n) + n) % n;
  const storyIdx = (feedIdx + 1) % n;

  return {
    feed: accounts[feedIdx],
    story: accounts[storyIdx],
    feedIdx,
    storyIdx,
  };
}

// === 이미지 선택 ===
// 계정별 사용 기록에 없는 이미지 중 랜덤 1개
function pickImage(username, availableImages, state) {
  if (!availableImages.length) {
    throw new Error('이미지 폴더에 사용 가능한 파일이 없습니다.');
  }

  if (!state.usedImages) state.usedImages = {};
  if (!state.usedImages[username]) state.usedImages[username] = [];

  const used = new Set(state.usedImages[username]);
  let remaining = availableImages.filter(img => !used.has(img));

  // 100장(또는 전체) 다 썼으면 사용 기록 초기화
  if (remaining.length === 0) {
    console.log(`[rotation] ${username}: 전체 이미지 사용 완료 → 기록 초기화`);
    state.usedImages[username] = [];
    remaining = availableImages.slice();
  }

  const idx = Math.floor(Math.random() * remaining.length);
  return remaining[idx];
}

// 이미지 사용 기록
function markImageUsed(username, filename, state) {
  if (!state.usedImages) state.usedImages = {};
  if (!state.usedImages[username]) state.usedImages[username] = [];
  if (!state.usedImages[username].includes(filename)) {
    state.usedImages[username].push(filename);
  }
}

// 실행 이력 기록 (최근 200건 유지)
function addHistory(state, entry) {
  if (!state.history) state.history = [];
  state.history.unshift({
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (state.history.length > 200) {
    state.history = state.history.slice(0, 200);
  }
}

module.exports = {
  loadState,
  saveState,
  shouldSkipToday,
  pickAccounts,
  pickImage,
  markImageUsed,
  addHistory,
  loadHolidays,
  formatDate,
};
