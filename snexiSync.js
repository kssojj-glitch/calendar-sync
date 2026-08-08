// Ferme le bandeau cookies afin de rendre les éléments de page cliquables.
async function closeCookiePopup(page) {
  const selectors = [
    '#didomi-notice-agree-button',
    'button#didomi-notice-agree-button',
    'button',
    'a',
  ];

  for (const sel of selectors) {
    try {
      if (sel === 'button' || sel === 'a') {
        const clickedByText = await page.evaluate((tag) => {
          const candidates = Array.from(document.querySelectorAll(tag));
          const target = candidates.find((el) => {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            return text.includes('accepter & fermer') || text.includes('continuer sans accepter');
          });
          if (!target) return false;
          target.click();
          return true;
        }, sel);
        if (clickedByText) {
          console.log('[LOGIN] Pop-up cookies géré via texte.');
          await page.waitForTimeout(800);
          return;
        }
      } else {
        await page.waitForSelector(sel, { timeout: 1500, visible: true });
        await page.click(sel);
        console.log('[LOGIN] Consentement cookies accepté.');
        await page.waitForTimeout(800);
        return;
      }
    } catch (e) {
      // Continuer sur les autres stratégies.
    }
  }

  console.log('[LOGIN] Aucun pop-up cookies bloquant détecté.');
}

// Fonction utilitaire pour cliquer sur le bouton « Espace client » de façon robuste
async function clickEspaceClient(page) {
  const selectors = [
    'button[aria-label*="Espace client"]',
    'button[aria-label*="Ouvrir l’espace client"]',
    'button[aria-label*="Ouvrir l\u2019espace client"]',
    'button',
    'a',
  ];
  let found = false;
  for (let i = 0; i < selectors.length; i++) {
    const sel = selectors[i];
    try {
      await page.waitForSelector(sel, { timeout: 3000, visible: true });
      const btns = await page.$$(sel);
      for (const btn of btns) {
        const text = await page.evaluate(el => (el.innerText || el.textContent || '').trim(), btn);
        const aria = await page.evaluate(el => (el.getAttribute('aria-label') || '').trim(), btn);
        const fullText = `${text} ${aria}`.toLowerCase();
        if (fullText.includes('espace client')) {
          console.log(`[LOGIN] Clic sur bouton avec sélecteur: ${sel} et texte: ${text}`);
          await btn.click();
          found = true;
          break;
        }
      }
      if (found) break;
    } catch (e) {
      console.log(`[LOGIN] Sélecteur non trouvé ou invisible: ${sel}`);
    }
  }
  if (!found) {
    const clickedInDom = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],span'));
      const target = nodes.find((el) => {
        const text = `${el.innerText || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
        return text.includes('espace client');
      });
      if (!target) return false;
      const clickable = target.closest('button,a,[role="button"]') || target;
      clickable.click();
      return true;
    });
    if (clickedInDom) {
      console.log('[LOGIN] Clic Espace client effectué via fallback DOM.');
      return;
    }
    console.log('[LOGIN] Bouton « Espace client » introuvable, capture d’écran...');
    await page.screenshot({ path: 'debug_espace_client_not_found.png' });
    throw new Error('Bouton « Espace client » non trouvé');
  }
}

async function openSnexiCalendarIfLogged(page) {
  const menuSelector = "a.lien_menu[href*='experts/experts_indisponibilites.php']";
  try {
    const menu = await page.$(menuSelector);
    if (!menu) return false;
    const visible = await page.evaluate((el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)), menu);
    if (!visible) return false;
    await menu.click();
    console.log('[LOGIN] Session Snexi déjà active, menu Indisponibilités ouvert sans relogin.');
    await page.waitForTimeout(2500);
    return true;
  } catch (_) {
    return false;
  }
}
// Snexi to Google Calendar Sync - Nouvelle base saine
// Dépendances : puppeteer, dotenv, googleapis

require('dotenv').config({ path: __dirname + '/.env' });
const puppeteer = require('puppeteer');
const { google } = require('googleapis');

// Chargement des variables d'environnement
const SNEXI_URL = process.env.SNEXI_URL;
const SNEXI_USERNAME = process.env.SNEXI_USERNAME;
const SNEXI_PASSWORD = process.env.SNEXI_PASSWORD;
const CONSTATIMMO_URL = process.env.CONSTATIMMO_URL;
const CONSTATIMMO_USERNAME = process.env.CONSTATIMMO_USERNAME;
const CONSTATIMMO_PASSWORD = process.env.CONSTATIMMO_PASSWORD;
const CONSTATIMMO_USER_DATA_DIR = process.env.CONSTATIMMO_USER_DATA_DIR || './.browser/constatimmo';
const CONSTATIMMO_HEADLESS = String(process.env.CONSTATIMMO_HEADLESS || 'false').toLowerCase() === 'true';
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const GOOGLE_CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH;

async function loginSnexi(page) {
  const snexiUrl = process.env.SNEXI_URL || SNEXI_URL || '';
  console.log('SNEXI_URL utilisé pour la connexion :', snexiUrl);
  if (!snexiUrl) {
    throw new Error('SNEXI_URL est vide ou non défini. Vérifiez votre .env.');
  }
  await page.goto(snexiUrl, { waitUntil: 'networkidle2' });
  // Gestion des variantes de pop-up cookies Snexi
  await closeCookiePopup(page);

  if (await openSnexiCalendarIfLogged(page)) {
    let calFrame = null;
    for (let tries = 0; tries < 8; tries++) {
      const frames = await page.frames();
      calFrame = frames.find(f => f.url().includes('indisponibilites'));
      if (calFrame) break;
      await page.waitForTimeout(1000);
    }
    if (calFrame) {
      if (isSnexiManualCaptureEnabled()) {
        await captureSnexiManualSession(page, calFrame);
        return [];
      }
      const allAppointments = await extractAppointments(calFrame);
      console.log('Rendez-vous extraits :');
      console.log(JSON.stringify(allAppointments, null, 2));
      return allAppointments;
    }
  }

  // Clic robuste sur le bouton « Espace client »
  try {
    await clickEspaceClient(page);
    console.log('Bouton Espace client cliqué.');
  } catch (e) {
    console.error('Bouton Espace client non trouvé.');
    throw e;
  }

  // Attendre l'apparition du formulaire modal de login
  try {
    const resolveLoginSelectors = async () => {
      const candidates = [
        { user: '#login', pass: '#password' },
        { user: 'input[name="login"]', pass: 'input[name="mdp"]' },
        { user: 'input[name="username"]', pass: 'input[name="password"]' },
        { user: 'input[id*="login"]', pass: 'input[id*="pass"]' },
        { user: 'input[type="text"]', pass: 'input[type="password"]' },
      ];

      for (const pair of candidates) {
        const userEl = await page.$(pair.user);
        const passEl = await page.$(pair.pass);
        if (!userEl || !passEl) continue;
        const visible = await page.evaluate((u, p) => {
          const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
          return isVisible(u) && isVisible(p);
        }, userEl, passEl);
        if (visible) return pair;
      }

      return null;
    };

    let selectors = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      selectors = await resolveLoginSelectors();
      if (selectors) break;
      console.log(`[LOGIN] Formulaire non détecté (tentative ${attempt}/2), nouvelle tentative de clic Espace client...`);
      await clickEspaceClient(page);
      await page.waitForTimeout(2000);
      selectors = await resolveLoginSelectors();
      if (selectors) break;
      await page.waitForTimeout(3000);
    }

    if (!selectors) {
      // Après clics successifs, la session peut devenir active sans modal visible.
      let openedFromActiveSession = false;
      for (let t = 0; t < 8; t++) {
        if (await openSnexiCalendarIfLogged(page)) {
          openedFromActiveSession = true;
          break;
        }
        await page.waitForTimeout(1500);
      }

      if (openedFromActiveSession) {
        selectors = null;
      } else {
        await page.waitForSelector('#login', { timeout: 15000, visible: true });
        await page.waitForSelector('#password', { timeout: 15000, visible: true });
        selectors = { user: '#login', pass: '#password' };
      }
    }

    if (selectors) {
      console.log('Formulaire de login modal détecté.');
      await page.click(selectors.user, { clickCount: 3 });
      await page.type(selectors.user, process.env.SNEXI_USERNAME, { delay: 50 });
      await page.click(selectors.pass, { clickCount: 3 });
      await page.type(selectors.pass, process.env.SNEXI_PASSWORD, { delay: 50 });

      await page.waitForFunction(() => {
        const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
        return btns.some((btn) => {
          const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
          return txt.includes('connexion') || txt.includes('connecter');
        });
      }, { timeout: 10000 });

      const clickableButtons = await page.$$('button, input[type="submit"]');
      let clicked = false;
      for (const btn of clickableButtons) {
        const text = await page.evaluate((el) => (el.textContent || el.value || '').trim().toLowerCase(), btn);
        if (text.includes('connexion') || text.includes('connecter')) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error('Bouton Connexion non trouvé dans le modal');

      try {
        await page.waitForSelector('#login', { hidden: true, timeout: 10000 });
        await page.waitForSelector('#password', { hidden: true, timeout: 10000 });
        await page.waitForTimeout(1000);
      } catch (e) {
        console.log('[DEBUG] Le formulaire de login ne s’est pas masqué proprement.');
      }
    }
    // Attendre activement l'apparition du menu Indisponibilités puis cliquer
    let menu = null;
    try {
      await page.waitForSelector("a.lien_menu[href*='experts/experts_indisponibilites.php']", { timeout: 15000 });
      menu = await page.$("a.lien_menu[href*='experts/experts_indisponibilites.php']");
    } catch (e) {
      console.log('[DEBUG] Menu Indisponibilités non trouvé après login (timeout).');
    }
    if (menu) {
      await menu.click();
      console.log('[DEBUG] Clic sur le menu Indisponibilités effectué, attente 3s...');
      await page.waitForTimeout(3000);
    } else {
      await page.screenshot({ path: 'debug_menu_indispo_introuvable.png' });
      throw new Error('Menu Indisponibilités introuvable après login.');
    }
    // Détection de l’iframe calendrier (indisponibilites.php)
    let calFrame = null;
    for (let tries = 0; tries < 8; tries++) {
      const frames = await page.frames();
      calFrame = frames.find(f => f.url().includes('indisponibilites'));
      if (calFrame) break;
      await page.waitForTimeout(1000);
    }
    let allAppointments = [];
    if (!calFrame) {
      console.log('[FALLBACK] Iframe calendrier non trouvée, tentative d’extraction offline depuis le HTML principal...');
      const html = await page.content();
      const fs = require('fs');
      fs.writeFileSync('debug/snexi-calendar-fallback.html', html, 'utf-8');
      const { extractSnexiEventsFromHtml } = require('./extractSnexiFromHtml');
      allAppointments = extractSnexiEventsFromHtml(html);
      console.log(`[FALLBACK] ${allAppointments.length} événements extraits offline.`);
    } else {
      if (isSnexiManualCaptureEnabled()) {
        await captureSnexiManualSession(page, calFrame);
        return [];
      }
      console.log('Iframe calendrier détectée. Extraction des rendez-vous cibles à venir...');
      allAppointments = await extractAppointments(calFrame);
      console.log('Rendez-vous extraits :');
      console.log(JSON.stringify(allAppointments, null, 2));
    }
    // Ne pas synchroniser ici, retourner la liste pour traitement dans main
    return allAppointments;
  } catch (e) {
    console.error('Erreur lors du login modal :', e.message);
    await page.screenshot({ path: 'debug_login_modal_error.png' });
    throw e;
  }
}

// Clique sur le bouton "semaine suivante" (adapter le sélecteur si besoin)
async function goToNextWeek(calFrame) {
  const nextButtonSelector = '.fc-next-button, .fc-button-next, button[aria-label="Suivant"], button[title*="suiv" i], .fc-button.fc-button-next';
  await calFrame.waitForSelector(nextButtonSelector, { timeout: 5000 });
  await calFrame.click(nextButtonSelector);
  await calFrame.waitForTimeout(1500);
}

function toIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseFrenchMonth(raw) {
  const m = String(raw || '').toLowerCase().replace('.', '').trim();
  const map = {
    janv: 1, janvier: 1,
    fev: 2, fevr: 2, fevrier: 2, février: 2,
    mars: 3,
    avr: 4, avril: 4,
    mai: 5,
    juin: 6,
    juil: 7, juillet: 7,
    aout: 8, août: 8,
    sept: 9, septembre: 9,
    oct: 10, octobre: 10,
    nov: 11, novembre: 11,
    dec: 12, decembre: 12, décembre: 12,
  };
  return map[m] || null;
}

function parseWeekStartFromLabel(weekLabel) {
  const label = String(weekLabel || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const r1 = label.match(/(\d{1,2})\s*[\u2013\-]\s*\d{1,2}\s+([a-zéû\.]+)\s+(\d{4})/i);
  if (r1) {
    const day = Number(r1[1]);
    const month = parseFrenchMonth(r1[2]);
    const year = Number(r1[3]);
    if (day && month && year) return toIsoDate(year, month, day);
  }
  const r2 = label.match(/(\d{1,2})\s+([a-zéû\.]+)\s*[\u2013\-]\s*\d{1,2}\s+[a-zéû\.]+\s+(\d{4})/i);
  if (r2) {
    const day = Number(r2[1]);
    const month = parseFrenchMonth(r2[2]);
    const year = Number(r2[3]);
    if (day && month && year) return toIsoDate(year, month, day);
  }
  return null;
}

function addDays(isoDate, days) {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days, 12, 0, 0);
  return toIsoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

function weekMondayIso(weekOffset = 0) {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // lundi=0 ... dimanche=6
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + weekOffset * 7, 12, 0, 0);
  return toIsoDate(monday.getFullYear(), monday.getMonth() + 1, monday.getDate());
}

function parseTimeParts(text) {
  const src = String(text || '');
  const range = src.match(/\b(\d{1,2}:\d{2})\s*[\-–]\s*(\d{1,2}:\d{2})\b/);
  if (range) return { startTime: range[1].padStart(5, '0'), endTime: range[2].padStart(5, '0') };
  const one = src.match(/\b(\d{1,2}:\d{2})\b/);
  if (one) return { startTime: one[1].padStart(5, '0'), endTime: null };
  return { startTime: null, endTime: null };
}

async function extractAppointments(calFrame) {
  const fs = require('fs');
  const allAppointments = [];
  const seenKeys = new Set();
  const eventSelectors = '.fc-event, a.fc-event, .fc-day-grid-event, .fc-time-grid-event';

  for (let semaine = 0; semaine < 4; semaine++) {
    await calFrame.waitForTimeout(1200);
    const weekData = await calFrame.evaluate((selector) => {
      const weekLabel = (document.querySelector('.fc-toolbar h2')?.textContent || '').replace(/\s+/g, ' ').trim();
      const headerDates = Array.from(document.querySelectorAll('th.fc-day-header[data-date], .fc-day-header[data-date]'))
        .map((el) => el.getAttribute('data-date'))
        .filter(Boolean);
      const nodes = Array.from(document.querySelectorAll(selector));
      const events = nodes.map((el) => {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        const title = el.getAttribute('title') || '';
        const style = el.getAttribute('style') || '';
        const className = el.className || '';
        const rect = el.getBoundingClientRect();
        const dateFromParent = (el.closest('[data-date]')?.getAttribute('data-date') || '').trim() || null;
        const timeRaw = (
          el.querySelector('.fc-time')?.getAttribute('data-full')
          || el.querySelector('.fc-time')?.textContent
          || el.querySelector('.fc-event-time')?.textContent
          || ''
        ).replace(/\s+/g, ' ').trim();
        const leftMatch = style.match(/left\s*:\s*([\d.]+)px/i);
        const leftPx = leftMatch ? Number(leftMatch[1]) : Math.round(rect.left);
        return {
          text: text || title || 'Rendez-vous Snexi',
          description: title || text || '',
          class: className,
          style,
          date: dateFromParent,
          timeRaw,
          leftPx,
          address: null,
        };
      });
      return { weekLabel, headerDates, events };
    }, eventSelectors);

    const weekStart = parseWeekStartFromLabel(weekData.weekLabel) || weekMondayIso(semaine);
    const fallbackHeaderDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter(Boolean);
    const headerDates = weekData.headerDates.length ? weekData.headerDates : fallbackHeaderDates;

    const leftColumns = [...new Set(weekData.events
      .map((e) => Number(e.leftPx))
      .filter((n) => Number.isFinite(n)))]
      .sort((a, b) => a - b);

    let addedForWeek = 0;
    for (const evt of weekData.events) {
      let date = evt.date || null;
      if (!date && leftColumns.length && headerDates.length) {
        const left = Number(evt.leftPx);
        let bestIdx = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < leftColumns.length; i++) {
          const dist = Math.abs(leftColumns[i] - left);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        date = headerDates[bestIdx] || null;
      }

      const times = parseTimeParts(`${evt.timeRaw || ''} ${evt.text || ''}`);
      const enriched = {
        ...evt,
        date,
        startTime: times.startTime,
        endTime: times.endTime,
        weekLabel: weekData.weekLabel || null,
      };

      const key = `${semaine}|${enriched.text}|${enriched.date || 'nodate'}|${enriched.startTime || 'notime'}|${enriched.style}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      allAppointments.push(enriched);
      addedForWeek++;
    }

    console.log(`[EXTRACTION] Semaine ${semaine + 1}: ${addedForWeek} rendez-vous.`);

    if (semaine < 3) {
      try {
        await goToNextWeek(calFrame);
      } catch (e) {
        console.log(`[EXTRACTION] Avance semaine impossible en semaine ${semaine + 1}: ${e.message}`);
        break;
      }
    }
  }

  fs.writeFileSync('appointments.json', JSON.stringify(allAppointments, null, 2), 'utf-8');
  console.log(`[EXTRACTION] ${allAppointments.length} rendez-vous extraits et sauvegardés dans appointments.json`);
  return allAppointments;
}

function getConstatimmoPlanningUrl() {
  try {
    const u = new URL(CONSTATIMMO_URL);
    return `${u.protocol}//${u.host}/profile#planification`;
  } catch (e) {
    return 'https://constatonline.constatimmo.com/profile#planification';
  }
}

function getSnexiPortalBaseUrl() {
  try {
    const u = new URL(SNEXI_URL || 'https://snexi.fr/portail');
    const pathname = (u.pathname || '/').replace(/\/+$/, '');
    if (pathname.toLowerCase().endsWith('/portail')) {
      return `${u.protocol}//${u.host}${pathname}`;
    }
    return `${u.protocol}//${u.host}/portail`;
  } catch (e) {
    return 'https://snexi.fr/portail';
  }
}

function isSnexiManualCaptureEnabled() {
  return String(process.env.SNEXI_MANUAL_CAPTURE || 'false').toLowerCase() === 'true';
}

function waitForEnter(message) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function installSnexiClickRecorder(context) {
  await context.evaluate(() => {
    if (window.__snexiClickRecorderInstalled) return;
    window.__snexiClickRecorderInstalled = true;
    window.__snexiManualClicks = [];

    const safeText = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const buildPath = (el) => {
      if (!el || !el.nodeType || el.nodeType !== 1) return '';
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 8) {
        let seg = node.tagName.toLowerCase();
        if (node.id) {
          seg += `#${node.id}`;
          parts.unshift(seg);
          break;
        }
        const cls = (node.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) seg += `.${cls.join('.')}`;
        parts.unshift(seg);
        node = node.parentElement;
      }
      return parts.join(' > ');
    };

    document.addEventListener('click', (evt) => {
      const t = evt.target;
      if (!t) return;
      window.__snexiManualClicks.push({
        at: new Date().toISOString(),
        tag: (t.tagName || '').toLowerCase(),
        id: t.id || '',
        className: (t.className || '').toString(),
        text: safeText(t.innerText || t.textContent || t.value || ''),
        path: buildPath(t),
      });
    }, true);
  });
}

async function captureSnexiManualSession(page, calFrame) {
  const fs = require('fs');
  const path = require('path');
  const debugDir = path.join(__dirname, 'debug');
  fs.mkdirSync(debugDir, { recursive: true });

  try {
    await installSnexiClickRecorder(calFrame);
  } catch (_) {
    await installSnexiClickRecorder(page);
  }

  console.log('[SNEXI][MANUAL] Mode capture actif. Fais tes clics manuellement (ouvrir OS, retour, suivant...).');
  await waitForEnter('[SNEXI][MANUAL] Appuie sur Entree ici quand tu as fini. ');

  let clicks = [];
  try {
    clicks = await calFrame.evaluate(() => Array.isArray(window.__snexiManualClicks) ? window.__snexiManualClicks : []);
  } catch (_) {
    try {
      clicks = await page.evaluate(() => Array.isArray(window.__snexiManualClicks) ? window.__snexiManualClicks : []);
    } catch (_) {
      clicks = [];
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(debugDir, `snexi-manual-clicks-${stamp}.json`);
  const payload = {
    capturedAt: new Date().toISOString(),
    pageUrl: page.url(),
    clickCount: clicks.length,
    clicks,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[SNEXI][MANUAL] ${clicks.length} clics sauvegardes dans ${filePath}`);
}

function extractOsNumber(text) {
  const src = String(text || '').replace(/\u00a0/g, ' ');

  const taggedPatterns = [
    /\bos\s*n(?:[°ºo]|(?:um(?:e|é)ro))?\s*[:#-]?\s*(\d{5,})\b/i,
    /\bordre\s*de\s*service\b[^\d]{0,20}(\d{5,})\b/i,
    /\bos\b[^\d]{0,12}(\d{5,})\b/i,
  ];

  for (const pattern of taggedPatterns) {
    const m = src.match(pattern);
    if (m && m[1]) return m[1];
  }

  // Fallback: prendre un identifiant numerique long (evite heures et codes postaux).
  const fallback = src.match(/\b(\d{6,})\b/);
  return fallback ? fallback[1] : '';
}

async function dumpConstatimmoDebug(page, label) {
  const fs = require('fs');
  const path = require('path');
  const debugDir = path.join(__dirname, 'debug');
  fs.mkdirSync(debugDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = String(label || 'state').replace(/[^a-zA-Z0-9_-]/g, '_');
  const base = path.join(debugDir, `constatimmo-${safeLabel}-${stamp}`);

  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
  } catch (_) {
    // ignorer si la capture échoue
  }

  try {
    const html = await page.content();
    fs.writeFileSync(`${base}.html`, html, 'utf-8');
  } catch (_) {
    // ignorer si le dump HTML échoue
  }

  try {
    const frames = page.frames().map((f) => ({
      name: f.name() || null,
      url: f.url() || null,
    }));
    fs.writeFileSync(`${base}.frames.json`, JSON.stringify({ pageUrl: page.url(), frames }, null, 2), 'utf-8');
  } catch (_) {
    // ignorer si le dump des frames échoue
  }
}

function getConstatimmoDetailUrl(odmNumber) {
  const clean = String(odmNumber || '').match(/\d{6,}/);
  if (!clean) return null;
  return `https://v2.constatimmo.com/index.php?odmRedirect=${clean[0]}`;
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatSnexiDetails(fields) {
  const lines = [
    fields.address ? `Adresse: ${fields.address}` : '',
    fields.owner ? `Proprietaire: ${fields.owner}` : '',
    fields.manager ? `Gestionnaire: ${fields.manager}` : '',
    fields.tenant ? `Locataire: ${fields.tenant}` : '',
    fields.tenantMobile ? `Portable locataire: ${fields.tenantMobile}` : '',
    fields.comment ? `Commentaire: ${fields.comment}` : '',
    fields.keyPickupPlace ? `Lieu recuperation cles: ${fields.keyPickupPlace}` : '',
    fields.keyDropPlace ? `Lieu depot cles: ${fields.keyDropPlace}` : '',
    fields.floor ? `Etage: ${fields.floor}` : '',
    fields.door ? `Porte: ${fields.door}` : '',
    fields.digicode ? `Digicode: ${fields.digicode}` : '',
    fields.building ? `Batiment: ${fields.building}` : '',
    fields.detailUrl ? `Fiche: ${fields.detailUrl}` : '',
  ].filter(Boolean);
  return lines.join(' | ');
}

async function extractSnexiDetailFields(context, detailUrl, osNumber) {
  const extracted = await context.evaluate((meta) => {
    const normalize = (v) => String(v || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const bodyText = normalize(document.body ? document.body.innerText : '');
    const toKey = (s) => normalize(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const findByInputName = (namePatterns) => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      for (const el of inputs) {
        const rawName = el.getAttribute('name') || el.getAttribute('id') || '';
        const k = toKey(rawName);
        if (!k) continue;
        const hit = namePatterns.some((p) => p.test(k));
        if (!hit) continue;
        const val = normalize(el.value || el.getAttribute('value') || el.textContent || '');
        if (val) return val;
      }
      return '';
    };

    const findByLabelText = (labelPatterns) => {
      const all = Array.from(document.querySelectorAll('td, th, label, strong, b, span, div, p'));
      for (const el of all) {
        const raw = normalize(el.textContent || '');
        if (!raw || raw.length > 90) continue;
        const key = toKey(raw.replace(/\s*:\s*$/, ''));
        const isLabel = labelPatterns.some((p) => p.test(key));
        if (!isLabel) continue;

        const siblings = [el.nextElementSibling, el.parentElement && el.parentElement.nextElementSibling].filter(Boolean);
        for (const sib of siblings) {
          const v = normalize(sib.textContent || '');
          if (v && toKey(v) !== key) return v;
        }
      }
      return '';
    };

    const findByRegex = (patterns) => {
      for (const p of patterns) {
        const m = bodyText.match(p);
        if (m && m[1]) return normalize(m[1]);
      }
      return '';
    };

    const byInputOrLabelOrRegex = (inputPatterns, labelPatterns, regexPatterns) => {
      const byInput = findByInputName(inputPatterns);
      if (byInput) return byInput;
      const byLabel = findByLabelText(labelPatterns);
      if (byLabel) return byLabel;
      return findByRegex(regexPatterns);
    };

    const owner = byInputOrLabelOrRegex(
      [/propriet/i, /owner/i],
      [/^proprietaire$/i, /^proprietaire\s+du\s+bien$/i],
      [/\bpropri[ée]taire\s*:\s*([^\n]+)/i]
    );
    const address = byInputOrLabelOrRegex(
      [/adresse/i, /address/i, /rue/i, /ville/i, /cp/i, /code.?postal/i],
      [/^adresse$/i, /^adresse\s+du\s+bien$/i, /^adresse\s+intervention$/i, /^ville$/i, /^code\s+postal$/i],
      [/\badresse\s*(?:du\s+bien|intervention)?\s*:\s*([^\n]+)/i]
    );
    const manager = byInputOrLabelOrRegex(
      [/gestionnaire/i, /manager/i],
      [/^gestionnaire$/i],
      [/\bgestionnaire\s*:\s*([^\n]+)/i]
    );
    const tenant = byInputOrLabelOrRegex(
      [/locataire/i, /tenant/i],
      [/^locataire$/i, /^locataire\s+sortant$/i, /^nom\s+locataire$/i],
      [/\blocataire(?:\s+sortant)?\s*:\s*([^\n]+)/i]
    );
    const tenantMobile = byInputOrLabelOrRegex(
      [/portable/i, /telephone.*portable/i, /tel/i, /mobile/i],
      [/^portable\s+locataire$/i, /^tel\.?\s*locataire(?:\s+sortant)?$/i, /^telephone\s+locataire(?:\s+sortant)?$/i],
      [/\b(?:portable|t[ée]l(?:[ée]phone)?)\s+locataire(?:\s+sortant)?\s*:\s*([^\n]+)/i]
    );
    const floor = byInputOrLabelOrRegex(
      [/etage/i, /floor/i],
      [/^etage$/i],
      [/\b[ée]tage\s*:\s*([^\n]+)/i]
    );
    const door = byInputOrLabelOrRegex(
      [/porte/i, /door/i],
      [/^porte$/i],
      [/\bporte\s*:\s*([^\n]+)/i]
    );
    const digicode = byInputOrLabelOrRegex(
      [/digicode/i, /code.*porte/i],
      [/^digicode$/i, /^code\s+(?:porte|immeuble)$/i],
      [/\bdigicode\s*:\s*([^\n]+)/i, /\bcode\s+(?:porte|immeuble)\s*:\s*([^\n]+)/i]
    );
    const building = byInputOrLabelOrRegex(
      [/batiment/i, /immeuble/i, /building/i],
      [/^batiment$/i, /^immeuble$/i],
      [/\bb[âa]timent\s*:\s*([^\n]+)/i, /\bimmeuble\s*:\s*([^\n]+)/i]
    );
    const keyPickupPlace = byInputOrLabelOrRegex(
      [/recup.*cle/i, /retrait.*cle/i, /pickup.*key/i],
      [/^lieu\s+recuperation\s+cles$/i, /^lieu\s+de\s+recuperation\s+des\s+cles$/i, /^recuperation\s+cles$/i],
      [/\blieu\s+de\s+r[ée]cup[ée]ration\s+des\s+cl[ée]s\s*:\s*([^\n]+)/i, /\br[ée]cup[ée]ration\s+cl[ée]s\s*:\s*([^\n]+)/i]
    );
    const keyDropPlace = byInputOrLabelOrRegex(
      [/depot.*cle/i, /retour.*cle/i, /drop.*key/i],
      [/^lieu\s+depot\s+cles$/i, /^lieu\s+de\s+depot\s+des\s+cles$/i, /^depot\s+cles$/i],
      [/\blieu\s+de\s+d[ée]p[ôo]t\s+des\s+cl[ée]s\s*:\s*([^\n]+)/i, /\bd[ée]p[ôo]t\s+cl[ée]s\s*:\s*([^\n]+)/i]
    );
    const comment = byInputOrLabelOrRegex(
      [/comment/i, /observation/i, /note/i],
      [/^commentaire$/i, /^observations?$/i, /^note(?:s)?$/i],
      [/\bcommentaire\s*:\s*([^\n]+)/i, /\bobservations?\s*:\s*([^\n]+)/i]
    );

    return {
      osNumber: String(meta.osNumber || ''),
      detailUrl: String(meta.detailUrl || location.href || ''),
      address: normalize(address),
      owner: normalize(owner),
      manager: normalize(manager),
      tenant: normalize(tenant),
      tenantMobile: normalize(tenantMobile),
      comment: normalize(comment),
      keyPickupPlace: normalize(keyPickupPlace),
      keyDropPlace: normalize(keyDropPlace),
      floor: normalize(floor),
      door: normalize(door),
      digicode: normalize(digicode),
      building: normalize(building),
    };
  }, { detailUrl, osNumber });

  return extracted;
}

function countFilledSnexiFields(fields) {
  if (!fields || typeof fields !== 'object') return 0;
  const keys = ['address', 'owner', 'manager', 'tenant', 'tenantMobile', 'comment', 'keyPickupPlace', 'keyDropPlace', 'floor', 'door', 'digicode', 'building'];
  return keys.reduce((acc, k) => acc + (compactText(fields[k]) ? 1 : 0), 0);
}

async function findSnexiAgendaFrameInPage(page) {
  const frames = page.frames();
  const byUrl = frames.find((f) => /indisponibilites|experts_indisponibilites/i.test(f.url() || ''));
  if (byUrl) return byUrl;

  for (const f of frames) {
    try {
      const hasCalendar = await f.evaluate(() => !!document.querySelector('.fc-event, .fc-time-grid-event, .fc-day-grid-event'));
      if (hasCalendar) return f;
    } catch (_) {
      // frame cross-origin
    }
  }
  return null;
}

async function ensureSnexiAgendaFrame(page, options = {}) {
  const forceGoto = !!(options && options.forceGoto);

  if (!forceGoto) {
    const existing = await findSnexiAgendaFrameInPage(page);
    if (existing) return existing;
  }

  const portalBase = getSnexiPortalBaseUrl();
  const agendaUrl = `${portalBase}/experts/experts_indisponibilites.php`;
  await page.goto(agendaUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  for (let i = 0; i < 12; i++) {
    const calFrame = await findSnexiAgendaFrameInPage(page);
    if (calFrame) return calFrame;
    await page.waitForTimeout(700);
  }
  return null;
}

async function clickSnexiOsInAgendaFrame(calFrame, payload) {
  return calFrame.evaluate((data) => {
    const num = String(data && data.osNumber ? data.osNumber : '');
    if (!num) return false;

    const start = String(data && data.startTime ? data.startTime : '');
    const targetDate = String(data && data.targetDate ? data.targetDate : '');
    const targetText = String(data && data.targetText ? data.targetText : '');
    const normalize = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();

    const collectNodes = (root) => Array.from(root.querySelectorAll('.fc-event, a.fc-event, .fc-time-grid-event, .fc-day-grid-event'));
    const agendaTable = document.querySelector('table.fc-agenda-days') || document.querySelector('.fc-agenda-days');
    const tableNodes = agendaTable ? collectNodes(agendaTable) : [];
    const nodes = tableNodes.length ? tableNodes : collectNodes(document);
    const withNum = nodes.filter((el) => {
      const txt = normalize(el.innerText || el.textContent || '');
      if (!txt) return false;
      if (!txt.includes(`os n°${num}`) && !txt.includes(`os n${num}`) && !txt.includes(num)) return false;
      if (start && !txt.includes(start.toLowerCase())) return false;
      if (targetDate) {
        const dateFromParent = (el.closest('[data-date]') && el.closest('[data-date]').getAttribute('data-date')) || '';
        if (dateFromParent && dateFromParent !== targetDate) return false;
      }
      return true;
    });

    const preferTrajet = /trajet/.test(targetText);
    const preferred = withNum.find((el) => {
      const txt = normalize(el.innerText || el.textContent || '');
      const isTrajet = /trajet/.test(txt);
      return preferTrajet ? isTrajet : !isTrajet;
    });

    const target = preferred || withNum[0] || null;
    if (!target) return false;
    target.click();
    return true;
  }, payload);
}

async function clickRetourOnSnexi(page) {
  const contexts = [page, ...page.frames()];

  // Certains écrans Snexi affichent un bouton retour en icône ExtJS sans texte visible.
  const iconSelectors = [
    '#button-1501-btnIconEl',
    '#button-1161-btnIconEl',
    'span.x-btn-icon-el[id$="-btnIconEl"]',
  ];

  for (const ctx of contexts) {
    for (const selector of iconSelectors) {
      try {
        const clicked = await ctx.evaluate((sel) => {
          const icon = document.querySelector(sel);
          if (!icon) return false;
          const clickable = icon.closest('a,button,[role="button"],.x-btn,.x-btn-default-toolbar-small') || icon.parentElement || icon;
          if (!clickable) return false;
          clickable.click();
          return true;
        }, selector);
        if (clicked) {
          await page.waitForTimeout(900);
          return true;
        }
      } catch (_) {
        // continuer
      }
    }
  }

  for (const ctx of contexts) {
    try {
      const clicked = await ctx.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('a,button,span,div,input[type="button"],input[type="submit"]'));
        const target = nodes.find((el) => {
          const txt = (el.innerText || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().toLowerCase();
          return txt === 'retour' || txt.startsWith('retour ');
        });
        if (!target) return false;
        (target.closest('a,button,[role="button"]') || target).click();
        return true;
      });
      if (clicked) {
        await page.waitForTimeout(900);
        return true;
      }
    } catch (_) {
      // continuer
    }
  }

  try {
    await page.goBack({ waitUntil: 'networkidle2', timeout: 8000 });
    await page.waitForTimeout(700);
    return true;
  } catch (_) {
    return false;
  }
}

async function enrichSnexiOsFromAgenda(page, targetEvent) {
  const osNumber = extractOsNumber(`${targetEvent && targetEvent.text ? targetEvent.text : ''} ${targetEvent && targetEvent.description ? targetEvent.description : ''}`);
  if (!osNumber) return null;
  const startTime = compactText(targetEvent && targetEvent.startTime ? targetEvent.startTime : '');
  const targetDate = compactText(targetEvent && targetEvent.date ? targetEvent.date : '');
  const targetText = compactText(targetEvent && targetEvent.text ? targetEvent.text : '').toLowerCase();
  let calFrame = await ensureSnexiAgendaFrame(page);
  if (!calFrame) return null;

  const clickPayload = { osNumber, startTime, targetDate, targetText };
  let clicked = await clickSnexiOsInAgendaFrame(calFrame, clickPayload);

  // Si l'OS n'est pas visible sur la semaine courante, avancer progressivement.
  for (let i = 0; !clicked && i < 3; i++) {
    try {
      await goToNextWeek(calFrame);
      clicked = await clickSnexiOsInAgendaFrame(calFrame, clickPayload);
    } catch (_) {
      break;
    }
  }

  if (!clicked) return null;

  // Laisser le temps au pop-up de details de se charger avant lecture des champs.
  await page.waitForTimeout(1400);
  try {
    await page.waitForFunction((num) => {
      const text = String(document.body ? document.body.innerText : '').toLowerCase();
      if (!text) return false;
      const hasNum = num ? text.includes(String(num).toLowerCase()) : false;
      const hasOsPanelHeader = new RegExp(`os\\s*n[°º]?\\s*${String(num || '').replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s+cr[ée]\\s+le`, 'i').test(text);
      const hasDetails = /(locataire|propri[ée]taire|gestionnaire|digicode|etage|porte|cle|cl[ée]s|batiment|immeuble|adresse)/i.test(text);
      return hasNum || hasOsPanelHeader || hasDetails;
    }, { timeout: 5000 }, osNumber);
  } catch (_) {
    // continuer meme si la detection de popup est partielle
  }

  let best = null;
  const contexts = [page, ...page.frames()];
  for (const ctx of contexts) {
    try {
      const details = await extractSnexiDetailFields(ctx, (ctx.url && ctx.url()) || page.url(), osNumber);
      const score = countFilledSnexiFields(details);
      if (!best || score > best.score) {
        best = { details, score };
      }
    } catch (_) {
      // continuer
    }
  }

  const backOk = await clickRetourOnSnexi(page);
  if (!backOk) {
    calFrame = await ensureSnexiAgendaFrame(page);
    if (!calFrame) return best && best.score > 0 ? best.details : null;
  } else {
    try {
      await page.waitForFunction(() => !!document.querySelector('.fc-event, .fc-time-grid-event, .fc-day-grid-event'), { timeout: 5000 });
    } catch (_) {
      calFrame = await ensureSnexiAgendaFrame(page);
      if (!calFrame) return best && best.score > 0 ? best.details : null;
    }
  }

  return best && best.score > 0 ? best.details : null;
}

async function enrichSnexiAppointments(page, events) {
  // Enrichissement detaille des OS desactive par defaut: activer explicitement via .env.
  const enabled = String(process.env.SNEXI_ENRICH_DETAILS || 'false').toLowerCase() === 'true';
  if (!enabled) return events;

  const snexiEvents = events.filter((evt) => evt && evt.source === 'snexi');
  if (snexiEvents.length === 0) return events;

  const isOsAppointmentCard = (evt) => {
    const text = compactText(`${evt && evt.text ? evt.text : ''} ${evt && evt.description ? evt.description : ''}`).toLowerCase();
    return /\bos\s*n[°º]?\s*\d{5,}\b/.test(text) && !/\btrajet\b/.test(text);
  };

  const agendaTargets = [];
  const seenAgendaKeys = new Set();
  for (const evt of snexiEvents) {
    const meta = classifyEvent(evt);
    const osNumber = extractOsNumber(`${evt.text || ''} ${evt.description || ''}`);
    if (!osNumber) continue;
    const isBlueOrGreen = meta.color === 'bleu' || meta.color === 'vert';
    const isIndispo = /indisponibilit[ée]/i.test(String(evt.text || ''));
    if (!isBlueOrGreen || isIndispo || !isOsAppointmentCard(evt)) continue;

    const key = `${evt.date || 'nodate'}|${evt.startTime || 'notime'}|${osNumber}`;
    if (seenAgendaKeys.has(key)) continue;
    seenAgendaKeys.add(key);

    agendaTargets.push({
      ...evt,
      osNumber,
      _targetKey: key,
    });
  }

  agendaTargets.sort((a, b) => {
    const da = `${a.date || ''} ${a.startTime || ''}`;
    const db = `${b.date || ''} ${b.startTime || ''}`;
    return da.localeCompare(db);
  });

  if (agendaTargets.length === 0) return events;

  const detailsByOs = new Map();
  const clickReport = [];

  let index = 0;
  for (const target of agendaTargets) {
    index++;
    const osNumber = target.osNumber;
    const reportItem = {
      osNumber,
      date: target.date || null,
      startTime: target.startTime || null,
      text: compactText(target.text || ''),
      status: 'pending',
      parsedFields: 0,
    };
    try {
      console.log(`[SNEXI][DETAIL] Clic OS ${osNumber} (${target.date || 'nodate'} ${target.startTime || 'notime'})`);
      const fields = await enrichSnexiOsFromAgenda(page, target);
      if (!fields) {
        console.warn(`[SNEXI][DETAIL] OS ${osNumber}: panneau inline non trouve.`);
        reportItem.status = 'panel-not-found';
        clickReport.push(reportItem);
        continue;
      }

      const score = countFilledSnexiFields(fields);
      reportItem.parsedFields = score;
      if (score === 0) {
        console.warn(`[SNEXI][DETAIL] OS ${osNumber}: panneau ouvert mais champs non detectes.`);
        reportItem.status = 'opened-no-fields';
      } else {
        reportItem.status = 'opened-parsed';
      }
      const existing = detailsByOs.get(osNumber);
      if (!existing || countFilledSnexiFields(existing) < score) {
        detailsByOs.set(osNumber, fields);
      }
      clickReport.push(reportItem);
      if (index % 5 === 0 || index === agendaTargets.length) {
        console.log(`[SNEXI][DETAIL] ${index}/${agendaTargets.length} rendez-vous (bleu/vert) cliques.`);
      }
    } catch (e) {
      console.warn(`[SNEXI][DETAIL] OS ${osNumber}: echec d'enrichissement (${e.message}).`);
      reportItem.status = 'error';
      reportItem.error = e.message;
      clickReport.push(reportItem);
    }
  }

  try {
    const fs = require('fs');
    const details = Array.from(detailsByOs.entries()).map(([osNumber, fields]) => ({
      osNumber,
      ...fields,
    }));
    const payload = {
      generatedAt: new Date().toISOString(),
      totalTargets: agendaTargets.length,
      clickReport,
      details,
    };
    fs.writeFileSync('snexi.os.details.json', JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[SNEXI][DETAIL] Export details: ${details.length}/${agendaTargets.length} -> snexi.os.details.json`);
  } catch (e) {
    console.warn(`[SNEXI][DETAIL] Export details impossible: ${e.message}`);
  }

  if (detailsByOs.size === 0) return events;

  return events.map((evt) => {
    if (!evt || evt.source !== 'snexi') return evt;
    const osNumber = extractOsNumber(`${evt.text || ''} ${evt.description || ''}`);
    if (!osNumber || !detailsByOs.has(osNumber)) return evt;

    const details = detailsByOs.get(osNumber);
    const detailsLine = formatSnexiDetails(details);
    const descriptionParts = [compactText(evt.description), detailsLine].filter(Boolean);

    return {
      ...evt,
      osNumber,
      detailUrl: details.detailUrl || evt.detailUrl || null,
      address: details.address || evt.address || null,
      owner: details.owner || evt.owner || null,
      manager: details.manager || evt.manager || null,
      tenant: details.tenant || evt.tenant || null,
      tenantMobile: details.tenantMobile || evt.tenantMobile || null,
      comment: details.comment || evt.comment || null,
      keyPickupPlace: details.keyPickupPlace || evt.keyPickupPlace || null,
      keyDropPlace: details.keyDropPlace || evt.keyDropPlace || null,
      floor: details.floor || evt.floor || null,
      door: details.door || evt.door || null,
      digicode: details.digicode || evt.digicode || null,
      building: details.building || evt.building || null,
      description: descriptionParts.join(' | '),
    };
  });
}

function formatConstatimmoDetails(fields) {
  const tenantPhone = fields.tenantMobile || fields.tenantPhone || '';
  const lines = [
    fields.owner ? `Proprietaire: ${fields.owner}` : '',
    fields.manager ? `Gestionnaire: ${fields.manager}` : '',
    fields.tenant ? `Locataire: ${fields.tenant}` : '',
    tenantPhone ? `Telephone locataire: ${tenantPhone}` : '',
    fields.comment ? `Commentaire: ${fields.comment}` : '',
    fields.keyPickupPlace ? `Lieu recuperation cles: ${fields.keyPickupPlace}` : '',
    fields.keyDropPlace ? `Lieu depot cles: ${fields.keyDropPlace}` : '',
    fields.floor ? `Etage: ${fields.floor}` : '',
    fields.door ? `Porte: ${fields.door}` : '',
    fields.digicode ? `Digicode: ${fields.digicode}` : '',
    fields.building ? `Batiment: ${fields.building}` : '',
    fields.detailUrl ? `Fiche: ${fields.detailUrl}` : '',
  ].filter(Boolean);
  return lines.join(' | ');
}

async function extractConstatimmoDetailFields(detailPage, detailUrl, odmNumber) {
  const extracted = await detailPage.evaluate((meta) => {
    const normalize = (v) => String(v || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const bodyText = normalize(document.body ? document.body.innerText : '');
    const toKey = (s) => normalize(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const findByInputName = (namePatterns) => {
      const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
      for (const el of inputs) {
        const rawName = el.getAttribute('name') || el.getAttribute('id') || '';
        const k = toKey(rawName);
        if (!k) continue;
        const hit = namePatterns.some((p) => p.test(k));
        if (!hit) continue;
        const val = normalize(el.value || el.getAttribute('value') || el.textContent || '');
        if (val) return val;
      }
      return '';
    };

    const findByLabelText = (labelPatterns) => {
      const all = Array.from(document.querySelectorAll('td, th, label, strong, b, span, div, p'));
      for (const el of all) {
        const raw = normalize(el.textContent || '');
        if (!raw || raw.length > 80) continue;
        const key = toKey(raw.replace(/\s*:\s*$/, ''));
        const isLabel = labelPatterns.some((p) => p.test(key));
        if (!isLabel) continue;

        const siblings = [el.nextElementSibling, el.parentElement && el.parentElement.nextElementSibling].filter(Boolean);
        for (const sib of siblings) {
          const v = normalize(sib.textContent || '');
          if (v && toKey(v) !== key) return v;
        }
      }
      return '';
    };

    const findByRegex = (patterns) => {
      for (const p of patterns) {
        const m = bodyText.match(p);
        if (m && m[1]) return normalize(m[1]);
      }
      return '';
    };

    const byInputOrLabelOrRegex = (inputPatterns, labelPatterns, regexPatterns) => {
      const byInput = findByInputName(inputPatterns);
      if (byInput) return byInput;
      const byLabel = findByLabelText(labelPatterns);
      if (byLabel) return byLabel;
      return findByRegex(regexPatterns);
    };

    const owner = byInputOrLabelOrRegex(
      [/propriet/i, /owner/i],
      [/^proprietaire$/i, /^proprietaire\s+du\s+bien$/i],
      [/\bpropri[ée]taire\s*:\s*([^\n]+)/i]
    );

    const manager = byInputOrLabelOrRegex(
      [/gestionnaire/i, /manager/i],
      [/^gestionnaire$/i],
      [/\bgestionnaire\s*:\s*([^\n]+)/i]
    );

    const tenant = byInputOrLabelOrRegex(
      [/locataire/i, /tenant/i],
      [/^locataire$/i, /^locataire\s+sortant$/i, /^nom\s+locataire$/i],
      [/\blocataire(?:\s+sortant)?\s*:\s*([^\n]+)/i]
    );

    const tenantMobile = byInputOrLabelOrRegex(
      [/portable/i, /telephone.*portable/i, /tel/i, /mobile/i],
      [/^portable\s+locataire$/i, /^tel\.?\s*locataire(?:\s+sortant)?$/i, /^telephone\s+locataire(?:\s+sortant)?$/i],
      [/\b(?:portable|t[ée]l(?:[ée]phone)?)\s+locataire(?:\s+sortant)?\s*:\s*([^\n]+)/i]
    );

    const floor = byInputOrLabelOrRegex(
      [/etage/i, /floor/i],
      [/^etage$/i],
      [/\b[ée]tage\s*:\s*([^\n]+)/i]
    );

    const door = byInputOrLabelOrRegex(
      [/porte/i, /door/i],
      [/^porte$/i],
      [/\bporte\s*:\s*([^\n]+)/i]
    );

    const digicode = byInputOrLabelOrRegex(
      [/digicode/i, /code.*porte/i],
      [/^digicode$/i, /^code\s+(?:porte|immeuble)$/i],
      [/\bdigicode\s*:\s*([^\n]+)/i, /\bcode\s+(?:porte|immeuble)\s*:\s*([^\n]+)/i]
    );

    const building = byInputOrLabelOrRegex(
      [/batiment/i, /immeuble/i, /building/i],
      [/^batiment$/i, /^immeuble$/i],
      [/\bb[âa]timent\s*:\s*([^\n]+)/i, /\bimmeuble\s*:\s*([^\n]+)/i]
    );

    const keyPickupPlace = byInputOrLabelOrRegex(
      [/recup.*cle/i, /retrait.*cle/i, /pickup.*key/i],
      [/^lieu\s+recuperation\s+cles$/i, /^lieu\s+de\s+recuperation\s+des\s+cles$/i, /^recuperation\s+cles$/i],
      [/\blieu\s+de\s+r[ée]cup[ée]ration\s+des\s+cl[ée]s\s*:\s*([^\n]+)/i, /\br[ée]cup[ée]ration\s+cl[ée]s\s*:\s*([^\n]+)/i]
    );

    const keyDropPlace = byInputOrLabelOrRegex(
      [/depot.*cle/i, /retour.*cle/i, /drop.*key/i],
      [/^lieu\s+depot\s+cles$/i, /^lieu\s+de\s+depot\s+des\s+cles$/i, /^depot\s+cles$/i],
      [/\blieu\s+de\s+d[ée]p[ôo]t\s+des\s+cl[ée]s\s*:\s*([^\n]+)/i, /\bd[ée]p[ôo]t\s+cl[ée]s\s*:\s*([^\n]+)/i]
    );

    const ownerFallback = findByRegex([
      /\bpropri[ée]taire(?:\s+du\s+bien)?\s*:\s*([^\n]+)/i,
      /\bbailleur\s*:\s*([^\n]+)/i,
    ]);
    const tenantFallback = findByRegex([
      /\binformations?\s+occupant[\s\S]{0,500}?\bnom\s*:\s*([^\n]+)/i,
      /\blocataire(?:\s+sortant)?\s*:\s*([^\n]+)/i,
    ]);
    const tenantMobileFallback = findByRegex([
      /\binformations?\s+occupant[\s\S]{0,600}?\bt[ée]l[ée]phone\s+portable\s*:\s*([^\n]+)/i,
      /\bportable\s+locataire(?:\s+sortant)?\s*:\s*([^\n]+)/i,
    ]);
    const tenantPhoneFallback = findByRegex([
      /\binformations?\s+occupant[\s\S]{0,600}?\bt[ée]l[ée]phone\s+fixe\s*:\s*([^\n]+)/i,
      /\bt[ée]l(?:[ée]phone)?\s+locataire(?:\s+sortant)?\s*:\s*([^\n]+)/i,
    ]);

    let comment = '';
    const dialogTitle = Array.from(document.querySelectorAll('*')).find((el) => /zone\s+de\s+dialogue\s+avec\s+constatimmo/i.test(normalize(el.textContent || '')));
    if (dialogTitle) {
      const section = dialogTitle.closest('table, div') || dialogTitle.parentElement;
      if (section) {
        const candidateRows = Array.from(section.querySelectorAll('tr'));
        for (const row of candidateRows) {
          const cells = Array.from(row.querySelectorAll('td')).map((td) => normalize(td.innerText || td.textContent || ''));
          if (cells.length >= 3 && cells[2]) {
            comment = cells[2];
            break;
          }
        }
      }
    }
    if (!comment) {
      comment = findByRegex([/\bcommentaire\s*:\s*([^\n]+)/i]);
    }

    return {
      odmNumber: String(meta.odmNumber || ''),
      detailUrl: String(meta.detailUrl || location.href || ''),
      owner: normalize(owner || ownerFallback),
      manager: normalize(manager),
      tenant: normalize(tenant || tenantFallback),
      tenantMobile: normalize(tenantMobile || tenantMobileFallback),
      tenantPhone: normalize(tenantPhoneFallback),
      comment: normalize(comment),
      keyPickupPlace: normalize(keyPickupPlace),
      keyDropPlace: normalize(keyDropPlace),
      floor: normalize(floor),
      door: normalize(door),
      digicode: normalize(digicode),
      building: normalize(building),
    };
  }, { detailUrl, odmNumber });

  return extracted;
}

async function enrichConstatimmoAppointments(page, events) {
  const enabled = String(process.env.CONSTATIMMO_ENRICH_DETAILS || 'true').toLowerCase() !== 'false';
  if (!enabled) return events;

  const constEvents = events.filter((evt) => evt && evt.source === 'constatimmo');
  if (constEvents.length === 0) return events;

  const byOdm = new Map();
  for (const evt of constEvents) {
    const odmFromField = compactText(evt.odmNumber || '');
    const odmFromText = ((compactText(evt.text).match(/\b\d{6,}\b/) || [])[0] || '');
    const odm = odmFromField || odmFromText;
    if (!odm) continue;
    if (!byOdm.has(odm)) {
      byOdm.set(odm, {
        detailUrl: evt.detailUrl || getConstatimmoDetailUrl(odm),
      });
    }
  }

  if (byOdm.size === 0) return events;

  const detailPage = await page.browser().newPage();
  const detailsByOdm = new Map();

  try {
    let index = 0;
    for (const [odm, info] of byOdm.entries()) {
      index++;
      const targetUrl = info.detailUrl || getConstatimmoDetailUrl(odm);
      if (!targetUrl) continue;

      try {
        await detailPage.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await detailPage.waitForTimeout(800);
        const finalUrl = detailPage.url();
        if (/\/sso\/login/i.test(finalUrl)) {
          console.warn(`[CONSTATIMMO][DETAIL] ODM ${odm}: redirection SSO, details ignores.`);
          continue;
        }

        const fields = await extractConstatimmoDetailFields(detailPage, finalUrl, odm);
        detailsByOdm.set(odm, fields);
        if (index % 5 === 0 || index === byOdm.size) {
          console.log(`[CONSTATIMMO][DETAIL] ${index}/${byOdm.size} fiches traitees.`);
        }
      } catch (e) {
        console.warn(`[CONSTATIMMO][DETAIL] ODM ${odm}: echec d'enrichissement (${e.message}).`);
      }
    }
  } finally {
    await detailPage.close();
  }

  if (detailsByOdm.size === 0) return events;

  const enriched = events.map((evt) => {
    if (!evt || evt.source !== 'constatimmo') return evt;
    const odm = compactText(evt.odmNumber || '') || ((compactText(evt.text).match(/\b\d{6,}\b/) || [])[0] || '');
    if (!odm || !detailsByOdm.has(odm)) return evt;

    const details = detailsByOdm.get(odm);
    const detailsLine = formatConstatimmoDetails(details);
    const descriptionParts = [compactText(evt.description), detailsLine].filter(Boolean);
    return {
      ...evt,
      odmNumber: odm,
      detailUrl: evt.detailUrl || details.detailUrl || getConstatimmoDetailUrl(odm),
      owner: details.owner || evt.owner || null,
      manager: details.manager || evt.manager || null,
      tenant: details.tenant || evt.tenant || null,
      tenantMobile: details.tenantMobile || evt.tenantMobile || null,
      tenantPhone: details.tenantPhone || evt.tenantPhone || null,
      comment: details.comment || evt.comment || null,
      keyPickupPlace: details.keyPickupPlace || evt.keyPickupPlace || null,
      keyDropPlace: details.keyDropPlace || evt.keyDropPlace || null,
      floor: details.floor || evt.floor || null,
      door: details.door || evt.door || null,
      digicode: details.digicode || evt.digicode || null,
      building: details.building || evt.building || null,
      description: descriptionParts.join(' | '),
    };
  });

  return enriched;
}

async function extractConstatimmoFromContext(context, sourceUrl) {
  return context.evaluate((originUrl) => {
    const toAbs = (href) => {
      try {
        return new URL(href, originUrl || location.href).href;
      } catch (_) {
        return href || '';
      }
    };
    const parseOdmNumber = (text) => ((String(text || '').match(/\b\d{6,}\b/) || [])[0] || '');
    const buildDetailUrl = (odmNumber) => odmNumber ? `https://v2.constatimmo.com/index.php?odmRedirect=${odmNumber}` : '';

    const roadMapRows = Array.from(document.querySelectorAll('#road-map-results table tbody tr'));
    const roadMapEvents = roadMapRows.map((row) => {
      const readCell = (title) => {
        const cells = Array.from(row.querySelectorAll('td'));
        const cell = cells.find((td) => ((td.getAttribute('data-title') || '').toLowerCase()).includes(title));
        return (cell ? (cell.innerText || cell.textContent || '') : '').replace(/\s+/g, ' ').trim();
      };

      const from = readCell('de');
      const to = readCell('a');
      const odm = readCell('odm');
      const odmNumber = parseOdmNumber(odm);
      const mission = readCell('mission');
      const metier = readCell('métier') || readCell('metier');
      const address = readCell('adresse');
      const keysStatus = readCell('clés') || readCell('cles') || readCell('clefs') || readCell('clé');
      const rowHref = row.querySelector('a[href]') ? row.querySelector('a[href]').getAttribute('href') : '';
      const detailUrl = /odmRedirect=/i.test(String(rowHref || '')) ? toAbs(rowHref) : buildDetailUrl(odmNumber);
      const propertyTypes = (odm.match(/\(([^)]+)\)/g) || [])
        .map((s) => s.replace(/[()]/g, '').trim())
        .filter(Boolean);
      const propertyType = propertyTypes.join(' / ');
      const detailsBlob = [odm, mission, address].filter(Boolean).join(' | ');
      const extractLabeled = (regex, keywordRegex) => {
        const m = detailsBlob.match(regex);
        if (!m) return '';
        const raw = m[0].replace(/\s+/g, ' ').trim();
        const cleaned = raw.replace(keywordRegex, '').replace(/^[\s:\-]+/, '').trim();
        if (!cleaned) return '';
        return cleaned;
      };
      const doorInfo = extractLabeled(/\b(?:porte|appartement|appart\.?|appt)\s*[:\-]?\s*[a-z0-9\-]*/i, /^(?:porte|appartement|appart\.?|appt)\s*/i);
      const caveInfo = extractLabeled(/\bcave\s*[:\-]?\s*[a-z0-9\-]*/i, /^cave\s*/i);
      const parkingInfo = extractLabeled(/\b(?:parking|box|garage|place(?:\s+de\s+parking)?)\s*[:\-]?\s*[a-z0-9\-]*/i, /^(?:parking|box|garage|place(?:\s+de\s+parking)?)\s*/i);
      const missionLower = mission.toLowerCase();
      const type = missionLower.includes('entrée') || missionLower.includes('entree')
        ? 'Entrée'
        : missionLower.includes('sortie')
          ? 'Sortie'
          : 'RDV';

      const cleanOdm = odmNumber || (odm.match(/\d{6,}/g) || [odm])[0];
      const dateMatch = from.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
      const datePart = dateMatch ? dateMatch[0] : '';
      const fromTime = (from.match(/\b\d{2}:\d{2}(?::\d{2})?\b/) || [''])[0].slice(0, 5);
      const toTime = (to.match(/\b\d{2}:\d{2}(?::\d{2})?\b/) || [''])[0].slice(0, 5);

      const summaryParts = [type];
      if (cleanOdm) summaryParts.push(`ODM ${cleanOdm}`);
      if (datePart) summaryParts.push(datePart);
      if (fromTime || toTime) summaryParts.push(`${fromTime || '?'}-${toTime || '?'}`);
      if (!cleanOdm && metier) summaryParts.push(metier);

      const description = [
        odm ? `ODM: ${odm}` : '',
        propertyType ? `Type de bien: ${propertyType}` : '',
        metier ? `Métier: ${metier}` : '',
        mission ? `Mission: ${mission}` : '',
        address ? `Adresse: ${address}` : '',
        keysStatus ? `Clés: ${keysStatus}` : '',
        doorInfo ? `Porte: ${doorInfo}` : '',
        caveInfo ? `Cave: ${caveInfo}` : '',
        parkingInfo ? `Parking: ${parkingInfo}` : '',
      ].filter(Boolean).join(' | ');

      return {
        text: summaryParts.join(' ').trim() || 'Rendez-vous Constatimmo',
        description,
        class: 'constatimmo-roadmap-row',
        style: 'background-color: rgb(156, 39, 176);',
        computedBg: 'rgb(156, 39, 176)',
        width: 100,
        height: 20,
        keep: true,
        address: address || null,
        propertyType: propertyType || null,
        keysStatus: keysStatus || null,
        odmNumber: odmNumber || null,
        detailUrl: detailUrl || null,
        doorInfo: doorInfo || null,
        caveInfo: caveInfo || null,
        parkingInfo: parkingInfo || null,
        source: 'constatimmo',
        pageUrl: originUrl || location.href,
      };
    }).filter((e) => e.text);

    const selectors = [
      '.fc-event',
      'a.fc-event',
      '.event',
      '.appointment',
      '.planning .event',
      '.calendar .event',
      'td div[style*="background"]',
      'div[style*="background-color"]',
    ];

    const uniq = new Set();
    const nodes = [];
    for (const sel of selectors) {
      const found = Array.from(document.querySelectorAll(sel));
      for (const el of found) {
        if (uniq.has(el)) continue;
        uniq.add(el);
        nodes.push(el);
      }
    }

    const calendarEvents = nodes.map((el) => {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const title = el.getAttribute('title') || '';
      const href = el.getAttribute('href') || '';
      const detailUrl = /odmRedirect=/i.test(href) ? toAbs(href) : '';
      const odmFromHref = ((detailUrl.match(/odmRedirect=(\d{6,})/i) || [])[1] || '');
      const odmFromText = parseOdmNumber(`${text} ${title}`);
      const odmNumber = odmFromHref || odmFromText || '';
      const style = el.getAttribute('style') || '';
      const className = el.className || '';
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      const computedBg = (computed.backgroundColor || '').toLowerCase();
      const visible = rect.width > 20 && rect.height > 10;
      const isGreen = /rgb\(\s*1?2?\d,\s*1[2-6]\d,\s*1?2?\d\)/.test(computedBg) || computedBg.includes('138, 123');
      const isPurple = computedBg.includes('156, 39, 176') || computedBg.includes('123, 31, 162') || computedBg.includes('103, 58, 183') || computedBg.includes('128, 0, 128');
      const keep = visible && (isGreen || isPurple || /odm/i.test(text));
      return {
        text: text || title || 'Rendez-vous Constatimmo',
        description: title || text || '',
        class: className,
        style: style || `background-color:${computedBg};`,
        computedBg,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        keep,
        odmNumber: odmNumber || null,
        detailUrl: detailUrl || (odmNumber ? buildDetailUrl(odmNumber) : null),
        address: null,
        source: 'constatimmo',
        pageUrl: originUrl || location.href,
      };
    }).filter((e) => e.keep && e.text);

    return [...roadMapEvents, ...calendarEvents];
  }, sourceUrl);
}

async function extractConstatimmoAppointments(page) {
  const fs = require('fs');
  const collected = [];
  collected.push(...await extractConstatimmoFromContext(page, page.url()));

  const frames = page.frames().filter((f) => f !== page.mainFrame());
  for (const frame of frames) {
    try {
      const frameEvents = await extractConstatimmoFromContext(frame, frame.url());
      collected.push(...frameEvents);
    } catch (e) {
      // Certaines frames cross-origin ne sont pas lisibles.
    }
  }

  const dedup = [];
  const seen = new Set();
  for (const evt of collected) {
    const key = `${evt.text}|${evt.style}|${evt.pageUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(evt);
  }

  fs.writeFileSync('constatimmo.appointments.json', JSON.stringify(dedup, null, 2), 'utf-8');
  return dedup;
}

async function loginConstatimmo() {
  if (!CONSTATIMMO_URL || !CONSTATIMMO_USERNAME || !CONSTATIMMO_PASSWORD) {
    console.log('[CONSTATIMMO] Variables manquantes, extraction ignorée.');
    return [];
  }

  const browser = await puppeteer.launch({
    headless: CONSTATIMMO_HEADLESS,
    userDataDir: CONSTATIMMO_USER_DATA_DIR,
    defaultViewport: null,
  });
  const page = await browser.newPage();
  try {
    console.log(`[CONSTATIMMO] Connexion à ${CONSTATIMMO_URL} (profil: ${CONSTATIMMO_USER_DATA_DIR})`);
    await page.goto(CONSTATIMMO_URL, { waitUntil: 'networkidle2' });

    const userSelectors = [
      '#sign_in > div:nth-child(1) > div > input',
      '#sign_in input[type="email"]',
      'input[name="email"]',
      'input[type="email"]',
    ];
    const passSelectors = [
      '#sign_in > div:nth-child(2) > div > input',
      '#sign_in input[type="password"]',
      'input[name="password"]',
      'input[type="password"]',
    ];
    const submitSelectors = [
      '#sign_in > div:nth-child(3) > div.col-xs-4 > button',
      '#sign_in button[type="submit"]',
      'button[type="submit"]',
    ];

    const fillFirstVisible = async (selectors, value) => {
      for (const sel of selectors) {
        const handle = await page.$(sel);
        if (!handle) continue;
        const visible = await page.evaluate((el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length), handle);
        if (!visible) continue;
        await page.click(sel, { clickCount: 3 });
        await page.type(sel, value, { delay: 30 });
        return true;
      }
      return false;
    };

    const userOk = await fillFirstVisible(userSelectors, CONSTATIMMO_USERNAME);
    const passOk = await fillFirstVisible(passSelectors, CONSTATIMMO_PASSWORD);

    if (userOk && passOk) {
      for (const sel of submitSelectors) {
        try {
          const btn = await page.$(sel);
          if (!btn) continue;
          await btn.click();
          break;
        } catch (e) {
          // continuer
        }
      }
      await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
        page.waitForTimeout(6000),
      ]);
    }

    const planningUrl = getConstatimmoPlanningUrl();
    let finalUrl = page.url();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.goto(planningUrl, { waitUntil: 'networkidle2' });
      await page.waitForTimeout(8000);
      finalUrl = page.url();
      const redirectedToSso = /\/sso\/login/i.test(finalUrl);
      if (!redirectedToSso) break;

      console.log(`[CONSTATIMMO] Retour SSO détecté après accès planning (tentative ${attempt}/2): ${finalUrl}`);
      if (attempt < 2) {
        const relogUser = await fillFirstVisible(userSelectors, CONSTATIMMO_USERNAME);
        const relogPass = await fillFirstVisible(passSelectors, CONSTATIMMO_PASSWORD);
        if (relogUser && relogPass) {
          for (const sel of submitSelectors) {
            try {
              const btn = await page.$(sel);
              if (!btn) continue;
              await btn.click();
              break;
            } catch (_) {
              // continuer
            }
          }
          await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
            page.waitForTimeout(6000),
          ]);
        }
      }
    }

    await page.waitForTimeout(4000);
    await dumpConstatimmoDebug(page, 'after-planning-nav');
    if (/\/sso\/login/i.test(finalUrl)) {
      console.log(`[CONSTATIMMO] Session non authentifiée sur planning. URL finale: ${finalUrl}`);
    }

    await page.evaluate(() => {
      const findByText = (txt) => {
        const nodes = Array.from(document.querySelectorAll('a,button,li,span,div'));
        return nodes.find((n) => (n.innerText || '').trim().toLowerCase() === txt);
      };
      const monActivite = findByText('mon activité');
      if (monActivite) (monActivite.closest('a,button,li,div') || monActivite).click();
      const mesDispos = findByText('mes disponibilités');
      if (mesDispos) (mesDispos.closest('a,button,li,div') || mesDispos).click();
    });
    await page.waitForTimeout(4000);

    await page.evaluate(() => {
      const cb = document.querySelector('#comingOrdersCheckbox');
      if (cb && !cb.checked) cb.click();
      if (typeof window.getComingOrders === 'function') {
        window.getComingOrders();
      }
    });
    await page.waitForTimeout(5000);
    await dumpConstatimmoDebug(page, 'before-extraction');

    const events = await extractConstatimmoAppointments(page);
    const enrichedEvents = await enrichConstatimmoAppointments(page, events);
    const enrichedCount = enrichedEvents.filter((evt) => evt && evt.source === 'constatimmo' && (evt.owner || evt.manager || evt.tenant || evt.comment || evt.keyPickupPlace || evt.keyDropPlace || evt.floor || evt.door || evt.digicode || evt.building)).length;
    console.log(`[CONSTATIMMO] ${enrichedEvents.length} événements détectés. Enrichis: ${enrichedCount}.`);
    return enrichedEvents;
  } catch (e) {
    console.log(`[CONSTATIMMO] Extraction en échec: ${e.message}`);
    try {
      await page.screenshot({ path: 'debug_constatimmo_error.png' });
    } catch (_) {
      // ignore
    }
    return [];
  } finally {
    await page.close();
    await browser.close();
  }
}

function classifyEvent(evt) {
  const style = (evt.style || '').toLowerCase();
  const computedBg = (evt.computedBg || '').toLowerCase();
  const text = (evt.text || '').toLowerCase();

  const styleRef = `${style} ${computedBg}`;
  const isRed = styleRef.includes('rgb(207, 36, 36)') || styleRef.includes('rgb(207,36,36)');
  const isBlue = /rgb\(18,\s*17,\s*171\)|rgba\(18,\s*17,\s*171/.test(styleRef);
  const isGreen = /rgb\(17,\s*138,\s*123\)|rgba\(17,\s*138,\s*123/.test(styleRef);
  const isPurple = styleRef.includes('156, 39, 176') || styleRef.includes('123, 31, 162') || styleRef.includes('103, 58, 183') || styleRef.includes('128, 0, 128') || /\bodm\b/.test(text);
  const textSaysEntree = /\bedl\s+entr[ée]e\b|\bentr[ée]e\b|\bentrer\b|\bentrant\b/.test(text);
  const textSaysSortie = /\bedl\s+sortie\b|\bsortie\b|\bsortir\b|\bsortant\b/.test(text);
  const textSaysIndispo = /indisponibilit[ée]/.test(text);
  const isTrajet = /\btrajet\b/.test(text);

  let type = 'autre';
  if (isRed || textSaysIndispo) type = 'indisponibilite';
  else if (textSaysEntree || isBlue) type = 'entree';
  else if (textSaysSortie || isGreen) type = 'sortie';
  else if (isPurple) type = 'odm';

  return {
    color: isPurple ? 'violet' : isGreen ? 'vert' : isBlue ? 'bleu' : isRed ? 'rouge' : 'autre',
    type,
    isTrajet,
  };
}

function buildBusinessAppointments(events) {
  const business = [];
  let sortieCount = 0;
  let entreeCount = 0;
  let odmCount = 0;
  let skippedRed = 0;
  let skippedTrajet = 0;
  const sourceCounts = { snexi: 0, constatimmo: 0, unknown: 0 };

  for (const evt of events) {
    const meta = classifyEvent(evt);
    if (meta.type === 'indisponibilite') {
      skippedRed++;
      continue;
    }
    if (meta.isTrajet) {
      skippedTrajet++;
      continue;
    }
    if (meta.type !== 'entree' && meta.type !== 'sortie' && meta.type !== 'odm') {
      continue;
    }
    if (meta.type === 'sortie') sortieCount++;
    if (meta.type === 'entree') entreeCount++;
    if (meta.type === 'odm') odmCount++;
    const source = evt.source || 'unknown';
    if (source === 'snexi') sourceCounts.snexi++;
    else if (source === 'constatimmo') sourceCounts.constatimmo++;
    else sourceCounts.unknown++;
    business.push({ ...evt, meta, source });
  }

  return {
    business,
    stats: {
      total: events.length,
      kept: business.length,
      sortieCount,
      entreeCount,
      odmCount,
      skippedRed,
      skippedTrajet,
      sourceCounts,
    },
  };
}

// Authentification Google et synchronisation des événements
async function syncToGoogleCalendar(events) {
  const fs = require('fs');
  const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
  const defaultCalendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const osCalendarId = process.env.GOOGLE_CALENDAR_OS_ID || defaultCalendarId;
  const odmCalendarId = process.env.GOOGLE_CALENDAR_ODM_ID || defaultCalendarId;
  const dryRun = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  const repairWrongDates = process.argv.includes('--repair-wrong-dates') || String(process.env.REPAIR_WRONG_DATES || '').toLowerCase() === 'true';

  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
  } catch (e) {
    console.error('Erreur de lecture des credentials Google :', e.message);
    throw e;
  }

  const { client_email, private_key } = credentials;
  const auth = new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/calendar']);
  const calendar = google.calendar({ version: 'v3', auth });

  const buildDateTime = (dateIso, timeHHmm) => `${dateIso}T${(timeHHmm || '08:00').padStart(5, '0')}:00`;
  const addMinutes = (dateIso, timeHHmm, minutes) => {
    const [h, m] = String(timeHHmm || '08:00').split(':').map(Number);
    const dt = new Date(`${dateIso}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
    dt.setMinutes(dt.getMinutes() + minutes);
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `${dateIso}T${hh}:${mm}:00`;
  };
  const parseDateFromText = (text) => {
    const m = String(text || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  };
  const parseTimesFromText = (text) => {
    const s = String(text || '');
    const range = s.match(/\b(\d{1,2}:\d{2})\s*[\-–]\s*(\d{1,2}:\d{2})\b/);
    if (range) return { start: range[1].padStart(5, '0'), end: range[2].padStart(5, '0') };
    const one = s.match(/\b(\d{1,2}:\d{2})\b/);
    if (one) return { start: one[1].padStart(5, '0'), end: null };
    return { start: null, end: null };
  };
  const eventCalendarId = (evt, meta) => {
    if (meta.type === 'odm' || /\bodm\b/i.test(evt.text || '')) return odmCalendarId;
    return osCalendarId;
  };
  const extractOdmNumber = (value) => {
    const src = String(value || '');
    const fromRedirect = src.match(/odmRedirect=(\d{6,})/i);
    if (fromRedirect && fromRedirect[1]) return fromRedirect[1];
    const tagged = src.match(/\bodm\b[^\d]{0,20}(\d{6,})\b/i);
    if (tagged && tagged[1]) return tagged[1];
    const fallback = src.match(/\b(\d{6,})\b/);
    return fallback ? fallback[1] : '';
  };
  const getDedupFamily = (evt, meta) => {
    const isOdm = (evt.source === 'constatimmo') || meta.type === 'odm' || /\bodm\b/i.test(evt.text || '');
    return isOdm ? 'odm' : 'os';
  };
  const getEventRefNumber = (evt, meta) => {
    const family = getDedupFamily(evt, meta);
    if (family === 'odm') {
      const byField = compactText(evt.odmNumber || '');
      const byText = extractOdmNumber(`${evt.text || ''} ${evt.description || ''}`);
      const byUrl = extractOdmNumber(evt.detailUrl || '');
      return { family, number: byField || byText || byUrl || '' };
    }
    const byFieldRaw = compactText(evt.osNumber || '');
    const byField = extractOsNumber(byFieldRaw);
    const byText = extractOsNumber(`${evt.text || ''} ${evt.description || ''}`);
    return { family, number: byField || byText || byFieldRaw || '' };
  };
  const getGoogleEventRefNumber = (ev, family) => {
    const src = `${ev.summary || ''} ${ev.description || ''} ${ev.location || ''}`;
    return family === 'odm' ? extractOdmNumber(src) : extractOsNumber(src);
  };
  const normalizeForDup = (str) => String(str || '').trim().toLowerCase();
  const buildGoogleSummary = (evt, meta) => {
    const isOdm = getDedupFamily(evt, meta) === 'odm';
    const family = isOdm ? 'ODM' : 'OS';
    const suffix = meta.type === 'entree' ? 'E' : 'S';
    return `${family} ${suffix}`;
  };
  const buildLegacySummaries = (evt) => {
    const raw = String(evt.text || 'Rendez-vous Snexi').substring(0, 100);
    return [raw].filter(Boolean);
  };
  const buildOdmContactDescription = (evt) => {
    const owner = compactText(evt.owner || '');
    const tenant = compactText(evt.tenant || '');
    const phone = compactText(evt.tenantMobile || evt.tenantPhone || '');
    const contactParts = [
      owner ? `Proprietaire: ${owner}` : '',
      tenant ? `Locataire: ${tenant}` : '',
      phone ? `Telephone locataire: ${phone}` : '',
    ].filter(Boolean);
    if (contactParts.length === 0) return compactText(evt.description || evt.text || '');

    const base = compactText(evt.description || evt.text || '');
    const hasOwner = /\bproprietaire\s*:/i.test(base);
    const hasTenant = /\blocataire\s*:/i.test(base);
    const hasPhone = /\b(?:portable|telephone)\s+locataire\s*:/i.test(base);
    if (hasOwner && hasTenant && hasPhone) return base;

    return [base, ...contactParts].filter(Boolean).join(' | ');
  };
  const isManagedSummary = (summary) => /^(os|odm)\s+[es]$/i.test(String(summary || '').trim()) || /\bos\s*n°|\bodm\b/i.test(summary || '');

  try {
    await auth.authorize();
  } catch (e) {
    console.error('[GOOGLE] Authentification impossible :', e.message);
    console.error('[GOOGLE] Vérifiez le compte de service, les clés JSON et le partage du calendrier cible.');
    return;
  }

  let existingEvents = [];
  try {
    const now = new Date();
    const timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14).toISOString();
    const timeMax = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 120).toISOString();
    const collect = async (cid) => {
      const res = await calendar.events.list({ calendarId: cid, timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 2500 });
      return (res.data.items || []).map((e) => ({ ...e, _calendarId: cid }));
    };
    const parts = [];
    parts.push(...await collect(osCalendarId));
    if (odmCalendarId !== osCalendarId) {
      parts.push(...await collect(odmCalendarId));
    }
    existingEvents = parts;
  } catch (e) {
    console.warn('Impossible de récupérer les événements existants pour la détection des doublons.');
  }

  if (repairWrongDates) {
    const todayIso = new Date().toISOString().slice(0, 10);
    let removed = 0;
    for (const ev of existingEvents) {
      const isTarget = isManagedSummary(ev.summary || '');
      const startIso = (ev.start && (ev.start.dateTime || ev.start.date) || '').slice(0, 10);
      if (!isTarget || startIso !== todayIso) continue;
      try {
        if (dryRun) {
          removed++;
        } else {
          await calendar.events.delete({ calendarId: ev._calendarId || defaultCalendarId, eventId: ev.id });
          removed++;
        }
      } catch (_) {
        // continuer
      }
    }
    if (removed > 0) {
      console.log(dryRun
        ? `[REPAIR][DRY_RUN] ${removed} événements mal datés (aujourd'hui) seraient supprimés.`
        : `[REPAIR] ${removed} événements mal datés (aujourd'hui) supprimés.`);
      existingEvents = existingEvents.filter((ev) => {
        const isTarget = isManagedSummary(ev.summary || '');
        const startIso = (ev.start && (ev.start.dateTime || ev.start.date) || '').slice(0, 10);
        return !(isTarget && startIso === todayIso);
      });
    }
  }

  let createdCount = 0;
  let skippedCount = 0;

  for (const evt of events) {
    const meta = classifyEvent(evt);
    if (meta.type === 'indisponibilite' || meta.isTrajet) {
      skippedCount++;
      continue;
    }

    const parsedDate = evt.date || parseDateFromText(evt.text) || parseDateFromText(evt.description) || null;
    const t = parseTimesFromText(`${evt.startTime || ''} ${evt.endTime || ''} ${evt.timeRaw || ''} ${evt.text || ''}`);
    const startTime = evt.startTime || t.start || '08:00';
    const endTime = evt.endTime || t.end || null;
    if (!parsedDate) {
      console.warn('[SYNC] Date introuvable, événement ignoré :', evt.text || evt.description || 'sans titre');
      skippedCount++;
      continue;
    }

    const startIso = buildDateTime(parsedDate, startTime);
    const endIso = endTime ? buildDateTime(parsedDate, endTime) : addMinutes(parsedDate, startTime, 45);
    const summary = buildGoogleSummary(evt, meta);
    const candidateSummaries = [summary, ...buildLegacySummaries(evt)].map(normalizeForDup);
    const targetCalendarId = eventCalendarId(evt, meta);
    const startKey = startIso.slice(0, 16);
    const ref = getEventRefNumber(evt, meta);
    const isOdmEvent = getDedupFamily(evt, meta) === 'odm';
    const finalDescription = isOdmEvent ? buildOdmContactDescription(evt) : (evt.description || evt.text || '');

    const gEvent = {
      summary,
      location: evt.address || '',
      description: finalDescription,
      start: { dateTime: startIso, timeZone: 'Europe/Paris' },
      end: { dateTime: endIso, timeZone: 'Europe/Paris' },
    };

    const duplicateByRef = ref.number ? existingEvents.find((ev) => {
      if ((ev._calendarId || targetCalendarId) !== targetCalendarId) return false;
      const evStart = (ev.start && ev.start.dateTime ? ev.start.dateTime.slice(0, 16) : '');
      if (evStart !== startKey) return false;
      const evRef = getGoogleEventRefNumber(ev, ref.family);
      return evRef === ref.number;
    }) : null;

    if (duplicateByRef) {
      skippedCount++;
      console.log(`[SYNC][DOUBLON] ${ref.family.toUpperCase()} ${ref.number} deja present au meme debut (${startIso}) - ignore.`);
      continue;
    }

    const duplicateEvent = existingEvents.find((ev) => {
      if ((ev._calendarId || targetCalendarId) !== targetCalendarId) return false;
      const evSummary = normalizeForDup(ev.summary);
      const evStart = (ev.start && ev.start.dateTime ? ev.start.dateTime.slice(0, 16) : '');
      return candidateSummaries.includes(evSummary) && evStart === startKey;
    });

    if (duplicateEvent) {
      const existingLocation = String(duplicateEvent.location || '').trim();
      const existingDescription = String(duplicateEvent.description || '').trim();
      const newLocation = String(gEvent.location || '').trim();
      const newDescription = String(gEvent.description || '').trim();
      const existingSummary = String(duplicateEvent.summary || '').trim();
      const needsUpdate = existingSummary !== gEvent.summary || existingLocation !== newLocation || existingDescription !== newDescription;

      if (!needsUpdate) {
        skippedCount++;
        continue;
      }

      if (dryRun) {
        createdCount++;
        console.log('[DRY_RUN] Événement existant serait mis à jour :', gEvent.summary, gEvent.start.dateTime, 'calendar=', targetCalendarId);
        continue;
      }

      try {
        await calendar.events.patch({
          calendarId: targetCalendarId,
          eventId: duplicateEvent.id,
          resource: {
            summary: gEvent.summary,
            location: gEvent.location,
            description: gEvent.description,
          },
        });
        createdCount++;
        duplicateEvent.summary = gEvent.summary;
        duplicateEvent.location = gEvent.location;
        duplicateEvent.description = gEvent.description;
        console.log('♻️ [Google Calendar] Événement mis à jour :', gEvent.summary, 'ID:', duplicateEvent.id, 'calendar=', targetCalendarId);
      } catch (e) {
        console.error('Erreur lors de la mise à jour d’un événement Google Calendar :', e.message);
      }
      continue;
    }

    if (dryRun) {
      createdCount++;
      console.log('[DRY_RUN] Événement prêt à créer :', gEvent.summary, gEvent.start.dateTime, 'calendar=', targetCalendarId);
      continue;
    }

    try {
      const res = await calendar.events.insert({ calendarId: targetCalendarId, resource: gEvent });
      createdCount++;
      console.log('✅ [Google Calendar] Événement ajouté :', gEvent.summary, 'ID:', res.data.id, 'calendar=', targetCalendarId);
      existingEvents.push({
        summary: gEvent.summary,
        description: gEvent.description,
        location: gEvent.location,
        start: { dateTime: gEvent.start.dateTime },
        _calendarId: targetCalendarId,
      });
    } catch (e) {
      console.error('Erreur lors de l’ajout d’un événement Google Calendar :', e.message);
    }
  }

  console.log(`[SYNC] Créés: ${createdCount} | Ignorés: ${skippedCount}`);
}

// Point d'entrée principal pour lancer la synchronisation Snexi (doit être à la toute fin du fichier)
if (require.main === module) {
  (async () => {
    try {
      const fs = require('fs');
      const CACHE_FILE = 'appointments.cache.json';
      const FILTERED_FILE = 'appointments.filtered.json';
      const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h
      const syncOnly = process.argv.includes('--sync-only');

      if (syncOnly) {
        // Mode sync-only : charge le cache si < 2h, sinon fallback sur appointments.filtered.json récent
        let cachedEvents = null;
        let ageMinutes = null;

        if (fs.existsSync(CACHE_FILE)) {
          const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
          if (Array.isArray(cache.events) && typeof cache.timestamp === 'number') {
            const age = Date.now() - cache.timestamp;
            if (age <= CACHE_TTL_MS) {
              cachedEvents = cache.events;
              ageMinutes = Math.round(age / 60000);
            }
          }
        }

        if (!cachedEvents && fs.existsSync(FILTERED_FILE)) {
          const stat = fs.statSync(FILTERED_FILE);
          const age = Date.now() - stat.mtimeMs;
          if (age <= CACHE_TTL_MS) {
            const events = JSON.parse(fs.readFileSync(FILTERED_FILE, 'utf-8'));
            if (Array.isArray(events)) {
              cachedEvents = events;
              ageMinutes = Math.round(age / 60000);
              fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), events }, null, 2), 'utf-8');
            }
          }
        }

        if (!cachedEvents) {
          console.error('[SYNC-ONLY] Aucun jeu d\'événements valide (<2h). Lance npm start pour relancer l\'extraction.');
          process.exit(1);
        }

        console.log(`[SYNC-ONLY] Données valides (${ageMinutes} min) — ${cachedEvents.length} événements.`);
        await syncToGoogleCalendar(cachedEvents);
        console.log('--- Synchronisation terminée (sync-only) ---');
        return;
      }

      console.log('--- Démarrage de la synchronisation Snexi vers Google Calendar ---');
      const browser = await puppeteer.launch({ headless: false });
      const page = await browser.newPage();
      let snexiEvents = [];
      try {
        const snexiEventsRaw = await loginSnexi(page);
        const snexiTagged = snexiEventsRaw.map((e) => ({ ...e, source: 'snexi' }));
        snexiEvents = await enrichSnexiAppointments(page, snexiTagged);
      } catch (e) {
        console.log(`[SNEXI] Extraction en échec, poursuite avec Constatimmo uniquement: ${e.message}`);
      }
      const constatimmoEvents = await loginConstatimmo();
      const allEvents = [...snexiEvents, ...constatimmoEvents];
      console.log(`Nombre d'événements extraits : ${allEvents.length} (Snexi: ${snexiEvents.length}, Constatimmo: ${constatimmoEvents.length})`);
      const { business, stats } = buildBusinessAppointments(allEvents);
      fs.writeFileSync('appointments.filtered.json', JSON.stringify(business, null, 2), 'utf-8');
      fs.writeFileSync('appointments.stats.json', JSON.stringify(stats, null, 2), 'utf-8');
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ timestamp: Date.now(), events: business }, null, 2), 'utf-8');
      console.log(`[FILTRE] Conservés: ${stats.kept} | Sorties: ${stats.sortieCount} | Entrées: ${stats.entreeCount} | ODM: ${stats.odmCount} | Indispo ignorées: ${stats.skippedRed} | Trajets ignorés: ${stats.skippedTrajet} | Sources: ${JSON.stringify(stats.sourceCounts)}`);
      await syncToGoogleCalendar(business);
      await browser.close();
      console.log('--- Synchronisation terminée ---');
    } catch (err) {
      console.error('Erreur lors de la synchronisation Snexi :', err);
      process.exit(1);
    }
  })();
}
