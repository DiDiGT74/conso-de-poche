/**
 * Conso de poche : API de l'appli installée (GitHub Pages, dossier /conso/), même principe que Crypto de poche.
 * Lit « HA données » (Home Assistant) et « Electricité », calcule tout ici et renvoie un JSON compact.
 * Déploiement : Déployer > Nouveau déploiement > Application Web,
 * « Exécuter en tant que : moi », « Qui a accès : tout le monde » (chaque requête porte une clé secrète).
 *
 * Clés (propriétés du script, créées par les pages de liaison, jamais à la main) :
 *   API_KEY          = Adrien : tout voir + saisies (Tesla, sacs de granulés, tarifs)
 *   API_KEY_LECTURE  = lecture seule : tout voir, aucune écriture (refus ici, côté serveur)
 * Pages réservées au propriétaire (ouvrir l'URL /exec connecté à son compte Google) :
 *   ?lier=1          relier son propre téléphone
 *   ?lier=lecture    lien personnel en lecture seule (à envoyer) ; &nouveau=1 révoque l'ancien
 */
const HA_ID = '1bVmJAkRaJzicLDbgN1xEbDQrSOab7lIkNnMVA_c7GbQ';  // « HA données »
const EL_ID = '16yn0_8GPCsoijVN_r8DhG46RIKmYe7ooz0cvXVeIdiw';  // « Electricité »
const APP_URL = 'https://didigt74.github.io/conso-de-poche/';
const TZ = 'Europe/Paris';
const CACHE_S = 90; // les relevés arrivent toutes les 15 min : 90 s de cache suffisent

/* ---------- Clés et rôles (repris de Crypto de poche) ---------- */
function sameKey_(k, real) {
  if (!real || typeof k !== 'string' || k.length !== real.length) return false;
  let diff = 0;
  for (let i = 0; i < k.length; i++) diff |= k.charCodeAt(i) ^ real.charCodeAt(i);
  return diff === 0;
}
function role_(k) {
  const props = PropertiesService.getScriptProperties();
  if (sameKey_(k, props.getProperty('API_KEY'))) return 'owner';
  if (sameKey_(k, props.getProperty('API_KEY_LECTURE'))) return 'lecture';
  return null;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const WRITES = { tesla: 1, sac: 1, tarif: 1, sub: 1, vapid: 1, alerte: 1 };
function api_(req) {
  const role = role_(req.k);
  if (!role) return json_({ ok: false, error: 'clé refusée' });
  try {
    if (req.a === 'data') return json_({ ok: true, data: viewFor_(role, getData_(req.p === true || req.p === 1)) });
    if (req.a === 'hist') return json_({ ok: true, data: getHist_(req.p === true || req.p === 1) });
    if (req.a === 'dev') return json_({ ok: true, data: getDev_(req.p === true || req.p === 1) }); // lecture : aussi pour la clé lecture seule
    if (WRITES[req.a] && role !== 'owner') return json_({ ok: false, error: 'lecture seule : action refusée' });
    if (req.a === 'tesla') return json_({ ok: true, data: saveTesla_(req.p) });
    if (req.a === 'sac') return json_({ ok: true, data: saveSac_(req.p) });
    if (req.a === 'tarif') return json_({ ok: true, data: saveTarif_(req.p) });
    if (req.a === 'vapid') return json_({ ok: true, data: { pub: vapid_().pub } });
    if (req.a === 'sub') return json_({ ok: true, data: addPushSub_(req.p) });
    if (req.a === 'alerte') return json_({ ok: true, data: getAlerte_() });
    return json_({ ok: false, error: 'action non autorisée' });
  } catch (e) {
    return json_({ ok: false, error: e.message });
  }
}

/** Lecture seule : mêmes chiffres, sans la liste des saisies ni le formulaire des tarifs. */
function viewFor_(role, d) {
  const out = Object.assign({}, d, { role: role });
  if (role !== 'owner') { delete out.tarifs; delete out.saisies; }
  return out;
}

function doPost(e) {
  let req = {};
  try { req = JSON.parse(e.postData.contents); } catch (_) {}
  return api_(req);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.k) {
    const req = { k: e.parameter.k, a: e.parameter.a };
    if (e.parameter.p) { try { req.p = JSON.parse(e.parameter.p); } catch (_) {} }
    if (WRITES[req.a] && req.a !== 'alerte' && req.a !== 'vapid') return json_({ ok: false, error: 'écriture : utiliser POST' });
    return api_(req);
  }
  const isOwner = Session.getActiveUser().getEmail() === Session.getEffectiveUser().getEmail();
  if (!isOwner) return ContentService.createTextOutput('Conso de poche');
  if (e && e.parameter && e.parameter.lier === 'lecture') return lectureLinkPage_(e.parameter.nouveau === '1');
  if (e && e.parameter && e.parameter.lier) return linkPage_();
  return ContentService.createTextOutput('Conso de poche : ouvre ?lier=1 pour relier ton téléphone, ?lier=lecture pour le lien en lecture seule.');
}

function newKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function appLink_(key) { return APP_URL + '#k=' + key + '&api=' + encodeURIComponent(ScriptApp.getService().getUrl()); }

const LINK_CSS = 'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0B1526;color:#E6EEFB;font-family:system-ui,sans-serif;text-align:center;padding:24px}' +
  'a.b,button{display:inline-block;margin-top:14px;padding:15px 20px;border:0;border-radius:16px;background:#4D8DFF;color:#06101F;font:inherit;font-weight:700;text-decoration:none;cursor:pointer}' +
  'a.s{color:#93A6C6;font-size:.85rem}p{line-height:1.5;max-width:34em;margin:10px auto}' +
  'textarea{width:100%;max-width:34em;height:6.5em;margin-top:12px;border-radius:12px;border:1px solid #26395C;background:#13213A;color:#E6EEFB;padding:10px;font:12px ui-monospace,monospace}';

/** Page réservée au propriétaire : crée la clé secrète (une seule fois) et l'envoie à l'appli installée. */
function linkPage_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) { key = newKey_(); props.setProperty('API_KEY', key); }
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + LINK_CSS +
    '</style></head><body><div><h1 style="font-size:1.3rem">Relier ce téléphone</h1>' +
    '<p>Ce bouton ouvre Conso de poche et la relie à tes deux fichiers.<br>À faire une seule fois, dans Chrome.</p>' +
    '<a class="b" href="' + appLink_(key) + '" target="_top">Ouvrir et relier l\'appli</a></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Relier Conso de poche')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Page réservée au propriétaire : le lien personnel en lecture seule (à envoyer). nouveau=1 révoque l'ancien lien. */
function lectureLinkPage_(regen) {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY_LECTURE');
  if (!key || regen) { key = newKey_(); props.setProperty('API_KEY_LECTURE', key); }
  const url = appLink_(key);
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + LINK_CSS +
    '</style></head><body><div><h1 style="font-size:1.3rem">Lien en lecture seule</h1>' +
    '<p>Envoie ce lien en message privé. Elle l\'ouvre une fois dans Chrome, choisit son code à 6 chiffres, puis installe l\'appli. Elle voit tous les chiffres mais ne peut rien enregistrer.</p>' +
    '<textarea id="l" readonly>' + url + '</textarea><br>' +
    '<button type="button" onclick="var t=document.getElementById(\'l\');t.select();try{navigator.clipboard.writeText(t.value)}catch(e){document.execCommand(\'copy\')}this.textContent=\'Lien copié\'">Copier le lien</button>' +
    '<p><a class="s" href="' + ScriptApp.getService().getUrl() + '?lier=lecture&nouveau=1" target="_top">Créer un nouveau lien (l\'ancien ne marchera plus)</a></p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Lien lecture seule')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/* ====================================================================================
 * Lecture des fichiers. Chaque cellule = nombre si c'en est un, sinon le texte affiché
 * (dates comprises) : mêmes règles de lecture que la première version, vérifiée sur les vraies données.
 * ==================================================================================== */
function cells_(range) {
  const v = range.getValues(), d = range.getDisplayValues();
  return v.map((r, i) => r.map((x, j) => typeof x === 'number' ? x : d[i][j]));
}
function tableFromRows_(rows) {
  const head = (rows[0] || []).map(h => String(h).trim());
  return rows.slice(1).map(r => { const o = {}; head.forEach((h, i) => { if (h) o[h] = r[i] == null ? '' : r[i]; }); return o; });
}

function num_(s) {
  if (s === undefined || s === null) return null;
  if (typeof s === 'number') return s;
  s = String(s).trim();
  if (s === '') return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  let c = s.replace(/[^\d,.]/g, '');
  if (c.indexOf(',') >= 0) c = c.replace(/\./g, '').replace(',', '.');
  if (c === '') return null;
  const v = parseFloat(c);
  return isNaN(v) ? null : (neg ? -v : v);
}
const pad2_ = n => String(n).padStart(2, '0');
const keyOf_ = d => d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
const dOf_ = k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)));
const addDays_ = (k, n) => { const d = dOf_(k); d.setUTCDate(d.getUTCDate() + n); return keyOf_(d); };
const daysBetween_ = (a, b) => Math.round((dOf_(b) - dOf_(a)) / 864e5);
const daysInMonth_ = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const todayKey_ = () => Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
const lastYear_ = k => (+k.slice(0, 4) - 1) + k.slice(4);
function parseDay_(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s > 20000 && s < 80000 ? keyOf_(new Date(Math.round((Math.floor(s) - 25569) * 864e5))) : null;
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return null;
}
/** Horodatage HA (« 23/10/2026 22:14 », heure de la maison) → instant. */
function parseStamp_(s) {
  if (s == null || s === '') return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})/);
  if (m) return Utilities.parseDate(m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]) + ' ' + pad2_(m[4]) + ':' + m[5], TZ, 'yyyy-MM-dd HH:mm');
  const m2 = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (m2) return Utilities.parseDate(m2[1] + '-' + m2[2] + '-' + m2[3] + ' ' + pad2_(m2[4]) + ':' + m2[5], TZ, 'yyyy-MM-dd HH:mm');
  return null;
}
/* Saisons du 12/07 au 11/07, un onglet « AAAA-AAAA » par saison */
function seasonOf_(k) { const y = +k.slice(0, 4); const s = k.slice(5) >= '07-12' ? y : y - 1; return s + '-' + (s + 1); }
const seasonStart_ = name => name.slice(0, 4) + '-07-12';
const prevSeason_ = name => { const s = +name.slice(0, 4) - 1; return s + '-' + (s + 1); };

const TAR = ['HCJB', 'HPJB', 'HCJW', 'HPJW', 'HCJR', 'HPJR'];
const COLOR_OF = { B: 'Bleu', W: 'Blanc', R: 'Rouge' };
const DEVICES = [
  ['PAC_kWh', 'Pompe à chaleur'], ['Ballon_kWh', 'Ballon eau chaude'], ['Deshumidificateur_kWh', 'Déshumidificateur'],
  ['Pompe_piscine_kWh', 'Pompe piscine'], ['Volet_piscine_kWh', 'Volet piscine'], ['Lit_chauffant_kWh', 'Lit chauffant'],
  ['Ventilateur_garage_kWh', 'Ventilateur garage'], ['Compresseur_kWh', 'Compresseur'], ['Imprimante_3D_kWh', 'Imprimante 3D'],
  ['Aquarium_kWh', 'Aquarium'], ['Repeteur_kWh', 'Prise répéteur'], ['Jardin_devant_kWh', 'Lumière jardin devant']];
const r2_ = v => v == null || isNaN(v) ? null : Math.round(v * 100) / 100;
const r4_ = v => v == null || isNaN(v) ? null : Math.round(v * 10000) / 10000;

/** État de calcul : toutes les lectures, puis les mêmes fonctions que la première version de l'appli. */
function newState_() {
  return { today: todayKey_(), releves: [], last: null, lastVals: {}, jours: [], daily: {}, tarifs: [], seasonPrices: null,
    echT15: null, echeancier: [], factures: [], seasons: {}, saisies: [], suivi: null, errs: [] };
}
function safe_(S, label, fn) { try { fn(); } catch (e) { S.errs.push(label + ' : ' + e.message); } }

function readHA_(S) {
  const ss = SpreadsheetApp.openById(HA_ID);
  safe_(S, 'Releves', () => {
    const sh = ss.getSheetByName('Releves'), last = sh.getLastRow(), nc = sh.getLastColumn();
    if (last < 2) return;
    const n = Math.min(last - 1, 210); // ~52 h de relevés (un toutes les 15 min) : aujourd'hui et hier en entier
    const head = sh.getRange(1, 1, 1, nc).getDisplayValues()[0];
    parseReleves_(S, [head].concat(cells_(sh.getRange(last - n + 1, 1, n, nc))));
  });
  safe_(S, 'Tarifs', () => parseTarifs_(S, cells_(ss.getSheetByName('Tarifs').getDataRange())));
  safe_(S, 'Jours', () => parseJours_(S, cells_(ss.getSheetByName('Jours').getDataRange())));
  safe_(S, 'Saisies', () => { S.saisies = tableFromRows_(cells_(ss.getSheetByName('Saisies').getDataRange())).filter(s => s.Date || s.Type); });
  safe_(S, 'Echeancier', () => {
    S.echeancier = tableFromRows_(cells_(ss.getSheetByName('Echeancier').getDataRange()))
      .map(o => ({ from: parseDay_(o['Date début']), eur: num_(o['Montant mensuel (€)']), type: String(o.Type || ''), rem: String(o.Remarque || '') }))
      .filter(e => e.from && e.eur != null).sort((a, b) => a.from < b.from ? -1 : 1);
  });
  safe_(S, 'Factures', () => { S.factures = factures_(cells_(ss.getSheetByName('Factures').getDataRange())); });
}
function readSeason_(S, ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) return;
  parseSeason_(S, name, cells_(sh.getRange('B3:R400')));
}
function readEL_(S, withHist) {
  const ss = SpreadsheetApp.openById(EL_ID);
  const cur = seasonOf_(addDays_(S.today, -1)), prev = prevSeason_(cur);
  safe_(S, 'prix ' + cur, () => { const sh = ss.getSheetByName(cur); if (sh) parseSeasonPrices_(S, cells_(sh.getRange('S8:T20'))); });
  safe_(S, cur, () => readSeason_(S, ss, cur));
  safe_(S, prev, () => readSeason_(S, ss, prev));
  if (withHist) {
    const p2 = prevSeason_(prev);
    safe_(S, p2, () => readSeason_(S, ss, p2));
    safe_(S, 'Suivi mensuel', () => { const sh = ss.getSheetByName('Suivi mensuel'); S.suivi = sh ? cells_(sh.getRange('A4:G800')).filter(r => r[0]) : []; });
  }
  return cur;
}

function parseReleves_(S, rows) {
  const recs = tableFromRows_(rows).map(o => Object.assign(o, { t: parseStamp_(o.Horodatage) })).filter(o => o.t);
  recs.sort((a, b) => a.t - b.t);
  S.releves = recs;
  S.last = recs[recs.length - 1] || null;
  const lv = {};
  for (let i = recs.length - 1; i >= 0; i--) {
    Object.keys(recs[i]).forEach(k => { const v = recs[i][k]; if (!(k in lv) && v !== '' && k !== 't') lv[k] = v; });
  }
  S.lastVals = lv;
}
function priceAt_(S, k) {
  let best = null;
  S.tarifs.forEach(t => { if (t.from <= k) best = t.p; });
  return best || S.seasonPrices;
}
function aboAt_(S, k) {
  let best = null;
  S.tarifs.forEach(t => { if (t.from <= k && t.abo != null) best = t.abo; });
  return best;
}
function parseTarifs_(S, rows) {
  S.tarifs = tableFromRows_(rows).map(o => {
    const p = {}; TAR.forEach(k => { p[k] = num_(o[k]); });
    return { from: parseDay_(o["Date d'effet"]), p: p, by: String(o['Saisi par'] || ''), abo: num_(o.Abonnement_mois) };
  }).filter(t => t.from && TAR.every(k => t.p[k] != null)).sort((a, b) => a.from < b.from ? -1 : 1);
}
/* Jours : index à minuit ; conso J = ligne J − ligne J−1 ; solaire et prises : index − max précédent */
function parseJours_(S, rows) {
  const recs = tableFromRows_(rows).map(o => Object.assign(o, { day: parseDay_(o.Jour) })).filter(o => o.day);
  recs.sort((a, b) => a.day < b.day ? -1 : 1);
  S.jours = recs;
  const daily = {}, maxPrev = {};
  const plugs = ['Solaire_kWh'].concat(DEVICES.map(d => d[0]));
  recs.forEach((r, i) => {
    const vals = {};
    plugs.forEach(k => {
      const v = num_(r[k]);
      if (i > 0 && v != null && maxPrev[k] != null) vals[k] = Math.max(0, v - maxPrev[k]);
      if (v != null) maxPrev[k] = Math.max(maxPrev[k] == null ? -Infinity : maxPrev[k], v);
    });
    if (i === 0) return;
    const p = recs[i - 1], tar = {};
    let buy = 0, ok = true;
    TAR.forEach(k => {
      const a = num_(r[k]), b = num_(p[k]);
      if (a == null || b == null) { ok = false; return; }
      tar[k] = Math.max(0, a - b); buy += tar[k];
    });
    if (!ok) return;
    const byC = { B: tar.HCJB + tar.HPJB, W: tar.HCJW + tar.HPJW, R: tar.HCJR + tar.HPJR };
    const c = Object.keys(byC).sort((x, y) => byC[y] - byC[x])[0];
    const pr = priceAt_(S, r.day);
    const cost = pr ? TAR.reduce((s, k) => s + tar[k] * pr[k], 0) : null;
    daily[r.day] = { tar: tar, buy: buy, cost: cost, sol: vals.Solaire_kWh == null ? null : vals.Solaire_kWh, dev: vals,
      color: byC[c] > 0 ? COLOR_OF[c] : null, hc: tar.HCJB + tar.HCJW + tar.HCJR, hp: tar.HPJB + tar.HPJW + tar.HPJR };
  });
  S.daily = daily;
}
/* Onglet de saison, S8:T20 : prix (6 lignes « Prix kwh … ») et « Echéancier » (T15) */
function parseSeasonPrices_(S, rows) {
  const p = {}; let ech = null;
  rows.forEach(r => {
    const lab = String(r[0] || '').toLowerCase(), v = num_(r[1]);
    if (lab.indexOf('prix kwh') === 0) {
      const hc = lab.indexOf('creuse') >= 0 ? 'HC' : lab.indexOf('pleine') >= 0 ? 'HP' : null;
      const c = lab.indexOf('bleu') >= 0 ? 'B' : lab.indexOf('blanc') >= 0 ? 'W' : lab.indexOf('rouge') >= 0 ? 'R' : null;
      if (hc && c) p[hc + 'J' + c] = v;
    }
    if (lab.indexOf('ech') === 0 || lab.indexOf('éch') === 0) ech = v;
  });
  S.seasonPrices = TAR.every(k => p[k] != null) ? p : null;
  S.echT15 = ech;
}
/* rows = B3:R… ; ligne 0 = en-têtes (ligne 3 de l'onglet) ; I = total kWh, L = coût du jour, N = kWh Tesla, Q = solaire */
function parseSeason_(S, name, rows) {
  const head = (rows[0] || []).map(h => String(h).trim());
  const idx = h => head.indexOf(h);
  const cols = { HCJW: idx('HC Blanc'), HPJW: idx('HP Blanc'), HCJB: idx('HC Bleu'), HPJB: idx('HP Bleu'), HCJR: idx('HC Rouge'), HPJR: idx('HP Rouge') };
  const iSol = idx('Kw Solaire'), iGain = idx('Solaire gain'), iCar = idx('Montant voiture');
  const g = (r, i) => i >= 0 ? (num_(r[i]) || 0) : 0;
  const map = {};
  rows.slice(1).forEach((r, i) => {
    const k = parseDay_(r[0]); if (!k) return;
    const kwh = num_(r[7]), eur = num_(r[10]);
    const byC = { B: g(r, cols.HCJB) + g(r, cols.HPJB), W: g(r, cols.HCJW) + g(r, cols.HPJW), R: g(r, cols.HCJR) + g(r, cols.HPJR) };
    const c = Object.keys(byC).sort((x, y) => byC[y] - byC[x])[0];
    map[k] = { kwh: kwh > 0 ? kwh : null, eur: kwh > 0 ? eur : null, row: i + 4,
      sol: iSol >= 0 ? num_(r[iSol]) : null, gain: iGain >= 0 ? num_(r[iGain]) : null,
      tesla: iCar >= 0 ? num_(r[iCar]) : null, color: byC[c] > 0 ? COLOR_OF[c] : null };
  });
  S.seasons[name] = map;
}
/* Jour fusionné : fichier « Electricité » s'il est rempli, sinon calcul depuis l'onglet Jours */
function day_(S, k) {
  const s = (S.seasons[seasonOf_(k)] || {})[k], j = S.daily[k];
  const kwh = s && s.kwh != null ? s.kwh : j ? j.buy : null;
  if (kwh == null) return null;
  const fromFile = !!(s && s.kwh != null);
  const sol = j && j.sol != null ? j.sol : (s && s.sol != null ? s.sol : null);
  let gain = s && s.gain ? s.gain : null;
  if (gain == null && sol != null) {
    const p = priceAt_(S, k), c = (j && j.color) || (s && s.color) || 'Bleu';
    if (p) gain = sol * p[{ Bleu: 'HPJB', Blanc: 'HPJW', Rouge: 'HPJR' }[c]];
  }
  return { k: k, kwh: kwh, eur: fromFile ? s.eur : (j ? j.cost : null), sol: sol, gain: gain, fromFile: fromFile,
    color: (j && j.color) || (s && s.color) || null, hc: j ? j.hc : null, hp: j ? j.hp : null, tesla: s ? s.tesla : null, dev: j ? j.dev : null };
}
function sumDays_(S, from, to) {
  let kwh = 0, eur = 0, sol = 0, n = 0, missing = 0;
  for (let k = from; k <= to; k = addDays_(k, 1)) {
    const d = day_(S, k);
    if (!d) { missing++; continue; }
    n++; kwh += d.kwh; eur += d.eur || 0; sol += d.sol || 0;
  }
  return { kwh: r2_(kwh), eur: r2_(eur), sol: r2_(sol), n: n, missing: missing };
}
/** Échéancier en vigueur à une date : onglet Echeancier (historique), sinon T15 de l'onglet de saison. */
function echeancierAt_(S, k) {
  let best = null;
  S.echeancier.forEach(e => { if (e.from <= k && /ch[ée]ancier|r[ée]vision/i.test(e.type)) best = e; });
  return best ? { eur: best.eur, from: best.from, type: best.type } : (S.echT15 != null ? { eur: S.echT15, from: null, type: 'onglet de saison' } : null);
}

/* ====================================================================================
 * Écran principal (action « data »)
 * ==================================================================================== */
function getData_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) { const c = cache.get('data'); if (c) return JSON.parse(c); }
  const S = newState_();
  readHA_(S);
  const cur = readEL_(S, false);
  const out = {
    at: Date.now(), today: S.today,
    now: nowBlock_(S), curve: S.releves.slice(-110).map(r => [Math.round(r.t.getTime() / 60000), num_(r.Reseau_VA) || 0, num_(r.Solaire_W) || 0]),
    sol: sol_(S), poele: poele_(S), yest: yesterday_(S), month: month_(S), reg: reg_(S), abo: aboAt_(S, S.today),
    echeancier: S.echeancier.map(e => ({ from: e.from, eur: e.eur, type: e.type, rem: e.rem })), factures: S.factures, cmp: compare_(S), pel: pellets_(S),
    tarifs: S.tarifs.map(t => ({ from: t.from, p: TAR.map(k => t.p[k]), by: t.by, abo: t.abo })),
    tarifNow: (S.tarifs.filter(t => t.from <= S.today).pop() || {}).from || null,
    seasonPrices: S.seasonPrices ? TAR.map(k => S.seasonPrices[k]) : null,
    saisies: S.saisies.slice(-8).reverse().map(s => ({ d: parseDay_(s.Date) || String(s.Date), type: String(s.Type || ''), val: s.Valeur, prix: s.Prix, det: String(s['Détail'] || ''), by: String(s['Saisi par'] || '') })),
    state: stateLine_(S, cur), errs: S.errs
  };
  try { cache.put('data', JSON.stringify(out), CACHE_S); } catch (_) {}
  return out;
}
function stateLine_(S, cur) {
  let filled = null;
  Object.keys(S.seasons[cur] || {}).forEach(k => { if (S.seasons[cur][k].kwh != null && (!filled || k > filled)) filled = k; });
  return { filled: filled, joursTo: S.jours.length ? S.jours[S.jours.length - 1].day : null, nRel: S.releves.length };
}
function nowBlock_(S) {
  const L = S.last;
  if (!L) return null;
  const sol = num_(L.Solaire_W) || 0, grid = num_(L.Reseau_VA) || 0;
  const out = { t: L.t.getTime(), sol: sol, grid: grid, cons: grid + sol, tempo: String(L.Tempo_jour || ''), since: null };
  // Aujourd'hui depuis minuit : dernier relevé moins l'index de fin de veille (onglet Jours)
  const base = S.jours[S.jours.length - 1];
  if (base) {
    const tar = {};
    let buy = 0, ok = true;
    TAR.forEach(k => { const a = num_(S.lastVals[k]), b = num_(base[k]); if (a == null || b == null) ok = false; else { tar[k] = Math.max(0, a - b); buy += tar[k]; } });
    const sA = num_(S.lastVals.Solaire_kWh), sB = num_(base.Solaire_kWh);
    const lDay = Utilities.formatDate(L.t, TZ, 'yyyy-MM-dd'), from = addDays_(base.day, 1);
    if (ok) {
      const midnight = from === lDay, sol = sA != null && sB != null ? Math.max(0, sA - sB) : null;
      // Coût : kWh de chaque registre Tempo × son prix (onglet Tarifs, sinon prix de l'onglet de saison)
      const pr = priceAt_(S, lDay), eur = pr ? TAR.reduce((s, k) => s + tar[k] * pr[k], 0) : null;
      const byC = { B: tar.HCJB + tar.HPJB, W: tar.HCJW + tar.HPJW, R: tar.HCJR + tar.HPJR };
      const c = Object.keys(byC).sort((x, y) => byC[y] - byC[x])[0];
      const color = (midnight && tempoName_(L.Tempo_jour)) || (byC[c] > 0 ? COLOR_OF[c] : tempoName_(L.Tempo_jour));
      const gain = sol != null && pr && color ? sol * pr[{ Bleu: 'HPJB', Blanc: 'HPJW', Rouge: 'HPJR' }[color]] : null;
      out.since = { from: from, midnight: midnight, buy: r2_(buy), sol: r2_(sol), eur: r2_(eur), gain: r2_(gain), color: color,
        hc: r2_(tar.HCJB + tar.HCJW + tar.HCJR), hp: r2_(tar.HPJB + tar.HPJW + tar.HPJR) };
    }
  }
  return out;
}
/* Poêle (Edilkamin) : plages de marche d'après les relevés de 15 min (Poele_phase On/Ignition = en marche) */
function poele_(S) {
  if (!S.releves.some(r => r.Poele_phase !== undefined && r.Poele_phase !== '')) return null;
  const on = r => /^(on|ignition)$/i.test(String(r.Poele_phase || '').trim());
  const day = (k, isToday) => {
    const rs = S.releves.filter(r => r.Poele_phase !== undefined && r.Poele_phase !== '' && Utilities.formatDate(r.t, TZ, 'yyyy-MM-dd') === k);
    const ranges = []; let st = null;
    rs.forEach(r => {
      const m = +Utilities.formatDate(r.t, TZ, 'H') * 60 + +Utilities.formatDate(r.t, TZ, 'm');
      if (on(r)) { if (st === null) st = m; } else if (st !== null) { ranges.push([st, m]); st = null; }
    });
    if (st !== null) ranges.push([st, isToday ? null : 1440]);
    let h = null;
    if (isToday) { for (let i = rs.length - 1; i >= 0; i--) { const v = num_(rs[i].Poele_h_jour); if (v != null) { h = v; break; } } }
    else {
      const j = S.jours.filter(o => o.day === k)[0], v = j ? num_(j.Poele_heures) : null;
      if (v != null) h = v;
      else { const vs = rs.map(r => num_(r.Poele_h_jour)).filter(x => x != null); if (vs.length) h = Math.max.apply(null, vs); else if (rs.length) h = ranges.reduce((a, g) => a + (g[1] - g[0]) / 60, 0); }
    }
    return { k: k, h: h == null ? null : r2_(h), r: ranges, n: rs.length };
  };
  return { today: day(S.today, true), yest: day(addDays_(S.today, -1), false) };
}
/* Onglet Solaire : production et gain par jour depuis l'installation, prévision de demain et météo (colonnes des Releves repérées par leur en-tête) */
function sol_(S) {
  const end = addDays_(S.today, -1), days = [];
  for (let k = '2026-08-31'; k <= end; k = addDays_(k, 1)) { const d = day_(S, k); if (d && d.sol != null) days.push([k, r2_(d.sol), r2_(d.gain), d.color]); }
  const L = S.last, out = { days: days, tom: null, meteo: null };
  if (L) {
    const lastOf = h => { for (let i = S.releves.length - 1; i >= 0; i--) { const v = S.releves[i][h]; if (v !== undefined && v !== '' && v !== null) return { t: S.releves[i].t, v: v }; } return null; };
    const f = lastOf('Solaire_prevu_demain_kWh'), kwh = f ? num_(f.v) : null;
    if (kwh != null && L.t - f.t < 36 * 3600000) {
      const tk = addDays_(Utilities.formatDate(f.t, TZ, 'yyyy-MM-dd'), 1), p = priceAt_(S, tk), tc = lastOf('Tempo_demain'), c = tc ? tempoName_(tc.v) : null;
      out.tom = { k: tk, kwh: r2_(kwh), c: c, p: p ? r2_(p[{ Bleu: 'HPJB', Blanc: 'HPJW', Rouge: 'HPJR' }[c || 'Bleu']]) : null };
    }
    const m = lastOf('Meteo');
    if (m && String(m.v).trim()) out.meteo = { v: String(m.v).trim().toLowerCase(), k: Utilities.formatDate(m.t, TZ, 'yyyy-MM-dd') };
  }
  return out;
}
function tempoName_(s) {
  s = String(s || '').toLowerCase();
  return s.indexOf('bleu') >= 0 || s === 'blue' ? 'Bleu' : s.indexOf('blanc') >= 0 || s === 'white' ? 'Blanc' : s.indexOf('rouge') >= 0 || s === 'red' ? 'Rouge' : null;
}
function yesterday_(S) {
  let k = addDays_(S.today, -1), d = day_(S, k), back = 0;
  while (!d && back < 7) { k = addDays_(k, -1); d = day_(S, k); back++; }
  if (!d) return null;
  return { k: d.k, back: back, kwh: r2_(d.kwh), eur: r2_(d.eur), sol: r2_(d.sol), gain: r2_(d.gain), fromFile: d.fromFile,
    color: d.color, hc: r2_(d.hc), hp: r2_(d.hp), tesla: d.tesla };
}
function month_(S) {
  const y = addDays_(S.today, -1), first = S.today.slice(0, 8) + '01';
  const Y = +S.today.slice(0, 4), M = +S.today.slice(5, 7), dim = daysInMonth_(Y, M);
  const ech = echeancierAt_(S, S.today), abo = aboAt_(S, S.today);
  if (y < first) return { Y: Y, M: M, empty: true, ech: ech };
  const m = sumDays_(S, first, y);
  const proj = m.n ? m.eur / m.n * dim + (abo || 0) : null, projK = m.n ? m.kwh / m.n * dim : null;
  return { Y: Y, M: M, to: +y.slice(8), kwh: m.kwh, eur: m.eur, sol: m.sol, n: m.n, missing: m.missing,
    proj: r2_(proj), projK: r2_(projK), abo: abo, aboPro: r2_((abo || 0) * (+y.slice(8)) / dim), ech: ech };
}
/** Onglet Factures : une ligne par facture annuelle (période 11/07 → 11/07). */
function factures_(rows) {
  return tableFromRows_(rows).map(o => ({
    date: parseDay_(o['Date facture']), no: String(o['N° facture'] || ''), offre: String(o.Offre || ''), kva: num_(o['Puissance (kVA)']),
    from: parseDay_(o['Début période']), to: parseDay_(o['Fin période']), kwh: num_(o['kWh total']), hp: num_(o['kWh HP']), hc: num_(o['kWh HC']),
    aboHT: num_(o['Abonnement HT (€)']), enHT: num_(o['Énergie HT (€)']), ht: num_(o['Total HT (€)']), tax: num_(o['Taxes + TVA (€)']),
    ttc: num_(o['Total TTC (€)']), paid: num_(o['Mensualités payées (€)']), solde: num_(o['Solde à payer (€)']),
    next: num_(o['Prochaine mensualité (€)']), nb: num_(o['Nb mensualités']), start: parseDay_(o['Début échéancier']), rem: String(o.Remarque || '')
  })).filter(f => f.date || f.from).sort((a, b) => (a.from || '') < (b.from || '') ? -1 : 1);
}
/** Estimation de la régularisation de fin d'année (11/07) : coût projeté + abonnement − mensualités prévues (octobre → juillet). */
function reg_(S) {
  const y = addDays_(S.today, -1), name = seasonOf_(y), ss = seasonStart_(name);
  if (y < ss) return null;
  const Y0 = +ss.slice(0, 4), end = (Y0 + 1) + '-07-11', days = daysBetween_(ss, end) + 1;
  const m = sumDays_(S, ss, y);
  if (!m.n) return null;
  const abo = aboAt_(S, S.today) || 0;
  let plan = 0, nb = 0;
  for (let i = 0; i < 10; i++) {
    const mo = 10 + i, e = echeancierAt_(S, (mo > 12 ? Y0 + 1 : Y0) + '-' + pad2_(mo > 12 ? mo - 12 : mo) + '-05');
    if (e) { plan += e.eur; nb++; }
  }
  if (!nb) return null;
  // Saisonnalité : rapport « année complète / même période » de la saison précédente, sinon rythme linéaire.
  let factor = days / m.n, method = 'linéaire';
  const ps = prevSeason_(name), pss = seasonStart_(ps), pend = (Y0) + '-07-11';
  const pPart = sumDays_(S, pss, lastYear_(y)), pAll = sumDays_(S, pss, pend), pDays = daysBetween_(pss, pend) + 1;
  if (pPart.eur > 0 && pAll.n >= pDays * 0.95 && pPart.n >= (daysBetween_(pss, lastYear_(y)) + 1) * 0.9) { factor = pAll.eur / pPart.eur; method = 'saison'; }
  const proj = m.eur * factor + abo * 12;
  return { from: ss, to: end, n: m.n, missing: m.missing, eurTo: m.eur, aboYear: r2_(abo * 12), proj: r2_(proj), plan: r2_(plan), nb: nb, est: r2_(proj - plan), method: method };
}
function compare_(S) {
  const y = addDays_(S.today, -1), first = S.today.slice(0, 8) + '01', out = [];
  if (y >= first) out.push({ label: 'Mois à date (1er–' + (+y.slice(8)) + ')', cur: sumDays_(S, first, y), prev: sumDays_(S, lastYear_(first), lastYear_(y)) });
  const ss = seasonStart_(seasonOf_(y));
  out.push({ label: 'Saison à date (depuis le 12/07)', cur: sumDays_(S, ss, y), prev: sumDays_(S, lastYear_(ss), lastYear_(y)) });
  return out;
}
function pellets_(S) {
  const sacs = num_(S.lastVals.Sacs_granules), prix = num_(S.lastVals.Prix_sac);
  const ss = seasonStart_(seasonOf_(S.today));
  const achats = S.saisies.filter(s => /achat/i.test(String(s.Type || '')) && (parseDay_(s.Date) || '') >= ss);
  return { sacs: sacs, prix: prix, nAch: achats.reduce((t, s) => t + (num_(s.Valeur) || 0), 0),
    eAch: r2_(achats.reduce((t, s) => t + (num_(s.Valeur) || 0) * (num_(s.Prix) || 0), 0)), lines: achats.length };
}

/* ====================================================================================
 * Historique (action « hist ») : 30 jours, 12 mois, saisons, appareils
 * ==================================================================================== */
function getHist_(force) {
  if (!force) { const c = snapGet_('hist'); if (c) { ensurePrecalc_(); return c; } }
  const t0 = Date.now();
  const S = newState_();
  readHA_(S);
  readEL_(S, true);
  const out = { at: Date.now(), today: S.today, days: days30_(S), months: months12_(S), seasons: seasons_(S), dev: devices_(S), errs: S.errs };
  out.ms = { total: Date.now() - t0 };
  snapPut_('hist', out);
  ensurePrecalc_();
  return out;
}
function days30_(S) {
  const end = addDays_(S.today, -1), out = [], ph = {};
  S.jours.forEach(j => { const v = num_(j.Poele_heures); if (v != null) ph[j.day] = r2_(v); });
  for (let i = 29; i >= 0; i--) {
    const k = addDays_(end, -i), d = day_(S, k);
    out.push(d ? { k: k, kwh: r2_(d.kwh), sol: r2_(d.sol), eur: r2_(d.eur), c: d.color, tesla: d.tesla, ph: ph[k] } : { k: k, ph: ph[k] });
  }
  return out;
}
function months12_(S) {
  const out = [], Y = +S.today.slice(0, 4), M = +S.today.slice(5, 7), yest = addDays_(S.today, -1);
  for (let i = 11; i >= 0; i--) {
    let m = M - i, y = Y; while (m < 1) { m += 12; y--; }
    const a = y + '-' + pad2_(m) + '-01', b0 = y + '-' + pad2_(m) + '-' + pad2_(daysInMonth_(y, m)), b = b0 > yest ? yest : b0;
    if (b < a) continue;
    out.push({ y: y, m: m, partial: b0 > yest, cur: sumDays_(S, a, b), prev: sumDays_(S, lastYear_(a), lastYear_(b0)) });
  }
  return out;
}
function seasons_(S) {
  const yest = addDays_(S.today, -1), cur = seasonOf_(yest), names = [cur, prevSeason_(cur), prevSeason_(prevSeason_(cur))];
  const md = yest.slice(4);
  return names.filter(n => S.seasons[n]).map(n => {
    const start = seasonStart_(n), y0 = +n.slice(0, 4);
    const sameDay = (md >= '-07-12' ? y0 : y0 + 1) + md;
    const toDate = sumDays_(S, start, sameDay <= yest ? sameDay : yest);
    const full = n === cur ? null : sumDays_(S, start, (y0 + 1) + '-07-11');
    return { n: n, toDate: toDate, full: full };
  });
}
function devices_(S) {
  const out = { ha: null, suivi: [] };
  const first = S.today.slice(0, 8) + '01', y = addDays_(S.today, -1);
  if (y >= first) {
    const m = sumDays_(S, first, y), avg = m.kwh ? m.eur / m.kwh : 0;
    const dev = {}; let tesla = 0;
    for (let k = first; k <= y; k = addDays_(k, 1)) {
      const d = day_(S, k); if (!d) continue;
      tesla += d.tesla || 0;
      if (d.dev) DEVICES.forEach(dd => { if (d.dev[dd[0]] != null) dev[dd[0]] = (dev[dd[0]] || 0) + d.dev[dd[0]]; });
    }
    const total = m.kwh + m.sol;
    let known = tesla;
    let list = DEVICES.filter(dd => dev[dd[0]] != null).map(dd => { known += dev[dd[0]]; return { name: dd[1], kwh: dev[dd[0]], eur: dev[dd[0]] * avg, key: dd[0] }; });
    if (tesla) list.push({ name: 'Tesla (recharge)', kwh: tesla, eur: tesla * avg, key: 'tesla' });
    list.sort((a, b) => b.kwh - a.kwh);
    list.push({ name: 'Non identifié', kwh: Math.max(0, total - known), eur: Math.max(0, total - known) * avg });
    list.forEach(l => { l.share = total ? l.kwh / total : 0; });
    list.unshift({ name: 'Conso maison (réseau + solaire)', kwh: total, eur: m.eur, tot: true, sub: 'dont ' + Math.round(m.sol) + ' kWh de solaire' });
    out.ha = { label: MOIS[+S.today.slice(5, 7) - 1] + ' ' + S.today.slice(0, 4) + ' (en cours, Home Assistant)', to: +y.slice(8), avg: r4_(avg), list: list.map(roundLine_) };
  }
  if (S.suivi) {
    const names = [];
    S.suivi.forEach(r => { const n = String(r[0]); if (names.indexOf(n) < 0) names.push(n); });
    out.suivi = names.reverse().map(name => {
      const rows = S.suivi.filter(r => String(r[0]) === name), list = [];
      const tot = rows.find(r => /achetée au réseau/i.test(r[2] || ''));
      const sol = rows.find(r => /production solaire/i.test(r[2] || ''));
      const totalK = (num_(tot && tot[3]) || 0) + (num_(sol && sol[3]) || 0);
      if (tot) list.push({ name: 'Électricité achetée au réseau', kwh: num_(tot[3]), eur: num_(tot[4]), tot: true });
      if (sol && num_(sol[3]) != null) list.push({ name: 'Production solaire', kwh: num_(sol[3]), eur: num_(sol[4]), sub: 'valeur au tarif du moment', key: 'Solaire_kWh' });
      rows.filter(r => r !== tot && r !== sol && !/^Total/i.test(r[1] || '') && num_(r[3]) != null)
        .map(r => ({ name: String(r[2]), kwh: num_(r[3]), eur: num_(r[4]), share: totalK ? num_(r[3]) / totalK : 0, key: devKeyOf_(r[2]) }))
        .sort((a, b) => b.kwh - a.kwh).forEach(l => list.push(l));
      const gran = rows.find(r => /granulés/i.test(r[2] || ''));
      const totE = rows.find(r => /^Total dépensé/i.test(r[2] || ''));
      if (gran && num_(gran[4]) != null) list.push({ name: String(gran[2]), kwh: null, eur: num_(gran[4]) });
      if (totE) list.push({ name: 'Total dépensé (électricité + granulés)', kwh: null, eur: num_(totE[4]), tot: true });
      return { name: name, list: list.map(roundLine_) };
    });
  }
  return out;
}
function roundLine_(l) { return { name: l.name, kwh: r2_(l.kwh), eur: r2_(l.eur), share: l.share == null ? null : r4_(l.share), tot: !!l.tot, sub: l.sub || null, key: l.key || null }; }
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/* ====================================================================================
 * Détail par appareil (action « dev », lecture) : kWh par jour sur 60 jours (onglet Jours)
 * et par mois (« Suivi mensuel », puis mois suivants calculés depuis Jours).
 * ==================================================================================== */
const DEV_MATCH = [['PAC_kWh', /pompe à chaleur/i], ['Ballon_kWh', /ballon/i], ['Deshumidificateur_kWh', /déshumid/i],
  ['Pompe_piscine_kWh', /pompe piscine/i], ['Volet_piscine_kWh', /volet/i], ['Lit_chauffant_kWh', /lit chauffant/i],
  ['Ventilateur_garage_kWh', /ventilateur/i], ['Compresseur_kWh', /compresseur/i], ['Imprimante_3D_kWh', /imprimante/i],
  ['Aquarium_kWh', /aquarium/i], ['Repeteur_kWh', /r[ée]p[ée]teur/i], ['Jardin_devant_kWh', /jardin/i],
  ['tesla', /tesla/i], ['Solaire_kWh', /production solaire/i]];
function devKeyOf_(name) { const m = DEV_MATCH.find(x => x[1].test(String(name || ''))); return m ? m[0] : null; }
const DEV_KEYS = DEV_MATCH.map(x => x[0]);

/* Lecture rapide pour « dev » : valeurs brutes seulement (pas de getDisplayValues, qui force la mise en forme),
 * plages bornées aux lignes utiles, et seulement les onglets nécessaires (Tarifs, Jours, saison(s), Suivi mensuel). */
function fastVals_(range, tz) {
  return range.getValues().map(r => r.map(x => x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : x));
}
function readForDev_(S) {
  let t = Date.now();
  const ha = SpreadsheetApp.openById(HA_ID), tzH = ha.getSpreadsheetTimeZone();
  safe_(S, 'Tarifs', () => parseTarifs_(S, fastVals_(ha.getSheetByName('Tarifs').getDataRange(), tzH)));
  safe_(S, 'Jours', () => parseJours_(S, fastVals_(ha.getSheetByName('Jours').getDataRange(), tzH)));
  S.ms.ha = Date.now() - t; t = Date.now();
  const el = SpreadsheetApp.openById(EL_ID), tzE = el.getSpreadsheetTimeZone();
  const end = addDays_(S.today, -1), cur = seasonOf_(end), first = addDays_(end, -59);
  const readS = name => {
    const sh = el.getSheetByName(name); if (!sh) return;
    const last = name === cur ? end : (+name.slice(0, 4) + 1) + '-07-11';
    const n = Math.min(398, daysBetween_(seasonStart_(name), last) + 4); // ligne 3 = en-têtes, ligne 4 = 12/07
    parseSeason_(S, name, fastVals_(sh.getRange(3, 2, n, 17), tzE));
  };
  safe_(S, 'prix ' + cur, () => { const sh = el.getSheetByName(cur); if (sh) parseSeasonPrices_(S, fastVals_(sh.getRange('S8:T20'), tzE)); });
  safe_(S, cur, () => readS(cur));
  if (first < seasonStart_(cur)) safe_(S, prevSeason_(cur), () => readS(prevSeason_(cur)));
  safe_(S, 'Suivi mensuel', () => {
    const sh = el.getSheetByName('Suivi mensuel'), last = sh ? sh.getLastRow() : 0;
    S.suivi = last >= 4 ? fastVals_(sh.getRange(4, 1, last - 3, 7), tzE).filter(r => r[0]) : [];
  });
  S.ms.el = Date.now() - t;
}

/* ---------- Instantanés précalculés (dev, hist) : cache 6 h découpé + copie durable dans les propriétés ---------- */
const SNAP_TTL = 21600, SNAP_MAX_AGE = 2 * 3600e3;
function snapPut_(name, obj) {
  const s = JSON.stringify(obj);
  try {
    const m = {}, size = 40000; let n = 0;
    for (let i = 0; i < s.length; i += size) m['snap_' + name + '_' + (n++)] = s.slice(i, i + size);
    m['snap_' + name] = String(n);
    CacheService.getScriptCache().putAll(m, SNAP_TTL);
  } catch (_) {}
  try { // repli durable (8 Ko par propriété) si le cache a expiré ou a été vidé
    const size = 4000, n = Math.ceil(s.length / size);
    if (n <= 40) {
      const ps = {}; for (let i = 0; i < n; i++) ps['SNAP_' + name + '_' + i] = s.slice(i * size, (i + 1) * size);
      ps['SNAP_' + name] = String(n);
      PropertiesService.getScriptProperties().setProperties(ps, false); // false : les autres propriétés (clés) sont gardées
    }
  } catch (_) {}
}
function snapGet_(name) {
  const ok = o => o && o.today === todayKey_() && Date.now() - (o.at || 0) < SNAP_MAX_AGE;
  try {
    const cache = CacheService.getScriptCache(), n = +cache.get('snap_' + name);
    if (n > 0) {
      const keys = []; for (let i = 0; i < n; i++) keys.push('snap_' + name + '_' + i);
      const got = cache.getAll(keys);
      if (keys.every(k => got[k] != null)) { const o = JSON.parse(keys.map(k => got[k]).join('')); if (ok(o)) return o; }
    }
  } catch (_) {}
  try {
    const all = PropertiesService.getScriptProperties().getProperties(), n = +all['SNAP_' + name];
    if (n > 0) {
      const parts = []; for (let i = 0; i < n; i++) parts.push(all['SNAP_' + name + '_' + i]);
      if (parts.every(p => p != null)) { const o = JSON.parse(parts.join('')); if (ok(o)) return o; }
    }
  } catch (_) {}
  return null;
}
function snapClear_() {
  try { CacheService.getScriptCache().removeAll(['snap_dev', 'snap_hist']); } catch (_) {}
  try { const p = PropertiesService.getScriptProperties(); p.deleteProperty('SNAP_dev'); p.deleteProperty('SNAP_hist'); } catch (_) {}
}
/** Déclencheur toutes les 30 min : recalcule hist et dev pour que l'appli les reçoive tout de suite. */
function precalcul() {
  getHist_(true);
  getDev_(true);
}
/** À lancer depuis l'éditeur si besoin ; sinon créé automatiquement au premier appel de l'appli. */
function installerPrecalcul() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'precalcul').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('precalcul').timeBased().everyMinutes(30).create();
  PropertiesService.getScriptProperties().setProperty('PRECALC_ON', '2');
}
function ensurePrecalc_() {
  try {
    const p = PropertiesService.getScriptProperties();
    if (p.getProperty('PRECALC_ON') === '2') return;
    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'precalcul')) ScriptApp.newTrigger('precalcul').timeBased().everyMinutes(30).create();
    p.setProperty('PRECALC_ON', '2');
  } catch (_) {}
}

function getDev_(force) {
  if (!force) { const c = snapGet_('dev'); if (c) { ensurePrecalc_(); return c; } }
  const t0 = Date.now();
  const S = newState_();
  S.ms = {};
  readForDev_(S);
  const t1 = Date.now();
  const names = { tesla: 'Tesla (recharge)', Solaire_kWh: 'Production solaire' };
  DEVICES.forEach(d => { names[d[0]] = d[1]; });
  // Valeur d'un appareil un jour donné : [kWh, € estimés au prix moyen payé ce jour-là]
  const valOf = (key, k) => {
    const d = day_(S, k), j = S.daily[k];
    const avg = d && d.kwh > 0 && d.eur != null ? d.eur / d.kwh : null;
    let v = null, e = null;
    if (key === 'Solaire_kWh') { v = d ? d.sol : null; e = d ? d.gain : null; }
    else if (key === 'tesla') { v = d ? d.tesla : null; e = v != null && avg != null ? v * avg : null; }
    else { v = j && j.dev ? j.dev[key] : null; if (v === undefined) v = null; e = v != null && avg != null ? v * avg : null; }
    return [v, e];
  };
  const end = addDays_(S.today, -1), days = [], colors = [], series = {};
  DEV_KEYS.forEach(key => { series[key] = { name: names[key], k: [], e: [] }; });
  for (let i = 59; i >= 0; i--) {
    const k = addDays_(end, -i), d = day_(S, k);
    days.push(k); colors.push(d ? d.color : null);
    DEV_KEYS.forEach(key => { const v = valOf(key, k); series[key].k.push(r2_(v[0])); series[key].e.push(r2_(v[1])); });
  }
  // Mois : « Suivi mensuel » (chiffres du fichier), puis les mois qu'il n'a pas encore, calculés jour par jour
  const months = [], seen = {};
  (S.suivi || []).forEach(r => {
    const a0 = String(r[0]).trim().toLowerCase(), m = a0.match(/^([a-zéû]+)\s+(\d{4})$/), d = a0.match(/^(\d{4})-(\d{2})/);
    if (!d && (!m || MOIS.indexOf(m[1]) < 0)) return;
    const id = d ? d[1] + '-' + d[2] : m[2] + '-' + pad2_(MOIS.indexOf(m[1]) + 1);
    if (!seen[id]) { seen[id] = { id: id, est: false, partial: false, v: {} }; months.push(seen[id]); }
    const key = devKeyOf_(r[2]);
    if (key && num_(r[3]) != null) seen[id].v[key] = [r2_(num_(r[3])), r2_(num_(r[4]))];
  });
  const firstJ = S.jours.length > 1 ? S.jours[1].day : null;
  if (firstJ && firstJ <= end) {
    for (let id = firstJ.slice(0, 7); id <= end.slice(0, 7); id = addDays_(id + '-01', 32).slice(0, 7)) {
      if (seen[id]) continue;
      const y = +id.slice(0, 4), mo = +id.slice(5, 7), a = id + '-01', b0 = id + '-' + pad2_(daysInMonth_(y, mo)), b = b0 > end ? end : b0;
      const o = { id: id, est: true, partial: b0 > end, to: +b.slice(8), v: {} };
      DEV_KEYS.forEach(key => {
        let kwh = 0, eur = 0, n = 0, ne = 0;
        for (let k = a; k <= b; k = addDays_(k, 1)) { const v = valOf(key, k); if (v[0] != null) { kwh += v[0]; n++; } if (v[1] != null) { eur += v[1]; ne++; } }
        if (n) o.v[key] = [r2_(kwh), ne ? r2_(eur) : null];
      });
      seen[id] = o; months.push(o);
    }
  }
  months.sort((x, y) => x.id < y.id ? -1 : 1);
  const t2 = Date.now();
  const out = { at: Date.now(), today: S.today, days: days, c: colors, s: series, months: months, errs: S.errs,
    ms: { ha: S.ms.ha, el: S.ms.el, calc: t2 - t1, total: t2 - t0 } };
  snapPut_('dev', out);
  ensurePrecalc_();
  return out;
}

/* ====================================================================================
 * Écritures (Adrien seulement, refusées pour la clé lecture dans api_)
 * ==================================================================================== */
function dayArg_(s) {
  const m = typeof s === 'string' && s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Date invalide.');
  return s;
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Une autre saisie est en cours, réessaie dans un instant.');
  try { return fn(); } finally { lock.releaseLock(); }
}
function clearCache_() { try { CacheService.getScriptCache().removeAll(['data', 'hist', 'dev']); } catch (_) {} snapClear_(); }

/** Recharge Tesla : seule écriture dans « Electricité » = colonne N (kWh voiture) de la ligne du jour.
 *  p = { date: 'AAAA-MM-JJ', kwh: 21, confirm: false, expect: 0 }. Si des kWh sont déjà notés, on demande confirmation. */
function saveTesla_(p) {
  const k = dayArg_(p && p.date), kwh = Number(p && p.kwh);
  if (k > todayKey_()) throw new Error('La date est dans le futur.');
  if (!(kwh > 0 && kwh < 300)) throw new Error('Indique un nombre de kWh entre 0 et 300.');
  return withLock_(() => {
    const tab = seasonOf_(k), sh = SpreadsheetApp.openById(EL_ID).getSheetByName(tab);
    if (!sh) throw new Error('Onglet de saison « ' + tab + ' » introuvable dans le fichier Electricité.');
    let row = 4 + daysBetween_(seasonStart_(tab), k);
    if (parseDay_(sh.getRange(row, 2).getDisplayValue()) !== k) {
      const all = sh.getRange('B4:B400').getDisplayValues();
      const i = all.findIndex(x => parseDay_(x[0]) === k);
      if (i < 0) throw new Error('Le ' + k.slice(8) + '/' + k.slice(5, 7) + ' est introuvable dans l\'onglet « ' + tab + ' » (colonne B).');
      row = 4 + i;
    }
    const cell = sh.getRange(row, 14); // colonne N
    if (cell.getFormula()) throw new Error('La cellule N' + row + ' contient une formule : rien n\'a été écrit.');
    const existing = num_(cell.getValue()) || 0;
    const total = Math.round((existing + kwh) * 100) / 100;
    if (existing > 0 && (!p.confirm || Math.abs(Number(p.expect) - existing) > 0.001)) {
      return { need: true, existing: existing, total: total, k: k };
    }
    cell.setValue(total);
    SpreadsheetApp.flush();
    const got = num_(cell.getValue());
    clearCache_();
    return { ok: got != null && Math.abs(got - total) < 0.01, existing: existing, total: total, got: got, k: k, tab: tab, row: row };
  });
}

/** Granulés : ajoute une ligne à « Saisies » (HA données). Home Assistant la reprend dans l'heure, en comptant les lignes :
 *  on ajoute toujours en bas, on ne réordonne et ne supprime jamais rien. p = { date, type, nb, prix, det } */
function saveSac_(p) {
  const k = dayArg_(p && p.date);
  const type = p && p.type === 'Achat sacs' ? 'Achat sacs' : p && p.type === 'Ouverture sacs' ? 'Ouverture sacs' : null;
  if (!type) throw new Error('Type de saisie inconnu.');
  const nb = Number(p.nb), prix = p.prix === '' || p.prix == null ? null : Number(p.prix);
  if (!(nb > 0 && nb < 500 && Math.floor(nb) === nb)) throw new Error('Indique un nombre entier de sacs.');
  if (prix != null && !(prix > 0 && prix < 100)) throw new Error('Le prix du sac semble faux.');
  const det = String(p.det || '').slice(0, 200);
  return withLock_(() => {
    const sh = SpreadsheetApp.openById(HA_ID).getSheetByName('Saisies');
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, 7).setValues([[k, type, nb, prix == null ? '' : prix, det, 'Adrien (appli)', '']]);
    sh.getRange(r, 1).setNumberFormat('yyyy-mm-dd');
    SpreadsheetApp.flush();
    clearCache_();
    return { ok: true, row: r, k: k, type: type, nb: nb };
  });
}

/** Nouveaux tarifs Tempo avec date d'effet : ajoute une ligne à « Tarifs » (HA données). Le fichier Electricité n'est pas modifié.
 *  p = { date, p: [HCJB, HPJB, HCJW, HPJW, HCJR, HPJR], abo } */
function saveTarif_(p) {
  const k = dayArg_(p && p.date);
  const v = (p && p.p || []).map(Number);
  if (v.length !== 6 || !v.every(x => x > 0.01 && x < 3)) throw new Error('Chaque prix doit être en €/kWh, entre 0,01 et 3 (ex. 0,1356).');
  const abo = p.abo === '' || p.abo == null ? null : Number(p.abo);
  if (abo != null && !(abo >= 0 && abo < 200)) throw new Error('L\'abonnement mensuel semble faux.');
  return withLock_(() => {
    const sh = SpreadsheetApp.openById(HA_ID).getSheetByName('Tarifs');
    const S = newState_(); parseTarifs_(S, cells_(sh.getDataRange()));
    if (S.tarifs.some(t => t.from === k)) throw new Error('Un tarif existe déjà à cette date : corrige-le dans l\'onglet « Tarifs » ou choisis une autre date.');
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, 9).setValues([[k].concat(v, ['Adrien (appli)', abo == null ? '' : abo])]);
    sh.getRange(r, 1).setNumberFormat('yyyy-mm-dd');
    SpreadsheetApp.flush();
    clearCache_();
    return { ok: true, row: r, k: k };
  });
}

/* ====================================================================================
 * Alerte push : si Home Assistant n'écrit plus dans Releves depuis 3 h (jeton Google expiré, panne…),
 * un « réveil » sans contenu part vers le téléphone d'Adrien, qui vient lire le message ici (action « alerte »).
 * Mécanisme repris de Crypto de poche (VAPID généré dans les propriétés du script).
 * ==================================================================================== */
const PUSH_SUB = APP_URL;
const STALE_H = 3;

/** À lancer une fois depuis l'éditeur : autorise le script et crée le contrôle horaire. */
function installer() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'verifierReleves').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verifierReleves').timeBased().everyHours(1).create();
  vapid_();
  const d = getData_(true);
  Logger.log('OK. Dernier relevé : ' + (d.now ? new Date(d.now.t) : 'aucun') + ' ; hier : ' + JSON.stringify(d.yest) + ' ; erreurs : ' + JSON.stringify(d.errs));
}

function lastReleveT_() {
  const sh = SpreadsheetApp.openById(HA_ID).getSheetByName('Releves'), last = sh.getLastRow();
  if (last < 2) return null;
  const t = parseStamp_(sh.getRange(last, 1).getDisplayValue());
  return t ? t.getTime() : null;
}
/** Déclencheur horaire. */
function verifierReleves() {
  const props = PropertiesService.getScriptProperties();
  const t = lastReleveT_(), late = !t || Date.now() - t > STALE_H * 3600e3;
  const was = props.getProperty('ALERTE');
  if (late && !was) {
    const hm = t ? Utilities.formatDate(new Date(t), TZ, 'dd/MM HH:mm') : '?';
    props.setProperty('ALERTE', JSON.stringify({ t: Date.now(), title: 'Home Assistant n\'écrit plus dans le Sheet', body: 'Dernier relevé : ' + hm + '. Vérifie l\'intégration Google Sheets dans Home Assistant (réparation à valider ?).' }));
    sendPush_();
  } else if (!late && was) {
    props.deleteProperty('ALERTE');
  }
}
function getAlerte_() {
  const a = PropertiesService.getScriptProperties().getProperty('ALERTE');
  return a ? JSON.parse(a) : { title: 'Conso de poche', body: 'Les relevés arrivent normalement.' };
}
/** À lancer depuis l'éditeur : notification de test sur le téléphone (après « Activer les alertes » dans Réglages). */
function testPush() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('ALERTE', JSON.stringify({ t: Date.now(), title: 'Test : les alertes de Conso de poche fonctionnent', body: 'Message de test envoyé depuis le script.' }));
  Logger.log(JSON.stringify({ envoi: sendPush_(), subs: pushSubs_().length }));
  Utilities.sleep(60000);
  props.deleteProperty('ALERTE');
}

/* --- Abonnements push (un par téléphone) --- */
function pushSubs_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PUSH_SUBS') || '[]'); } catch (e) { return []; } }
function savePushSubs_(a) { PropertiesService.getScriptProperties().setProperty('PUSH_SUBS', JSON.stringify(a.slice(-5))); }
function addPushSub_(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) throw new Error('abonnement invalide');
  const a = pushSubs_().filter(s => s.endpoint !== sub.endpoint);
  a.push({ endpoint: sub.endpoint, at: Date.now() });
  savePushSubs_(a);
  return { subs: a.length };
}

/* --- Clés VAPID (P-256), générées une fois dans les propriétés du script (code de Crypto de poche) --- */
const B0 = BigInt(0), B1 = BigInt(1), B2 = BigInt(2), B3 = BigInt(3), B4 = BigInt(4), B8 = BigInt(8), B255 = BigInt(255);
const P256 = {
  p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  Gx: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
  Gy: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5')
};
function mod_(a, m) { const r = a % m; return r >= B0 ? r : r + m; }
function inv_(a, m) {
  let t = B0, nt = B1, r = m, nr = mod_(a, m);
  while (nr !== B0) { const q = r / nr; [t, nt] = [nt, t - q * nt]; [r, nr] = [nr, r - q * nr]; }
  return mod_(t, m);
}
function jDouble_(P) {
  const p = P256.p, X = P[0], Y = P[1], Z = P[2];
  if (Z === B0 || Y === B0) return [B0, B1, B0];
  const YY = mod_(Y * Y, p), S = mod_(B4 * X * YY, p), ZZ = mod_(Z * Z, p);
  const M = mod_(B3 * (X - ZZ) * (X + ZZ), p);
  const X3 = mod_(M * M - B2 * S, p);
  const Y3 = mod_(M * (S - X3) - B8 * YY * YY, p);
  const Z3 = mod_(B2 * Y * Z, p);
  return [X3, Y3, Z3];
}
function jAdd_(P, Q) {
  const p = P256.p;
  if (P[2] === B0) return Q; if (Q[2] === B0) return P;
  const Z1Z1 = mod_(P[2] * P[2], p), Z2Z2 = mod_(Q[2] * Q[2], p);
  const U1 = mod_(P[0] * Z2Z2, p), U2 = mod_(Q[0] * Z1Z1, p);
  const S1 = mod_(P[1] * Q[2] * Z2Z2, p), S2 = mod_(Q[1] * P[2] * Z1Z1, p);
  if (U1 === U2) return S1 === S2 ? jDouble_(P) : [B0, B1, B0];
  const H = mod_(U2 - U1, p), R = mod_(S2 - S1, p);
  const HH = mod_(H * H, p), HHH = mod_(H * HH, p), V = mod_(U1 * HH, p);
  const X3 = mod_(R * R - HHH - B2 * V, p);
  const Y3 = mod_(R * (V - X3) - S1 * HHH, p);
  const Z3 = mod_(H * P[2] * Q[2], p);
  return [X3, Y3, Z3];
}
function mulG_(k) {
  let R = [B0, B1, B0], Q = [P256.Gx, P256.Gy, B1];
  while (k > B0) { if (k & B1) R = jAdd_(R, Q); Q = jDouble_(Q); k >>= B1; }
  const p = P256.p, zi = inv_(R[2], p), zi2 = mod_(zi * zi, p);
  return [mod_(R[0] * zi2, p), mod_(R[1] * zi2 * zi, p)];
}
function bytesToBig_(b) { let x = B0; for (let i = 0; i < b.length; i++) x = (x << B8) | BigInt(b[i] & 255); return x; }
function bigToBytes_(x, len) { const out = new Array(len); for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & B255); x >>= B8; } return out; }
function b64u_(bytes) { return Utilities.base64EncodeWebSafe(bytes.map(b => b > 127 ? b - 256 : b)).replace(/=+$/, ''); }
function sha256_(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes.map(b => b > 127 ? b - 256 : b)).map(b => b & 255); }
function hmac_(keyBytes, msgBytes) { return Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, msgBytes.map(b => b > 127 ? b - 256 : b), keyBytes.map(b => b > 127 ? b - 256 : b)).map(b => b & 255); }
function utf8_(s) { return Utilities.newBlob(s).getBytes().map(b => b & 255); }

function vapid_() {
  const props = PropertiesService.getScriptProperties();
  let d = props.getProperty('VAPID_D');
  if (!d) {
    let k = B0;
    while (k <= B0 || k >= P256.n) {
      const seed = utf8_(Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid() + Date.now());
      k = bytesToBig_(sha256_(seed));
    }
    d = k.toString(16);
    props.setProperty('VAPID_D', d);
    props.deleteProperty('VAPID_PUB');
  }
  let pub = props.getProperty('VAPID_PUB');
  if (!pub) {
    const Q = mulG_(BigInt('0x' + d));
    pub = b64u_([4].concat(bigToBytes_(Q[0], 32), bigToBytes_(Q[1], 32)));
    props.setProperty('VAPID_PUB', pub);
  }
  return { d: BigInt('0x' + d), pub: pub };
}
function es256_(d, msgBytes) {
  const n = P256.n, h = sha256_(msgBytes), e = mod_(bytesToBig_(h), n), dk = bigToBytes_(d, 32);
  for (let ctr = 0; ctr < 100; ctr++) {
    const k = mod_(bytesToBig_(hmac_(dk, h.concat([ctr]))), n);
    if (k === B0) continue;
    const r = mod_(mulG_(k)[0], n);
    if (r === B0) continue;
    const s = mod_(inv_(k, n) * (e + r * d), n);
    if (s === B0) continue;
    return bigToBytes_(r, 32).concat(bigToBytes_(s, 32));
  }
  throw new Error('signature impossible');
}
function vapidHeader_(endpoint) {
  const v = vapid_();
  const aud = endpoint.match(/^https:\/\/[^/]+/)[0];
  const head = b64u_(utf8_(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u_(utf8_(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: PUSH_SUB })));
  const sig = b64u_(es256_(v.d, utf8_(head + '.' + body)));
  return 'vapid t=' + head + '.' + body + '.' + sig + ', k=' + v.pub;
}
function sendPush_() {
  const subs = pushSubs_(), keep = [], res = [];
  subs.forEach(s => {
    try {
      const r = UrlFetchApp.fetch(s.endpoint, { method: 'post', muteHttpExceptions: true, payload: '',
        headers: { TTL: '86400', Urgency: 'high', Authorization: vapidHeader_(s.endpoint) } });
      const c = r.getResponseCode();
      res.push(c);
      if (c !== 404 && c !== 410) keep.push(s);
      if (c >= 400) Logger.log('push ' + c + ' ' + r.getContentText().slice(0, 200));
    } catch (e) { keep.push(s); res.push(e.message); }
  });
  if (keep.length !== subs.length) savePushSubs_(keep);
  return res;
}

/** À lancer depuis l'éditeur pour contrôler les chiffres (contrôle : 22/10/2026 = HC Bleu 19,21, HP Bleu 12,34, solaire 6,55, 4,65 €). */
function verifier() {
  const S = newState_(); readHA_(S); readEL_(S, false);
  Logger.log(JSON.stringify({ j22: S.daily['2026-10-22'] && { hc: S.daily['2026-10-22'].tar.HCJB, hp: S.daily['2026-10-22'].tar.HPJB, sol: S.daily['2026-10-22'].sol, eur: S.daily['2026-10-22'].cost }, day22: day_(S, '2026-10-22'), errs: S.errs }));
  Logger.log(JSON.stringify(getData_(true)).slice(0, 4000));
}
