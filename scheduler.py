"""셀러별 스케줄 관리 모듈"""

import json
import schedule
import time
from main import run_giveaway


def load_config(config_path: str = "config.json") -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return json.load(f)


DAY_MAP = {
    "monday": schedule.every().monday,
    "tuesday": schedule.every().tuesday,
    "wednesday": schedule.every().wednesday,
    "thursday": schedule.every().thursday,
    "friday": schedule.every().friday,
    "saturday": schedule.every().saturday,
    "sunday": schedule.every().sunday,
}


def setup_schedules():
    """config.json 기반으로 셀러별 스케줄 등록"""
    config = load_config()

    for influencer in config["influencers"]:
        name = influencer["name"]
        day = influencer["schedule"]["day"].lower()
        run_time = influencer["schedule"]["time"]

        if day not in DAY_MAP:
            print(f"[{name}] 알 수 없는 요일: {day}. 건너뜁니다.")
            continue

        DAY_MAP[day].at(run_time).do(run_giveaway, seller_name=name)
        print(f"[{name}] 스케줄 등록: 매주 {day} {run_time}")

    print(f"\n총 {len(config['influencers'])}개 스케줄 등록 완료. 실행 대기 중...\n")


if __name__ == "__main__":
    setup_schedules()

    while True:
        schedule.run_pending()
        time.sleep(60)
