/* ================= VK INIT ================= */
const isVK = typeof window.vkBridge !== 'undefined';
if (isVK) vkBridge.send('VKWebAppInit').catch(() => {});

/* ================= CONSTANTS ================= */
const SHEET_ID = '11yaPysnuMfkXtwvZSOOohogKnvT0py7rWuKNyAs5ud8';
const INDEX_GID = 887181046;
const FALLBACK_SCHEDULES = {
  big: './fallback/big.csv',
  small: './fallback/small.csv'
};
const THEME_ICONS = {
  dark: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20 15.2A8.2 8.2 0 0 1 8.8 4 8.9 8.9 0 1 0 20 15.2Z" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.9"/><path d="M12 2.75V5.1M12 18.9v2.35M21.25 12H18.9M5.1 12H2.75M18.54 5.46l-1.66 1.66M7.12 16.88l-1.66 1.66M18.54 18.54l-1.66-1.66M7.12 7.12 5.46 5.46" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>'
};

const DAYS = [
  'Понедельник','Вторник','Среда',
  'Четверг','Пятница','Суббота','Воскресенье'
];

/* ================= STATE ================= */
let scheduleIndex = [];
let parsed = {};
let activeDay = null;
let activePool = 'big';
let minFreeLanes = 0;
let midnightTimerId = null;
let currentRequestId = 0;
let indexPromise = null;
const laneFilter = document.getElementById('laneFilter');
const showAllBtn = document.getElementById('showAllBtn');
const themeToggle = document.getElementById('themeToggle');
const themeToggleText = document.getElementById('themeToggleText');
const themeToggleIcon = document.getElementById('themeToggleIcon');

laneFilter.onchange = () => {
  minFreeLanes = Number(laneFilter.value);
  renderDay();
};

showAllBtn.onclick = () => {
  minFreeLanes = 0;
  laneFilter.value = '0';
  renderDay();
};

themeToggle.onclick = () => {
  const nextTheme = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
};
/* ================= DOM ================= */
const titleEl = document.getElementById('title');
const contentEl = document.getElementById('scheduleContent');
const dayTabs = document.getElementById('dayTabs');
const poolBtns = document.querySelectorAll('[data-pool]');

poolBtns.forEach(btn => {
  btn.onclick = () => {
    if (activePool === btn.dataset.pool) return;

    poolBtns.forEach(b => b.classList.remove('primary'));
    btn.classList.add('primary');
    activePool = btn.dataset.pool;
    init();
  };
});

/* ================= INIT ================= */
initTheme();
init();

async function init() {
  const requestId = ++currentRequestId;
  titleEl.textContent = `Расписание бассейна на ${getCurrentMonth()}`;

  try {
    if (!scheduleIndex.length) await loadIndex();

    const entry = findMonth();
    const rows = await loadScheduleRows(activePool, entry?.[activePool]);
    if (requestId !== currentRequestId) return;

    parsed = parseSchedule(rows);

    const today = getToday();
    activeDay = parsed[today] ? today : Object.keys(parsed)[0] || null;

    renderDayTabs();
    renderDay();
    scheduleMidnightSwitch();
  } catch (error) {
    if (requestId !== currentRequestId) return;

    parsed = {};
    activeDay = null;
    dayTabs.innerHTML = '';
    showMessage('Не удалось загрузить расписание');
    console.error('Failed to initialize schedule', error);
  }
}

/* ================= FETCH ================= */
async function loadIndex() {
  if (indexPromise) {
    await indexPromise;
    return;
  }

  indexPromise = loadIndexOnce();
  await indexPromise;
}

async function loadIndexOnce() {
  const text = await fetchSheetText(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${INDEX_GID}`
  );

  scheduleIndex = parseCSV(text).slice(1).reduce((acc, c) => {
    if (!c[0]) return acc;
    acc.push({
      month: c[0].trim(),
      big: c[1] ? Number(c[1]) : null,
      small: c[2] ? Number(c[2]) : null
    });
    return acc;
  }, []);
}

async function fetchCSV(gid) {
  const text = await fetchSheetText(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  );
  return parseCSV(text);
}

async function fetchLocalCSV(path) {
  const text = await fetchSheetText(path);
  return parseCSV(text);
}

async function loadScheduleRows(pool, gid) {
  if (gid) {
    try {
      return await fetchCSV(gid);
    } catch (error) {
      console.warn(`Failed to load remote schedule for pool '${pool}'`, error);
    }
  }

  const fallbackPath = FALLBACK_SCHEDULES[pool];
  if (!fallbackPath) {
    throw new Error(`No fallback schedule configured for pool '${pool}'`);
  }

  return fetchLocalCSV(fallbackPath);
}

/* ================= PARSER ================= */
function parseSchedule(rows) {
  const res = {};

  const timeRow = rows.findIndex(row =>
    row.some(cell => isTimeHeaderCell(cell))
  );
  if (timeRow === -1) return res;

  const times = [];
  const cols = [];

  rows[timeRow].forEach((c, idx) => {
    if (isTimeRange(c)) {
      times.push(normalizeCell(c));
      cols.push(idx);
    }
  });

  if (!times.length) return res;

  for (let i = timeRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const day = getDayName(row);
    if (!row || !day) continue;

    res[day] = times.map(t => ({ time: t, lanes: [] }));

    let r = i;

    while (rows[r] && (r === i || !getDayName(rows[r]))) {
      const lane = getLaneNumber(rows[r]);

      if (lane !== null) {
        cols.forEach((col, idx) => {
          const cell = rows[r][col];
          res[day][idx].lanes.push({
            lane,
            busy: Boolean(cell && cell.trim())
          });
        });
      }

      r++;
    }

    i = r - 1; // перескакиваем обработанные строки
  }

  return res;
}

/* ================= RENDER ================= */
function renderDayTabs() {
  dayTabs.innerHTML = '';
  Object.keys(parsed).forEach(day => {
    const button = document.createElement('button');
    button.textContent = day;
    button.className = day === activeDay ? 'active' : '';
    button.onclick = () => {
      activeDay = day;
      renderDayTabs();
      renderDay();
    };
    dayTabs.appendChild(button);
  });
}

function renderDay() {
  contentEl.innerHTML = '';

  const daySlots = parsed[activeDay];
  if (!daySlots?.length) {
    showMessage('Нет данных на этот день');
    return;
  }

  const maxFree = Math.max(
    ...daySlots.map(s => s.lanes.filter(l => !l.busy).length),
    0
  );

  const today = getToday();

  daySlots.forEach(slot => {
    const total = slot.lanes.length;
    const free = slot.lanes.filter(l => !l.busy).length;

    if (free < minFreeLanes) return;

    const isNow = activeDay === today && isNowIn(slot.time);

    const div = document.createElement('div');
    const isBest = free === maxFree && maxFree > 0;

    div.className =
      'slot' +
      (isNow ? ' now' : '') +
      (isBest ? ' best' : '');

    div.innerHTML = `
      <div class="time">
        ${slot.time}
        <span class="count">Свободно: ${free}/${total}</span>
        ${isNow ? '<span class="badge now">СЕЙЧАС</span>' : ''}
        ${free === 0 ? '<span class="badge full">Все дорожки заняты</span>' : ''}
      </div>
      <div class="lanes">
        ${slot.lanes.map(l =>
          `<span class="lane ${l.busy ? 'busy' : 'free'}">${l.lane}</span>`
        ).join('')}
      </div>
    `;

    contentEl.appendChild(div);
  });

  if (!contentEl.children.length) showMessage('Нет подходящих слотов');

  if (activeDay === today) {
    setTimeout(() => {
      document.querySelector('.slot.now')
        ?.scrollIntoView({ block: 'center' });
    }, 0);
  }
}

/* ================= HELPERS ================= */
function getCurrentMonth() {
  const date = new Date();
  return date.toLocaleString('ru-RU', { month: 'long' })
    .replace(/^./, c => c.toUpperCase()) + ' ' + date.getFullYear();
}
function getToday() {
  const dayIndex = new Date().getDay();
  return DAYS[dayIndex === 0 ? 6 : dayIndex - 1];
}
function isNowIn(timeRange) {
  const now = new Date();
  const [start, end] = timeRange.split('-').map(value => {
    const [hours, minutes] = value.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  });
  return now >= start && now <= end;
}
function findMonth() {
  const month = getCurrentMonth().toLowerCase();
  return scheduleIndex.find(entry => entry.month.toLowerCase() === month);
}

function showMessage(message) {
  const messageEl = document.createElement('div');
  messageEl.className = 'slot empty';
  messageEl.textContent = message;
  contentEl.replaceChildren(messageEl);
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const preferredTheme = 'dark';

  applyTheme(savedTheme || preferredTheme);
}

function applyTheme(theme) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  const isDark = normalizedTheme === 'dark';

  document.body.dataset.theme = normalizedTheme;
  localStorage.setItem('theme', normalizedTheme);
  themeToggleText.textContent = isDark ? 'Светлая тема' : 'Темная тема';
  themeToggleIcon.innerHTML = isDark ? THEME_ICONS.light : THEME_ICONS.dark;
}

async function fetchSheetText(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.text();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  const normalizedText = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i];
    const nextChar = normalizedText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      row.push(value);
      if (row.some(cell => cell.length > 0)) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  row.push(value);
  if (row.some(cell => cell.length > 0)) rows.push(row);

  return rows;
}

function normalizeCell(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeCell(value).toLowerCase().replace(/\s+/g, ' ');
}

function isTimeRange(value) {
  return /\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/.test(normalizeCell(value));
}

function isTimeHeaderCell(value) {
  const normalized = normalizeKey(value);
  return normalized.includes('время') || isTimeRange(value);
}

function getDayName(row) {
  if (!row) return null;

  for (const cell of row) {
    const day = DAYS.find(name => normalizeKey(cell) === name.toLowerCase());
    if (day) return day;
  }

  return null;
}

function getLaneNumber(row) {
  if (!row) return null;

  for (const cell of row) {
    const normalized = normalizeCell(cell);
    if (!/^\d{1,2}$/.test(normalized)) continue;

    const lane = Number(normalized);
    if (lane > 0 && lane <= 20) return lane;
  }

  return null;
}

/* ================= MIDNIGHT ================= */
function scheduleMidnightSwitch() {
  clearTimeout(midnightTimerId);
  const now = new Date();
  const ms = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  midnightTimerId = setTimeout(() => {
    activeDay = getToday();
    renderDayTabs();
    renderDay();
    scheduleMidnightSwitch();
  }, ms + 1000);
}
