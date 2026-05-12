"""Instagram 게시물 댓글 스크래핑 모듈 — instagrapi 사용"""

from instagrapi import Client
from typing import List, Dict

SESSION_FILE = "credentials/insta_session.txt"

_client = None


def get_client() -> Client:
    """인스타그램 클라이언트 싱글턴"""
    global _client
    if _client is None:
        session_id = open(SESSION_FILE, "r").read().strip()
        _client = Client()
        _client.login_by_sessionid(session_id)
    return _client


def scrape_comments(post_url: str) -> List[Dict[str, str]]:
    """
    인스타그램 게시물의 댓글을 수집합니다.

    Args:
        post_url: 인스타그램 게시물 URL

    Returns:
        [{"username": "아이디", "comment": "댓글 내용"}, ...]
    """
    cl = get_client()
    media_pk = cl.media_pk_from_url(post_url)
    raw_comments = cl.media_comments(media_pk, amount=0)

    comments = []
    for c in raw_comments:
        comments.append({
            "username": c.user.username,
            "comment": c.text,
        })

    print(f"총 {len(comments)}개 댓글 수집 완료")
    return comments


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("사용법: python scraper.py <인스타그램_게시물_URL>")
        sys.exit(1)

    url = sys.argv[1]
    results = scrape_comments(url)

    for r in results[:5]:
        print(f"@{r['username']}: {r['comment']}")

    if len(results) > 5:
        print(f"... 외 {len(results) - 5}개")
