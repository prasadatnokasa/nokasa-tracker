// ============================================================
//  NoKasa Tracker — Google Apps Script Backend
//  Deploy as Web App: Execute as "Me", Anyone can access
// ============================================================

// ── GET HANDLER ─────────────────────────────────────────────
function doGet(e) {
  try {
    const action = (e.parameter && e.parameter.action) || 'ping';
    let result;

    if      (action === 'ping')           result = { status: 'ok', ts: new Date().toISOString() };
    else if (action === 'getConfig')      result = getConfig();
    else if (action === 'getCollections') result = getCollections(e.parameter.date, e.parameter.month);
    else if (action === 'getStorageState')result = getStorageState();
    else if (action === 'getDashboard')   result = getDashboard(e.parameter.month);
    else                                  result = { error: 'Unknown action: ' + action };

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.toString(), stack: err.stack });
  }
}

// ── POST HANDLER ─────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    let result;

    if      (action === 'addCollection')      result = addCollection(data);
    else if (action === 'deleteCollection')   result = deleteCollection(data.timestamp);
    else if (action === 'addStorageMovement') result = addStorageMovement(data);
    else if (action === 'addVehicle')         result = addConfigItem('Vehicles', data.name);
    else if (action === 'addStorage')         result = addConfigItem('Storages', data.name);
    else if (action === 'addRegion')          result = addConfigItem('Regions', data.name);
    else                                       result = { error: 'Unknown action: ' + action };

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ error: err.toString() });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── SHEET ACCESS ─────────────────────────────────────────────
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// ── ONE-TIME SETUP ────────────────────────────────────────────
// Run this manually once from the Apps Script editor
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  function ensureSheet(name, headers, textCols) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
           .setFontWeight('bold')
           .setBackground('#C8E6C9');
      sheet.setFrozenRows(1);
    }
    // Force text format on specified columns (so dates don't auto-convert)
    if (textCols) {
      textCols.forEach(col => sheet.getRange(1, col, 1000, 1).setNumberFormat('@STRING@'));
    }
    return sheet;
  }

  ensureSheet('Collections',
    ['Timestamp', 'Date', 'Vehicle', 'Pickups', 'WearableKG', 'WastageKG', 'StorageLocation'],
    [1, 2]
  );
  ensureSheet('StorageMovements',
    ['Timestamp', 'Date', 'StorageName', 'Type', 'WeightKG', 'Notes'],
    [1, 2]
  );
  ensureSheet('Vehicles', ['Name', 'Active']);
  ensureSheet('Storages', ['Name', 'Active']);
  ensureSheet('Regions',  ['Name', 'Active']);

  // Seed default vehicles
  const vs = ss.getSheetByName('Vehicles');
  if (vs.getLastRow() <= 1) {
    vs.getRange(2, 1, 3, 2).setValues([
      ['Vehicle 1', true],
      ['Vehicle 2', true],
      ['Vehicle 3', true],
    ]);
  }

  // Seed default regions
  const rs = ss.getSheetByName('Regions');
  if (rs.getLastRow() <= 1) {
    rs.getRange(2, 1, 4, 2).setValues([
      ['North', true],
      ['South', true],
      ['East',  true],
      ['West',  true],
    ]);
  }
}

// ── HELPERS ───────────────────────────────────────────────────
function dateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(val).substring(0, 10);
}

function r2(n) { return Math.round(Number(n) * 100) / 100; }

// ── COLLECTIONS ───────────────────────────────────────────────
function addCollection(data) {
  const sheet = getSheet('Collections');
  const timestamp = new Date().toISOString();
  sheet.appendRow([
    timestamp,
    data.date,
    data.vehicle,
    Number(data.pickups) || 0,
    Number(data.wearableKG) || 0,
    Number(data.wastageKG) || 0,
    data.storageLocation || '',
    data.region || ''
  ]);
  return { success: true, timestamp };
}

function deleteCollection(timestamp) {
  const sheet = getSheet('Collections');
  if (sheet.getLastRow() <= 1) return { error: 'Not found' };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(timestamp)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { error: 'Row not found' };
}

function getCollections(date, month) {
  const sheet = getSheet('Collections');
  if (!sheet || sheet.getLastRow() <= 1) return { collections: [] };

  const rows = sheet.getDataRange().getValues().slice(1);
  const collections = rows
    .filter(r => r[0]) // has timestamp
    .filter(r => {
      const d = dateStr(r[1]);
      if (date)  return d === date;
      if (month) return d.startsWith(month);
      return true;
    })
    .map(r => ({
      timestamp:       String(r[0]),
      date:            dateStr(r[1]),
      vehicle:         String(r[2] || ''),
      pickups:         Number(r[3]) || 0,
      wearableKG:      r2(r[4]),
      wastageKG:       r2(r[5]),
      storageLocation: String(r[6] || ''),
      region:          String(r[7] || '')
    }));

  return { collections };
}

// ── STORAGE ───────────────────────────────────────────────────
function addStorageMovement(data) {
  const sheet = getSheet('StorageMovements');
  const timestamp = new Date().toISOString();
  sheet.appendRow([
    timestamp,
    data.date,
    data.storageName,
    data.type,           // 'OUT' for vendor pickup
    Number(data.weightKG) || 0,
    data.notes || ''
  ]);
  return { success: true };
}

function getStorageState() {
  // Collect all configured storages
  const storagesSheet = getSheet('Storages');
  const state = {};

  if (storagesSheet && storagesSheet.getLastRow() > 1) {
    storagesSheet.getDataRange().getValues().slice(1)
      .filter(r => r[0])
      .forEach(r => { state[String(r[0])] = { name: String(r[0]), totalIn: 0, totalOut: 0 }; });
  }

  // Add wearable clothes from collections (IN flow)
  const collectionsSheet = getSheet('Collections');
  if (collectionsSheet && collectionsSheet.getLastRow() > 1) {
    collectionsSheet.getDataRange().getValues().slice(1)
      .filter(r => r[0] && r[6])
      .forEach(r => {
        const loc  = String(r[6]);
        const wkg  = Number(r[4]) || 0;
        if (!state[loc]) state[loc] = { name: loc, totalIn: 0, totalOut: 0 };
        state[loc].totalIn += wkg;
      });
  }

  // Add vendor pickups (OUT flow)
  const movSheet = getSheet('StorageMovements');
  if (movSheet && movSheet.getLastRow() > 1) {
    movSheet.getDataRange().getValues().slice(1)
      .filter(r => r[0])
      .forEach(r => {
        const name   = String(r[2]);
        const type   = String(r[3]);
        const weight = Number(r[4]) || 0;
        if (!state[name]) state[name] = { name, totalIn: 0, totalOut: 0 };
        if (type === 'OUT') state[name].totalOut += weight;
        if (type === 'IN')  state[name].totalIn  += weight;
      });
  }

  const storages = Object.values(state).map(s => ({
    name:         s.name,
    totalIn:      r2(s.totalIn),
    totalOut:     r2(s.totalOut),
    currentStock: r2(s.totalIn - s.totalOut)
  }));

  return { storages };
}

// ── DASHBOARD ─────────────────────────────────────────────────
function getDashboard(month) {
  const sheet = getSheet('Collections');
  if (!sheet || sheet.getLastRow() <= 1) return { stats: null, vehicleBreakdown: [], dailyData: [] };

  const allRows = sheet.getDataRange().getValues().slice(1).filter(r => r[0]);

  const rows = allRows.filter(r => {
    if (!month) return true;
    return dateStr(r[1]).startsWith(month);
  });

  if (rows.length === 0) return { stats: null, vehicleBreakdown: [], dailyData: [] };

  const totalPickups    = rows.reduce((s, r) => s + (Number(r[3]) || 0), 0);
  const totalWearable   = rows.reduce((s, r) => s + (Number(r[4]) || 0), 0);
  const totalWastage    = rows.reduce((s, r) => s + (Number(r[5]) || 0), 0);
  const totalWeight     = totalWearable + totalWastage;
  const uniqueDays      = new Set(rows.map(r => dateStr(r[1]))).size;

  // Per vehicle
  const vehicleMap = {};
  const dailyMap   = {};
  const regionMap  = {};

  rows.forEach(r => {
    const d    = dateStr(r[1]);
    const v    = String(r[2] || '');
    const pkp  = Number(r[3]) || 0;
    const wear = Number(r[4]) || 0;
    const wast = Number(r[5]) || 0;
    const reg  = String(r[7] || 'Unassigned');

    if (!vehicleMap[v]) vehicleMap[v] = { vehicle: v, trips: 0, pickups: 0, wearable: 0, wastage: 0 };
    vehicleMap[v].trips++;
    vehicleMap[v].pickups  += pkp;
    vehicleMap[v].wearable += wear;
    vehicleMap[v].wastage  += wast;

    if (!dailyMap[d]) dailyMap[d] = { date: d, pickups: 0, wearable: 0, wastage: 0 };
    dailyMap[d].pickups  += pkp;
    dailyMap[d].wearable += wear;
    dailyMap[d].wastage  += wast;

    if (!regionMap[reg]) regionMap[reg] = { region: reg, pickups: 0, wearable: 0, wastage: 0 };
    regionMap[reg].pickups  += pkp;
    regionMap[reg].wearable += wear;
    regionMap[reg].wastage  += wast;
  });

  const stats = {
    totalPickups,
    totalWeight:          r2(totalWeight),
    totalWearable:        r2(totalWearable),
    totalWastage:         r2(totalWastage),
    wearablePct:          totalWeight > 0 ? Math.round(totalWearable / totalWeight * 100) : 0,
    avgKgPerPickup:       r2(totalPickups > 0 ? totalWeight / totalPickups : 0),
    avgPickupsPerDay:     r2(uniqueDays   > 0 ? totalPickups / uniqueDays  : 0),
    avgCollectionPerDay:  r2(uniqueDays   > 0 ? totalWeight  / uniqueDays  : 0),
    activeDays: uniqueDays
  };

  const vehicleBreakdown = Object.values(vehicleMap).map(v => ({
    ...v,
    wearable: r2(v.wearable),
    wastage:  r2(v.wastage)
  }));

  const regionBreakdown = Object.values(regionMap).map(r => ({
    ...r,
    wearable: r2(r.wearable),
    wastage:  r2(r.wastage)
  }));

  const dailyData = Object.values(dailyMap)
    .sort((a, b) => a.date.localeCompare(b.date));

  return { stats, vehicleBreakdown, regionBreakdown, dailyData };
}

// ── CONFIG ────────────────────────────────────────────────────
function getConfig() {
  function listActive(sheetName) {
    const sheet = getSheet(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return [];
    return sheet.getDataRange().getValues().slice(1)
      .filter(r => r[0] && r[1] !== false && r[1] !== 'FALSE')
      .map(r => String(r[0]));
  }
  return {
    vehicles: listActive('Vehicles'),
    storages: listActive('Storages'),
    regions:  listActive('Regions')
  };
}

function addConfigItem(sheetName, name) {
  if (!name || !name.trim()) return { error: 'Name cannot be empty' };
  const sheet = getSheet(sheetName);
  sheet.appendRow([name.trim(), true]);
  return { success: true };
}
