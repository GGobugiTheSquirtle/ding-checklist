#!/usr/bin/env python3
"""
체크리스트.md → master-data.json 파서
- ●/○ 기호는 모두 드롭, completed=false로 통일
- 카테고리/섹션/아이템 3단 계층 추출
- 중간에 섹션 없이 바로 아이템이 있는 카테고리(공통 등) 지원
- 카테고리 안에 "카테고리 직속 아이템 + 섹션 아이템" 혼합(군상 등) 지원
- 구글시트/CSV로도 바로 쓸 수 있게 flat CSV도 함께 생성

Usage:
    python _tools/parse_checklist.py

Output:
    data/master-data.json   — 계층 구조
    data/master-sheet.csv   — 구글시트 seed용 플랫 테이블
"""
import json
import re
import csv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MD_PATH = ROOT / "체크리스트.md"
OUT_JSON = ROOT / "data" / "master-data.json"
OUT_CSV = ROOT / "data" / "master-sheet.csv"

# 알려진 최상위 카테고리 목록 (md 순서대로)
CATEGORIES = [
    "공통", "메인", "서브", "외전", "외경", "외사",
    "해후", "개안", "단장", "군상", "협주", "이경",
    "비경", "요행", "갈채", "현현", "회생", "서가",
    "환혹 저택",
]

ITEM_PREFIX = re.compile(r"^[●○]\s+")
SECTION_HEADER = re.compile(r"^(?:제[\d\.]+부.*|<.*)")


def slugify(s: str) -> str:
    """한글 포함 문자열을 식별자로 — 공백/특수문자 제거"""
    s = re.sub(r"[\s<>()★—\-:!?,\.]", "", s)
    return s[:40]


def parse():
    lines = MD_PATH.read_text(encoding="utf-8").splitlines()

    categories = []
    current_cat = None        # dict or None
    current_section = None    # dict or None
    cat_idx = -1
    sec_idx = -1
    item_counters = {}        # (cat_id, sec_id) → int

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            continue

        # 1) 최상위 카테고리인가?
        if stripped in CATEGORIES:
            cat_idx += 1
            sec_idx = -1
            current_cat = {
                "categoryName": stripped,
                "categoryId": f"c{cat_idx}",
                "sections": [],
                "items": [],  # 섹션 없이 카테고리 직속 아이템용
            }
            categories.append(current_cat)
            current_section = None
            continue

        # 카테고리가 아직 없으면 (md 상단 범례 등) 건너뛰기
        if current_cat is None:
            continue

        # 2) 섹션 헤더인가?
        if not ITEM_PREFIX.match(stripped) and SECTION_HEADER.match(stripped):
            sec_idx += 1
            current_section = {
                "sectionName": stripped,
                "sectionId": f"{current_cat['categoryId']}-s{sec_idx}",
                "items": [],
            }
            current_cat["sections"].append(current_section)
            continue

        # 3) 아이템 (●, ○ 모두 completed:false로 처리)
        m = ITEM_PREFIX.match(stripped)
        if m:
            text = stripped[m.end():].strip()
            parent = current_section if current_section else current_cat
            parent_id = (current_section["sectionId"]
                         if current_section else current_cat["categoryId"])
            counter_key = parent_id
            i = item_counters.get(counter_key, 0)
            item_counters[counter_key] = i + 1
            item = {
                "id": f"{parent_id}-i{i}",
                "text": text,
                "completed": False,
            }
            parent["items"].append(item)
            continue

        # 그 외: 범례나 공백 — 무시
        # (● : 완료 / ○ : 미완 같은 안내문 등)

    # 정리: 빈 sections/items 키는 그대로 두되 일관성 유지
    for cat in categories:
        if not cat["sections"]:
            # 섹션이 없는 카테고리(공통)는 items만
            cat.pop("sections", None)
        elif not cat["items"]:
            # 섹션만 있는 카테고리(메인)는 sections만
            cat.pop("items", None)
        # 둘 다 있는 경우(군상, 현현)는 유지

    return categories


def emit_csv(categories, path: Path):
    """구글시트 seed용 플랫 CSV. 컬럼: category / section / id / text / completed
    이 시트를 딩님이 직접 편집 → 앱은 CSV로 fetch하여 자동 반영.
    """
    rows = []
    for cat in categories:
        cat_name = cat["categoryName"]
        # 카테고리 직속 아이템
        for it in cat.get("items", []):
            rows.append([cat_name, "", it["id"], it["text"], "FALSE"])
        for sec in cat.get("sections", []):
            for it in sec["items"]:
                rows.append([cat_name, sec["sectionName"], it["id"], it["text"], "FALSE"])

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["category", "section", "id", "text", "completed"])
        w.writerows(rows)

    return len(rows)


def main():
    categories = parse()
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(
        json.dumps(categories, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    total_items = 0
    for c in categories:
        for it in c.get("items", []):
            total_items += 1
        for sec in c.get("sections", []):
            total_items += len(sec["items"])

    rows = emit_csv(categories, OUT_CSV)

    print(f"[OK] categories: {len(categories)}")
    print(f"[OK] total items: {total_items}")
    print(f"[OK] JSON  -> {OUT_JSON.relative_to(ROOT)}")
    print(f"[OK] CSV   -> {OUT_CSV.relative_to(ROOT)} ({rows} rows)")

    # 카테고리별 요약
    print("\n-- per category --")
    for c in categories:
        cat_items = len(c.get("items", []))
        sec_cnt = len(c.get("sections", []))
        sec_items = sum(len(s["items"]) for s in c.get("sections", []))
        print(f"  {c['categoryName']:10s}  sections={sec_cnt:2d}  items={cat_items + sec_items}")


if __name__ == "__main__":
    main()
