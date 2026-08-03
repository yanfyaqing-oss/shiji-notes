const STORAGE_KEY = 'shiji-notes-v1';
const THEME_KEY = 'shiji-theme';
const DRAFT_KEY = 'shiji-note-draft-v1';

const $ = (selector) => document.querySelector(selector);
const state = { notes: [], filter: 'all', category: 'all', query: '', editingId: null };
let updatePendingReload = false;
let dailyLearningSourceId = '';
const statusMeta = {
  open: { label: '待解决', title: '待解决的记录' },
  solved: { label: '已解决', title: '已解决的记录' },
  archived: { label: '已归档', title: '已归档的记录' }
};

function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }
function escapeHTML(value = '') { return value.replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function parseTags(value) { return [...new Set(value.split(/[，,\s]+/).map(x => x.trim()).filter(Boolean))].slice(0, 8); }
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.notes)); }
function load() {
  try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY)); state.notes = Array.isArray(data) ? data : []; }
  catch { state.notes = []; }
}
function formatDate(date) {
  const d = new Date(date); const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 ${d.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})}`;
  return d.toLocaleDateString('zh-CN', { year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric', month:'short', day:'numeric' });
}
function startOfWeek() { const d = new Date(); const day = d.getDay() || 7; d.setHours(0,0,0,0); d.setDate(d.getDate() - day + 1); return d; }
function startOfPreviousWeek() { const d = startOfWeek(); d.setDate(d.getDate() - 7); return d; }
function learningData(note) { return note.learningData && typeof note.learningData === 'object' ? note.learningData : {}; }
function hasLearningData(note) { return Object.values(learningData(note)).some(value => String(value || '').trim()); }
function excerpt(note) {
  const learning = learningData(note);
  return learning.completed || learning.understood || learning.problem || note.result || note.problem || note.process || '还没有补充详细内容。';
}
function autoCategory(value = '') {
  const text = value.toLocaleLowerCase();
  if (/学习|课程|阅读|读书|考试|知识|练习|unity|教程/.test(text)) return '学习';
  if (/生活|家庭|健康|运动|旅行|家务|日常|购物/.test(text)) return '生活';
  return '工作';
}
function localDateKey(date = new Date()) {
  const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function currentLearningWeek(date = new Date()) {
  const plan = window.SHIJI_LEARNING_PLAN;
  if (!plan) return '';
  const start = new Date(`${plan.start}T00:00:00`); const current = new Date(date); current.setHours(0,0,0,0);
  const week = Math.floor((current - start) / 604800000) + 1;
  if (week < 1) return '准备阶段';
  if (week > plan.weeks.length) return '40周计划已完成';
  return `第${week}周`;
}
function isRecurringPlan(note) { return Boolean(note.recurrence); }
function isBuiltInLearningPlan(note) { return ['learning-plan-u3d','learning-plan-spine'].includes(note.id); }
function completedTaskKeys(note) { return Array.isArray(note.completedTasks) ? note.completedTasks : []; }
function ensureBuiltInLearningPlans() {
  const now = new Date().toISOString();
  const templates = [
    {
      id:'learning-plan-u3d', title:'40周 U3D 学习计划', nextAction:'按40周路线继续完成下一项 U3D 训练',
      recurrence:'unity_days', planTime:'12:00', tags:['U3D','学习计划','40周计划']
    },
    {
      id:'learning-plan-spine', title:'40周 Spine 学习计划', nextAction:'按40周路线继续完成下一项 Spine 训练',
      recurrence:'spine_weekend', planTime:'20:30', tags:['Spine','学习计划','40周计划']
    }
  ];
  const repaired = [];
  for (const template of templates) {
    const existing = state.notes.find(note => note.id === template.id);
    if (existing) {
      let changed = false;
      const required = { title:template.title, category:'学习', nextAction:template.nextAction, recurrence:template.recurrence, planTime:template.planTime };
      for (const [key, value] of Object.entries(required)) {
        if (existing[key] === value) continue;
        existing[key] = value;
        changed = true;
      }
      if (!Array.isArray(existing.completedTasks)) { existing.completedTasks = []; changed = true; }
      const tags = [...new Set([...(Array.isArray(existing.tags) ? existing.tags : []), ...template.tags])];
      if (JSON.stringify(tags) !== JSON.stringify(existing.tags || [])) { existing.tags = tags; changed = true; }
      if (changed) { existing.updatedAt = now; repaired.push(existing); }
      continue;
    }
    const note = {
      ...template, category:'学习', status:'open', problem:'', process:'', result:'', learningData:{},
      photoCount:0, pinned:false, actionPeriod:'week', dueDate:'', actionDone:false,
      lastCompletedDate:'', completedTasks:[], createdAt:now, updatedAt:now
    };
    state.notes.push(note);
    repaired.push(note);
  }
  const u3d = state.notes.find(note => note.id === 'learning-plan-u3d');
  const courseProgressMarker = 'progress-2026-07-31-course-4';
  if (u3d && !completedTaskKeys(u3d).includes(courseProgressMarker)) {
    u3d.completedTasks = [...new Set([
      ...completedTaskKeys(u3d),
      'u3d-w1-t1',
      'u3d-w1-t2',
      'u3d-w2-t2',
      'u3d-w3-t1',
      courseProgressMarker
    ])];
    u3d.updatedAt = now;
    if (!repaired.includes(u3d)) repaired.push(u3d);
  }
  if (repaired.length) save();
  return repaired;
}
function planRouteDays(note) { return note.id === 'learning-plan-u3d' ? ['周二','周四'] : ['周六','周日']; }
function planTaskKey(note, weekNumber, taskIndex) { return `${note.id === 'learning-plan-u3d' ? 'u3d' : 'spine'}-w${weekNumber}-t${taskIndex + 1}`; }
function learningPlanTaskInfo(note, date = new Date()) {
  const plan = window.SHIJI_LEARNING_PLAN;
  if (!plan || !isBuiltInLearningPlan(note)) return null;
  const start = new Date(`${plan.start}T00:00:00`); const current = new Date(date); current.setHours(0,0,0,0);
  const weekNumber = Math.floor((current - start) / 604800000) + 1;
  const week = plan.weeks.find(item => item.week === weekNumber);
  if (!week) return null;
  const dayNames = ['周日','周一','周二','周三','周四','周五','周六'];
  const tasks = week.tasks.filter(task => planRouteDays(note).some(day => task.date.includes(day)));
  const taskIndex = tasks.findIndex(task => task.date.includes(dayNames[current.getDay()]));
  if (taskIndex < 0) return null;
  return { week, task:tasks[taskIndex], taskIndex, key:planTaskKey(note, weekNumber, taskIndex) };
}
function isPlanScheduledToday(note, date = new Date()) {
  const day = date.getDay();
  const dateKey = localDateKey(date);
  if (note.id === 'learning-plan-u3d') return dateKey >= '2026-08-04' && dateKey <= '2027-05-06' && (day === 2 || day === 4);
  if (note.id === 'learning-plan-spine') return dateKey >= '2026-08-01' && dateKey <= '2027-05-09' && (day === 0 || day === 6);
  if (note.recurrence === 'study_days') return day !== 0;
  if (note.recurrence === 'unity_days') return day === 2 || day === 4;
  if (note.recurrence === 'spine_weekend') return day === 0 || day === 6;
  return true;
}
function isPlanDone(note) {
  if (isBuiltInLearningPlan(note)) {
    const task = learningPlanTaskInfo(note);
    return task ? completedTaskKeys(note).includes(task.key) || note.lastCompletedDate === localDateKey() : false;
  }
  return isRecurringPlan(note) ? note.lastCompletedDate === localDateKey() : Boolean(note.actionDone);
}
function recurrenceLabel(note) {
  return ({ study_days:'周一至周六', unity_days:'周二、周四', spine_weekend:'周六、周日' })[note.recurrence] || ({today:'今天',week:'本周',later:'以后'})[note.actionPeriod] || '本周';
}
function learningTaskForToday(note, date = new Date()) {
  const plan = window.SHIJI_LEARNING_PLAN;
  if (!plan || !isBuiltInLearningPlan(note)) return note.nextAction;
  const start = new Date(`${plan.start}T00:00:00`); const today = new Date(date); today.setHours(0,0,0,0);
  const weekNumber = Math.floor((today - start) / 604800000) + 1;
  if (weekNumber < 1) {
    if (note.id === 'learning-plan-spine' && localDateKey(today) === '2026-08-01') return '启动准备：整理个人 Spine 角色、骨骼、Slot、Attachment 和贴图';
    if (note.id === 'learning-plan-spine' && localDateKey(today) === '2026-08-02') return '启动准备：建立动画名称与 WeaponPoint、HitPoint 等挂点规范';
    return note.id === 'learning-plan-u3d' ? '40周 U3D 计划将于8月4日中午开始' : 'Spine 启动准备将于8月1日晚开始';
  }
  const week = plan.weeks.find(item => item.week === weekNumber);
  if (!week) return weekNumber > 40 ? '40周学习计划已完成，查看作品集与复盘记录' : note.nextAction;
  const scheduledDays = note.id === 'learning-plan-u3d' ? [2, 4] : [0, 6];
  if (!scheduledDays.includes(today.getDay())) return `第${weekNumber}周 · 今日无${note.id === 'learning-plan-u3d' ? ' U3D' : ' Spine'} 训练`;
  const dayNames = ['周日','周一','周二','周三','周四','周五','周六'];
  const task = week.tasks.find(item => item.date.includes(dayNames[today.getDay()]));
  return task ? `第${weekNumber}周 · ${task.task}` : `第${weekNumber}周 · 今天休息或补课`;
}

function learningPlanRouteTasks(note) {
  const plan = window.SHIJI_LEARNING_PLAN;
  if (!plan || !isBuiltInLearningPlan(note)) return [];
  const wantedDays = planRouteDays(note);
  const dayOffsets = { '周一':0, '周二':1, '周三':2, '周四':3, '周五':4, '周六':5, '周日':6 };
  const start = new Date(`${plan.start}T00:00:00`);
  return plan.weeks.flatMap(week => week.tasks
    .filter(task => wantedDays.some(day => task.date.includes(day)))
    .map((task, taskIndex) => {
      const dayName = Object.keys(dayOffsets).find(day => task.date.includes(day));
      const taskDate = new Date(start);
      taskDate.setDate(start.getDate() + (week.week - 1) * 7 + dayOffsets[dayName]);
      return { weekNumber:week.week, task, taskIndex, key:planTaskKey(note, week.week, taskIndex), date:taskDate, dateKey:localDateKey(taskDate) };
    }));
}

function learningPlanDisplayInfo(note, date = new Date()) {
  if (!isBuiltInLearningPlan(note)) return { action:note.nextAction, meta:'' };
  const plan = window.SHIJI_LEARNING_PLAN;
  const todayKey = localDateKey(date);
  const completed = new Set(completedTaskKeys(note));
  if (!plan || (todayKey < plan.start && completed.size === 0)) return { action:learningTaskForToday(note, date), meta:'计划开始前' };
  const next = learningPlanRouteTasks(note).find(item => !completed.has(item.key));
  if (!next) return { action:'40周路线已全部完成', meta:'已完成全部80项任务' };
  const label = next.dateKey < todayKey ? '待补任务' : next.dateKey === todayKey ? '今天任务' : '下一项';
  return { action:`${label} · 第${next.weekNumber}周 · ${next.task.task}`, meta:`${next.task.date}${next.dateKey > todayKey ? ' · 可提前完成' : ''}`, task:next };
}

function categoryMatches(note) {
  if (state.category === 'all') return true;
  if (state.category === '其他') return !['学习','工作','生活'].includes(note.category);
  return note.category === state.category;
}

function setFormDetails(expanded) {
  $('#formDetails').hidden = !expanded;
  $('#formMoreBtn').setAttribute('aria-expanded', String(expanded));
  const learning = $('#categoryInput').value.trim() === '学习';
  $('#formMoreBtn').textContent = expanded ? (learning ? '－ 收起学习记录' : '－ 收起详细内容') : (learning ? '＋ 填写今天的学习记录' : '＋ 补充问题、过程、结果和计划');
}

function setLearningTemplate(category = $('#categoryInput').value) {
  const learning = category.trim() === '学习';
  $('#learningNoteFields').hidden = !learning;
  $('#standardNoteFields').hidden = learning;
  $('#formTitle').textContent = learning ? (state.editingId ? '整理这次学习记录' : '记录今天的学习') : (state.editingId ? '继续补充这次经历' : '记录问题与结果');
  if (learning) {
    if (!$('#learningDateInput').value) $('#learningDateInput').value = localDateKey();
    if (!$('#learningWeekInput').value) $('#learningWeekInput').value = currentLearningWeek();
  }
  setFormDetails(!$('#formDetails').hidden);
}

function readLearningForm() {
  return {
    date: $('#learningDateInput').value,
    week: $('#learningWeekInput').value.trim(),
    duration: $('#learningDurationInput').value.trim(),
    completed: $('#learningCompletedInput').value.trim(),
    understood: $('#learningUnderstoodInput').value.trim(),
    problem: $('#learningProblemInput').value.trim(),
    solution: $('#learningSolutionInput').value.trim(),
    englishWords: $('#learningEnglishInput').value.trim(),
    nextStep: $('#learningNextStepInput').value.trim()
  };
}

function separateMasterPlanLearningEntries() {
  let changed = false;
  for (const master of state.notes.filter(isBuiltInLearningPlan)) {
    if (!hasLearningData(master)) continue;
    const data = learningData(master); const route = master.id === 'learning-plan-u3d' ? 'U3D' : 'Spine';
    const date = data.date || localDateKey(new Date(master.updatedAt || Date.now()));
    const dailyId = `daily-${route.toLocaleLowerCase()}-${date}`;
    if (!state.notes.some(note => note.id === dailyId)) {
      const displayDate = new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { month:'long', day:'numeric' });
      state.notes.push({
        id:dailyId, title:`${route} 学习记录 · ${displayDate}`, category:'学习', status:'solved',
        problem:'', process:'', result:'', learningData:{ ...data, date, sourcePlanId:master.id },
        tags:[route, '学习记录'], photoCount:0, pinned:false, nextAction:'', actionPeriod:'week', dueDate:'',
        actionDone:false, recurrence:'', planTime:'', lastCompletedDate:'',
        createdAt:master.updatedAt || new Date().toISOString(), updatedAt:new Date().toISOString()
      });
    }
    master.learningData = {};
    master.updatedAt = new Date().toISOString();
    changed = true;
  }
  if (changed) save();
}

function setPlanFields(enabled) {
  $('#planFields').hidden = !enabled;
}

function updatePlanCompletionLabel() {
  $('#actionDoneLabel').textContent = $('#recurrenceInput').value ? '今天已经完成' : '这项计划已经完成';
}

function weeklyGroup(note) {
  const text = [note.category, note.title, ...(note.tags || [])].join(' ').toLocaleLowerCase();
  if (/学习|课程|阅读|读书|考试|知识|练习/.test(text)) return 'learning';
  if (/生活|家庭|健康|运动|旅行|家务|日常/.test(text)) return 'life';
  return 'work';
}

function joinChinese(items) {
  if (items.length < 2) return items[0] || '';
  if (items.length === 2) return items.join('和');
  return `${items.slice(0, -1).join('、')}和${items.at(-1)}`;
}

function weeklySummaryDescription(notes, groups, solved, photos) {
  const categories = groups.filter(group => notes.some(note => weeklyGroup(note) === group.key)).map(group => group.title);
  const titles = notes.map(note => String(note.title || '').trim()).filter(Boolean).slice(0, 3);
  const coverage = categories.length ? `，涉及${joinChinese(categories)}` : '';
  const activities = titles.length ? `你做了${joinChinese(titles.map(title => `「${title}」`))}` : '你为这一周留下了可回看的线索';
  const remaining = notes.length - titles.length;
  const extra = remaining > 0 ? `，以及另外 ${remaining} 件事` : '';
  const outcomes = [solved ? `完成了 ${solved} 项` : '', photos ? `留下了 ${photos} 张图片` : ''].filter(Boolean);
  return `这一周，你共记录了 ${notes.length} 件事${coverage}。${activities}${extra}。${outcomes.length ? `其中${joinChinese(outcomes)}。` : '这些记录值得在下周继续整理和推进。'}`;
}

function openWeeklySummary() {
  const weekStart = startOfPreviousWeek();
  const nextWeekStart = new Date(weekStart); nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const notes = state.notes.filter(note => {
    const updatedAt = new Date(note.updatedAt || note.createdAt);
    return !isBuiltInLearningPlan(note) && updatedAt >= weekStart && updatedAt < nextWeekStart;
  }).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const groups = [
    { key:'learning', icon:'◌', title:'学习', empty:'这周还没有学习记录' },
    { key:'work', icon:'◇', title:'工作', empty:'这周还没有工作记录' },
    { key:'life', icon:'○', title:'生活', empty:'这周还没有生活记录' }
  ];
  const solved = notes.filter(note => note.status === 'solved').length;
  const photos = notes.reduce((sum, note) => sum + (Number(note.photoCount) || 0), 0);
  const pending = notes.filter(note => note.nextAction && ((!isRecurringPlan(note) && !note.actionDone) || (isRecurringPlan(note) && isPlanScheduledToday(note) && !isPlanDone(note)))).slice(0, 3);
  const rangeEnd = new Date(weekStart); rangeEnd.setDate(rangeEnd.getDate() + 6);
  const summaryDescription = notes.length ? weeklySummaryDescription(notes, groups, solved, photos) : '';

  $('#summaryContent').innerHTML = `
    <div class="summary-range">${weekStart.toLocaleDateString('zh-CN', {month:'long',day:'numeric'})} — ${rangeEnd.toLocaleDateString('zh-CN', {month:'long',day:'numeric'})}</div>
    <div class="summary-stats"><div><strong>${notes.length}</strong><span>条记录</span></div><div><strong>${solved}</strong><span>项完成</span></div><div><strong>${photos}</strong><span>张图片</span></div></div>
    ${notes.length ? `<section class="summary-overview"><h3>这一周，你做了什么</h3><p>${escapeHTML(summaryDescription)}</p></section>${groups.map(group => {
      const items = notes.filter(note => weeklyGroup(note) === group.key);
      return `<section class="summary-group"><h3><span>${group.icon}</span>${group.title}<small>${items.length}</small></h3>${items.length ? `<div class="summary-list">${items.map(note => `<article><div><strong>${escapeHTML(note.title)}</strong><span class="status-badge ${note.status}">${statusMeta[note.status]?.label || '待解决'}</span></div><p>${escapeHTML(excerpt(note))}</p></article>`).join('')}</div>` : `<p class="summary-empty">${group.empty}</p>`}</section>`;
    }).join('')}` : '<div class="summary-zero"><span>✦</span><h3>本周还没有记录</h3><p>从今天遇到的一个问题开始，周末就会有属于你的回顾。</p></div>'}
    ${notes.length ? `<section class="summary-next"><h3>下周可以继续</h3>${pending.length ? `<ul>${pending.map(note => `<li>${escapeHTML(note.title)}</li>`).join('')}</ul>` : '<p>本周记录都已解决，可以挑一项最有价值的经验继续巩固。</p>'}</section>` : ''}`;
  $('#settingsDialog').close();
  $('#summaryDialog').showModal();
}

function renderCategoryChips() {
  const items = ['all','学习','工作','生活','其他'];
  $('#categoryChips').innerHTML = items.map(value => `<button class="category-chip ${state.category === value ? 'active' : ''}" type="button" data-category="${value}">${value === 'all' ? '全部' : value}</button>`).join('');
}

function renderPlans() {
  const plans = state.notes.filter(note => note.nextAction).sort((a,b) => Number(!isPlanScheduledToday(a)) - Number(!isPlanScheduledToday(b)) || Number(isPlanDone(a)) - Number(isPlanDone(b)) || (a.planTime || '99:99').localeCompare(b.planTime || '99:99') || new Date(b.updatedAt) - new Date(a.updatedAt));
  $('#planSection').hidden = plans.length === 0;
  if (!plans.length) return;
  const scheduled = plans.filter(note => isPlanScheduledToday(note));
  const pending = scheduled.filter(note => !isPlanDone(note)).length;
  const completed = scheduled.length - pending;
  const resting = plans.length - scheduled.length;
  $('#planProgress').textContent = `${pending} 项今日待完成 · ${completed} 项今日已完成${resting ? ` · ${resting} 项非训练日` : ''}`;
  $('#planList').innerHTML = plans.map(note => { const scheduled = isPlanScheduledToday(note); const display = learningPlanDisplayInfo(note); const action = display.action || learningTaskForToday(note); const todayTask = learningPlanTaskInfo(note); const directCheck = scheduled && (!isBuiltInLearningPlan(note) || (todayTask && display.task?.key === todayTask.key)); const taskControl = directCheck
    ? `<label class="plan-check-wrap" title="完成今天计划"><input class="plan-check" data-id="${note.id}" type="checkbox" ${isPlanDone(note) ? 'checked' : ''}><span>完成</span></label>`
    : isBuiltInLearningPlan(note)
      ? `<button class="plan-task-picker" data-id="${note.id}" type="button" aria-label="打开完整计划勾选任务" title="打开完整计划勾选任务"><span>☑</span><small>勾选任务</small></button>`
      : '<span class="plan-rest-label">休息日</span>';
    return `<article class="plan-item ${!isBuiltInLearningPlan(note) && isPlanDone(note) ? 'done' : ''} ${scheduled ? '' : 'upcoming'}" data-id="${note.id}">
    ${taskControl}
    <button class="plan-open" data-id="${note.id}" type="button"><strong>${note.planTime ? `<time>${escapeHTML(note.planTime)}</time>` : ''}${escapeHTML(action)}</strong><small>${isBuiltInLearningPlan(note) && display.meta ? `${escapeHTML(display.meta)} · ` : ''}${recurrenceLabel(note)}${scheduled ? ' · 今天' : ' · 非训练日'}${note.dueDate ? ` · ${new Date(`${note.dueDate}T00:00:00`).toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'})}` : ''} · 来自“${escapeHTML(note.title)}”</small>${isBuiltInLearningPlan(note) ? '<span class="plan-all-hint">打开后可勾选具体任务 →</span>' : ''}</button>
  </article>`; }).join('');
}

function renderTodayCompleted() {
  const today = localDateKey();
  const items = state.notes.filter(note => !isBuiltInLearningPlan(note) && learningData(note).date === today && learningData(note).completed).sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  $('#todayDoneSection').hidden = items.length === 0;
  if (!items.length) return;
  $('#todayDoneCount').textContent = `${items.length} 项`;
  $('#todayDoneList').innerHTML = items.map(note => {
    const data = learningData(note);
    return `<button class="today-done-item" type="button" data-id="${note.id}"><span class="today-done-check">✓</span><span><strong>${escapeHTML(note.title)}</strong><p>${escapeHTML(data.completed)}</p><small>${escapeHTML(data.week || '今日学习')}${data.duration ? ` · ${escapeHTML(data.duration)}` : ''}</small></span><em>查看记录 →</em></button>`;
  }).join('');
}

const PHOTO_DB = 'shiji-media-v1';
const PHOTO_STORE = 'photos';
const MAX_PHOTOS = 5;
let photoDbPromise;
let photoDraft = [];
let removedPhotoIds = new Set();
let cardPhotoUrls = [];
let detailNoteId = null;
let detailPhotoUrls = [];

function openPhotoDb() {
  if (photoDbPromise) return photoDbPromise;
  photoDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
      store.createIndex('noteId', 'noteId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return photoDbPromise;
}

async function getNotePhotos(noteId) {
  if (!noteId) return [];
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(PHOTO_STORE).objectStore(PHOTO_STORE).index('noteId').getAll(noteId);
    request.onsuccess = () => resolve(request.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}

async function getAllPhotos() {
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(PHOTO_STORE).objectStore(PHOTO_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePhotoDraft(noteId) {
  const db = await openPhotoDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(PHOTO_STORE, 'readwrite');
    const store = transaction.objectStore(PHOTO_STORE);
    removedPhotoIds.forEach(id => store.delete(id));
    photoDraft.forEach(photo => store.put({ id: photo.id, noteId, blob: photo.blob, name: photo.name, createdAt: photo.createdAt }));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function deleteNotePhotos(noteId) {
  const photos = await getNotePhotos(noteId);
  if (!photos.length) return;
  const db = await openPhotoDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(PHOTO_STORE, 'readwrite');
    photos.forEach(photo => transaction.objectStore(PHOTO_STORE).delete(photo.id));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function revokeDraftUrls() {
  photoDraft.forEach(photo => { if (photo.url) URL.revokeObjectURL(photo.url); });
  photoDraft = [];
}

function renderPhotoDraft() {
  $('#photoCount').textContent = `${photoDraft.length} / ${MAX_PHOTOS} 张 · 自动压缩并保存在当前设备`;
  $('#photoPreview').innerHTML = photoDraft.map(photo => `
    <figure class="photo-item" data-photo-id="${photo.id}">
      <button class="photo-open" type="button" aria-label="查看图片"><img src="${photo.url}" alt="笔记附件"></button>
      <button class="photo-remove" type="button" aria-label="删除图片" title="删除图片">×</button>
    </figure>`).join('');
  const full = photoDraft.length >= MAX_PHOTOS;
  $('#cameraBtn').disabled = full;
  $('#galleryBtn').disabled = full;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image-load')); };
    image.src = url;
  });
}

async function compressPhoto(file) {
  const image = await loadImage(file);
  const limit = 1600;
  const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.78));
  if (!blob) throw new Error('image-compress');
  return blob;
}

async function addPhotoFiles(files) {
  const available = MAX_PHOTOS - photoDraft.length;
  const selected = [...files].filter(file => file.type.startsWith('image/')).slice(0, available);
  if (!selected.length) { if (available <= 0) toast(`每条记录最多添加 ${MAX_PHOTOS} 张图片`); return; }
  toast('正在压缩图片…');
  for (const file of selected) {
    try {
      const blob = await compressPhoto(file);
      photoDraft.push({ id: uid(), blob, name: file.name || 'photo.jpg', createdAt: new Date().toISOString(), url: URL.createObjectURL(blob) });
    } catch { toast('有一张图片无法读取，请换一张重试'); }
  }
  renderPhotoDraft();
  toast(`已添加 ${selected.length} 张图片`);
}

async function hydrateCardPhotos(notes) {
  cardPhotoUrls.forEach(URL.revokeObjectURL);
  cardPhotoUrls = [];
  await Promise.all(notes.filter(note => note.photoCount).map(async note => {
    try {
      const photos = await getNotePhotos(note.id);
      const img = document.querySelector(`.note-card[data-id="${CSS.escape(note.id)}"] .card-photo img`);
      if (!img || !photos[0]) return;
      const url = URL.createObjectURL(photos[0].blob);
      cardPhotoUrls.push(url);
      img.src = url;
      img.closest('.card-photo').hidden = false;
    } catch { /* 图片不可用时仍正常显示文字卡片。 */ }
  }));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(',');
  const type = header.match(/data:(.*?);base64/)?.[1] || 'image/jpeg';
  const bytes = atob(body); const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type });
}

function formatDetailDate(date) {
  return new Date(date).toLocaleString('zh-CN', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function detailSection(title, content) {
  return `<section class="detail-section"><h3>${title}</h3><p class="${content ? '' : 'detail-empty'}">${content ? escapeHTML(content) : '尚未填写'}</p></section>`;
}

function learningDetail(note) {
  const data = learningData(note);
  return `<div class="learning-detail-meta">
    <div><span>日期</span><strong>${escapeHTML(data.date || '未填写')}</strong></div>
    <div><span>当前周次</span><strong>${escapeHTML(data.week || '未填写')}</strong></div>
    <div><span>本次用时</span><strong>${escapeHTML(data.duration || '未填写')}</strong></div>
  </div>
  ${detailSection('今天完成', data.completed)}
  ${detailSection('今天理解', data.understood)}
  ${detailSection('遇到的问题', data.problem)}
  ${detailSection('解决方法', data.solution)}
  ${detailSection('相关英文词', data.englishWords)}
  ${detailSection('下次第一件事', data.nextStep)}`;
}

function fullLearningPlanDetail(note, date = new Date()) {
  const plan = window.SHIJI_LEARNING_PLAN;
  if (!plan || !isBuiltInLearningPlan(note)) return '';
  const u3d = note.id === 'learning-plan-u3d';
  const wantedDays = u3d ? ['周二','周四'] : ['周六','周日'];
  const start = new Date(`${plan.start}T00:00:00`); const current = new Date(date); current.setHours(0,0,0,0);
  const rawWeek = Math.floor((current - start) / 604800000) + 1;
  const openWeek = Math.min(plan.weeks.length, Math.max(1, rawWeek));
  const schedule = u3d ? '每周二、周四 12:00–13:30 · 每周共3小时' : '每周六、周日 20:30开始';
  const method = u3d ? '按课程成果推进，日期仅作参考 · 工作目标 → 引导练习 → 独立任务 → 故障练习 → 验收' : '按两周闭环推进：制作动作 → 导入Unity测试 → 返回Spine调整';
  const completed = completedTaskKeys(note);
  const completedCount = completed.filter(key => key.startsWith(u3d ? 'u3d-' : 'spine-')).length;
  const dayOffsets = { '周一':0, '周二':1, '周三':2, '周四':3, '周五':4, '周六':5, '周日':6 };
  return `<section class="full-learning-plan" aria-labelledby="fullPlanTitle">
    <header class="full-plan-head"><div><span>完整路线 · 已完成 ${completedCount}/80</span><h3 id="fullPlanTitle">${u3d ? 'U3D' : 'Spine'} 40周成果路线</h3><p>${schedule} · ${method} · 可以勾选未来任务作为提前完成</p></div><button class="full-plan-toggle" type="button" data-expanded="false">展开全部40周</button></header>
    <div class="full-plan-weeks">${plan.weeks.map(week => {
      const tasks = week.tasks.filter(task => wantedDays.some(day => task.date.includes(day)));
      const weekDone = tasks.filter((task, index) => completed.includes(planTaskKey(note, week.week, index))).length;
      return `<details class="full-plan-week" ${week.week === openWeek ? 'open' : ''}><summary><strong>第${week.week}周</strong><span>${escapeHTML(week.range)}</span><small>${weekDone}/${tasks.length} 已完成</small></summary><ol>${tasks.map((task, index) => {
        const key = planTaskKey(note, week.week, index); const done = completed.includes(key);
        const dayName = Object.keys(dayOffsets).find(day => task.date.includes(day));
        const taskDate = new Date(start); taskDate.setDate(start.getDate() + (week.week - 1) * 7 + dayOffsets[dayName]);
        const taskDateKey = localDateKey(taskDate); const early = done && taskDate > current;
        return `<li class="${done ? 'task-completed' : ''}"><label class="full-plan-task"><input class="full-plan-task-check" type="checkbox" data-note-id="${note.id}" data-task-key="${key}" data-task-date="${taskDateKey}" ${done ? 'checked' : ''}><span class="full-plan-task-box">✓</span><span class="full-plan-task-copy"><time>${escapeHTML(task.date)}${done ? `<b>${early ? '已提前完成' : '已完成'}</b>` : ''}</time><p>${escapeHTML(task.task)}</p></span></label></li>`;
      }).join('')}</ol></details>`;
    }).join('')}</div>
  </section>`;
}

function cleanupDetailPhotos() {
  detailPhotoUrls.forEach(URL.revokeObjectURL);
  detailPhotoUrls = [];
  detailNoteId = null;
}

async function openDetail(id) {
  const note = state.notes.find(item => item.id === id);
  if (!note) return;
  cleanupDetailPhotos();
  detailNoteId = id;
  const meta = statusMeta[note.status] || statusMeta.open;
  $('#detailStatus').textContent = meta.label;
  $('#detailStatus').className = `status-badge ${note.status || 'open'}`;
  $('#detailCategory').textContent = note.category || '未分类';
  $('#detailTitle').textContent = note.title;
  $('#detailTime').textContent = `更新于 ${formatDetailDate(note.updatedAt)}`;
  $('#detailStudyBtn').hidden = !isBuiltInLearningPlan(note);
  $('#detailEditBtn').hidden = isBuiltInLearningPlan(note);
  const mainDetails = note.category === '学习' && hasLearningData(note) ? learningDetail(note) : `${detailSection('问题 / 背景', note.problem)}${detailSection('过程 / 思路', note.process)}${detailSection('结果 / 结论', note.result)}`;
  const planDisplay = learningPlanDisplayInfo(note);
  const currentPlan = note.nextAction ? `<section class="detail-plan ${!isBuiltInLearningPlan(note) && isPlanDone(note) ? 'done' : ''}"><span>${isPlanDone(note) ? '✓ 今天已完成 · 下面是下一项' : (isBuiltInLearningPlan(note) ? '当前需要完成' : '今天的安排')}</span><strong>${escapeHTML(planDisplay.action || learningTaskForToday(note))}</strong><small>${planDisplay.meta ? `${escapeHTML(planDisplay.meta)} · ` : ''}${recurrenceLabel(note)}${note.planTime ? ` · ${escapeHTML(note.planTime)}` : ''}${note.dueDate ? ` · ${new Date(`${note.dueDate}T00:00:00`).toLocaleDateString('zh-CN')}` : ''}</small></section>` : '';
  const fullPlan = fullLearningPlanDetail(note);
  $('#detailContent').innerHTML = `
    <div class="detail-meta"><span>创建于 ${formatDetailDate(note.createdAt)}</span>${note.pinned ? '<span>◆ 已置顶</span>' : ''}</div>
    ${isBuiltInLearningPlan(note) ? `${currentPlan}${fullPlan}${mainDetails}` : `${mainDetails}${currentPlan}`}
    ${(note.tags || []).length ? `<div class="detail-tags">${note.tags.map(tag => `<span class="tag"># ${escapeHTML(tag)}</span>`).join('')}</div>` : ''}
    ${note.photoCount ? '<section class="detail-photos-section"><h3>图片附件</h3><div id="detailPhotos" class="detail-photos"><span class="detail-photo-loading">正在读取图片…</span></div></section>' : ''}`;
  $('#detailDialog').showModal();

  if (!note.photoCount) return;
  try {
    const photos = await getNotePhotos(id);
    if (detailNoteId !== id || !$('#detailDialog').open) return;
    const photoContainer = $('#detailPhotos');
    if (!photos.length) {
      photoContainer.innerHTML = '<span class="detail-photo-loading">图片正在同步，请稍后再打开</span>';
      return;
    }
    photoContainer.innerHTML = photos.map((photo, index) => {
      const url = URL.createObjectURL(photo.blob);
      detailPhotoUrls.push(url);
      return `<button class="detail-photo-button" type="button" aria-label="查看第 ${index + 1} 张图片"><img src="${url}" alt="${escapeHTML(note.title)}的第 ${index + 1} 张图片"></button>`;
    }).join('');
  } catch {
    if ($('#detailPhotos')) $('#detailPhotos').innerHTML = '<span class="detail-photo-loading">图片暂时无法读取，文字内容不受影响</span>';
  }
}

function render() {
  const q = state.query.toLocaleLowerCase();
  const recordNotes = state.notes.filter(note => !isBuiltInLearningPlan(note));
  const visible = recordNotes.filter(note => {
    const matchesStatus = state.filter === 'all' || note.status === state.filter;
    const matchesCategory = categoryMatches(note);
    const haystack = [note.title, note.problem, note.process, note.result, note.category, ...Object.values(learningData(note)), ...(note.tags || [])].join(' ').toLocaleLowerCase();
    return matchesStatus && matchesCategory && (!q || haystack.includes(q));
  }).sort((a,b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt));

  $('#notesGrid').innerHTML = visible.map(note => `
    <article class="note-card ${note.pinned ? 'pinned' : ''}" data-id="${note.id}" tabindex="0" aria-label="打开记录：${escapeHTML(note.title)}">
      <div class="card-top"><span class="status-badge ${note.status}">${statusMeta[note.status]?.label || '待解决'}</span><span class="card-category">${escapeHTML(note.category || '未分类')}</span></div>
      <h3>${escapeHTML(note.title)}</h3>
      ${note.photoCount ? `<div class="card-photo" hidden><img alt="${escapeHTML(note.title)}的图片"><span>📷 ${note.photoCount}</span></div>` : ''}
      <p class="card-excerpt">${escapeHTML(excerpt(note))}</p>
      <div class="tags">${(note.tags || []).slice(0,4).map(tag => `<span class="tag"># ${escapeHTML(tag)}</span>`).join('')}</div>
      <footer class="card-footer"><span>${formatDate(note.updatedAt)}</span><span class="card-actions"><button class="mini-btn pin-btn" data-id="${note.id}" title="${note.pinned ? '取消置顶' : '置顶'}" aria-label="${note.pinned ? '取消置顶' : '置顶'}">${note.pinned ? '◆' : '◇'}</button><button class="mini-btn view-btn" data-id="${note.id}" type="button">查看</button><button class="mini-btn edit-btn" data-id="${note.id}" title="编辑" aria-label="编辑">✎</button></span></footer>
    </article>`).join('');

  $('#totalCount').textContent = recordNotes.length;
  $('#solvedCount').textContent = recordNotes.filter(n => n.status === 'solved').length;
  $('#weekCount').textContent = recordNotes.filter(n => new Date(n.createdAt) >= startOfWeek()).length;
  $('#resultCount').textContent = `${visible.length} 条`;
  $('#listTitle').textContent = q ? '搜索结果' : (state.filter === 'all' ? '全部记录' : statusMeta[state.filter].title);
  $('#emptyState').hidden = visible.length > 0;
  $('#emptyText').textContent = recordNotes.length ? '没有找到符合条件的记录，换个关键词或筛选试试。' : '记下第一个问题，让经验开始积累。';
  renderCategories();
  renderCategoryChips();
  renderPlans();
  renderTodayCompleted();
  hydrateCardPhotos(visible);
}

function renderCategories() {
  const select = $('#categoryFilter'); const current = state.category;
  const categories = [...new Set(state.notes.map(n => n.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  select.innerHTML = '<option value="all">全部分类</option>' + categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  select.value = categories.includes(current) ? current : 'all';
}

async function openForm(id = null) {
  state.editingId = id;
  revokeDraftUrls();
  removedPhotoIds.clear();
  renderPhotoDraft();
  const note = state.notes.find(n => n.id === id);
  dailyLearningSourceId = learningData(note || {}).sourcePlanId || '';
  $('#formEyebrow').textContent = note ? '编辑记录' : '新记录';
  $('#formTitle').textContent = note ? '继续补充这次经历' : '记录问题与结果';
  $('#titleInput').value = note?.title || '';
  $('#categoryInput').value = note?.category || '';
  $('#statusInput').value = note?.status || 'open';
  $('#problemInput').value = note?.problem || '';
  $('#processInput').value = note?.process || '';
  $('#resultInput').value = note?.result || '';
  const learning = learningData(note || {});
  $('#learningDateInput').value = learning.date || localDateKey();
  $('#learningWeekInput').value = learning.week || currentLearningWeek();
  $('#learningDurationInput').value = learning.duration || '';
  $('#learningCompletedInput').value = learning.completed || '';
  $('#learningUnderstoodInput').value = learning.understood || '';
  $('#learningProblemInput').value = learning.problem || '';
  $('#learningSolutionInput').value = learning.solution || '';
  $('#learningEnglishInput').value = learning.englishWords || '';
  $('#learningNextStepInput').value = learning.nextStep || '';
  $('#tagsInput').value = (note?.tags || []).join(' ');
  $('#planEnabledInput').checked = Boolean(note?.nextAction);
  $('#nextActionInput').value = note?.nextAction || '';
  $('#actionPeriodInput').value = note?.actionPeriod || 'week';
  $('#dueDateInput').value = note?.dueDate || '';
  $('#recurrenceInput').value = note?.recurrence || '';
  $('#planTimeInput').value = note?.planTime || '';
  $('#actionDoneInput').checked = note ? isPlanDone(note) : false;
  updatePlanCompletionLabel();
  setLearningTemplate(note?.category || '');
  setPlanFields($('#planEnabledInput').checked);
  const hasDetails = Boolean(note && (note.problem || note.process || note.result || hasLearningData(note) || note.tags?.length || note.photoCount || note.nextAction));
  setFormDetails(hasDetails);
  $('#deleteBtn').hidden = !note;
  $('#noteDialog').showModal();
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (draft && (draft.editingId || null) === id) {
      $('#titleInput').value = draft.title || $('#titleInput').value;
      $('#categoryInput').value = draft.category || $('#categoryInput').value;
      $('#statusInput').value = draft.status || $('#statusInput').value;
      $('#problemInput').value = draft.problem || '';
      $('#processInput').value = draft.process || '';
      $('#resultInput').value = draft.result || '';
      const draftLearning = draft.learningData || {};
      $('#learningDateInput').value = draftLearning.date || $('#learningDateInput').value;
      $('#learningWeekInput').value = draftLearning.week || $('#learningWeekInput').value;
      $('#learningDurationInput').value = draftLearning.duration || '';
      $('#learningCompletedInput').value = draftLearning.completed || '';
      $('#learningUnderstoodInput').value = draftLearning.understood || '';
      $('#learningProblemInput').value = draftLearning.problem || '';
      $('#learningSolutionInput').value = draftLearning.solution || '';
      $('#learningEnglishInput').value = draftLearning.englishWords || '';
      $('#learningNextStepInput').value = draftLearning.nextStep || '';
      $('#tagsInput').value = draft.tags || '';
      $('#planEnabledInput').checked = Boolean(draft.planEnabled);
      $('#nextActionInput').value = draft.nextAction || '';
      $('#actionPeriodInput').value = draft.actionPeriod || 'week';
      $('#dueDateInput').value = draft.dueDate || '';
      $('#recurrenceInput').value = draft.recurrence || '';
      $('#planTimeInput').value = draft.planTime || '';
      $('#actionDoneInput').checked = Boolean(draft.actionDone);
      updatePlanCompletionLabel();
      setLearningTemplate($('#categoryInput').value);
      setPlanFields($('#planEnabledInput').checked);
      if (draft.problem || draft.process || draft.result || Object.values(draftLearning).some(Boolean) || draft.tags || draft.planEnabled) setFormDetails(true);
      toast('已恢复上次未保存的草稿');
    }
  } catch { /* 无效草稿直接忽略。 */ }
  setTimeout(() => $('#titleInput').focus(), 50);
  if (note?.photoCount) {
    try {
      const photos = await getNotePhotos(note.id);
      if (state.editingId !== id || !$('#noteDialog').open) return;
      photoDraft = photos.map(photo => ({ ...photo, persisted: true, url: URL.createObjectURL(photo.blob) }));
      renderPhotoDraft();
    } catch { toast('图片暂时无法读取，文字内容不受影响'); }
  }
}
function closeForm() {
  $('#noteDialog').close();
  state.editingId = null;
  dailyLearningSourceId = '';
  revokeDraftUrls();
  removedPhotoIds.clear();
  if (updatePendingReload) setTimeout(() => location.reload(), 50);
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }

function saveFormDraft() {
  const draft = {
    editingId: state.editingId,
    title: $('#titleInput').value,
    category: $('#categoryInput').value,
    status: $('#statusInput').value,
    problem: $('#problemInput').value,
    process: $('#processInput').value,
    result: $('#resultInput').value,
    learningData: readLearningForm(),
    tags: $('#tagsInput').value,
    planEnabled: $('#planEnabledInput').checked,
    nextAction: $('#nextActionInput').value,
    actionPeriod: $('#actionPeriodInput').value,
    dueDate: $('#dueDateInput').value,
    recurrence: $('#recurrenceInput').value,
    planTime: $('#planTimeInput').value,
    actionDone: $('#actionDoneInput').checked
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

async function saveQuickNote() {
  const title = $('#quickInput').value.trim();
  if (!title) { $('#quickInput').focus(); toast('先写一句要记录的内容'); return; }
  const now = new Date().toISOString();
  const note = { id:uid(), title, category:autoCategory(title), status:'open', problem:'', process:'', result:'', learningData:{}, tags:[], photoCount:0, pinned:false, nextAction:'', actionPeriod:'week', dueDate:'', actionDone:false, recurrence:'', planTime:'', lastCompletedDate:'', createdAt:now, updatedAt:now };
  state.notes.unshift(note);
  $('#quickInput').value = '';
  save(); render(); toast(`已快速记录，并归入“${note.category}”`);
  window.cloudApi?.pushNote(note).catch(() => {});
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let activeRecognition = null;
let activeVoiceButton = null;

function finishVoiceInput() {
  activeVoiceButton?.classList.remove('listening');
  activeVoiceButton?.setAttribute('aria-pressed', 'false');
  activeRecognition = null;
  activeVoiceButton = null;
}

function startVoiceInput(button) {
  if (!SpeechRecognition) {
    toast('当前浏览器不支持网页语音识别，可使用手机键盘上的麦克风');
    return;
  }
  if (activeRecognition) {
    activeRecognition.stop();
    return;
  }

  const target = document.getElementById(button.dataset.voiceTarget);
  if (!target) return;
  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  activeRecognition = recognition;
  activeVoiceButton = button;

  recognition.onstart = () => {
    button.classList.add('listening');
    button.setAttribute('aria-pressed', 'true');
    target.focus();
    toast('正在听，请开始说话…再点麦克风可停止');
  };
  recognition.onresult = event => {
    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
    }
    transcript = transcript.trim();
    if (!transcript) return;
    const needsSpace = target.value && !/[\s，。！？；：]$/.test(target.value);
    target.value += `${needsSpace ? ' ' : ''}${transcript}`;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  };
  recognition.onerror = event => {
    const messages = {
      'not-allowed': '没有麦克风权限，请在浏览器设置中允许访问麦克风',
      'audio-capture': '没有检测到可用的麦克风',
      'network': '语音识别需要网络连接，请检查网络后重试',
      'no-speech': '没有听到语音，请靠近麦克风再试一次'
    };
    toast(messages[event.error] || '语音识别暂时不可用，请稍后重试');
  };
  recognition.onend = finishVoiceInput;
  try { recognition.start(); }
  catch { finishVoiceInput(); toast('语音识别启动失败，请稍后重试'); }
}

document.querySelectorAll('[data-voice-target]').forEach(button => {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', event => {
    event.preventDefault();
    startVoiceInput(button);
  });
});

$('#noteForm').addEventListener('submit', async event => {
  event.preventDefault();
  const title = $('#titleInput').value.trim(); if (!title) { $('#titleInput').focus(); return; }
  const now = new Date().toISOString(); const old = state.notes.find(n => n.id === state.editingId);
  const category = $('#categoryInput').value.trim() || autoCategory(title);
  const structuredLearning = category === '学习' ? { ...readLearningForm(), sourcePlanId:dailyLearningSourceId || learningData(old || {}).sourcePlanId || '' } : learningData(old || {});
  const planEnabled = $('#planEnabledInput').checked;
  const nextAction = planEnabled ? ($('#nextActionInput').value.trim() || structuredLearning.nextStep || `继续处理：${title}`) : '';
  const recurrence = planEnabled ? $('#recurrenceInput').value : '';
  const checked = planEnabled && $('#actionDoneInput').checked;
  let lastCompletedDate = old?.lastCompletedDate || '';
  if (recurrence && checked) lastCompletedDate = localDateKey();
  else if (recurrence && !checked && lastCompletedDate === localDateKey()) lastCompletedDate = '';
  const note = { id: old?.id || uid(), title, category, status: $('#statusInput').value, problem: $('#problemInput').value.trim(), process: $('#processInput').value.trim(), result: $('#resultInput').value.trim(), learningData:structuredLearning, tags: parseTags($('#tagsInput').value), photoCount: photoDraft.length, pinned: old?.pinned || false, nextAction, actionPeriod:planEnabled ? $('#actionPeriodInput').value : 'week', dueDate:planEnabled ? $('#dueDateInput').value : '', actionDone:planEnabled && !recurrence && checked, recurrence, planTime:planEnabled ? $('#planTimeInput').value : '', lastCompletedDate:planEnabled ? lastCompletedDate : '', createdAt: old?.createdAt || now, updatedAt: now };
  const submitButton = $('#noteForm button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = '正在保存…';
  try {
    await savePhotoDraft(note.id);
    if (old) state.notes = state.notes.map(n => n.id === old.id ? note : n); else state.notes.unshift(note);
    localStorage.removeItem(DRAFT_KEY); save(); render(); closeForm(); toast(old ? '记录已更新' : '记录已保存');
    window.cloudApi?.pushNote(note).catch(() => {});
  } catch {
    toast('图片保存失败，请检查浏览器存储空间后重试');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = '保存记录';
  }
});

$('#deleteBtn').addEventListener('click', async () => {
  const note = state.notes.find(n => n.id === state.editingId);
  if (note && confirm(`确定删除“${note.title}”吗？文字和图片都会被删除，此操作无法撤销。`)) {
    try { await deleteNotePhotos(note.id); } catch { /* 继续删除文字记录。 */ }
    state.notes = state.notes.filter(n => n.id !== note.id); save(); render(); closeForm(); toast('记录已删除');
    window.cloudApi?.deleteNote(note.id).catch(() => {});
  }
});

$('#cameraBtn').addEventListener('click', () => $('#cameraInput').click());
$('#galleryBtn').addEventListener('click', () => $('#galleryInput').click());
$('#cameraInput').addEventListener('change', async event => { await addPhotoFiles(event.target.files); event.target.value = ''; });
$('#galleryInput').addEventListener('change', async event => { await addPhotoFiles(event.target.files); event.target.value = ''; });
$('#photoPreview').addEventListener('click', event => {
  const item = event.target.closest('.photo-item');
  if (!item) return;
  const photo = photoDraft.find(entry => entry.id === item.dataset.photoId);
  if (!photo) return;
  if (event.target.closest('.photo-remove')) {
    if (photo.persisted) removedPhotoIds.add(photo.id);
    URL.revokeObjectURL(photo.url);
    photoDraft = photoDraft.filter(entry => entry.id !== photo.id);
    renderPhotoDraft();
    return;
  }
  if (event.target.closest('.photo-open')) {
    $('#imageDialogImg').src = photo.url;
    $('#imageDialog').showModal();
  }
});
$('#imageDialogClose').addEventListener('click', () => $('#imageDialog').close());
$('#imageDialog').addEventListener('click', event => { if (event.target === $('#imageDialog')) $('#imageDialog').close(); });
$('#detailCloseBtn').addEventListener('click', () => $('#detailDialog').close());
$('#detailDoneBtn').addEventListener('click', () => $('#detailDialog').close());
$('#detailDialog').addEventListener('close', cleanupDetailPhotos);
$('#detailDialog').addEventListener('click', event => { if (event.target === $('#detailDialog')) $('#detailDialog').close(); });
$('#detailContent').addEventListener('click', event => {
  const planToggle = event.target.closest('.full-plan-toggle');
  if (planToggle) {
    const weeks = [...$('#detailContent').querySelectorAll('.full-plan-week')];
    const expand = planToggle.dataset.expanded !== 'true';
    weeks.forEach(week => { week.open = expand; });
    planToggle.dataset.expanded = String(expand);
    planToggle.textContent = expand ? '收起全部周次' : '展开全部40周';
    return;
  }
  const button = event.target.closest('.detail-photo-button');
  if (!button) return;
  $('#imageDialogImg').src = button.querySelector('img').src;
  $('#imageDialog').showModal();
});
$('#detailContent').addEventListener('change', event => {
  const check = event.target.closest('.full-plan-task-check');
  if (!check) return;
  const note = state.notes.find(item => item.id === check.dataset.noteId);
  if (!note) return;
  const completed = new Set(completedTaskKeys(note));
  if (check.checked) completed.add(check.dataset.taskKey); else completed.delete(check.dataset.taskKey);
  note.completedTasks = [...completed];
  if (check.dataset.taskDate === localDateKey()) note.lastCompletedDate = check.checked ? localDateKey() : '';
  note.updatedAt = new Date().toISOString();
  const row = check.closest('li'); row.classList.toggle('task-completed', check.checked);
  const time = row.querySelector('time'); const oldBadge = time.querySelector('b'); if (oldBadge) oldBadge.remove();
  if (check.checked) {
    const badge = document.createElement('b'); badge.textContent = check.dataset.taskDate > localDateKey() ? '已提前完成' : '已完成'; time.appendChild(badge);
  }
  const week = check.closest('.full-plan-week');
  const weekChecks = [...week.querySelectorAll('.full-plan-task-check')];
  week.querySelector('summary small').textContent = `${weekChecks.filter(item => item.checked).length}/${weekChecks.length} 已完成`;
  const planHeader = check.closest('.full-learning-plan').querySelector('.full-plan-head>div>span');
  planHeader.textContent = `完整路线 · 已完成 ${completed.size}/80`;
  save(); render();
  toast(check.checked ? (check.dataset.taskDate > localDateKey() ? '已记录为提前完成' : '这项训练已完成') : '已恢复为未完成');
  window.cloudApi?.pushNote(note).catch(() => {});
});
$('#detailEditBtn').addEventListener('click', () => {
  const id = detailNoteId;
  $('#detailDialog').close();
  if (id) openForm(id);
});
$('#detailStudyBtn').addEventListener('click', async () => {
  const master = state.notes.find(note => note.id === detailNoteId);
  if (!master) return;
  const route = master.id === 'learning-plan-u3d' ? 'U3D' : 'Spine';
  $('#detailDialog').close();
  await openForm();
  dailyLearningSourceId = master.id;
  const today = new Date();
  $('#titleInput').value = `${route} 学习记录 · ${today.toLocaleDateString('zh-CN', { month:'long', day:'numeric' })}`;
  $('#categoryInput').value = '学习';
  $('#statusInput').value = 'solved';
  $('#tagsInput').value = `${route} 学习记录`;
  $('#learningDateInput').value = localDateKey(today);
  $('#learningWeekInput').value = currentLearningWeek(today);
  setLearningTemplate('学习');
  setFormDetails(true);
  setTimeout(() => $('#learningCompletedInput').focus(), 60);
});
$('#formMoreBtn').addEventListener('click', () => setFormDetails($('#formDetails').hidden));
$('#categoryInput').addEventListener('input', event => {
  setLearningTemplate(event.target.value);
  if (event.target.value.trim() === '学习') setFormDetails(true);
});
$('#planEnabledInput').addEventListener('change', event => { setPlanFields(event.target.checked); if (event.target.checked) $('#nextActionInput').focus(); });
$('#recurrenceInput').addEventListener('change', updatePlanCompletionLabel);
let draftSaveTimer;
$('#noteForm').addEventListener('input', () => { clearTimeout(draftSaveTimer); draftSaveTimer = setTimeout(saveFormDraft, 350); });
$('#quickSaveBtn').addEventListener('click', saveQuickNote);
$('#quickInput').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); saveQuickNote(); } });
$('#quickCameraBtn').addEventListener('click', async () => {
  const quickTitle = $('#quickInput').value.trim();
  await openForm();
  if (quickTitle) { $('#titleInput').value = quickTitle; $('#categoryInput').value = autoCategory(quickTitle); setLearningTemplate($('#categoryInput').value); $('#quickInput').value = ''; }
  setFormDetails(true);
  setTimeout(() => $('#cameraInput').click(), 80);
});
$('#weeklySummaryBtn').addEventListener('click', openWeeklySummary);
$('#summaryCloseBtn').addEventListener('click', () => $('#summaryDialog').close());
$('#summaryDoneBtn').addEventListener('click', () => $('#summaryDialog').close());
$('#summaryDialog').addEventListener('click', event => { if (event.target === $('#summaryDialog')) $('#summaryDialog').close(); });
$('#notesGrid').addEventListener('click', event => {
  const pin = event.target.closest('.pin-btn'); const view = event.target.closest('.view-btn'); const edit = event.target.closest('.edit-btn');
  if (pin) { event.stopPropagation(); const note = state.notes.find(n => n.id === pin.dataset.id); note.pinned = !note.pinned; note.updatedAt = new Date().toISOString(); save(); render(); toast(note.pinned ? '已置顶' : '已取消置顶'); return; }
  if (view) { event.stopPropagation(); openDetail(view.dataset.id); return; }
  if (edit) { event.stopPropagation(); openForm(edit.dataset.id); return; }
  const card = event.target.closest('.note-card'); if (card) openDetail(card.dataset.id);
});
$('#notesGrid').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('note-card')) { event.preventDefault(); openDetail(event.target.dataset.id); } });
$('#categoryChips').addEventListener('click', event => { const button = event.target.closest('.category-chip'); if (!button) return; state.category = button.dataset.category; render(); });
$('#planList').addEventListener('change', event => {
  const check = event.target.closest('.plan-check'); if (!check) return;
  const note = state.notes.find(item => item.id === check.dataset.id); if (!note) return;
  if (isBuiltInLearningPlan(note)) {
    const task = learningPlanTaskInfo(note); const completed = new Set(completedTaskKeys(note));
    if (task) { if (check.checked) completed.add(task.key); else completed.delete(task.key); }
    note.completedTasks = [...completed]; note.lastCompletedDate = check.checked ? localDateKey() : '';
  }
  else if (isRecurringPlan(note)) note.lastCompletedDate = check.checked ? localDateKey() : '';
  else note.actionDone = check.checked;
  note.updatedAt = new Date().toISOString(); save(); render(); toast(check.checked ? '今天的计划已完成' : '已恢复到今天的计划'); window.cloudApi?.pushNote(note).catch(() => {});
});
$('#planList').addEventListener('click', event => { const button = event.target.closest('.plan-open, .plan-task-picker'); if (button) openDetail(button.dataset.id); });
$('#todayDoneList').addEventListener('click', event => { const item = event.target.closest('.today-done-item'); if (item) openDetail(item.dataset.id); });
$('#statusFilters').addEventListener('click', event => { const btn = event.target.closest('.filter'); if (!btn) return; state.filter = btn.dataset.status; document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === btn)); render(); });
$('#categoryFilter').addEventListener('change', event => { state.category = event.target.value; render(); });
$('#searchInput').addEventListener('input', event => { state.query = event.target.value.trim(); render(); });
['#newNoteBtn','#mobileNewBtn','#emptyNewBtn'].forEach(s => $(s).addEventListener('click', () => openForm()));
document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeForm));
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openForm(); } });

const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme === 'dark' || (!savedTheme && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.dataset.theme = 'dark';
$('#themeBtn').addEventListener('click', () => { const dark = document.documentElement.dataset.theme === 'dark'; document.documentElement.dataset.theme = dark ? 'light' : 'dark'; localStorage.setItem(THEME_KEY, dark ? 'light' : 'dark'); });
$('#moreBtn').addEventListener('click', () => $('#settingsDialog').showModal());
document.querySelectorAll('[data-settings-close]').forEach(btn => btn.addEventListener('click', () => $('#settingsDialog').close()));
$('#exportBtn').addEventListener('click', async () => {
  const button = $('#exportBtn'); button.disabled = true; button.textContent = '正在打包…';
  try {
    const photos = await getAllPhotos();
    const photoBackup = await Promise.all(photos.map(async photo => ({ id: photo.id, noteId: photo.noteId, name: photo.name, createdAt: photo.createdAt, data: await blobToDataUrl(photo.blob) })));
    const blob = new Blob([JSON.stringify({ app:'拾记', version:2, exportedAt:new Date().toISOString(), notes:state.notes, photos:photoBackup }, null, 2)], {type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`拾记备份-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); toast(`备份已导出，包含 ${photos.length} 张图片`);
  } catch { toast('备份生成失败，请稍后重试'); }
  finally { button.disabled = false; button.textContent = '导出 JSON'; }
});
$('#importBtn').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async event => {
  const file=event.target.files[0]; if(!file)return;
  try {
    const data=JSON.parse(await file.text()); const incoming=Array.isArray(data)?data:data.notes; if(!Array.isArray(incoming))throw new Error();
    const valid=incoming.filter(n=>n && n.title).map(n=>({...n,id:n.id||uid(),photoCount:Number(n.photoCount)||0,createdAt:n.createdAt||new Date().toISOString(),updatedAt:n.updatedAt||new Date().toISOString(),tags:Array.isArray(n.tags)?n.tags:[]}));
    const photoBackup = Array.isArray(data.photos) ? data.photos.filter(photo => photo?.id && photo?.noteId && photo?.data) : [];
    if (photoBackup.length) {
      const db = await openPhotoDb();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(PHOTO_STORE, 'readwrite'); const store = transaction.objectStore(PHOTO_STORE);
        photoBackup.forEach(photo => store.put({ id:photo.id, noteId:photo.noteId, name:photo.name||'photo.jpg', createdAt:photo.createdAt||new Date().toISOString(), blob:dataUrlToBlob(photo.data) }));
        transaction.oncomplete=resolve; transaction.onerror=()=>reject(transaction.error);
      });
    }
    const map=new Map(state.notes.map(n=>[n.id,n])); valid.forEach(n=>map.set(n.id,n)); state.notes=[...map.values()]; save();render();$('#settingsDialog').close();toast(`已导入 ${valid.length} 条记录和 ${photoBackup.length} 张图片`); window.cloudApi?.pushAll().catch(()=>{});
  } catch { alert('无法读取这个备份文件，请确认它是拾记导出的 JSON 文件。'); }
  finally { event.target.value=''; }
});

let deferredPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt=event; $('#installBtn').disabled=false; $('#installBtn').textContent='安装应用'; });
$('#installBtn').addEventListener('click', async () => { if(!deferredPrompt)return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('#installBtn').disabled=true; $('#installBtn').textContent='已处理安装请求'; });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    if ($('#noteDialog').open) {
      updatePendingReload = true;
      toast('新版本已准备好，保存或关闭记录后会自动更新');
    } else {
      location.reload();
    }
  });
  navigator.serviceWorker.register('./sw.js?v=28').then(registration => {
    registration.update();
    setInterval(() => registration.update(), 60 * 60 * 1000);
  }).catch(() => {
    // 离线或浏览器暂时无法注册时，核心记事功能仍可继续使用。
  });
}

$('#todayText').textContent = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
load(); ensureBuiltInLearningPlans(); separateMasterPlanLearningEntries(); render();
