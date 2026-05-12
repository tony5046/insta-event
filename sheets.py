"""구글 시트 연동 모듈 — 셀러별 별도 시트"""

import gspread
from google.oauth2.service_account import Credentials
from typing import List, Dict
from datetime import datetime

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

SERVICE_ACCOUNT_FILE = "credentials/google_service_account.json"


def get_client() -> gspread.Client:
    """구글 시트 클라이언트 생성"""
    creds = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    return gspread.authorize(creds)


def save_comments(sheet_id: str, comments: List[Dict[str, str]], seller_name: str) -> int:
    """
    댓글 데이터를 셀러별 구글 시트에 저장합니다.

    Args:
        sheet_id: 구글 시트 ID
        comments: [{"username": "...", "comment": "..."}, ...]
        seller_name: 셀러 이름

    Returns:
        저장된 행 수
    """
    client = get_client()
    spreadsheet = client.open_by_key(sheet_id)

    today = datetime.now().strftime("%Y-%m-%d")
    worksheet_title = f"댓글_{today}"

    try:
        worksheet = spreadsheet.worksheet(worksheet_title)
        worksheet.clear()
    except gspread.WorksheetNotFound:
        worksheet = spreadsheet.add_worksheet(title=worksheet_title, rows=len(comments) + 1, cols=4)

    header = ["번호", "아이디", "댓글 내용", "수집 시간"]
    rows = [header]

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for i, c in enumerate(comments, 1):
        rows.append([i, c["username"], c["comment"], now])

    worksheet.update(range_name="A1", values=rows)

    print(f"[{seller_name}] 구글 시트에 {len(comments)}개 댓글 저장 완료 (시트: {worksheet_title})")
    return len(comments)


def save_winners(sheet_id: str, winners: List[Dict[str, str]], seller_name: str) -> None:
    """
    당첨자 목록을 구글 시트의 '당첨자' 워크시트에 저장합니다.

    Args:
        sheet_id: 구글 시트 ID
        winners: [{"username": "...", "comment": "..."}, ...]
        seller_name: 셀러 이름
    """
    client = get_client()
    spreadsheet = client.open_by_key(sheet_id)

    today = datetime.now().strftime("%Y-%m-%d")
    worksheet_title = f"당첨자_{today}"

    try:
        worksheet = spreadsheet.worksheet(worksheet_title)
        worksheet.clear()
    except gspread.WorksheetNotFound:
        worksheet = spreadsheet.add_worksheet(title=worksheet_title, rows=len(winners) + 1, cols=4)

    header = ["번호", "당첨자 아이디", "댓글 내용", "선정 시간"]
    rows = [header]

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for i, w in enumerate(winners, 1):
        rows.append([i, w["username"], w["comment"], now])

    worksheet.update(range_name="A1", values=rows)

    print(f"[{seller_name}] 당첨자 {len(winners)}명 시트에 저장 완료")
