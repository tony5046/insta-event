// ============================================
// Google Apps Script - 시트에 붙여넣기용 코드 (셀러별 탭 분리 버전)
// ============================================
//
// 설정 방법:
// 1. Google 시트에서 "확장 프로그램" → "Apps Script" 클릭
// 2. 기존 코드 전부 삭제 후 이 코드를 붙여넣기
// 3. 상단 "배포" → "배포 관리" → 연필 아이콘 → "새 버전" → 배포
//    (또는 "새 배포"로 재배포 후 새 URL 사용)
// 4. 실행 권한: "나" / 액세스 권한: "모든 사용자"
// 5. 인스타 추첨 도구에서 웹 앱 URL 재입력
//
// ※ 시트 양식(6열): 진행마켓명 | 아이디 | 댓글 내용 | 선정 유무 | 증정품 | 추첨일자
// ※ 각 셀러별로 별도 탭에 저장됨 (탭이 없으면 자동 생성)
// ※ 당첨자만 저장 (전체 댓글 X)
//

var SHEET_ID = '1HFCnttiqciOoXrbiSPygkbUEvwhnFzPBMboenS2_JV8';

var HEADERS = ['진행마켓명', '아이디', '댓글 내용', '선정 유무', '증정품', '추첨일자'];

// seller 값 = 계정 등록 시 입력한 별칭(label)이 그대로 탭 이름이 됩니다.
// 예: "달빛언니팀 계정" → 시트에 "달빛언니팀 계정" 탭 생성
function getSheetName(sellerKey) {
  if (!sellerKey) return '기타';
  return sellerKey;
}

function getOrCreateSheet(ss, sellerKey) {
  var name = getSheetName(sellerKey);
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ============================================
// doPost: 당첨자 행을 셀러별 탭에 추가
// body: { seller: 'moonlight.living', rows: [[마켓명, 아이디, 댓글, 선정유무, 증정품, 추첨일자], ...] }
// ============================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var rows = data.rows || [];
    var seller = data.seller || '';

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = getOrCreateSheet(ss, seller);

    // 헤더가 없는 경우 추가
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var lastRow = sheet.getLastRow();
    if (rows.length > 0) {
      sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    return jsonOut({
      success: true,
      added: rows.length,
      sheet: sheet.getName(),
      seller: seller
    });

  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

// ============================================
// doGet: 최근 N일 이내 당첨자 목록 조회 (셀러별)
// URL: {웹앱URL}?action=recent&days=30&seller=moonlight.living
// 응답: { success: true, usernames: [...], count: N }
// ============================================
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || '';

    if (action === 'recent') {
      var days = parseInt((e.parameter && e.parameter.days) || '30', 10);
      if (isNaN(days) || days <= 0) days = 30;
      var seller = (e.parameter && e.parameter.seller) || '';

      var ss = SpreadsheetApp.openById(SHEET_ID);

      var sheets = [];
      if (seller) {
        // 특정 셀러 탭만 조회 (없으면 빈 배열)
        var s = ss.getSheetByName(getSheetName(seller));
        if (s) sheets.push(s);
      } else {
        // seller 미지정 시 모든 탭 조회
        sheets = ss.getSheets();
      }

      var cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - days);

      var winners = {};
      for (var si = 0; si < sheets.length; si++) {
        var sheet = sheets[si];
        var lastRow = sheet.getLastRow();
        if (lastRow < 2) continue;
        var values = sheet.getRange(1, 1, lastRow, 6).getValues();

        for (var i = 1; i < values.length; i++) {
          // i=0은 헤더일 가능성이 높으므로 스킵
          var row = values[i];
          var username = String(row[1] || '').trim();
          var selected = String(row[3] || '').trim();
          var dateVal = row[5];

          if (!username) continue;
          if (selected.indexOf('당첨') === -1) continue;

          var rowDate = parseDateCell(dateVal);
          if (!rowDate) continue;
          if (rowDate < cutoff) continue;

          winners[username.toLowerCase()] = true;
        }
      }

      var list = Object.keys(winners);
      return jsonOut({
        success: true,
        usernames: list,
        count: list.length,
        days: days,
        seller: seller
      });
    }

    return jsonOut({ status: 'ok', message: '인스타 이벤트 시트 연동 (셀러별 탭 분리)' });
  } catch (err) {
    return jsonOut({ success: false, error: err.message });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseDateCell(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  var s = String(v).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (m) {
    var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  var d2 = new Date(s);
  return isNaN(d2.getTime()) ? null : d2;
}
