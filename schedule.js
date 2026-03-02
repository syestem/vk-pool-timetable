/* ================= VK INIT ================= */
const isVK = typeof window.vkBridge !== 'undefined';
if (isVK) vkBridge.send('VKWebAppInit').catch(() => {});

/* ================= CONSTANTS ================= */
const SHEET_ID = '11yaPysnuMfkXtwvZSOOohogKnvT0py7rWuKNyAs5ud8';
const INDEX_GID = 887181046;

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

/* ================= DOM ================= */
const titleEl = document.getElementById('title');
const contentEl = document.getElementById('scheduleContent');
const dayTabs = document.getElementById('dayTabs');
const poolBtns = document.querySelectorAll('[data-pool]');
const filterBtns = document.querySelectorAll('[data-filter]');

/* ================= INIT ================= */
init();

async function init() {
  titleEl.textContent = `Расписание бассейна на ${getCurrentMonth()}`;

  poolBtns.forEach(btn => {
    btn.onclick = () => {
      poolBtns.forEach(b => b.classList.remove('primary'));
      btn.classList.add('primary');
      activePool = btn.dataset.pool;
      init();
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

  if (!scheduleIndex.length) await loadIndex();

  const entry = findMonth();
  if (!entry || !entry[activePool]) {
    contentEl.innerHTML = '<div class="slot empty">Нет данных</div>';
    return;
  }

  const rows = await fetchCSV(entry[activePool]);
  parsed = parseSchedule(rows);

  const today = getToday();
  activeDay = parsed[today] ? today : Object.keys(parsed)[0];

  renderDayTabs();
  renderDay();
  scheduleMidnightSwitch();
}

/* ================= FETCH ================= */
async function loadIndex() {
  const text = await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${INDEX_GID}`
  ).then(r => r.text());

  text.replace(/^\uFEFF/, '').split(/\r?\n/).slice(1).forEach(r => {
    const c = r.split(',');
    if (!c[0]) return;
    scheduleIndex.push({
      month: c[0].trim(),
      big: Number(c[1]) || null,
      small: Number(c[2]) || null
    });
  });
}

async function fetchCSV(gid) {
  return fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
  ).then(r => r.text())
   .then(t => t.replace(/^\uFEFF/, '').split(/\r?\n/).map(r => r.split(',')));
}

/* ================= PARSER ================= */
function parseSchedule(rows) {
  const res = {};
  const timeRow = rows.findIndex(r => r[0]?.toLowerCase().includes('время'));
  if (timeRow === -1) return res;

  const times = [];
  const cols = [];

  rows[timeRow].forEach((c,i)=>{
    if (/\d+:\d+.*\d+:\d+/.test(c)) {
      times.push(c.trim());
      cols.push(i);
    }
  });

  for (let i = timeRow+1; i < rows.length; i++) {
    const day = rows[i][0];
    if (!DAYS.includes(day)) continue;

    res[day] = times.map(t => ({ time:t, lanes:[] }));
    let r = i+1;

    while (rows[r] && !DAYS.includes(rows[r][0])) {
      const lane = Number(rows[r][2]);
      if (lane >= 1 && lane <= 6) {
        cols.forEach((c,idx)=>{
          res[day][idx].lanes.push({
            lane,
            busy: Boolean(rows[r][c]?.trim())
          });
        });
      }
      r++;
    }
    i = r-1;
  }
  return res;
}

/* ================= RENDER ================= */
function renderDayTabs() {
  dayTabs.innerHTML = '';
  Object.keys(parsed).forEach(d=>{
    const b=document.createElement('button');
    b.textContent=d;
    b.className=d===activeDay?'active':'';
    b.onclick=()=>{activeDay=d;renderDayTabs();renderDay();};
    dayTabs.appendChild(b);
  });
}

function renderDay() {
  contentEl.innerHTML='';
  const today=getToday();

  parsed[activeDay].forEach(slot=>{
    const total=slot.lanes.length;
    const free=slot.lanes.filter(l=>!l.busy).length;
    if (free < minFreeLanes) return;

    const isNow=activeDay===today && isNowIn(slot.time);

    const div=document.createElement('div');
    div.className='slot'+(isNow?' now':'');

    div.innerHTML=`
      <div class="time">
        ${slot.time}
        <span class="count">Свободно: ${free}/${total}</span>
        ${isNow?'<span class="badge now">СЕЙЧАС</span>':''}
        ${free===0?'<span class="badge full">Все дорожки заняты</span>':''}
      </div>
      <div class="lanes">
        ${slot.lanes.map(l=>`<span class="lane ${l.busy?'busy':'free'}">${l.lane}</span>`).join('')}
      </div>
    `;
    contentEl.appendChild(div);
  });

  if (!contentEl.children.length)
    contentEl.innerHTML='<div class="slot empty">Нет подходящих слотов</div>';

  if (activeDay===today)
    setTimeout(()=>document.querySelector('.slot.now')?.scrollIntoView({block:'center'}),0);
}

/* ================= HELPERS ================= */
function getCurrentMonth(){
  const d=new Date();
  return d.toLocaleString('ru-RU',{month:'long'})
    .replace(/^./,c=>c.toUpperCase())+' '+d.getFullYear();
}
function getToday(){
  const d=new Date().getDay();
  return DAYS[d===0?6:d-1];
}
function isNowIn(t){
  const n=new Date();
  const [a,b]=t.split('-').map(x=>{
    const [h,m]=x.split(':').map(Number);
    const d=new Date();d.setHours(h,m,0,0);return d;
  });
  return n>=a && n<=b;
}
function findMonth(){
  const m=getCurrentMonth().toLowerCase();
  return scheduleIndex.find(x=>x.month.toLowerCase()===m);
}

/* ================= MIDNIGHT ================= */
function scheduleMidnightSwitch(){
  const n=new Date();
  const ms=new Date(n.getFullYear(),n.getMonth(),n.getDate()+1)-n;
  setTimeout(()=>{activeDay=getToday();renderDayTabs();renderDay();scheduleMidnightSwitch();},ms+1000);
}
