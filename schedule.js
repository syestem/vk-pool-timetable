/* ===============================
   ENV & VK INIT (SAFE)
================================ */
const isVK = typeof window.vkBridge !== 'undefined';

if (isVK) {
  vkBridge.send('VKWebAppInit').catch(() => {});
  vkBridge.subscribe(e => {
    if (e.detail.type === 'VKWebAppUpdateConfig') {
      document.body.classList.toggle(
        'dark',
        e.detail.data.scheme.includes('dark')
      );
    }
  });
}

/* ===============================
   CONSTANTS
================================ */
const SHEET_ID_TIMETABLE = '11yaPysnuMfkXtwvZSOOohogKnvT0py7rWuKNyAs5ud8';
const SCHEDULE_INDEX_GID = 887181046;

const DAYS = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье'
];

/* ===============================
   STATE
================================ */
let scheduleIndex = [];
let parsed = {};
let activeDay = null;
let activePool = 'big';
let minFreeLanes = 0;

/* ===============================
   DOM
================================ */
const titleEl = document.getElementById('title');
const contentEl = document.getElementById('scheduleContent');
const dayTabsEl = document.getElementById('dayTabs');
const poolBtns = document.querySelectorAll('[data-pool]');
const filterBtns = document.querySelectorAll('[data-filter]');
const showAllBtn = document.getElementById('showAllBtn');

/* ===============================
   INIT
================================ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  titleEl.textContent = `Расписание бассейна на ${getCurrentMonth()}`;

  bindUI();

  if (scheduleIndex.length === 0) {
    await loadScheduleIndex();
  }

  await loadScheduleForCurrentMonth();
  scheduleMidnightSwitch();
}

/* ===============================
   UI BINDINGS
================================ */
function bindUI() {
  poolBtns.forEach(btn => {
    btn.onclick = async () => {
      poolBtns.forEach(b => b.classList.remove('primary'));
      btn.classList.add('primary');
      activePool = btn.dataset.pool;
      await loadScheduleForCurrentMonth();
    };
  });

  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove('primary'));
      btn.classList.add('primary');
      minFreeLanes = Number(btn.dataset.filter);
      renderDay();
    };
  });

  showAllBtn.onclick = () => {
    minFreeLanes = 0;
    filterBtns.forEach(b => b.classList.remove('primary'));
    renderDay();
  };
}

/* ===============================
   DATA LOAD
================================ */
async function loadScheduleIndex() {
  const text = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID_TIMETABLE}/export?format=csv&gid=${SCHEDULE_INDEX_GID}`
  ).then(r => r.text());

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  scheduleIndex = lines.slice(1).map(l => {
    const c = l.split(',');
    return {
      month: normalize(c[0]),
      big: c[1] ? Number(c[1]) : null,
      small: c[2] ? Number(c[2]) : null
    };
  });
}

async function loadScheduleForCurrentMonth() {
  const entry = findMonth();
  if (!entry || !entry[activePool]) {
    contentEl.innerHTML = '<div class="slot empty">Нет расписания</div>';
    return;
  }

  const rows = await fetchCSV(entry[activePool]);
  parsed = parseSchedule(rows);

  const today = getCurrentWeekDay();
  activeDay = parsed[today] ? today : Object.keys(parsed)[0];

  renderDayTabs();
  renderDay();
}

async function fetchCSV(gid) {
  const text = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID_TIMETABLE}/export?format=csv&gid=${gid}`
  ).then(r => r.text());

  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(r => r.split(','));
}

/* ===============================
   PARSER
================================ */
function parseSchedule(rows) {
  const result = {};
  const timeRow = rows.findIndex(r => r[0]?.toLowerCase().includes('время'));
  if (timeRow === -1) return result;

  const times = [];
  const cols = [];

  rows[timeRow].forEach((c, i) => {
    if (/\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/.test(c)) {
      times.push(c.trim());
      cols.push(i);
    }
  });

  for (let i = timeRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row?.[0]) continue;

    if (DAYS.includes(row[0])) {
      const day = row[0];
      result[day] = times.map(t => ({
        time: t,
        lanes: []
      }));

      let r = i + 1;
      while (r < rows.length && !DAYS.includes(rows[r]?.[0])) {
        const lane = Number(rows[r]?.[2]);
        if (lane >= 1 && lane <= 6) {
          cols.forEach((col, idx) => {
            result[day][idx].lanes.push({
              lane,
              busy: Boolean(rows[r][col]?.trim())
            });
          });
        }
        r++;
      }
      i = r - 1;
    }
  }

  return result;
}

/* ===============================
   RENDER
================================ */
function renderDayTabs() {
  dayTabsEl.innerHTML = '';
  Object.keys(parsed).forEach(day => {
    const b = document.createElement('button');
    b.textContent = day;
    b.className = day === activeDay ? 'active' : '';
    b.onclick = () => {
      activeDay = day;
      renderDayTabs();
      renderDay();
    };
    dayTabsEl.appendChild(b);
  });
}

function renderDay() {
  contentEl.innerHTML = '';
  const today = getCurrentWeekDay();

  parsed[activeDay].forEach(slot => {
    const total = slot.lanes.length;
    const free = slot.lanes.filter(l => !l.busy).length;

    if (free < minFreeLanes) return;

    const isNow = activeDay === today && isNowInSlot(slot.time);

    const div = document.createElement('div');
    div.className = `slot${isNow ? ' now' : ''}`;

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

  if (!contentEl.children.length) {
    contentEl.innerHTML = `<div class="slot empty">Нет подходящих слотов</div>`;
  }

  if (activeDay === today) {
    setTimeout(() => {
      document.querySelector('.slot.now')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 0);
  }
}

/* ===============================
   HELPERS
================================ */
function normalize(s = '') {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

function findMonth() {
  return scheduleIndex.find(m => m.month === normalize(getCurrentMonth()));
}

function getCurrentMonth() {
  const d = new Date();
  return d.toLocaleString('ru-RU', { month: 'long' })
    .replace(/^./, c => c.toUpperCase()) + ' ' + d.getFullYear();
}

function getCurrentWeekDay() {
  const d = new Date().getDay();
  return DAYS[d === 0 ? 6 : d - 1];
}

function isNowInSlot(t) {
  const [s, e] = t.split('-');
  const now = new Date();
  const a = s.split(':').map(Number);
  const b = e.split(':').map(Number);
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(a[0], a[1], 0, 0);
  end.setHours(b[0], b[1], 0, 0);
  return now >= start && now <= end;
}

/* ===============================
   MIDNIGHT SWITCH
================================ */
function scheduleMidnightSwitch() {
  const now = new Date();
  const ms =
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;

  setTimeout(() => {
    const today = getCurrentWeekDay();
    if (parsed[today]) {
      activeDay = today;
      renderDayTabs();
      renderDay();
    }
    scheduleMidnightSwitch();
  }, ms + 1000);
}
