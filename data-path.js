// data-path.js
// Railway Volume이 /data에 마운트되어 있으면 영구 저장 디렉토리로 사용.
// 없으면 프로젝트 루트 사용 (로컬 PC)

const fs = require('fs');
const path = require('path');

// Railway Volume 마운트 포인트
const VOLUME_PATH = '/data';
const USE_VOLUME = fs.existsSync(VOLUME_PATH);

const ROOT = __dirname;
const DATA_DIR = USE_VOLUME ? VOLUME_PATH : ROOT;

if (USE_VOLUME) {
  console.log(`[data-path] Railway Volume 사용: ${VOLUME_PATH}`);
} else {
  console.log(`[data-path] 로컬 디렉토리 사용: ${ROOT}`);
}

// 이미지 폴더는 볼륨의 auto-images 하위 디렉토리
const IMAGE_DIR = USE_VOLUME ? path.join(VOLUME_PATH, 'auto-images') : path.join(ROOT, 'auto-images');

// 이미지 폴더 자동 생성
if (!fs.existsSync(IMAGE_DIR)) {
  try { fs.mkdirSync(IMAGE_DIR, { recursive: true }); } catch {}
}

// 파일 경로 resolver
function resolve(filename) {
  return path.join(DATA_DIR, filename);
}

// 레거시 파일 마이그레이션: 볼륨을 처음 쓰는 경우 기존 루트 파일을 한 번 복사
function migrateFromRoot(filename) {
  if (!USE_VOLUME) return;
  const srcPath = path.join(ROOT, filename);
  const destPath = path.join(VOLUME_PATH, filename);
  if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
    try {
      fs.copyFileSync(srcPath, destPath);
      console.log(`[data-path] 마이그레이션: ${filename} (루트 → 볼륨)`);
    } catch (e) {
      console.log(`[data-path] 마이그레이션 실패: ${filename} - ${e.message}`);
    }
  }
}

// 서버 시작 시 1회 호출
function migrateAll() {
  ['auto-accounts.json', 'accounts.json', 'state.json', 'auto-config.json'].forEach(migrateFromRoot);
}

module.exports = {
  USE_VOLUME,
  DATA_DIR,
  IMAGE_DIR,
  resolve,
  migrateAll,
};
