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

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000); // serialize concurrent downloads
  try {
    var data = JSON.parse(e.postData.contents);
    var email = String(data.email || '').trim().toLowerCase();
    if (!email || email.length > 254) {
      return ContentService.createTextOutput('ignored');
    }
    var fileName = String(data.fileName || '').slice(0, 200);
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
      sheet.appendRow([email, 1, now, now, fileName]);
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  } finally {
    lock.releaseLock();
  }
}
