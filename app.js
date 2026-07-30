const STORAGE_KEY = 'shiji-notes-v1';
const THEME_KEY = 'shiji-theme';

const $ = (selector) => document.querySelector(selector);
const state = { notes: [], filter: 'all', category: 'all', query: '', editingId: null };
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
}

function renderCategories() {
  const select = $('#categoryFilter'); const current = state.category;
  const categories = [...new Set(state.notes.map(n => n.category).filter(Boolean))].sort((a,b) => a.localeCompare(b,'zh-CN'));
  select.innerHTML = '<option value="all">全部分类</option>' + categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
  select.value = categories.includes(current) ? current : 'all';
  if (!categories.includes(current)) state.category = 'all';
}

function openForm(id = null) {
  state.editingId = id;
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
}
function closeForm() { $('#noteDialog').close(); state.editingId = null; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2200); }

$('#noteForm').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#titleInput').value.trim(); if (!title) { $('#titleInput').focus(); return; }
  const now = new Date().toISOString(); const old = state.notes.find(n => n.id === state.editingId);
  const note = { id: old?.id || uid(), title, category: $('#categoryInput').value.trim() || '未分类', status: $('#statusInput').value, problem: $('#problemInput').value.trim(), process: $('#processInput').value.trim(), result: $('#resultInput').value.trim(), tags: parseTags($('#tagsInput').value), pinned: old?.pinned || false, createdAt: old?.createdAt || now, updatedAt: now };
  if (old) state.notes = state.notes.map(n => n.id === old.id ? note : n); else state.notes.unshift(note);
  save(); render(); closeForm(); toast(old ? '记录已更新' : '记录已保存');
});

$('#deleteBtn').addEventListener('click', () => {
  const note = state.notes.find(n => n.id === state.editingId);
  if (note && confirm(`确定删除“${note.title}”吗？此操作无法撤销。`)) { state.notes = state.notes.filter(n => n.id !== note.id); save(); render(); closeForm(); toast('记录已删除'); }
});
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
$('#exportBtn').addEventListener('click', () => { const blob = new Blob([JSON.stringify({ app:'拾记', version:1, exportedAt:new Date().toISOString(), notes:state.notes }, null, 2)], {type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`拾记备份-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); toast('备份已导出'); });
$('#importBtn').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async event => { const file=event.target.files[0]; if(!file)return; try { const data=JSON.parse(await file.text()); const incoming=Array.isArray(data)?data:data.notes; if(!Array.isArray(incoming))throw new Error(); const valid=incoming.filter(n=>n && n.title).map(n=>({...n,id:n.id||uid(),createdAt:n.createdAt||new Date().toISOString(),updatedAt:n.updatedAt||new Date().toISOString(),tags:Array.isArray(n.tags)?n.tags:[]})); const map=new Map(state.notes.map(n=>[n.id,n])); valid.forEach(n=>map.set(n.id,n)); state.notes=[...map.values()]; save();render();$('#settingsDialog').close();toast(`已导入 ${valid.length} 条记录`); } catch { alert('无法读取这个备份文件，请确认它是拾记导出的 JSON 文件。'); } finally { event.target.value=''; } });

let deferredPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt=event; $('#installBtn').disabled=false; $('#installBtn').textContent='安装应用'; });
$('#installBtn').addEventListener('click', async () => { if(!deferredPrompt)return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; $('#installBtn').disabled=true; $('#installBtn').textContent='已处理安装请求'; });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js');

$('#todayText').textContent = new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
load(); render();
