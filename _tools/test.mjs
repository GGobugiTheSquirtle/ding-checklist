#!/usr/bin/env node
/**
 * _tools/test.mjs — 순수 함수 단위 테스트
 * Node.js 내장만 사용. Vitest/Jest 의존성 없음.
 *
 * 사용: node _tools/test.mjs
 *
 * 테스트 대상은 app.js에서 그대로 복제한 순수 함수들.
 * app.js 수정 시 이 파일의 함수 복제본도 동기화 필요 (원본과 지문 일치 확인으로 완화).
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJsPath = resolve(__dirname, "..", "app.js");

// ======================================================================
// 순수 함수 복제 (app.js와 동일하게 유지 필요)
// ======================================================================

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
  const iId = header.indexOf("id");
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
        categoryName: catName, categoryId: `c${catIdx}`,
        sections: [], items: [], _secMap: new Map(),
      });
      catOrder.push(catName);
    }
    const cat = catMap.get(catName);
    const item = { id, text, completed: false };
    if (secName) {
      if (!cat._secMap.has(secName)) {
        const secObj = { sectionName: secName, sectionId: `${cat.categoryId}-s${cat.sections.length}`, items: [] };
        cat._secMap.set(secName, secObj);
        cat.sections.push(secObj);
      }
      cat._secMap.get(secName).items.push(item);
    } else {
      cat.items.push(item);
    }
  }
  return catOrder.map((name) => {
    const c = catMap.get(name);
    delete c._secMap;
    if (!c.sections.length) delete c.sections;
    if (!c.items.length) delete c.items;
    return c;
  });
}

function sanitizeSheetName(name) {
  return (name || "sheet").replace(/[\\\/\?\*\[\]:]/g, "").slice(0, 31);
}

function percent(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

function b64urlEncode(b64) {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return s;
}
function encodeProgress(progress, ids) {
  const bytes = new Uint8Array(Math.ceil(ids.length / 8));
  ids.forEach((id, i) => { if (progress[id]) bytes[i >> 3] |= 1 << (i & 7); });
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return b64urlEncode(Buffer.from(bin, "binary").toString("base64"));
}
function decodeProgress(str, ids) {
  const bin = Buffer.from(b64urlDecode(str), "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const result = {};
  ids.forEach((id, i) => { if (bytes[i >> 3] & (1 << (i & 7))) result[id] = true; });
  return result;
}

function explicitFalseFromXlsx(flagRaw) {
  const flag = String(flagRaw).trim().toUpperCase();
  const raw = String(flagRaw).trim();
  return raw === "" || flag === "FALSE" || flag === "0" || flag === "N"
      || flag === "NO" || flag === "X" || raw === "☐";
}

// ======================================================================
// 원본과의 싱크 검사 — app.js에 여전히 이 함수들이 존재하는지 해시 대조
// ======================================================================
function checkSync() {
  const src = readFileSync(appJsPath, "utf8");
  const markers = [
    "function parseCsv(",
    "function csvRowsToMaster(",
    "function sanitizeSheetName(",
    "function encodeProgress(",
    "function decodeProgress(",
    "function b64urlEncode(",
  ];
  for (const m of markers) {
    assert.ok(src.includes(m), `app.js에 ${m} 심볼 누락 — 테스트 복제본과 싱크 필요`);
  }
}

// ======================================================================
// 테스트 케이스
// ======================================================================

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

// --- parseCsv ---
test("parseCsv: 간단한 3행 파싱", () => {
  const r = parseCsv("a,b,c\n1,2,3\n4,5,6");
  assert.deepEqual(r, [["a","b","c"],["1","2","3"],["4","5","6"]]);
});
test("parseCsv: BOM 제거", () => {
  const r = parseCsv("\uFEFFh1,h2\nx,y");
  assert.equal(r[0][0], "h1");
});
test("parseCsv: 따옴표 안 쉼표/개행", () => {
  const r = parseCsv('a,"b,c\nd",e');
  assert.deepEqual(r, [["a", "b,c\nd", "e"]]);
});
test("parseCsv: 따옴표 이스케이프 (\"\")", () => {
  const r = parseCsv('a,"say ""hi""",b');
  assert.deepEqual(r, [["a", 'say "hi"', "b"]]);
});
test("parseCsv: CRLF 처리", () => {
  const r = parseCsv("a,b\r\nc,d\r\n");
  assert.deepEqual(r, [["a","b"],["c","d"]]);
});

// --- csvRowsToMaster ---
test("csvRowsToMaster: 헤더 누락시 throw", () => {
  assert.throws(() => csvRowsToMaster([["cat","sec","x","y","z"], ["a","","","","",""]]));
});
test("csvRowsToMaster: 기본 구조 생성 (섹션/직속 혼합)", () => {
  const rows = [
    ["category","section","id","text","completed"],
    ["공통","","c0-i0","항목1","FALSE"],
    ["공통","","c0-i1","항목2","FALSE"],
    ["메인","제1부","c1-s0-i0","퀘1","FALSE"],
    ["메인","제1부","c1-s0-i1","퀘2","FALSE"],
    ["메인","제2부","c1-s1-i0","퀘3","FALSE"],
  ];
  const m = csvRowsToMaster(rows);
  assert.equal(m.length, 2);
  assert.equal(m[0].categoryName, "공통");
  assert.equal(m[0].items.length, 2);
  assert.ok(!m[0].sections);
  assert.equal(m[1].sections.length, 2);
  assert.equal(m[1].sections[0].items.length, 2);
});
test("csvRowsToMaster: 빈 행 스킵", () => {
  const rows = [
    ["category","section","id","text","completed"],
    ["", "", "", "", ""],
    ["공통","","c0-i0","항목","FALSE"],
  ];
  const m = csvRowsToMaster(rows);
  assert.equal(m[0].items.length, 1);
});

// --- sanitizeSheetName ---
test("sanitizeSheetName: 특수문자 제거", () => {
  assert.equal(sanitizeSheetName("메인[1]/외전?"), "메인1외전");
});
test("sanitizeSheetName: 31자 제한", () => {
  const long = "가".repeat(50);
  assert.equal(sanitizeSheetName(long).length, 31);
});
test("sanitizeSheetName: null/빈 폴백", () => {
  assert.equal(sanitizeSheetName(""), "sheet");
  assert.equal(sanitizeSheetName(null), "sheet");
});

// --- percent ---
test("percent: 기본 계산", () => {
  assert.equal(percent(3, 10), 30);
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(0, 0), 0);
});

// --- base64url ---
test("b64url: 인코딩 왕복", () => {
  const orig = "hello world!";
  const enc = b64urlEncode(Buffer.from(orig).toString("base64"));
  assert.ok(!enc.includes("+"));
  assert.ok(!enc.includes("/"));
  assert.ok(!enc.includes("="));
  const dec = Buffer.from(b64urlDecode(enc), "base64").toString();
  assert.equal(dec, orig);
});

// --- encodeProgress / decodeProgress ---
test("encodeProgress: 빈 progress", () => {
  const ids = ["a","b","c","d","e","f","g","h"];
  const enc = encodeProgress({}, ids);
  const dec = decodeProgress(enc, ids);
  assert.deepEqual(dec, {});
});
test("encodeProgress/decodeProgress: 왕복 (한 바이트 경계)", () => {
  const ids = ["a","b","c","d","e","f","g","h"];
  const prog = { a: true, c: true, h: true };
  const enc = encodeProgress(prog, ids);
  const dec = decodeProgress(enc, ids);
  assert.deepEqual(dec, prog);
});
test("encodeProgress: 662개 아이템 → 길이 111~112자", () => {
  const ids = Array.from({ length: 662 }, (_, i) => `id-${i}`);
  const prog = {};
  for (let i = 0; i < 662; i += 3) prog[ids[i]] = true; // 1/3 완료
  const enc = encodeProgress(prog, ids);
  assert.ok(enc.length >= 110 && enc.length <= 114, `길이 ${enc.length} (111~112 기대)`);
  const dec = decodeProgress(enc, ids);
  assert.deepEqual(dec, prog);
});

// --- explicitFalseFromXlsx (가져오기 관용 파싱) ---
test("xlsx import: 명시적 미완료 값들", () => {
  for (const v of ["", "FALSE", "false", "0", "N", "n", "NO", "no", "X", "x", "☐"]) {
    assert.equal(explicitFalseFromXlsx(v), true, `"${v}" 는 미완료여야 함`);
  }
});
test("xlsx import: 명시적 완료 값들", () => {
  for (const v of ["TRUE", "1", "O", "Y", "YES", "v", "✓", "✔", "●", "☑", "완료", "아무값"]) {
    assert.equal(explicitFalseFromXlsx(v), false, `"${v}" 는 완료여야 함`);
  }
});

// ======================================================================
// 실행
// ======================================================================
let passed = 0, failed = 0;
console.log("=== app.js 순수 함수 단위 테스트 ===\n");
try {
  checkSync();
  console.log("[싱크] app.js에 모든 테스트 대상 심볼 존재\n");
} catch (e) {
  console.error("[싱크 실패]", e.message);
  process.exit(2);
}

for (const c of cases) {
  try {
    c.fn();
    console.log(`  ✓ ${c.name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${c.name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed / ${cases.length} total`);
process.exit(failed ? 1 : 0);
