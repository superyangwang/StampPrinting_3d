# Google Sheet download tracking — setup (~5 minutes)

The website asks for an email before each STL download and sends the event to
a Google Apps Script web app, which records it in a Google Sheet you own:
one row per email with the download count and first/last download times.

## One-time setup

1. Go to https://sheets.google.com and create a new blank spreadsheet.
   Name it something like **Stamp Downloads**.

2. In the sheet, open **Extensions → Apps Script**.

3. Delete the placeholder code in the editor and paste the full contents of
   [`download-tracker.gs`](download-tracker.gs). Save (Ctrl+S).

4. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Description: anything (e.g. "download tracker").
   - Execute as: **Me**.
   - Who has access: **Anyone**. (Required so the website can post to it.
     The URL is unguessable, and the script only ever appends to the sheet.)
   - Click **Deploy**, then **Authorize access** and approve with your
     Google account. If you see "Google hasn't verified this app", click
     **Advanced → Go to ... (unsafe)** — it's your own script.

5. Copy the **Web app URL** (looks like
   `https://script.google.com/macros/s/AKfycb.../exec`).

6. Paste that URL into [`src/tracking.js`](../src/tracking.js):

   ```js
   export const TRACKING_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```

7. Commit and push — the site redeploys automatically and starts recording.

## Viewing the data

Just open the spreadsheet. The **Downloads** tab fills in automatically:

| Email | Downloads | First download | Last download | Last file |
|-------|-----------|----------------|---------------|-----------|

## Updating the script later

If you ever edit the script code, use **Deploy → Manage deployments →
(pencil icon) → Version: New version → Deploy** so the existing URL picks up
the change. A brand-new deployment would generate a different URL.

## Notes

- Until `TRACKING_URL` is set, the email prompt still appears but nothing is
  recorded.
- Requests are sent fire-and-forget (`no-cors`), so a tracking outage never
  blocks anyone's download.
