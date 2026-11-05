/**
 * Download tracker for the 3D stamp generator.
 *
 * Receives POST requests from the website and records, per email address:
 * how many downloads, first/last download time, and the last file name.
 *
 * Paste this into a Google Apps Script bound to a Google Sheet
 * (Extensions > Apps Script) and deploy as a Web App.
 * See SETUP.md in this folder for step-by-step instructions.
 */

var SHEET_NAME = 'Downloads';
var HEADERS = ['Email', 'Downloads', 'First download', 'Last download', 'Last file'];

// The web app URL ships in the site's public JavaScript, so anyone can POST
// to it. Treat every field as hostile input.
var MAX_BODY_CHARS = 2000;
var MAX_ROWS = 20000; // stop a flood of junk emails from filling the sheet
var EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// Sheets runs any cell starting with = + - @ as a formula, which would let a
// crafted value read other rows and send them elsewhere. Keep the file name
// to plain characters and never let it start with a formula trigger.
function safeText(value) {
  var text = String(value || '').replace(/[^\w .()\-]/g, '_').slice(0, 200);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // serialize concurrent downloads
  try {
    var body = (e && e.postData && e.postData.contents) || '';
    if (!body || body.length > MAX_BODY_CHARS) {
      return ContentService.createTextOutput('ignored');
    }
    var data = JSON.parse(body);
    var email = String(data.email || '').trim().toLowerCase();
    // EMAIL_RE cannot match a leading = + - @, so the email is formula-safe.
    if (email.length > 254 || !EMAIL_RE.test(email) || /^[+\-]/.test(email)) {
      return ContentService.createTextOutput('ignored');
    }
    var fileName = safeText(data.fileName);
    var now = new Date();

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
    }

    // Find the row for this email (column A, below the header).
    var lastRow = sheet.getLastRow();
    var row = 0;
    if (lastRow > 1) {
      var emails = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < emails.length; i++) {
        if (emails[i][0] === email) {
          row = i + 2;
          break;
        }
      }
    }

    if (row) {
      var count = Number(sheet.getRange(row, 2).getValue()) || 0;
      sheet.getRange(row, 2).setValue(count + 1);
      sheet.getRange(row, 4).setValue(now);
      sheet.getRange(row, 5).setValue(fileName);
    } else {
      if (lastRow >= MAX_ROWS) {
        return ContentService.createTextOutput('ignored');
      }
      sheet.appendRow([email, 1, now, now, fileName]);
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    // Don't echo internals back to an anonymous caller.
    console.error(err);
    return ContentService.createTextOutput('error');
  } finally {
    lock.releaseLock();
  }
}
