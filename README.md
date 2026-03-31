# NoKasa Tracker — Setup Guide

A mobile-first web app for tracking daily clothes collection per vehicle,
warehouse inventory, and vendor pickups. Data stored in Google Sheets.
Hosted on Cloudflare Workers. Password-protected.

---

## Architecture

```
Browser (iPhone / desktop)
    │
    ▼
Cloudflare Worker  ←── serves HTML app + auth + /api proxy
    │
    ▼  (POST/GET with redirect-follow)
Google Apps Script Web App
    │
    ▼
Google Sheets (4 sheets)
    ├── Collections       — daily vehicle entries
    ├── StorageMovements  — vendor pickup logs
    ├── Vehicles          — config
    └── Storages          — config
```

---

## STEP 1 — Google Sheets + Apps Script

### 1a. Create the spreadsheet

1. Go to [sheets.new](https://sheets.new) and create a blank sheet.
2. Name it **NoKasa Tracker** (or anything you like).
3. Copy the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/**SHEET_ID**/edit`

### 1b. Open the Apps Script editor

1. In the spreadsheet, click **Extensions → Apps Script**.
2. Delete any existing code in `Code.gs`.
3. Paste the entire contents of `apps-script/Code.gs` from this project.
4. Save (Ctrl+S / Cmd+S).

### 1c. Run setup once

1. In the Apps Script editor, select the function `setup` from the dropdown.
2. Click **▶ Run**.
3. Grant permissions when prompted (allow the script to access your spreadsheet).
4. You should see 4 new sheets created: `Collections`, `StorageMovements`,
   `Vehicles`, `Storages`, with 3 default vehicles already added.

### 1d. Deploy as Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon ⚙ next to "Type" → select **Web app**.
3. Set:
   - **Description**: NoKasa Tracker API
   - **Execute as**: Me
   - **Who has access**: Anyone  ← important, the Worker handles auth
4. Click **Deploy**.
5. Copy the **Web app URL** — it looks like:
   `https://script.google.com/macros/s/AKfycby.../exec`

> ⚠️ Every time you edit Code.gs, you must create a **New deployment** (not
> update an existing one) for changes to take effect.

---

## STEP 2 — Cloudflare Worker

### 2a. Install Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### 2b. Set the Apps Script URL

Open `cloudflare-worker/wrangler.toml` and replace the placeholder:

```toml
APPS_SCRIPT_URL = "https://script.google.com/macros/s/YOUR_ID/exec"
```

### 2c. Set the password (secret)

```bash
cd cloudflare-worker
wrangler secret put PASSWORD
# Type your chosen password when prompted, then press Enter
```

### 2d. Deploy

```bash
wrangler deploy
```

You'll get a URL like `https://nokasa-tracker.YOUR-SUBDOMAIN.workers.dev`

That's it — open the URL on your iPhone, save it to your home screen.

---

## STEP 3 — First-time app setup (in browser)

1. Open your Workers URL.
2. Sign in with the password you set above.
3. Go to **Settings** tab.
4. Add your vehicle names (e.g. Vehicle 1, Vehicle 2, Vehicle 3).
5. Add your storage locations (e.g. Warehouse Koramangala, Shop Indiranagar).
6. Go back to **Entry** and start logging!

---

## Using the App

### Daily Entry tab
- Pick the date (defaults to today).
- Thursday is automatically marked as a holiday.
- Tap **+ Add Vehicle Entry** for each vehicle that ran.
- Per vehicle you enter: number of customer pickups, wearable kg, wastage kg,
  and which storage the wearable clothes went to.

### Storage tab
- Shows each warehouse with: **Total Received** (wearable clothes in),
  **Vendor Taken** (pickups out), **Current Stock** (remaining).
- Tap **Log Pickup** to record when a vendor takes stock from a warehouse.
  This deducts from the current stock.
- The overall combined total is shown at the top.

### Dashboard tab
- Pick any month to see:
  - Total pickups, total weight, avg kg/pickup, avg pickups/day,
    avg collection/day, active days.
  - Wearable vs Wastage split (with %).
  - Breakdown by vehicle.
  - Daily breakdown table.

### Settings tab
- Add new vehicles or storage locations any time.

---

## Custom Domain (optional)

In Cloudflare dashboard → Workers & Pages → your worker → Settings → Domains & Routes,
add a custom domain like `tracker.nokasa.co`.

---

## Sharing view-only access to the Sheet

Since all real data lives in Google Sheets, you can share the spreadsheet
with team members or vendors for read-only access directly in Sheets, while
keeping the web app password-protected.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "Upstream error" on API calls | Re-deploy the Apps Script as a new deployment |
| Data not updating | Make sure you deployed after the last Code.gs change |
| Wrong date on entry | The date picker uses your device's local time |
| Apps Script permissions error | Re-run `setup()` and re-grant permissions |
