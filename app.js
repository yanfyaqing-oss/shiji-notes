const STORAGE_KEY = 'shiji-notes-v1';
const THEME_KEY = 'shiji-theme';

const $ = (selector) => document.querySelector(selector);
const state = { notes: [], filter: 'all', category: 'all', query: '', editingId: null };
let updatePendingReload = false;
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
function excerpt(note) { return note.result || note.problem || note.process || '还没有补充详细内容。'; }

const PHOTO_DB = 'shiji-media-v1';
const PHOTO_STORE = 'photos';
const MAX_PHOTOS = 5;
let photoDbPromise;
let photoDraft = [];
let removedPhotoIds = new Set();
let cardPhotoUrls = [];

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

function render() {
  const q = state.query.toLocaleLowerCase();
  const visible = state.notes.filter(note => {
    const matchesStatus = state.filter === 'all' || note.status === state.filter;
    const matchesCategory = state.category === 'all' || note.category === state.category;
    const haystack = [note.title, note.problem, note.process, note.result, note.category, ...(note.tags || [])].join(' ').toLocaleLowerCase();
    return matchesStatus && matchesCategory && (!q || haystack.includes(q));
  }).sort((a,b) => Number(b.pinned) - Number(a.pinned) || new Date(b.updatedAt) - new Date(a.updatedAt));

  $('#notesGrid').innerHTML = visible.map(note => `
    <article class="note-card ${note.pinned ? 'pinned' : ''}" data-id="${note.id}" tabindex="0" aria-label="打开记录：${escapeHTML(note.title)}">
      <div class="card-top"><span class="status-badge ${note.status}">${statusMeta[note.status]?.label || '待解决'}</span><span class="card-category">${escapeHTML(note.category || '未分类')}</span></div>
      <h3>${escapeHTML(note.title)}</h3>
      ${note.photoCount ? `<div class="card-photo" hidden><img alt="${escapeHTML(note.title)}的图片"><span>📷 ${note.photoCount}</span></div>` : ''}
      <p class="card-excerpt">${escapeHTML(excerpt(note))}</p>
      <div class="tags">${(note.tags || []).slice(0,4).map(tag => `<span class="tag"># ${escapeHTML(tag)}</span>`).join('')}</div>
      <footer class="card-footer"><span>${formatDate(note.updatedAt)}</span><span class="card-actions"><button class="mini-btn pin-btn" data-id="${note.id}" title="${note.pinned ? '取消置顶' : '置顶'}" aria-label="${note.pinned ? '取消置顶' : '置顶'}">${note.pinned ? '◆' : '◇'}</button><button class="mini-btn edit-btn" data-id="${note.id}" title="编辑" aria-label="编辑">✎</button></span></footer>
    </article>`).join('');

  $('#totalCount').textContent = state.notes.length;
  $('#solvedCount').textContent = state.notes.filter(n => n.status === 'solved').length;
  $('#weekCount').textContent = state.notes.filter(n => new Date(n.createdAt) >= startOfWeek()).length;
  $('#resultCount').textContent = `${visible.length} 条`;
  $('#listTitle').textContent = q ? '搜索结果' : (state.filter === 'all' ? '全部记录' : statusMeta[state.filter].title);
  $('#emptyState').hidden = visible.length > 0;
  $('#emptyText').textContent = state.notes.length ? '没有找到符合条件的记录，换个关键词或筛选试试。' : '记下第一个问题，让经验开始积累。';
  renderCategories();
  hydrateCardPhotos(visible);
}

function renderCategories() {
  const select = $('#categoryFilter'); const current = state.category;
  const categories = [...new Set(state.notes.map(n => n.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  select.innerHTML = '<option value="all">全部分类</option>' + categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  select.value = categories.includes(current) ? current : 'all';
  if (!categories.includes(current)) state.category = 'all';
}

async function openForm(id = null) {
  state.editingId = id;
  revokeDraftUrls();
  removedPhotoIds.clear();
  renderPhotoDraft();
  const note = state.notes.find(n => n.id === id);
  $('#formEyebrow').textContent = note ? '编辑记录' : '新记录';
  $('#formTitle').textContent = note ? '继续补充这次经历' : '记录问题与结果';
  $('#titleInput').value = note?.title || '';
  $('#categoryInput').value = note?.category || '';
  $('#statusInput').value = note?.status || 'open';
  $('#problemInput').value = note?.problem || '';
  $('#processInput').value = note?.process || '';
  $('#resultInput').value = note?.result || '';
  $('#tagsInput').value = (note?.tags || []).join(' ');
  $('#deleteBtn').hidden = !note;
  $('#noteDialog').showModal();
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
  revokeDraftUrls();
  removedPhotoIds.clear();
  if (updatePendingReload) setTimeout(() => location.reload(), 50);
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }

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
  const note = { id: old?.id || uid(), title, category: $('#categoryInput').value.trim() || '未分类', status: $('#statusInput').value, problem: $('#problemInput').value.trim(), process: $('#processInput').value.trim(), result: $('#resultInput').value.trim(), tags: parseTags($('#tagsInput').value), photoCount: photoDraft.length, pinned: old?.pinned || false, createdAt: old?.createdAt || now, updatedAt: now };
  const submitButton = $('#noteForm button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = '正在保存…';
  try {
    await savePhotoDraft(note.id);
    if (old) state.notes = state.notes.map(n => n.id === old.id ? note : n); else state.notes.unshift(note);
    save(); render(); closeForm(); toast(old ? '记录已更新' : '记录已保存');
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
$('#notesGrid').addEventListener('click', event => {
  const pin = event.target.closest('.pin-btn'); const edit = event.target.closest('.edit-btn');
  if (pin) { event.stopPropagation(); const note = state.notes.find(n => n.id === pin.dataset.id); note.pinned = !note.pinned; note.updatedAt = new Date().toISOString(); save(); render(); toast(note.pinned ? '已置顶' : '已取消置顶'); return; }
  if (edit) { event.stopPropagation(); openForm(edit.dataset.id); return; }
  const card = event.target.closest('.note-card'); if (card) openForm(card.dataset.id);
});
$('#notesGrid').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('note-card')) openForm(event.target.dataset.id); });
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
  navigator.serviceWorker.register('./sw.js').then(registration => {
    registration.update();
    setInterval(() => registration.update(), 60 * 60 * 1000);
  }).catch(() => {
    // 离线或浏览器暂时无法注册时，核心记事功能仍可继续使用。
  });
}

$('#todayText').textContent = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
load(); render();
