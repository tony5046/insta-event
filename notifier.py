"""슬랙 알림 모듈"""

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from typing import List, Dict
from datetime import datetime

SLACK_BOT_TOKEN = ""  # credentials/slack_token.txt 에서 로드


def load_token(token_file: str = "credentials/slack_token.txt") -> str:
    """슬랙 봇 토큰 로드"""
    with open(token_file, "r") as f:
        return f.read().strip()


def notify_winners(
    channel: str,
    seller_name: str,
    post_url: str,
    winners: List[Dict[str, str]],
    total_comments: int,
) -> bool:
    """
    슬랙 채널에 당첨자를 공유합니다.

    Args:
        channel: 슬랙 채널명 (예: #셀러a-이벤트)
        seller_name: 셀러 이름
        post_url: 인스타 게시물 URL
        winners: 당첨자 리스트
        total_comments: 전체 댓글 수

    Returns:
        성공 여부
    """
    token = load_token()
    client = WebClient(token=token)

    today = datetime.now().strftime("%Y-%m-%d")
    winner_list = "\n".join(
        [f"  {i}. @{w['username']}" for i, w in enumerate(winners, 1)]
    )

    message = (
        f"🎉 *[{seller_name}] 이벤트 당첨자 발표* ({today})\n\n"
        f"📌 게시물: {post_url}\n"
        f"💬 총 댓글: {total_comments}개\n"
        f"🏆 당첨자 ({len(winners)}명):\n{winner_list}\n\n"
        f"축하합니다! 🎊"
    )

    try:
        client.chat_postMessage(channel=channel, text=message)
        print(f"[{seller_name}] 슬랙 알림 전송 완료 → {channel}")
        return True
    except SlackApiError as e:
        print(f"[{seller_name}] 슬랙 전송 실패: {e.response['error']}")
        return False
