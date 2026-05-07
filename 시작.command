#!/bin/bash
# 더블클릭으로 실행 - 인스타 이벤트 추첨 도구

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

# 2. Node.js 자동 설치 (없으면)
if ! command -v node &> /dev/null; then
  echo "📦 Node.js 설치 중..."
  brew install node
fi

# 3. 패키지 자동 설치 (없으면)
if [ ! -d "node_modules" ]; then
  echo "📦 라이브러리 설치 중..."
  npm install --silent
fi

# 4. 3초 후 자동으로 브라우저 열기
(sleep 3 && open http://localhost:3000) &

# 5. 서버 실행
echo ""
echo "✅ 준비 완료! 브라우저가 자동으로 열립니다."
echo "   끄려면 이 창 닫거나 Ctrl+C"
echo ""
npm start
