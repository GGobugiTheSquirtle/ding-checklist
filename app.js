/* ==========================================================================
 * Another Eden 체크리스트 — app.js
 *
 * 데이터 모델:
 *   master  = 카테고리/섹션/아이템 구조 (Google Sheet CSV 또는 로컬 JSON)
 *   progress = { [itemId]: boolean }  (localStorage)
 *
 * 마스터 소스 우선순위:
 *   1) window.__CONFIG__.sheetCsvUrl 에 URL이 설정되어 있으면 Google Sheet CSV fetch
 *   2) 실패 시 data/master-data.json (번들된 최신본) fetch
 *   3) 그래도 실패면 에러 토스트
 *
 * 보안: 사용자 텍스트는 모두 textContent로 주입 — innerHTML 사용 안 함.
 * ========================================================================== */

// ---------- 설정 ----------
window.__CONFIG__ = Object.assign({
  // 구글시트 "웹에 게시" (CSV) URL. 빈 값이면 로컬 JSON 사용.
  // 시트 헤더: category | section | id | text | completed
  sheetCsvUrl: "",
  fallbackJson: "data/master-data.json",
}, window.__CONFIG__ || {});

// ---------- localStorage 키 ----------
const LS = {
  progress: "ae-checklist.progress.v5",
  theme:    "ae-checklist.theme",
  ui:       "ae-checklist.ui.v5",
};

// ---------- 상태 ----------
const state = {
  master: [],
  progress: {},
  openChapters: new Set(),
  view: "dashboard",
  filter: { categoryId: "", sectionId: "" },
};

let ALL_IDS = new Set();

// ==========================================================================
// DOM 헬퍼 — 모든 사용자 텍스트는 textContent로만 주입
// ==========================================================================
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/**
 * el("div", {class:"x", onClick:fn}, child1, "text", child2)
 * - 문자열 자식은 textContent로 안전 주입
 * - 객체 자식은 appendChild
 * - style/dataset은 객체로 지정 가능
 */
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "dataset" && typeof v === "object") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    }
    else if (k === "html") node.innerHTML = v; // 신뢰된 정적 SVG 등 한정 사용
    else if (k in node && typeof node[k] !== "object") node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === "string" || typeof c === "number") {
      node.appendChild(document.createTextNode(String(c)));
    } else {
      node.appendChild(c);
    }
  }
  return node;
}

/** 내부 정의된 SVG 마크업만 사용 (사용자 입력 미포함 → 안전) */
const SVG = {
  chev: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 6 15 12 9 18"/></svg>`,
};

// ==========================================================================
// localStorage
// ==========================================================================
function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn("localStorage save failed:", e); toast("저장 실패 — 저장 공간을 확인해 주세요", "error"); }
}

// ==========================================================================
// Toast & Dialog
// ==========================================================================
function toast(msg, kind = "success", ms = 2600) {
  const host = $("#toast-host");
  const t = el("div", { class: `toast ${kind}` }, String(msg));
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .3s"; }, ms - 300);
  setTimeout(() => t.remove(), ms);
}

function confirmDialog(title, msg, okLabel = "확인", cancelLabel = "취소") {
  return new Promise((resolve) => {
    $("#dialog-title").textContent = title;
    $("#dialog-msg").textContent = msg;
    const actions = $("#dialog-actions");
    actions.textContent = "";
    const cancel = el("button", { class: "btn" }, cancelLabel);
    const ok = el("button", { class: "btn btn-primary" }, okLabel);
    actions.append(cancel, ok);
    const close = (v) => { $("#dialog").dataset.open = "false"; resolve(v); };
    cancel.addEventListener("click", () => close(false));
    ok.addEventListener("click", () => close(true));
    $("#dialog").dataset.open = "true";
    ok.focus();
  });
}

// ==========================================================================
// 데이터 로드
// ==========================================================================
async function loadMaster() {
  const { sheetCsvUrl, fallbackJson } = window.__CONFIG__;

  if (sheetCsvUrl && sheetCsvUrl.trim()) {
    try {
      const res = await fetch(sheetCsvUrl, { cache: "no-store" });
      if (!res.ok) throw new Error("sheet HTTP " + res.status);
      const text = await res.text();
      const rows = parseCsv(text);
      return csvRowsToMaster(rows);
    } catch (e) {
      console.warn("Google Sheet fetch failed, fallback:", e);
      toast("구글시트 로드 실패 — 번들본으로 진행합니다", "error");
    }
  }

  try {
    const res = await fetch(fallbackJson, { cache: "no-store" });
    if (!res.ok) throw new Error("json HTTP " + res.status);
    return await res.json();
  } catch (e) {
    console.error("fallback JSON failed:", e);
    toast("데이터 로드 실패 — 페이지를 새로고침해 주세요", "error", 5000);
    return [];
  }
}

// CSV 파서 (따옴표 안 쉼표/개행 지원)
function parseCsv(text) {
  const rows = [];
  let cur = [], cell = "", inQ = false, i = 0;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { inQ = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { cur.push(cell); cell = ""; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length || cur.length) { cur.push(cell); rows.push(cur); }
  return rows;
}

function csvRowsToMaster(rows) {
  if (rows.length < 2) return [];
  const header = rows[0].map((s) => s.trim().toLowerCase());
  const iCat = header.indexOf("category");
  const iSec = header.indexOf("section");
  const iId  = header.indexOf("id");
  const iTxt = header.indexOf("text");
  if (iCat < 0 || iId < 0 || iTxt < 0) {
    throw new Error("CSV 헤더는 category / section / id / text / completed 가 필요합니다");
  }
  const catMap = new Map();
  const catOrder = [];
  let catIdx = -1;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || (row.length === 1 && !row[0])) continue;
    const catName = (row[iCat] || "").trim();
    if (!catName) continue;
    const secName = iSec >= 0 ? (row[iSec] || "").trim() : "";
    const id = (row[iId] || "").trim();
    const text = (row[iTxt] || "").trim();
    if (!id || !text) continue;

    if (!catMap.has(catName)) {
      catIdx++;
      catMap.set(catName, {
        categoryName: catName,
        categoryId: `c${catIdx}`,
        sections: [],
        items: [],
        _secMap: new Map(),
      });
      catOrder.push(catName);
    }
    const cat = catMap.get(catName);
    const item = { id, text, completed: false };
    if (secName) {
      if (!cat._secMap.has(secName)) {
        const secObj = {
          sectionName: secName,
          sectionId: `${cat.categoryId}-s${cat.sections.length}`,
          items: [],
        };
        cat._secMap.set(secName, secObj);
        cat.sections.push(secObj);
      }
      cat._secMap.get(secName).items.push(item);
    } else {
      cat.items.push(item);
    }
  }
  const out = catOrder.map((name) => {
    const c = catMap.get(name);
    delete c._secMap;
    if (!c.sections.length) delete c.sections;
    if (!c.items.length) delete c.items;
    return c;
  });
  return out;
}

function rebuildIdIndex() {
  ALL_IDS = new Set();
  for (const cat of state.master) {
    (cat.items || []).forEach((it) => ALL_IDS.add(it.id));
    (cat.sections || []).forEach((sec) => sec.items.forEach((it) => ALL_IDS.add(it.id)));
  }
}

// ==========================================================================
// 통계
// ==========================================================================
function stats() {
  let total = 0, done = 0;
  const byCat = new Map();
  for (const cat of state.master) {
    let t = 0, d = 0;
    const countItem = (it) => {
      t++; total++;
      if (state.progress[it.id]) { d++; done++; }
    };
    (cat.items || []).forEach(countItem);
    (cat.sections || []).forEach((sec) => sec.items.forEach(countItem));
    byCat.set(cat.categoryId, { total: t, done: d });
  }
  return { total, done, byCat };
}

function chapterStats(cat) {
  let t = 0, d = 0;
  (cat.items || []).forEach((it) => { t++; if (state.progress[it.id]) d++; });
  (cat.sections || []).forEach((sec) => sec.items.forEach((it) => { t++; if (state.progress[it.id]) d++; }));
  return { total: t, done: d };
}

function percent(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function progressHsl(pct) {
  if (!pct) return "var(--text-dim)";
  const hue = 20 + pct * 1.0;
  return `hsl(${hue}, 55%, 52%)`;
}

function findCategory(cid) { return state.master.find((c) => c.categoryId === cid); }

// ==========================================================================
// 렌더링
// ==========================================================================
function renderAll() {
  renderSummary();
  renderSidebar();
  renderCategoryFilter();
  renderSectionFilter();
  // 뷰 전환 버튼 텍스트를 현재 상태와 항상 동기화
  const btnView = $("#btn-view");
  if (btnView) btnView.textContent = state.view === "dashboard" ? "상세 목록 보기" : "대시보드 보기";
  if (state.view === "dashboard") {
    $("#view-dashboard").classList.remove("hidden");
    $("#view-detail").classList.add("hidden");
    renderDashboard();
  } else {
    $("#view-dashboard").classList.add("hidden");
    $("#view-detail").classList.remove("hidden");
    renderChecklist();
  }
}

function renderSummary() {
  const s = stats();
  const pct = percent(s.done, s.total);
  $("#sum-total").textContent = s.total.toLocaleString();
  $("#sum-done").textContent = s.done.toLocaleString();
  $("#sum-remain").textContent = (s.total - s.done).toLocaleString();
  $("#sum-pct").textContent = pct + "%";
  $("#sum-bar").style.width = pct + "%";
  $("#sum-bar-outer").setAttribute("aria-valuenow", pct);
  $("#total-count").textContent = s.total.toLocaleString();
}

function renderSidebar() {
  const nav = $("#sidebar-nav");
  nav.textContent = "";
  const s = stats();

  const all = el("button",
    { class: state.filter.categoryId === "" ? "active" : "",
      onClick: () => {
        state.filter = { categoryId: "", sectionId: "" };
        persistUi(); renderAll(); closeMobileSidebar();
      } },
    el("span", {}, "전체"),
    el("span", { class: "count" }, String(s.total))
  );
  nav.appendChild(all);

  for (const cat of state.master) {
    const cs = s.byCat.get(cat.categoryId) || { total: 0, done: 0 };
    const isActive = state.filter.categoryId === cat.categoryId;
    const btn = el("button",
      { class: isActive ? "active" : "",
        onClick: () => {
          state.filter = { categoryId: cat.categoryId, sectionId: "" };
          state.view = "detail";
          state.openChapters.add(cat.categoryId);
          persistUi(); renderAll();
          setTimeout(() => {
            const target = document.getElementById("ch-" + cat.categoryId);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
          closeMobileSidebar();
        } },
      el("span", {}, cat.categoryName),
      el("span", { class: "count" }, `${cs.done}/${cs.total}`)
    );
    nav.appendChild(btn);
  }
}

function renderCategoryFilter() {
  const sel = $("#f-category");
  const cur = state.filter.categoryId;
  sel.textContent = "";
  sel.appendChild(el("option", { value: "" }, "— 전체 —"));
  for (const cat of state.master) {
    sel.appendChild(el("option", { value: cat.categoryId }, cat.categoryName));
  }
  sel.value = cur;
}

function renderSectionFilter() {
  const sel = $("#f-section");
  const cat = findCategory(state.filter.categoryId);
  sel.textContent = "";
  sel.appendChild(el("option", { value: "" }, "— 전체 —"));
  if (!cat || !cat.sections || !cat.sections.length) {
    sel.disabled = true; sel.value = "";
    state.filter.sectionId = "";
    return;
  }
  sel.disabled = false;
  for (const sec of cat.sections) {
    sel.appendChild(el("option", { value: sec.sectionId }, sec.sectionName));
  }
  sel.value = state.filter.sectionId;
}

function renderDashboard() {
  const host = $("#dashboard");
  host.textContent = "";
  for (const cat of state.master) {
    const st = chapterStats(cat);
    const pct = percent(st.done, st.total);
    const color = progressHsl(pct);

    const bar = el("div", { class: "progress-bar" },
      el("div", { class: "fill", style: { width: pct + "%" } }));

    const card = el("button",
      { class: "card", style: { "--progress-color": color },
        onClick: () => {
          state.filter = { categoryId: cat.categoryId, sectionId: "" };
          state.view = "detail";
          state.openChapters.add(cat.categoryId);
          persistUi(); renderAll();
          setTimeout(() => {
            const target = document.getElementById("ch-" + cat.categoryId);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
        } },
      el("div", { class: "cat-label" }, cat.categoryId.toUpperCase()),
      el("div", { class: "cat-title" }, cat.categoryName),
      el("div", { class: "progress-row" },
        el("span", { class: "progress-num", style: { color } }, pct + "%"),
        el("span", { class: "progress-total" }, `${st.done} / ${st.total}`)
      ),
      bar
    );
    // set CSS custom prop via style attribute workaround
    card.style.setProperty("--progress-color", color);
    host.appendChild(card);
  }
}

function renderChecklist() {
  const host = $("#checklist");
  host.textContent = "";
  const { categoryId, sectionId } = state.filter;
  const cats = categoryId ? state.master.filter((c) => c.categoryId === categoryId) : state.master;

  if (!cats.length) {
    host.appendChild(el("div", { class: "empty" }, "표시할 항목이 없습니다."));
    return;
  }

  for (const cat of cats) {
    const st = chapterStats(cat);
    const pct = percent(st.done, st.total);
    const color = progressHsl(pct);
    const isOpen = state.openChapters.has(cat.categoryId);

    const chev = el("svg", { class: "chev", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" });
    chev.innerHTML = `<polyline points="9 6 15 12 9 18"/>`; // 정적 SVG — 안전

    const miniFill = el("span", { class: "fill", style: { width: pct + "%" } });
    const miniBar = el("span", { class: "mini-bar" }, miniFill);
    const numSpan = el("span", { class: "num" }, pct + "%");
    const totalSpan = el("span", { class: "progress-total",
      style: { color: "var(--text-dim)", fontSize: "var(--text-xs)", fontVariantNumeric: "tabular-nums" }
    }, `${st.done}/${st.total}`);

    const header = el("header", { class: "chapter-header", role: "button" },
      el("div", { class: "chapter-title" }, chev, cat.categoryName),
      el("div", { class: "chapter-meta" }, miniBar, numSpan, totalSpan)
    );
    header.setAttribute("aria-expanded", String(isOpen));

    const body = el("div", { class: "chapter-body" });

    // 카테고리 직속 아이템 (섹션 필터 없을 때만)
    if (cat.items && cat.items.length && !sectionId) {
      body.appendChild(renderItems(cat.items));
    }
    // 섹션
    if (cat.sections) {
      for (const sec of cat.sections) {
        if (sectionId && sec.sectionId !== sectionId) continue;
        const secDone = sec.items.filter((it) => state.progress[it.id]).length;
        const block = el("div", { class: "section-block" },
          el("div", { class: "section-title" },
            el("span", {}, sec.sectionName),
            el("span", { class: "count" }, `${secDone}/${sec.items.length}`)
          ),
          renderItems(sec.items)
        );
        body.appendChild(block);
      }
    }

    const chapter = el("section", { class: "chapter", id: "ch-" + cat.categoryId }, header, body);
    chapter.dataset.open = isOpen ? "true" : "false";
    chapter.style.setProperty("--progress-color", color);

    header.addEventListener("click", () => {
      const nowOpen = chapter.dataset.open !== "true";
      chapter.dataset.open = nowOpen ? "true" : "false";
      header.setAttribute("aria-expanded", String(nowOpen));
      if (nowOpen) state.openChapters.add(cat.categoryId);
      else state.openChapters.delete(cat.categoryId);
      persistUi();
    });

    host.appendChild(chapter);
  }
}

function renderItems(items) {
  const ul = el("ul", { class: "item-list" });
  for (const it of items) {
    const done = !!state.progress[it.id];
    const chk = el("input", { type: "checkbox", class: "chk", dataset: { id: it.id } });
    chk.checked = done;
    const li = el("li", { class: "item" + (done ? " done" : "") },
      el("label", {}, chk, el("span", { class: "text" }, it.text))
    );
    ul.appendChild(li);
  }
  ul.addEventListener("change", onItemToggle);
  return ul;
}

function onItemToggle(e) {
  const cb = e.target;
  if (!cb.classList || !cb.classList.contains("chk")) return;
  const id = cb.dataset.id;
  if (cb.checked) state.progress[id] = true;
  else delete state.progress[id];
  saveLS(LS.progress, state.progress);

  const li = cb.closest(".item");
  if (li) li.classList.toggle("done", cb.checked);
  renderSummary();

  const chapter = cb.closest(".chapter");
  if (chapter) {
    const cid = chapter.id.replace("ch-", "");
    const cat = findCategory(cid);
    if (cat) {
      const st = chapterStats(cat);
      const pct = percent(st.done, st.total);
      chapter.style.setProperty("--progress-color", progressHsl(pct));
      chapter.querySelector(".chapter-meta .num").textContent = pct + "%";
      chapter.querySelector(".chapter-meta .mini-bar .fill").style.width = pct + "%";
      const totalSpan = chapter.querySelector(".chapter-meta .progress-total");
      if (totalSpan) totalSpan.textContent = `${st.done}/${st.total}`;
    }
  }
  const sectionBlock = cb.closest(".section-block");
  if (sectionBlock) {
    const title = sectionBlock.querySelector(".section-title .count");
    if (title) {
      const ul = sectionBlock.querySelector(".item-list");
      const doneN = $$('input.chk:checked', ul).length;
      const totalN = $$('input.chk', ul).length;
      title.textContent = `${doneN}/${totalN}`;
    }
  }
  renderSidebar();
}

// ==========================================================================
// xlsx 내보내기 (ExcelJS 동적 로드) — 스타일/데이터 유효성/조건부 서식 적용
// ==========================================================================
async function loadExcelJS() {
  if (window.ExcelJS) return window.ExcelJS;
  const urls = [
    "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
    "https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js",
  ];
  for (const url of urls) {
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url;
        s.onload = resolve;
        s.onerror = () => reject(new Error("네트워크"));
        setTimeout(() => reject(new Error("타임아웃")), 12000);
        document.head.appendChild(s);
      });
      if (window.ExcelJS) return window.ExcelJS;
    } catch (_) { /* 다음 CDN 시도 */ }
  }
  throw new Error("ExcelJS CDN 로드 실패 — 네트워크 또는 차단 확인");
}

// 공통 스타일 팔레트 (엑셀에서 보기 좋은 브라운+크림 톤)
const XL = {
  goldBg:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFC9A44C" } },
  goldSoft:  { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5EAD0" } },
  white:     { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } },
  doneBg:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1DC" } },
  rowAlt:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAF5E9" } },
  titleFont: { name: "맑은 고딕", size: 16, bold: true, color: { argb: "FF1A1612" } },
  subFont:   { name: "맑은 고딕", size: 11, color: { argb: "FF6B5D4C" } },
  headFont:  { name: "맑은 고딕", size: 11, bold: true, color: { argb: "FFFFFFFF" } },
  bodyFont:  { name: "맑은 고딕", size: 11, color: { argb: "FF1A1612" } },
  doneFont:  { name: "맑은 고딕", size: 11, color: { argb: "FF6B5D4C" }, strike: true },
  totalFont: { name: "맑은 고딕", size: 12, bold: true, color: { argb: "FF785818" } },
  thin:      { style: "thin", color: { argb: "FFE5D9B8" } },
};
function borderAll() {
  return { top: XL.thin, left: XL.thin, bottom: XL.thin, right: XL.thin };
}

async function exportXlsx() {
  let ExcelJS;
  try {
    toast("엑셀 파일 생성 중…", "success", 1500);
    ExcelJS = await loadExcelJS();
  } catch (e) {
    console.warn("ExcelJS 로드 실패, SheetJS 폴백:", e);
    toast("프리미엄 엑셀 실패 — 기본 엑셀로 폴백합니다", "error", 3000);
    return exportXlsxFallback();
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Another Eden Checklist";
  wb.created = new Date();

  const today = new Date().toISOString().slice(0, 10);
  const s = stats();
  const pct = percent(s.done, s.total);

  // ------------- 요약 시트 -------------
  const wsSum = wb.addWorksheet("Summary", {
    views: [{ showGridLines: false, state: "frozen", ySplit: 4 }],
  });

  // 타이틀 영역 (3행 병합)
  wsSum.mergeCells("A1:E1");
  wsSum.getCell("A1").value = "ANOTHER EDEN · 올클리어 체크리스트";
  wsSum.getCell("A1").font = XL.titleFont;
  wsSum.getCell("A1").alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  wsSum.getRow(1).height = 28;

  wsSum.mergeCells("A2:E2");
  wsSum.getCell("A2").value = `내보낸 날짜: ${today}   ·   전체: ${s.total}개   ·   완료: ${s.done}개   ·   진행률: ${pct}%`;
  wsSum.getCell("A2").font = XL.subFont;
  wsSum.getCell("A2").alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  wsSum.getRow(2).height = 20;

  // 헤더 (4행)
  const sumHead = ["카테고리", "완료", "전체", "진행률", "진행률 차트"];
  const sumHeadRow = wsSum.getRow(4);
  sumHead.forEach((h, i) => {
    const c = sumHeadRow.getCell(i + 1);
    c.value = h;
    c.font = XL.headFont;
    c.fill = XL.goldBg;
    c.alignment = { vertical: "middle", horizontal: "center" };
    c.border = borderAll();
  });
  sumHeadRow.height = 22;

  // 데이터 행
  let r = 5;
  state.master.forEach((cat, idx) => {
    const st = s.byCat.get(cat.categoryId) || { done: 0, total: 0 };
    const p = percent(st.done, st.total);
    const row = wsSum.getRow(r++);
    row.getCell(1).value = cat.categoryName;
    row.getCell(2).value = st.done;
    row.getCell(3).value = st.total;
    row.getCell(4).value = p / 100;
    row.getCell(4).numFmt = "0%";
    // 진행률 차트: 유니코드 블록 문자로 시각화
    const bars = Math.round(p / 10);
    row.getCell(5).value = "█".repeat(bars) + "░".repeat(10 - bars) + `  ${p}%`;
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.font = XL.bodyFont;
      if (col === 1) c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      else if (col === 5) c.alignment = { horizontal: "left", vertical: "middle" };
      else c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = borderAll();
      if (idx % 2 === 1) c.fill = XL.rowAlt;
    });
    row.height = 20;
  });

  // 합계 행
  const totalRow = wsSum.getRow(r++);
  totalRow.getCell(1).value = "합계";
  totalRow.getCell(2).value = s.done;
  totalRow.getCell(3).value = s.total;
  totalRow.getCell(4).value = pct / 100;
  totalRow.getCell(4).numFmt = "0%";
  const bars = Math.round(pct / 10);
  totalRow.getCell(5).value = "█".repeat(bars) + "░".repeat(10 - bars) + `  ${pct}%`;
  totalRow.eachCell({ includeEmpty: true }, (c, col) => {
    c.font = XL.totalFont;
    c.fill = XL.goldSoft;
    if (col === 1) c.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    else if (col === 5) c.alignment = { horizontal: "left", vertical: "middle" };
    else c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = { top: { style: "medium", color: { argb: "FF785818" } }, bottom: XL.thin, left: XL.thin, right: XL.thin };
  });
  totalRow.height = 24;

  // 컬럼 너비
  wsSum.columns = [
    { width: 18 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 28 },
  ];

  // 조건부 서식: 진행률 Data bar
  wsSum.addConditionalFormatting({
    ref: `D5:D${r - 2}`,
    rules: [{
      type: "dataBar",
      cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }],
      color: { argb: "FFC9A44C" },
      showValue: true,
      priority: 1,
    }],
  });

  // ------------- 카테고리별 시트 -------------
  for (const cat of state.master) {
    const safeName = sanitizeSheetName(cat.categoryName);
    const ws = wb.addWorksheet(safeName, {
      views: [{ showGridLines: false, state: "frozen", ySplit: 4 }],
    });

    const catStats = chapterStats(cat);
    const catPct = percent(catStats.done, catStats.total);

    // 타이틀
    ws.mergeCells("A1:D1");
    ws.getCell("A1").value = `${cat.categoryName} · 체크리스트`;
    ws.getCell("A1").font = XL.titleFont;
    ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 28;

    ws.mergeCells("A2:D2");
    ws.getCell("A2").value = `진행: ${catStats.done} / ${catStats.total}  (${catPct}%)  ·  완료: C열 드롭다운 선택 또는 직접 입력(v, ✓ 등)  ·  해제: Delete`;
    ws.getCell("A2").font = XL.subFont;
    ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(2).height = 20;

    // 헤더
    const headers = ["섹션", "항목", "완료", "ID"];
    const headRow = ws.getRow(4);
    headers.forEach((h, i) => {
      const c = headRow.getCell(i + 1);
      c.value = h;
      c.font = XL.headFont;
      c.fill = XL.goldBg;
      c.alignment = { vertical: "middle", horizontal: "center" };
      c.border = borderAll();
    });
    headRow.height = 22;

    // 데이터 행 — 완료 컬럼은 자유 텍스트. 비어있지 않으면 조건부 서식으로 완료 시각화.
    let rr = 5;
    const pushItem = (secName, it, idx) => {
      const done = !!state.progress[it.id];
      const row = ws.getRow(rr++);
      row.getCell(1).value = secName;
      row.getCell(2).value = it.text;
      row.getCell(3).value = done ? "v" : "";   // 체크 시 기본값 'v', 빈값이면 미완료
      row.getCell(4).value = it.id;

      row.eachCell({ includeEmpty: true }, (c, col) => {
        c.font = XL.bodyFont;
        c.border = borderAll();
        if (col === 3) c.alignment = { horizontal: "center", vertical: "middle" };
        else if (col === 4) c.alignment = { horizontal: "center", vertical: "middle" };
        else c.alignment = { horizontal: "left", vertical: "middle", wrapText: true, indent: 1 };
        // alternating row color — 조건부 서식이 완료 행을 덮어씀
        if (idx % 2 === 1) c.fill = XL.rowAlt;
      });
      // 완료 셀 드롭다운 — 선택지에서 고르거나 직접 입력 둘 다 허용
      // showErrorMessage: false 로 리스트 외 값(직접 입력)도 경고 없이 수용됨
      row.getCell(3).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"✓,v,O"'],
        showErrorMessage: false,
      };
      row.height = 22;
    };

    let itemIdx = 0;
    (cat.items || []).forEach((it) => pushItem("", it, itemIdx++));
    (cat.sections || []).forEach((sec) => sec.items.forEach((it) => pushItem(sec.sectionName, it, itemIdx++)));

    // 컬럼 너비
    ws.columns = [
      { width: 42 }, { width: 72 }, { width: 10 }, { width: 18 },
    ];

    // 자동 필터
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: rr - 1, column: 4 } };

    // 조건부 서식 — C열이 비어있지 않으면 해당 행 전체 연녹색 배경 + 취소선
    // 엑셀에서 사용자가 C열에 아무 글자나 입력하면 자동으로 체크된 것처럼 보임
    if (rr > 5) {
      ws.addConditionalFormatting({
        ref: `A5:D${rr - 1}`,
        rules: [{
          type: "expression",
          formulae: [`AND($C5<>"", NOT(UPPER(TRIM($C5))="FALSE"), NOT(TRIM($C5)="0"), NOT(UPPER(TRIM($C5))="X"), NOT(UPPER(TRIM($C5))="N"), NOT(UPPER(TRIM($C5))="NO"))`],
          style: {
            fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFE8F1DC" }, fgColor: { argb: "FFE8F1DC" } },
            font: { name: "맑은 고딕", size: 11, color: { argb: "FF6B5D4C" }, strike: true },
          },
          priority: 1,
        }],
      });
    }
  }

  // ------------- 다운로드 -------------
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `AE-올클리어-${today}.xlsx`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);

  toast("엑셀 파일을 내보냈습니다 ✓", "success");
}

/** ExcelJS 실패 시 SheetJS 기본 엑셀로 폴백 (스타일 적음, 데이터는 정상) */
function exportXlsxFallback() {
  if (!window.XLSX) { toast("XLSX 라이브러리 없음 — 페이지 새로고침 필요", "error", 4000); return; }
  const wb = XLSX.utils.book_new();
  const s = stats();

  const summaryRows = [["카테고리", "완료", "전체", "진행률(%)"]];
  for (const cat of state.master) {
    const st = s.byCat.get(cat.categoryId) || { done: 0, total: 0 };
    summaryRows.push([cat.categoryName, st.done, st.total, percent(st.done, st.total)]);
  }
  summaryRows.push([]);
  summaryRows.push(["합계", s.done, s.total, percent(s.done, s.total)]);
  const wsSum = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSum["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSum, "Summary");

  for (const cat of state.master) {
    const rows = [["섹션", "항목", "완료", "ID"]];
    for (const it of (cat.items || [])) {
      rows.push(["", it.text, state.progress[it.id] ? "☑" : "☐", it.id]);
    }
    for (const sec of (cat.sections || [])) {
      for (const it of sec.items) {
        rows.push([sec.sectionName, it.text, state.progress[it.id] ? "☑" : "☐", it.id]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 40 }, { wch: 80 }, { wch: 8 }, { wch: 22 }];
    const safeName = sanitizeSheetName(cat.categoryName);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `AE-올클리어-${today}.xlsx`);
  toast("기본 엑셀로 내보냈습니다 (기본 스타일)", "success", 2800);
}

function sanitizeSheetName(name) {
  return (name || "sheet").replace(/[\\\/\?\*\[\]:]/g, "").slice(0, 31);
}

async function importXlsx(file) {
  if (!window.XLSX) { toast("XLSX 라이브러리를 로드하지 못했습니다", "error"); return; }
  const ok = await confirmDialog(
    "엑셀 파일 가져오기",
    `현재 진행도를 덮어씁니다. 계속할까요?\n\n파일: ${file.name}`,
    "덮어쓰기", "취소"
  );
  if (!ok) return;

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });

    const newProg = {};
    let matched = 0, unknown = 0;

    for (const sheetName of wb.SheetNames) {
      if (sheetName === "요약" || sheetName === "Summary") continue;
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!rows.length) continue;
      const header = rows[0].map((s) => String(s).trim());
      const iDone = header.findIndex((h) => /완료|done|checked|completed/i.test(h));
      const iId   = header.findIndex((h) => /^id$/i.test(h));
      if (iId < 0 || iDone < 0) continue;

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const id = String(row[iId] || "").trim();
        if (!id) continue;
        const flagRaw = String(row[iDone] || "").trim();
        const flag = flagRaw.toUpperCase();
        // 관용적 처리: 비어있지 않으면 완료. 단 명시적으로 FALSE/0/N/NO/X/☐는 미완료.
        const explicitFalse = flagRaw === ""
          || flag === "FALSE" || flag === "0" || flag === "N"
          || flag === "NO" || flag === "X" || flagRaw === "☐";
        const done = !explicitFalse;
        if (ALL_IDS.has(id)) {
          matched++;
          if (done) newProg[id] = true;
        } else {
          unknown++;
        }
      }
    }

    state.progress = newProg;
    saveLS(LS.progress, state.progress);
    renderAll();
    toast(`가져오기 완료 — 매칭 ${matched} · 알 수 없음 ${unknown}`, "success", 3600);
  } catch (e) {
    console.error(e);
    toast("엑셀 파일 파싱 실패 — 형식을 확인해 주세요", "error", 4000);
  }
}

// ==========================================================================
// 테마
// ==========================================================================
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  saveLS(LS.theme, theme);
}
function resolveInitialTheme() {
  const saved = loadLS(LS.theme, null);
  if (saved === "dark" || saved === "light") return saved;
  return (window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  applyTheme(cur === "dark" ? "light" : "dark");
}

// ==========================================================================
// UI 상태 지속
// ==========================================================================
function persistUi() {
  saveLS(LS.ui, {
    openChapters: [...state.openChapters],
    view: state.view,
    filter: state.filter,
  });
}
function restoreUi() {
  const saved = loadLS(LS.ui, null);
  if (!saved) return;
  state.openChapters = new Set(saved.openChapters || []);
  state.view = saved.view || "dashboard";
  state.filter = saved.filter || { categoryId: "", sectionId: "" };
}

// ==========================================================================
// 모바일 사이드바
// ==========================================================================
function openMobileSidebar() {
  $("#sidebar").dataset.open = "true";
  $("#mobile-scrim").dataset.open = "true";
  document.body.style.overflow = "hidden";
}
function closeMobileSidebar() {
  $("#sidebar").dataset.open = "false";
  $("#mobile-scrim").dataset.open = "false";
  document.body.style.overflow = "";
}

// ==========================================================================
// 이벤트 바인딩
// ==========================================================================
function bindEvents() {
  $("#f-category").addEventListener("change", (e) => {
    state.filter.categoryId = e.target.value;
    state.filter.sectionId = "";
    if (state.view === "dashboard" && state.filter.categoryId) state.view = "detail";
    persistUi(); renderAll();
  });
  $("#f-section").addEventListener("change", (e) => {
    state.filter.sectionId = e.target.value;
    persistUi(); renderAll();
  });
  $("#btn-reset-filter").addEventListener("click", () => {
    state.filter = { categoryId: "", sectionId: "" };
    persistUi(); renderAll();
  });

  $("#btn-view").addEventListener("click", () => {
    state.view = state.view === "dashboard" ? "detail" : "dashboard";
    $("#btn-view").textContent = state.view === "dashboard" ? "상세 목록 보기" : "대시보드 보기";
    persistUi(); renderAll();
  });

  $("#btn-open-all").addEventListener("click", () => {
    state.master.forEach((c) => state.openChapters.add(c.categoryId));
    persistUi(); renderAll();
  });
  $("#btn-close-all").addEventListener("click", () => {
    state.openChapters.clear();
    persistUi(); renderAll();
  });

  $("#btn-export").addEventListener("click", exportXlsx);
  $("#btn-import").addEventListener("click", () => $("#file-import").click());
  $("#file-import").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) importXlsx(f);
    e.target.value = "";
  });

  $("#btn-sync").addEventListener("click", async () => {
    toast("마스터 데이터 동기화 중…", "success", 1500);
    state.master = await loadMaster();
    rebuildIdIndex();
    renderAll();
    toast("동기화 완료", "success");
  });

  $("#btn-theme").addEventListener("click", toggleTheme);
  $("#btn-theme-mobile").addEventListener("click", toggleTheme);

  $("#btn-menu").addEventListener("click", openMobileSidebar);
  $("#mobile-scrim").addEventListener("click", closeMobileSidebar);

  $("#fab-up").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  $("#fab-down").addEventListener("click", () => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));

  document.addEventListener("click", (e) => {
    if (e.target.closest(".sidebar-brand") || e.target.closest(".topbar h1")) {
      state.view = "dashboard";
      state.filter = { categoryId: "", sectionId: "" };
      persistUi(); renderAll();
      window.scrollTo({ top: 0, behavior: "smooth" });
      closeMobileSidebar();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "t" || e.key === "T") toggleTheme();
    if (e.key === "d" || e.key === "D") { state.view = "dashboard"; persistUi(); renderAll(); }
    if (e.key === "l" || e.key === "L") { state.view = "detail"; persistUi(); renderAll(); }
  });
}

// ==========================================================================
// 부트
// ==========================================================================
async function boot() {
  applyTheme(resolveInitialTheme());
  state.progress = loadLS(LS.progress, {}) || {};
  restoreUi();

  $("#loader").classList.remove("hidden");
  state.master = await loadMaster();
  rebuildIdIndex();
  $("#loader").classList.add("hidden");

  $("#btn-view").textContent = state.view === "dashboard" ? "상세 목록 보기" : "대시보드 보기";

  bindEvents();
  renderAll();
}

boot();
