#!/bin/bash
# 맥북 더블클릭 실행

cd "$(dirname "$0")"

echo ""
echo "🎯 인스타 이벤트 추첨 도구"
echo "================================"
echo ""

# 1. Homebrew 자동 설치 (없으면)
if ! command -v brew &> /dev/null; then
  echo "📦 Homebrew 설치 중... (비밀번호 입력 필요)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -d "/opt/homebrew/bin" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  fi
fi

# 2. Node.js 자동 설치
if ! command -v node &> /dev/null; then
  echo "📦 Node.js 설치 중..."
  brew install node
fi

# 3. 패키지 자동 설치
if [ ! -d "node_modules" ]; then
  echo "📦 라이브러리 설치 중..."
  npm install --silent
fi

# 4. 계정 자동 등록 (최초 1회)
if [ ! -f "accounts.json" ] && [ -f "기본계정.json" ]; then
  cp "기본계정.json" accounts.json
  echo "✅ 계정 5개 자동 등록 완료"
fi

# 5. 3초 후 브라우저 자동 열기
(sleep 3 && open http://localhost:3000) &

echo ""
echo "✅ 준비 완료! 브라우저가 자동으로 열립니다."
echo "   끄려면 이 창 닫거나 Ctrl+C"
echo ""
npm start
