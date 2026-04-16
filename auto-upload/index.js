// auto-upload/index.js
// 자동 업로드 실행 (1일 1회 - 피드 1계정 + 스토리 1계정)

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const rotation = require('./rotation');
const uploader = require('./ig-uploader');

const IMAGE_FOLDER = path.join(__dirname, '..', 'auto-images');
const CONFIG_FILE = path.join(__dirname, '..', 'auto-config.json');
// 자동 업로드 전용 계정 파일 (이벤트 추첨 계정과 별도)
const ACCOUNTS_FILE = path.join(__dirname, '..', 'auto-accounts.json');

// 기본 설정
function defaultConfig() {
  return {
    enabled: true,
    // cron 표현식 (초 분 시 일 월 요일) - 매일 오전 10시 0분
    cronExpression: '0 10 * * *',
    // 이미지 폴더 (절대경로 또는 상대경로)
    imageFolder: IMAGE_FOLDER,
    // 피드와 스토리 업로드 사이 지연 (초)
    delayBetweenUploads: 30,
  };
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...defaultConfig(), ...data };
    }
  } catch (e) {
    console.error('[auto-config] 로드 실패:', e.message);
  }
  const cfg = defaultConfig();
  saveConfig(cfg);
  return cfg;
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

// 이미지 폴더 스캔
function scanImages(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
    return [];
  }
  const files = fs.readdirSync(folder);
  return files.filter(f => /\.(jpe?g|png|webp)$/i.test(f));
}

// === 메인 업로드 실행 ===
async function runAutoUpload({ forceRun = false } = {}) {
  const log = [];
  const pushLog = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    log.push(line);
  };

  pushLog('=== 자동 업로드 시작 ===');

  const cfg = loadConfig();
  if (!cfg.enabled && !forceRun) {
    pushLog('자동 업로드가 비활성화 상태입니다.');
    return { success: false, skipped: true, reason: 'disabled', log };
  }

  // 주말/공휴일 체크
  const skip = rotation.shouldSkipToday();
  if (skip.skip && !forceRun) {
    pushLog(`오늘은 건너뜁니다: ${skip.reason}`);
    const state = rotation.loadState();
    rotation.addHistory(state, {
      type: 'skip',
      reason: skip.reason,
    });
    rotation.saveState(state);
    return { success: true, skipped: true, reason: skip.reason, log };
  }

  // 계정 로드
  const accounts = loadAccounts();
  if (accounts.length < 2) {
    pushLog('계정이 2개 미만입니다. 최소 2개 이상 등록해주세요.');
    return { success: false, error: '계정 부족 (최소 2개)', log };
  }

  // 이미지 스캔
  const imageFolder = cfg.imageFolder || IMAGE_FOLDER;
  const images = scanImages(imageFolder);
  if (images.length === 0) {
    pushLog(`이미지 폴더가 비어있습니다: ${imageFolder}`);
    return { success: false, error: '이미지 없음', log };
  }
  pushLog(`이미지 폴더: ${imageFolder} (${images.length}개 파일)`);

  // 상태 로드 + 계정 선택
  const state = rotation.loadState();
  const picked = rotation.pickAccounts(accounts, state);
  pushLog(`피드 대상: @${picked.feed.username} (index ${picked.feedIdx})`);
  pushLog(`스토리 대상: @${picked.story.username} (index ${picked.storyIdx})`);

  const result = {
    success: true,
    feed: null,
    story: null,
    log,
  };

  // === 피드 업로드 ===
  try {
    const feedImage = rotation.pickImage(picked.feed.username, images, state);
    const feedImagePath = path.join(imageFolder, feedImage);
    pushLog(`[피드] ${feedImage} 업로드 시작...`);

    const feedResult = await uploader.uploadFeed({
      imagePath: feedImagePath,
      cookies: picked.feed.cookies,
      caption: '', // 캡션 없음 (추후 추가 예정)
    });

    rotation.markImageUsed(picked.feed.username, feedImage, state);
    rotation.saveState(state); // 중간 저장

    pushLog(`[피드] 완료: ${feedResult.url}`);
    result.feed = {
      username: picked.feed.username,
      image: feedImage,
      ...feedResult,
    };
    rotation.addHistory(state, {
      type: 'feed',
      username: picked.feed.username,
      image: feedImage,
      url: feedResult.url,
      mediaId: feedResult.mediaId,
    });
  } catch (err) {
    pushLog(`[피드] 실패: ${err.message}`);
    result.success = false;
    result.feedError = err.message;
    rotation.addHistory(state, {
      type: 'feed-fail',
      username: picked.feed.username,
      error: err.message,
    });
  }

  // 피드와 스토리 사이 지연 (한 번에 두 요청 방지)
  if (cfg.delayBetweenUploads > 0) {
    pushLog(`${cfg.delayBetweenUploads}초 대기...`);
    await new Promise(r => setTimeout(r, cfg.delayBetweenUploads * 1000));
  }

  // === 스토리 업로드 ===
  try {
    const storyImage = rotation.pickImage(picked.story.username, images, state);
    const storyImagePath = path.join(imageFolder, storyImage);
    pushLog(`[스토리] ${storyImage} 업로드 시작...`);

    const storyResult = await uploader.uploadStory({
      imagePath: storyImagePath,
      cookies: picked.story.cookies,
    });

    rotation.markImageUsed(picked.story.username, storyImage, state);
    pushLog(`[스토리] 완료: mediaId=${storyResult.mediaId}`);
    result.story = {
      username: picked.story.username,
      image: storyImage,
      ...storyResult,
    };
    rotation.addHistory(state, {
      type: 'story',
      username: picked.story.username,
      image: storyImage,
      mediaId: storyResult.mediaId,
    });
  } catch (err) {
    pushLog(`[스토리] 실패: ${err.message}`);
    result.success = false;
    result.storyError = err.message;
    rotation.addHistory(state, {
      type: 'story-fail',
      username: picked.story.username,
      error: err.message,
    });
  }

  // 다음 날을 위해 인덱스 +1
  state.nextFeedIndex = (picked.feedIdx + 1) % accounts.length;
  rotation.saveState(state);

  pushLog(`=== 자동 업로드 종료 === 다음 피드 인덱스: ${state.nextFeedIndex}`);
  return result;
}

// === 스케줄러 ===
let currentCronJob = null;

function startScheduler() {
  const cfg = loadConfig();

  if (currentCronJob) {
    currentCronJob.stop();
    currentCronJob = null;
  }

  if (!cron.validate(cfg.cronExpression)) {
    console.error(`[scheduler] 잘못된 cron 표현식: ${cfg.cronExpression}`);
    return false;
  }

  currentCronJob = cron.schedule(cfg.cronExpression, async () => {
    console.log(`\n[scheduler] ${new Date().toISOString()} 스케줄 실행`);
    try {
      await runAutoUpload();
    } catch (err) {
      console.error('[scheduler] 실행 중 오류:', err);
    }
  }, {
    timezone: 'Asia/Seoul',
  });

  console.log(`[scheduler] 스케줄 등록: ${cfg.cronExpression} (Asia/Seoul)`);
  return true;
}

function stopScheduler() {
  if (currentCronJob) {
    currentCronJob.stop();
    currentCronJob = null;
    console.log('[scheduler] 스케줄 중지됨');
  }
}

// === 미리보기: 다음 N일의 예정 ===
function previewSchedule(days = 14) {
  const accounts = loadAccounts();
  const state = rotation.loadState();
  const n = accounts.length;
  if (n < 2) return [];

  const result = [];
  let feedIdx = state.nextFeedIndex;
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const skip = rotation.shouldSkipToday(date);

    result.push({
      date: rotation.formatDate(date),
      dayOfWeek: ['일', '월', '화', '수', '목', '금', '토'][date.getDay()],
      skip: skip.skip,
      reason: skip.reason,
      feed: skip.skip ? null : accounts[feedIdx]?.username,
      story: skip.skip ? null : accounts[(feedIdx + 1) % n]?.username,
    });
    if (!skip.skip) {
      feedIdx = (feedIdx + 1) % n;
    }
  }
  return result;
}

module.exports = {
  runAutoUpload,
  startScheduler,
  stopScheduler,
  loadConfig,
  saveConfig,
  previewSchedule,
  scanImages,
  IMAGE_FOLDER,
};
