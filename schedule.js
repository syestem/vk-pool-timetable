const SHEET_ID_TIMETABLE = '11yaPysnuMfkXtwvZSOOohogKnvT0py7rWuKNyAs5ud8';
const SCHEDULE_INDEX_GID = 887181046;

const DAYS = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

let scheduleIndex = [];
let parsed = {};
let activeDay = null;
let activePool = 'big';
let onlyFree = false;
let minConsecutive = 1;

const content = document.getElementById('scheduleContent');
const dayTabs = document.getElementById('dayTabs');
const titleEl = document.getElementById('title');
const poolButtons = document.querySelectorAll('[data-pool]');
const onlyFreeBtn = document.getElementById('onlyFreeBtn');
const showAllBtn = document.getElementById('showAllBtn');
const laneFilter = document.getElementById('laneFilter');

init();

async function init() {
  titleEl.textContent = `Расписание бассейна на ${getCurrentMonth()}`;

  poolButtons.forEach(btn => {
    btn.onclick = () => {
      poolButtons.forEach(b => b.classList.remove('primary'));
      btn.classList.add('primary');
      activePool = btn.dataset.pool;
      init();
    };
  });

  onlyFreeBtn.onclick = () => {
    onlyFree = !onlyFree;
    onlyFreeBtn.classList.toggle('primary', onlyFree);
    renderDay();
  };

  showAllBtn.onclick = () => {
    onlyFree = false;
    onlyFreeBtn.classList.remove('primary');
    renderDay();
  };

  laneFilter.onchange = e => {
    minConsecutive = Number(e.target.value);
    renderDay();
  };

  if (!scheduleIndex.length) await loadIndex();

  const entry = findMonth();
  if (!entry || !entry[activePool]) {
    content.textContent = 'Нет расписания';
    return;
  }

  const rows = await fetchCSV(entry[activePool]);
  parsed = parseLaneSchedule(rows);

  const today = getCurrentWeekDay();
  activeDay = parsed[today] ? today : Object.keys(parsed)[0];

  renderDayTabs();
  renderDay();
  scheduleMidnightSwitch();
}

/* ===== FETCH ===== */

async function loadIndex() {
  const text = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID_TIMETABLE}/export?format=csv&gid=${SCHEDULE_INDEX_GID}`
  ).then(r => r.text());

  text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).forEach(l => {
    const c = l.split(',');
    if (!c[0]) return;
    scheduleIndex.push({
      month: c[0].trim(),
      big: c[1] ? Number(c[1]) : null,
      small: c[2] ? Number(c[2]) : null
    });
  });
}

async function fetchCSV(gid) {
  const text = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID_TIMETABLE}/export?format=csv&gid=${gid}`
  ).then(r => r.text());

  return text.replace(/^\uFEFF/, '').split(/\r?\n/).map(r => r.split(','));
}

/* ===== PARSER ===== */

function parseLaneSchedule(rows) {
  const res = {};
  const timeRow = rows.findIndex(r => r[0]?.toLowerCase().includes('время'));
  if (timeRow === -1) return res;

  const times = [];
  const cols = [];

  rows[timeRow].forEach((c, i) => {
    if (/\d{1,2}:\d{2}-\d{1,2}:\d{2}/.test(c)) {
      times.push(c.trim());
      cols.push(i);
    }
  });

  for (let i = timeRow + 1; i < rows.length; i++) {
    if (!DAYS.includes(rows[i][0])) continue;
    const day = rows[i][0];
    res[day] = times.map(t => ({ time: t, lanes: [] }));

    // дорожка 1 — в строке дня
    cols.forEach((c, idx) => {
      res[day][idx].lanes.push({
        lane: 1,
        busy: Boolean(rows[i][c]?.trim())
      });
    });

    let r = i + 1;
    while (r < rows.length && !DAYS.includes(rows[r][0])) {
      const lane = Number(rows[r][2]);
      if (lane >= 2 && lane <= 6) {
        cols.forEach((c, idx) => {
          res[day][idx].lanes.push({
            lane,
            busy: Boolean(rows[r][c]?.trim())
          });
        });
      }
      r++;
    }
    i = r - 1;
  }
  return res;
}

/* ===== RENDER ===== */

function renderDayTabs() {
  dayTabs.innerHTML = '';
  Object.keys(parsed).forEach(d => {
    const b = document.createElement('button');
    b.textContent = d;
    b.className = d === activeDay ? 'active' : '';
    b.onclick = () => {
      activeDay = d;
      renderDayTabs();
      renderDay();
    };
    dayTabs.appendChild(b);
  });
}

function renderDay() {
  content.innerHTML = '';
  const today = getCurrentWeekDay();

  const slots = parsed[activeDay];
  const maxFree = Math.max(...slots.map(s => s.lanes.filter(l => !l.busy).length));

  slots.forEach(slot => {
    const freeLanes = slot.lanes.filter(l => !l.busy).map(l => l.lane);
    const free = freeLanes.length;

    if (onlyFree && free === 0) return;
    if (!hasConsecutive(freeLanes, minConsecutive)) return;

    const isNow = activeDay === today && isNowInSlot(slot.time);
    const isBest = free === maxFree && free > 0;

    const div = document.createElement('div');
    div.className = `slot${isNow ? ' now' : ''}${isBest ? ' best' : ''}`;

    div.innerHTML = `
      <div class="time">
        ${slot.time}
        <span class="count">Свободно: ${free}/6</span>
        ${isNow ? '<span class="badge now">СЕЙЧАС</span>' : ''}
        ${free === 0 ? '<span class="badge full">Все дорожки заняты</span>' : ''}
      </div>
      <div class="lanes">
        ${slot.lanes.map(l =>
          `<span class="lane ${l.busy ? 'busy' : 'free'}">${l.lane}</span>`
        ).join('')}
      </div>
    `;

    content.appendChild(div);
  });

  if (activeDay === today) {
    setTimeout(() => {
      const el = document.querySelector('.slot.now');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  }
}

/* ===== HELPERS ===== */

function hasConsecutive(arr, n) {
  if (n === 1) return arr.length > 0;
  arr.sort((a, b) => a - b);
  let streak = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === arr[i - 1] + 1) {
      streak++;
      if (streak >= n) return true;
    } else streak = 1;
  }
  return false;
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
  const now = new Date();
  const [s, e] = t.split('-').map(x => {
    const [h, m] = x.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  });
  return now >= s && now <= e;
}

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findMonth() {
  const cur = normalize(getCurrentMonth());
  return scheduleIndex.find(m => normalize(m.month) === cur);
}

function scheduleMidnightSwitch() {
  const now = new Date();
  const ms =
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;
  setTimeout(() => {
    activeDay = getCurrentWeekDay();
    renderDayTabs();
    renderDay();
    scheduleMidnightSwitch();
  }, ms + 1000);
}
