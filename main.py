"""인스타 이벤트 당첨자 자동 추첨 — 메인 실행"""

import json
import sys
from scraper import scrape_comments
from sheets import save_comments, save_winners
from picker import pick_winners
from notifier import notify_winners


def load_config(config_path: str = "config.json") -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


def run_giveaway(seller_name: str = None, winners_override: int = None):
    """
    이벤트 추첨을 실행합니다.

    Args:
        seller_name: 특정 셀러만 실행 (None이면 전체)
        winners_override: 당첨 인원 수동 지정 (None이면 config 값 사용)
    """
    config = load_config()

    for influencer in config["influencers"]:
        if seller_name and influencer["name"] != seller_name:
            continue

        name = influencer["name"]
        post_url = influencer["post_url"]
        winner_count = winners_override or influencer["winners"]
        sheet_id = influencer["google_sheet_id"]
        slack_channel = influencer["slack_channel"]

        if not post_url:
            print(f"[{name}] 게시물 URL이 설정되지 않았습니다. 건너뜁니다.")
            continue

        if not sheet_id:
            print(f"[{name}] 구글 시트 ID가 설정되지 않았습니다. 건너뜁니다.")
            continue

        print(f"\n{'='*50}")
        print(f"[{name}] 이벤트 추첨 시작")
        print(f"{'='*50}")

        # 1. 댓글 수집
        print(f"\n[{name}] 1단계: 댓글 수집 중...")
        comments = scrape_comments(post_url)

        if not comments:
            print(f"[{name}] 댓글이 없습니다. 건너뜁니다.")
            continue

        # 2. 구글 시트에 저장
        print(f"\n[{name}] 2단계: 구글 시트에 저장 중...")
        save_comments(sheet_id, comments, name)

        # 3. 당첨자 선정
        print(f"\n[{name}] 3단계: 당첨자 {winner_count}명 선정 중...")
        winners = pick_winners(comments, winner_count)

        # 4. 당첨자 시트에 저장
        save_winners(sheet_id, winners, name)

        # 5. 슬랙 알림
        print(f"\n[{name}] 4단계: 슬랙 알림 전송 중...")
        notify_winners(slack_channel, name, post_url, winners, len(comments))

        print(f"\n[{name}] ✅ 완료!")


if __name__ == "__main__":
    seller = None
    winners = None

    if len(sys.argv) >= 2:
        seller = sys.argv[1]
    if len(sys.argv) >= 3:
        winners = int(sys.argv[2])

    run_giveaway(seller_name=seller, winners_override=winners)
