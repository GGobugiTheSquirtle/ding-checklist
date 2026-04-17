# Another Eden · 올클리어 체크리스트

어나더에덴의 모든 콘텐츠를 체크리스트로 관리하는 웹앱.
네이버 Another Eden 카페의 **『딩』**님이 작성하신
[『콘텐츠 목록, 체크 리스트』](https://cafe.naver.com/anothereden/88206)를 원본으로 사용합니다.

![preview](icon.png)

---

## Features

- **대시보드 뷰** — 카테고리별 진행률을 카드로 한눈에
- **상세 체크리스트** — 챕터 접기/펼치기, 섹션 단위 필터
- **다크/라이트 테마** — 스토리/티어리스트 가이드와 통일된 네이비 + 골드 팔레트 (다크) + 노션 톤 라이트
  - OS 설정 자동 감지 + 수동 전환 (단축키 `T`)
- **진행도 자동 저장** — 브라우저 localStorage (기기 단위)
- **엑셀 내보내기/가져오기** — SheetJS 기반. 카테고리별 시트 분리, 요약 대시보드 시트 포함, 자동 필터/틀 고정 적용
- **구글시트 마스터 연동(선택)** — 시트를 세팅한 경우 시트 내용이 마스터로 사용됨 ([가이드](docs/SETUP-GOOGLE-SHEET.md))
- **모바일 최적화** — 드래그/편집 기능 제거, 햄버거 메뉴, 단순화된 컨트롤
- **접근성** — 키보드 내비게이션, ARIA 레이블, `prefers-reduced-motion` 존중

---

## Quick Start

### 로컬에서 실행
```bash
cd Ding-checklist
python -m http.server 8000   # 또는 VS Code Live Server
```
→ http://localhost:8000

`fetch()`로 CSV/JSON을 읽으므로 `file://`로 직접 열면 CORS 에러가 납니다. 반드시 로컬 서버 경유.

### GitHub Pages 배포
이 폴더를 개별 repo로 push 하면 Pages에서 바로 서비스 가능.

---

## File Structure

```
Ding-checklist/
├── index.html              # 메인 페이지 (신버전 — 다크/라이트 + Supanova 톤)
├── app.js                  # 모든 로직 (약 600줄, 외부 의존: SheetJS CDN)
├── icon.png                # 파비콘 / 프로필
├── data/
│   ├── master-data.json    # 계층형 마스터 데이터 (번들 폴백)
│   └── master-sheet.csv    # 구글시트 seed용 플랫 CSV
├── docs/
│   └── SETUP-GOOGLE-SHEET.md  # 구글시트 연동 가이드
├── _tools/
│   └── parse_checklist.py  # 체크리스트.md → JSON/CSV 변환기
├── 체크리스트.md             # 원본 체크리스트 (딩님 카페 원글)
└── _legacy/                # 구버전 참고용 (미사용)
    ├── index (1).html
    ├── main.js
    ├── styles.css
    ├── api.js
    └── checklist-data.json
```

---

## Tech Stack

- **Vanilla HTML/CSS/JS** — 프레임워크 없음. 단일 페이지.
- **Pretendard** — 본문 한글 폰트
- **Noto Serif KR + Cinzel** — 디스플레이/제목 (스토리/티어 가이드와 통일)
- **SheetJS (xlsx.full.min.js, CDN)** — 엑셀 내보내기/가져오기
- **localStorage** — 진행도 지속
- **Google Sheets CSV Publish** (선택) — 마스터 데이터 실시간 갱신

---

## 데이터 레이어 구조

| 레이어 | 소스 | 변경 주체 | 저장 |
|---|---|---|---|
| 마스터 (항목 목록) | Google Sheet CSV · 또는 `data/master-data.json` | 원작자(딩님) | 시트 |
| 개인 진행도 (체크 상태) | localStorage | 각 사용자 | 브라우저 |
| 백업/이동 | xlsx 파일 | 사용자 수동 내보내기/가져오기 | 파일 |

- 진행도는 항목 `id` 로 연결 → 마스터의 텍스트가 바뀌어도 체크 상태 유지
- 마스터에서 `id`가 바뀌면 진행도 연결이 깨짐 → **id는 한 번 정해지면 바꾸지 말 것**
- 새 항목 추가 시 기존 `id` 체계를 따라 충돌 없이 번호 부여

---

## 체크리스트 업데이트 프로세스

### 카페 원글 갱신 → 앱 반영

**방법 A. 구글시트 사용 중이면 (권장)**
1. 시트의 해당 행 수정 / 새 행 추가
2. 사용자는 새로고침하면 자동 반영 (캐시 없음, 최대 5분 구글 측 지연)

**방법 B. 번들본만 사용 중이면**
1. `체크리스트.md` 갱신
2. `python _tools/parse_checklist.py` 실행
3. 생성된 `data/master-data.json` · `data/master-sheet.csv` 커밋 & 배포

---

## Keyboard Shortcuts

| 키 | 동작 |
|---|---|
| `T` | 다크/라이트 토글 |
| `D` | 대시보드 뷰 |
| `L` | 상세 목록 뷰 |

---

## Credits

- 원본 체크리스트 © **네이버 Another Eden 카페 『딩』**님
- 웹 인터페이스는 개인 제작 비공식 뷰어
- 디자인은 스토리 가이드·티어리스트 가이드와 통일 (네이비 + 골드)
- [Supanova Design Skill](https://github.com/uxjoseph/supanova-design-skill) 디자인 원칙 적용
