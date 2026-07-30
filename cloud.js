(() => {
  const SUPABASE_URL = 'https://adzkplxhztumyxyxfits.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_m5788nByZOPsgIJat3HwOg_u4w-YF0_';
  const LAST_SYNC_KEY = 'shiji-last-cloud-sync';
  const cloudButton = $('#cloudBtn');
  const cloudDialog = $('#cloudDialog');
  let client = null;
  let session = null;
  let realtimeChannel = null;
  let syncPromise = null;

  function setStatus(message) {
    $('#cloudStatusText').textContent = message;
  }

  function formatSyncTime(value) {
    if (!value) return '尚未同步';
    return `上次同步：${new Date(value).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}`;
  }

  function updateAccountUi() {
    const signedIn = Boolean(session?.user);
    $('#cloudSignedOut').hidden = signedIn;
    $('#cloudSignedIn').hidden = !signedIn;
    cloudButton.classList.toggle('connected', signedIn);
    cloudButton.title = signedIn ? '云端已连接' : '登录云端同步';
    if (signedIn) {
      $('#cloudUserEmail').textContent = session.user.email || '已登录';
      setStatus(formatSyncTime(localStorage.getItem(LAST_SYNC_KEY)));
    }
  }

  function localToRemote(note) {
    return {
      user_id: session.user.id,
      id: note.id,
      title: note.title,
      category: note.category || '未分类',
      status: note.status || 'open',
      problem: note.problem || '',
      process: note.process || '',
      result: note.result || '',
      learning_data: note.learningData && typeof note.learningData === 'object' ? note.learningData : {},
      tags: Array.isArray(note.tags) ? note.tags : [],
      pinned: Boolean(note.pinned),
      next_action: note.nextAction || '',
      action_period: note.actionPeriod || 'week',
      due_date: note.dueDate || null,
      action_done: Boolean(note.actionDone),
      recurrence: note.recurrence || '',
      plan_time: note.planTime || null,
      last_completed_date: note.lastCompletedDate || null,
      completed_tasks: Array.isArray(note.completedTasks) ? note.completedTasks : [],
      photo_count: Number(note.photoCount) || 0,
      created_at: note.createdAt || new Date().toISOString(),
      updated_at: note.updatedAt || new Date().toISOString(),
      deleted_at: null
    };
  }

  function remoteToLocal(row) {
    return {
      id: row.id,
      title: row.title,
      category: row.category || '未分类',
      status: row.status || 'open',
      problem: row.problem || '',
      process: row.process || '',
      result: row.result || '',
      learningData: row.learning_data && typeof row.learning_data === 'object' ? row.learning_data : {},
      tags: Array.isArray(row.tags) ? row.tags : [],
      pinned: Boolean(row.pinned),
      nextAction: row.next_action || '',
      actionPeriod: row.action_period || 'week',
      dueDate: row.due_date || '',
      actionDone: Boolean(row.action_done),
      recurrence: row.recurrence || '',
      planTime: row.plan_time || '',
      lastCompletedDate: row.last_completed_date || '',
      completedTasks: Array.isArray(row.completed_tasks) ? row.completed_tasks : [],
      photoCount: Number(row.photo_count) || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async function replaceLocalPhotos(noteId) {
    const { data: metadata, error } = await client.from('note_photos').select('*').eq('note_id', noteId).order('created_at');
    if (error) throw error;
    await deleteNotePhotos(noteId);
    if (!metadata?.length) return;
    const downloaded = [];
    for (const photo of metadata) {
      const { data, error: downloadError } = await client.storage.from('note-photos').download(photo.storage_path);
      if (downloadError) throw downloadError;
      downloaded.push({ id:photo.id, noteId, blob:data, name:photo.file_name, createdAt:photo.created_at });
    }
    const db = await openPhotoDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PHOTO_STORE, 'readwrite');
      downloaded.forEach(photo => transaction.objectStore(PHOTO_STORE).put(photo));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function pushPhotos(note) {
    const localPhotos = await getNotePhotos(note.id);
    const { data: remotePhotos, error: listError } = await client.from('note_photos').select('*').eq('note_id', note.id);
    if (listError) throw listError;
    const localIds = new Set(localPhotos.map(photo => photo.id));
    const removed = (remotePhotos || []).filter(photo => !localIds.has(photo.id));
    if (removed.length) {
      const { error: storageDeleteError } = await client.storage.from('note-photos').remove(removed.map(photo => photo.storage_path));
      if (storageDeleteError) throw storageDeleteError;
      const { error: metaDeleteError } = await client.from('note_photos').delete().eq('note_id', note.id).in('id', removed.map(photo => photo.id));
      if (metaDeleteError) throw metaDeleteError;
    }
    for (const photo of localPhotos) {
      const path = `${session.user.id}/${note.id}/${photo.id}.jpg`;
      const { error: uploadError } = await client.storage.from('note-photos').upload(path, photo.blob, { contentType:'image/jpeg', upsert:true });
      if (uploadError) throw uploadError;
      const { error: metaError } = await client.from('note_photos').upsert({ user_id:session.user.id, id:photo.id, note_id:note.id, storage_path:path, file_name:photo.name || 'photo.jpg', created_at:photo.createdAt }, { onConflict:'user_id,id' });
      if (metaError) throw metaError;
    }

    // The note row is written before its photo files. Touch it again after the
    // uploads finish so other devices receive a realtime event only when the
    // photos are ready to download.
    const { error: notifyError } = await client.from('notes').update({ photo_count:localPhotos.length }).eq('id', note.id);
    if (notifyError) throw notifyError;
  }

  async function pushNote(note) {
    if (!session?.user || !client) return;
    const row = localToRemote(note);
    const { error } = await client.from('notes').upsert(row, { onConflict:'user_id,id' });
    if (error) throw error;
    await pushPhotos(note);
  }

  async function pullNote(row) {
    const note = remoteToLocal(row);
    const index = state.notes.findIndex(item => item.id === note.id);
    if (index >= 0) state.notes[index] = note; else state.notes.push(note);
    await replaceLocalPhotos(note.id);
  }

  async function ensureRemotePhotos(row) {
    const expected = Number(row.photo_count) || 0;
    const localPhotos = await getNotePhotos(row.id);
    if (localPhotos.length !== expected) await replaceLocalPhotos(row.id);
  }

  async function deleteCloudNote(noteId) {
    if (!session?.user || !client) return;
    const { data: photos } = await client.from('note_photos').select('storage_path').eq('note_id', noteId);
    if (photos?.length) await client.storage.from('note-photos').remove(photos.map(photo => photo.storage_path));
    await client.from('note_photos').delete().eq('note_id', noteId);
    const now = new Date().toISOString();
    const { error } = await client.from('notes').update({ deleted_at:now, updated_at:now, photo_count:0 }).eq('id', noteId);
    if (error) throw error;
  }

  async function performSync() {
    if (!session?.user || !navigator.onLine) return;
    cloudButton.classList.add('syncing');
    setStatus('正在合并文字和图片…');
    try {
      const { data: rows, error } = await client.from('notes').select('*');
      if (error) throw error;
      const remote = new Map((rows || []).map(row => [row.id, row]));

      for (const row of rows || []) {
        if (!row.deleted_at) continue;
        const local = state.notes.find(note => note.id === row.id);
        if (local && new Date(row.updated_at) >= new Date(local.updatedAt)) {
          state.notes = state.notes.filter(note => note.id !== row.id);
          await deleteNotePhotos(row.id);
        }
        remote.delete(row.id);
      }

      for (const note of [...state.notes]) {
        const row = remote.get(note.id);
        if (!row) await pushNote(note);
        else if (new Date(note.updatedAt) > new Date(row.updated_at)) await pushNote(note);
        else if (new Date(row.updated_at) > new Date(note.updatedAt)) await pullNote(row);
        else await ensureRemotePhotos(row);
        remote.delete(note.id);
      }
      for (const row of remote.values()) await pullNote(row);

      // The two learning routes are part of the app itself. If an older cloud
      // state is missing one (or contains an old deletion marker), restore it
      // without touching the user's daily notes or task progress.
      const restoredPlans = ensureBuiltInLearningPlans();
      for (const planNote of restoredPlans) await pushNote(planNote);

      save(); render();
      const now = new Date().toISOString();
      localStorage.setItem(LAST_SYNC_KEY, now);
      setStatus(formatSyncTime(now));
      toast('云端同步完成');
    } catch (error) {
      console.warn('Cloud sync failed:', error?.message || error);
      setStatus('同步失败，本地记录不受影响');
      toast('云端暂时无法同步，记录已保存在本机');
      throw error;
    } finally {
      cloudButton.classList.remove('syncing');
    }
  }

  function syncAll() {
    if (!syncPromise) syncPromise = performSync().finally(() => { syncPromise = null; });
    return syncPromise;
  }

  function subscribeRealtime() {
    if (realtimeChannel) client.removeChannel(realtimeChannel);
    if (!session?.user) return;
    let timer;
    realtimeChannel = client.channel(`notes-${session.user.id}`).on('postgres_changes', { event:'*', schema:'public', table:'notes', filter:`user_id=eq.${session.user.id}` }, () => {
      clearTimeout(timer); timer = setTimeout(() => syncAll().catch(() => {}), 500);
    }).subscribe();
  }

  async function handleSession(nextSession) {
    session = nextSession;
    updateAccountUi();
    subscribeRealtime();
    if (session?.user) await syncAll().catch(() => {});
  }

  async function signIn() {
    const email = $('#cloudEmail').value.trim(); const password = $('#cloudPassword').value;
    if (!email || !password) { toast('请输入邮箱和密码'); return; }
    $('#cloudSignInBtn').disabled = true;
    const { error } = await client.auth.signInWithPassword({ email, password });
    $('#cloudSignInBtn').disabled = false;
    if (error) toast(error.message.includes('Invalid') ? '邮箱或密码不正确' : `登录失败：${error.message}`);
  }

  async function signUp() {
    const email = $('#cloudEmail').value.trim(); const password = $('#cloudPassword').value;
    if (!email || password.length < 8) { toast('请输入邮箱和至少 8 位密码'); return; }
    $('#cloudSignUpBtn').disabled = true;
    const { data, error } = await client.auth.signUp({ email, password, options:{ emailRedirectTo:'https://yanfyaqing-oss.github.io/shiji-notes/' } });
    $('#cloudSignUpBtn').disabled = false;
    if (error) toast(`注册失败：${error.message}`);
    else if (!data.session) toast('注册成功，请打开邮箱确认后再登录');
    else toast('同步账号创建成功');
  }

  window.cloudApi = { pushNote, deleteNote:deleteCloudNote, pushAll:syncAll };
  $('#cloudBtn').addEventListener('click', () => { updateAccountUi(); cloudDialog.showModal(); });
  $('#cloudDialogClose').addEventListener('click', () => cloudDialog.close());
  $('#cloudSignInBtn').addEventListener('click', () => signIn().catch(() => toast('登录失败，请检查网络')));
  $('#cloudSignUpBtn').addEventListener('click', () => signUp().catch(() => toast('注册失败，请检查网络')));
  $('#syncNowBtn').addEventListener('click', () => syncAll().catch(() => {}));
  $('#cloudSignOutBtn').addEventListener('click', async () => { await client.auth.signOut(); cloudDialog.close(); toast('已退出云端，本地记录仍然保留'); });

  if (!window.supabase?.createClient) {
    cloudButton.disabled = true;
    cloudButton.title = '云端组件加载失败，本地功能仍可使用';
    return;
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true } });
  client.auth.onAuthStateChange((_event, nextSession) => { handleSession(nextSession); });
  client.auth.getSession().then(({ data }) => handleSession(data.session));
  window.addEventListener('online', () => syncAll().catch(() => {}));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncAll().catch(() => {}); });
  updateAccountUi();
})();
