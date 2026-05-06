#!/bin/bash
# 맥북 자동 셋업 스크립트
# 사용법: bash setup-mac.sh

set -e

echo ""
echo "🍎 인스타 이벤트 도구 - 맥북 자동 설치"
echo "========================================"
echo ""

# 1. Homebrew 확인/설치
if ! command -v brew &> /dev/null; then
  echo "📦 Homebrew 설치 중..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # M1/M2 맥북 PATH 설정
  if [[ -d "/opt/homebrew/bin" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
else
  echo "✅ Homebrew 이미 설치됨"
fi

# 2. Node.js 확인/설치
if ! command -v node &> /dev/null; then
  echo "📦 Node.js 설치 중..."
  brew install node
else
  echo "✅ Node.js 이미 설치됨 ($(node -v))"
fi

# 3. ngrok 확인/설치
if ! command -v ngrok &> /dev/null; then
  echo "📦 ngrok 설치 중..."
  brew install ngrok
  ngrok config add-authtoken 3CQDThiR7pR84y1WdQE0w3TQFlQ_37A8rF7k4ZYujSsZceMCK
else
  echo "✅ ngrok 이미 설치됨"
fi

# 4. 패키지 설치
echo "📦 npm 패키지 설치 중..."
npm install

# 5. 안내
echo ""
echo "✅ 설치 완료!"
echo ""
echo "다음 단계:"
echo "1. 터미널 1: npm start"
echo "2. 터미널 2: ngrok http 3000"
echo ""
echo "그러면 http://localhost:3000 에서 접속 가능,"
echo "ngrok URL로 외부에서도 접속 가능합니다."
echo ""
echo "⚠️  계정 정보가 없을 수 있으니, 웹페이지에서 '계정 등록' 버튼으로"
echo "    5개 인스타 계정의 쿠키를 다시 등록해주세요."
echo ""
