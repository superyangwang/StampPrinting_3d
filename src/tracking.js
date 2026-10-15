// Download tracking via a Google Apps Script web app that writes to a
// Google Sheet. See apps-script/SETUP.md for how to create the script and
// get this URL. Leave empty to disable recording (the email gate still shows).
export const TRACKING_URL = '';

// Fire-and-forget: Apps Script web apps don't answer CORS preflights, so we
// send the JSON as text/plain (a "simple" request) with no-cors. We can't
// read the response, but the row still lands in the sheet.
export function recordDownload(email, fileName) {
  if (!TRACKING_URL) return;
  try {
    fetch(TRACKING_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email, fileName }),
    }).catch(() => {});
  } catch {
    // Recording must never block the download.
  }
}
