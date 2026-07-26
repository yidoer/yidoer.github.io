/**
 * 图形化编辑后台
 * 支持文章/小记管理、Markdown 编辑、图片上传、数据导入导出
 */
const Editor = {
  data: { articles: [], notes: [] },
  deleted: { articles: [], notes: [] },
  dirty: { articles: [], notes: [] },
  current: { type: null, id: null },
  imageCache: {},
  previewUrls: {},
  projectDirHandle: null,

  // ==================== 初始化 ====================
  async init() {
    this.loadFromStorage();
    await this.loadPendingImages();
    await this.loadFromFiles({ silent: true });
    this.normalizeContentPaths();
    this.renderArticlesList();
    this.renderNotesList();
    this.initTabs();
    this.initDragDrop();
    this.initPreviewListeners();
    this.updateEnvironmentStatus();
  },

  loadFromStorage() {
    try {
      const a = localStorage.getItem('blog-editor-articles');
      const n = localStorage.getItem('blog-editor-notes');
      const deleted = localStorage.getItem('blog-editor-deleted');
      const dirty = localStorage.getItem('blog-editor-dirty');
      if (a) this.data.articles = JSON.parse(a);
      if (n) this.data.notes = JSON.parse(n);
      if (deleted) this.deleted = JSON.parse(deleted);
      if (dirty) this.dirty = JSON.parse(dirty);
    } catch (e) { console.error('Storage load error:', e); }
  },

  async loadFromFiles({ silent = false } = {}) {
    try {
      const requestOptions = { cache: 'no-store' };
      const [articleResponse, noteResponse] = await Promise.all([
        fetch('data/articles.json', requestOptions),
        fetch('data/notes.json', requestOptions)
      ]);
      if (!articleResponse.ok || !noteResponse.ok) throw new Error('已发布数据请求失败');
      const [articleData, noteData] = await Promise.all([articleResponse.json(), noteResponse.json()]);
      this.mergeRemoteData(articleData.articles || [], noteData.notes || []);
      if (!silent) this.showToast('已刷新已发布文章和小记', 'success');
      return true;
    } catch (error) {
      console.error('Published data load error:', error);
      if (!silent) this.showToast('刷新失败，请检查网络后重试', 'error');
      return false;
    }
  },

  mergeRemoteData(remoteArticles, remoteNotes) {
    this.data.articles = this.mergePublishedItems(remoteArticles, this.data.articles, this.deleted.articles, this.dirty.articles);
    this.data.notes = this.mergePublishedItems(remoteNotes, this.data.notes, this.deleted.notes, this.dirty.notes);
    this.normalizeContentPaths();
    this.saveToStorage();
  },

  async refreshPublishedData({ silent = false } = {}) {
    const refreshed = this.projectDirHandle
      ? await this.loadProjectData({ silent })
      : await this.loadFromFiles({ silent });
    if (!refreshed) return false;
    this.renderArticlesList();
    this.renderNotesList();
    return true;
  },

  saveToStorage() {
    try {
      localStorage.setItem('blog-editor-articles', JSON.stringify(this.data.articles));
      localStorage.setItem('blog-editor-notes', JSON.stringify(this.data.notes));
      localStorage.setItem('blog-editor-deleted', JSON.stringify(this.deleted));
      localStorage.setItem('blog-editor-dirty', JSON.stringify(this.dirty));
    } catch (error) {
      console.error('Storage save error:', error);
      this.showToast('浏览器本地空间不足，请选择项目目录后保存', 'error');
    }
  },

  // ==================== 标签页 ====================
  initTabs() {
    document.querySelectorAll('.editor-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.editor-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById(`panel-${tab.dataset.tab}`);
        if (panel) panel.classList.add('active');
      });
    });
  },

  // ==================== 文章管理 ====================
  renderArticlesList() {
    const el = document.getElementById('articles-list');
    if (!el) return;
    if (this.data.articles.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📝</div>
          <p class="empty-state-text">暂无文章，点击上方按钮新建</p>
        </div>`;
      return;
    }
    const sorted = [...this.data.articles].sort((a, b) => new Date(b.date) - new Date(a.date));
    el.innerHTML = sorted.map(art => `
      <div class="editor-list-item fade-in">
        <div class="editor-list-item-info">
          <div class="editor-list-item-title">${this.escapeHtml(art.title)}</div>
          <div class="editor-list-item-meta">${art.date} · ${art.category || '未分类'} · ${(art.tags || []).join(', ') || '无标签'}</div>
        </div>
        <div class="editor-list-item-actions">
          <button class="editor-btn editor-btn-secondary" onclick="Editor.editArticle('${art.id}')">编辑</button>
          <button class="editor-btn editor-btn-danger" onclick="Editor.deleteArticle('${art.id}')">删除</button>
        </div>
      </div>`).join('');
  },

  newArticle() {
    this.current = { type: 'article', id: null };
    this.clearArticleForm();
    document.getElementById('article-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('modal-title').textContent = '新建文章';
    document.getElementById('article-modal').classList.add('active');
    this.updateArticlePreview();
  },

  editArticle(id) {
    const art = this.data.articles.find(a => a.id === id);
    if (!art) return;
    this.current = { type: 'article', id };
    document.getElementById('article-title').value = art.title || '';
    document.getElementById('article-date').value = art.date || '';
    document.getElementById('article-category').value = art.category || '';
    document.getElementById('article-tags').value = (art.tags || []).join(', ');
    document.getElementById('article-excerpt').value = art.excerpt || '';
    document.getElementById('article-content').value = art.content || '';
    document.getElementById('modal-title').textContent = '编辑文章';
    document.getElementById('article-modal').classList.add('active');
    this.updateArticlePreview();
  },

  async saveArticle() {
    const title = document.getElementById('article-title').value.trim();
    if (!title) { this.showToast('请输入文章标题', 'error'); return; }
    const articleId = this.current.id || 'article-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const date = document.getElementById('article-date').value || new Date().toISOString().split('T')[0];
    const existingArticle = this.data.articles.find(article => article.id === this.current.id);
    const sequence = this.nextContentSequence('articles', date, this.current.id);
    const articlePath = this.contentPath('articles', date, sequence);
    const legacyPaths = this.contentLegacyPaths(existingArticle, articlePath);
    const art = {
      id: articleId,
      path: articlePath,
      sequence,
      title,
      date,
      category: document.getElementById('article-category').value.trim(),
      tags: document.getElementById('article-tags').value.split(',').map(t => t.trim()).filter(t => t),
      excerpt: document.getElementById('article-excerpt').value.trim(),
      content: document.getElementById('article-content').value,
      ...(legacyPaths.length ? { legacyPaths } : {})
    };
    if (this.current.id) {
      const idx = this.data.articles.findIndex(a => a.id === this.current.id);
      if (idx !== -1) this.data.articles[idx] = art;
    } else {
      this.data.articles.push(art);
    }
    this.deleted.articles = this.deleted.articles.filter(id => id !== articleId);
    if (!this.dirty.articles.includes(articleId)) this.dirty.articles.push(articleId);
    this.saveToStorage();
    this.renderArticlesList();
    this.closeModal();
    const synced = await this.syncProjectDataIfConnected();
    this.showToast(synced ? '文章已保存并写入项目' : '文章已保存到浏览器', 'success');
  },

  async deleteArticle(id) {
    if (!confirm('确定删除这篇文章？不可撤销。')) return;
    this.data.articles = this.data.articles.filter(a => a.id !== id);
    if (!this.deleted.articles.includes(id)) this.deleted.articles.push(id);
    this.saveToStorage();
    this.renderArticlesList();
    const synced = await this.syncProjectDataIfConnected();
    this.showToast(synced ? '文章已删除并写入项目' : '文章已删除', 'success');
  },

  clearArticleForm() {
    ['article-title','article-date','article-category','article-tags','article-excerpt','article-content'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  },

  // ==================== 小记管理 ====================
  renderNotesList() {
    const el = document.getElementById('notes-list');
    if (!el) return;
    if (this.data.notes.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📌</div>
          <p class="empty-state-text">暂无小记，点击上方按钮新建</p>
        </div>`;
      return;
    }
    const sorted = [...this.data.notes].sort((a, b) => new Date(b.date) - new Date(a.date));
    el.innerHTML = sorted.map(note => `
      <div class="editor-list-item fade-in">
        <div class="editor-list-item-info">
          <div class="editor-list-item-title">${this.escapeHtml(note.content.substring(0, 40))}${note.content.length > 40 ? '...' : ''}</div>
          <div class="editor-list-item-meta">${note.date}</div>
        </div>
        <div class="editor-list-item-actions">
          <button class="editor-btn editor-btn-secondary" onclick="Editor.editNote('${note.id}')">编辑</button>
          <button class="editor-btn editor-btn-danger" onclick="Editor.deleteNote('${note.id}')">删除</button>
        </div>
      </div>`).join('');
  },

  newNote() {
    this.current = { type: 'note', id: null };
    document.getElementById('note-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('note-content').value = '';
    document.getElementById('note-modal-title').textContent = '新建小记';
    document.getElementById('note-modal').classList.add('active');
  },

  editNote(id) {
    const note = this.data.notes.find(n => n.id === id);
    if (!note) return;
    this.current = { type: 'note', id };
    document.getElementById('note-date').value = note.date || '';
    document.getElementById('note-content').value = note.content || '';
    document.getElementById('note-modal-title').textContent = '编辑小记';
    document.getElementById('note-modal').classList.add('active');
  },

  async saveNote() {
    const content = document.getElementById('note-content').value.trim();
    if (!content) { this.showToast('请输入小记内容', 'error'); return; }
    const noteId = this.current.id || 'note-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const date = document.getElementById('note-date').value || new Date().toISOString().split('T')[0];
    const existingNote = this.data.notes.find(note => note.id === this.current.id);
    const sequence = this.nextContentSequence('notes', date, this.current.id);
    const notePath = this.contentPath('notes', date, sequence);
    const legacyPaths = this.contentLegacyPaths(existingNote, notePath);
    const note = {
      id: noteId,
      path: notePath,
      sequence,
      date,
      content,
      ...(legacyPaths.length ? { legacyPaths } : {})
    };
    if (this.current.id) {
      const idx = this.data.notes.findIndex(n => n.id === this.current.id);
      if (idx !== -1) this.data.notes[idx] = note;
    } else {
      this.data.notes.push(note);
    }
    this.deleted.notes = this.deleted.notes.filter(id => id !== noteId);
    if (!this.dirty.notes.includes(noteId)) this.dirty.notes.push(noteId);
    this.saveToStorage();
    this.renderNotesList();
    this.closeModal();
    const synced = await this.syncProjectDataIfConnected();
    this.showToast(synced ? '小记已保存并写入项目' : '小记已保存到浏览器', 'success');
  },

  async deleteNote(id) {
    if (!confirm('确定删除这条小记？不可撤销。')) return;
    this.data.notes = this.data.notes.filter(n => n.id !== id);
    if (!this.deleted.notes.includes(id)) this.deleted.notes.push(id);
    this.saveToStorage();
    this.renderNotesList();
    const synced = await this.syncProjectDataIfConnected();
    this.showToast(synced ? '小记已删除并写入项目' : '小记已删除', 'success');
  },

  // ==================== Markdown 编辑器 ====================
  updateArticlePreview() {
    const content = document.getElementById('article-content').value;
    const preview = document.getElementById('article-preview');
    if (preview && typeof Markdown !== 'undefined') {
      preview.innerHTML = Markdown.parse(content);
      preview.querySelectorAll('img').forEach(image => {
        const blob = this.imageCache[image.getAttribute('src')];
        if (!blob) return;
        const imagePath = image.getAttribute('src');
        if (!this.previewUrls[imagePath]) this.previewUrls[imagePath] = URL.createObjectURL(blob);
        image.src = this.previewUrls[imagePath];
      });
    }
  },

  initPreviewListeners() {
    const textarea = document.getElementById('article-content');
    if (textarea) {
      textarea.addEventListener('input', () => this.updateArticlePreview());
    }
  },

  insertMarkdown(type) {
    const ta = document.getElementById('article-content');
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.substring(s, e);
    let ins = '';
    switch (type) {
      case 'bold': ins = `**${sel || '粗体'}**`; break;
      case 'italic': ins = `*${sel || '斜体'}*`; break;
      case 'heading': ins = `\n## ${sel || '标题'}\n`; break;
      case 'heading2': ins = `\n### ${sel || '标题'}\n`; break;
      case 'quote': ins = `\n> ${sel || '引用'}\n`; break;
      case 'list': ins = `\n- ${sel || '列表项'}\n- \n`; break;
      case 'link': ins = `[${sel || '链接'}](https://)`; break;
      case 'code': ins = `\`\`\`\n${sel || '代码'}\n\`\`\``; break;
      case 'hr': ins = `\n---\n`; break;
      case 'image': ins = `\n![${sel || '图片描述'}](图片URL)\n`; break;
    }
    ta.value = ta.value.substring(0, s) + ins + ta.value.substring(e);
    ta.selectionStart = ta.selectionEnd = s + ins.length;
    ta.focus();
    this.updateArticlePreview();
  },

  // ==================== 图片上传 ====================
  async handleImageUpload(input, type) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    try {
      if (this.supportsProjectDirectory() && !await this.ensureProjectAccess()) return;
      for (const file of files) await this.insertImageFile(file, type);
    } finally {
      input.value = '';
    }
  },

  initDragDrop() {
    ['article-content', 'note-content'].forEach(id => {
      const ta = document.getElementById(id);
      if (!ta) return;
      ta.addEventListener('dragover', (e) => { e.preventDefault(); ta.style.borderColor = 'var(--accent-color)'; });
      ta.addEventListener('dragleave', (e) => { e.preventDefault(); ta.style.borderColor = ''; });
      ta.addEventListener('drop', async (e) => {
        e.preventDefault();
        ta.style.borderColor = '';
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        const type = id === 'article-content' ? 'article' : 'note';
        if (this.supportsProjectDirectory() && !await this.ensureProjectAccess()) return;
        for (const file of files) await this.insertImageFile(file, type);
      });
    });
  },

  async insertImageFile(file, type) {
    if (file.size > 20 * 1024 * 1024) {
      this.showToast(`「${file.name}」超过 20MB，请先压缩`, 'error');
      return;
    }
    try {
      const date = document.getElementById(`${type}-date`)?.value || new Date().toISOString().split('T')[0];
      const imagePath = this.projectDirHandle
        ? await this.writeImageFile(file, file.name, date)
        : await this.cacheImageFile(file, file.name, date);
      const textarea = document.getElementById(`${type}-content`);
      if (!textarea) return;
      const position = textarea.selectionStart ?? textarea.value.length;
      const markdown = `\n\n![${file.name.replaceAll(']', '')}](${imagePath})\n\n`;
      textarea.value = textarea.value.substring(0, position) + markdown + textarea.value.substring(position);
      textarea.selectionStart = textarea.selectionEnd = position + markdown.length;
      if (type === 'article') this.updateArticlePreview();
      const location = this.projectDirHandle ? '项目目录' : '手机待发布区';
      this.showToast(`图片「${file.name}」已保存到${location}`, 'success');
    } catch (error) {
      console.error('Image save error:', error);
      this.showToast(`图片保存失败：${error.message}`, 'error');
    }
  },

  supportsProjectDirectory() {
    const mobile = navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return Boolean(window.showDirectoryPicker) && !mobile;
  },

  async connectProjectDirectory() {
    if (!window.showDirectoryPicker) {
      this.showToast('当前浏览器不支持目录写入，请使用最新版 Chrome 或 Edge', 'error');
      return false;
    }
    try {
      const handle = await window.showDirectoryPicker({ id: 'yidoer-blog-project', mode: 'readwrite' });
      const dataDirectory = await handle.getDirectoryHandle('data');
      await dataDirectory.getFileHandle('articles.json');
      await dataDirectory.getFileHandle('notes.json');
      this.projectDirHandle = handle;
      this.updateProjectStatus(true);
      await this.loadProjectData({ silent: true });
      this.renderArticlesList();
      this.renderNotesList();
      this.showToast('项目目录已连接，并已读取已发布内容', 'success');
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Project directory error:', error);
        this.showToast('请选择包含 data、images 目录的博客根目录', 'error');
      }
      return false;
    }
  },

  async ensureProjectAccess() {
    if (!this.projectDirHandle) return this.connectProjectDirectory();
    const options = { mode: 'readwrite' };
    if (await this.projectDirHandle.queryPermission(options) === 'granted') return true;
    return await this.projectDirHandle.requestPermission(options) === 'granted';
  },

  async syncProjectDataIfConnected() {
    if (!this.projectDirHandle) return false;
    const synced = await this.writeProjectData({ silent: true });
    if (!synced) this.showToast('自动写入失败，请重新连接项目目录', 'error');
    return synced;
  },

  async loadProjectData({ silent = false } = {}) {
    if (!this.projectDirHandle) return false;
    try {
      const dataDirectory = await this.projectDirHandle.getDirectoryHandle('data');
      const [articleHandle, noteHandle] = await Promise.all([
        dataDirectory.getFileHandle('articles.json'),
        dataDirectory.getFileHandle('notes.json')
      ]);
      const [articleFile, noteFile] = await Promise.all([articleHandle.getFile(), noteHandle.getFile()]);
      const [articleData, noteData] = await Promise.all([
        articleFile.text().then(JSON.parse),
        noteFile.text().then(JSON.parse)
      ]);
      this.mergeRemoteData(articleData.articles || [], noteData.notes || []);
      if (!silent) this.showToast('已从项目目录刷新文章和小记', 'success');
      return true;
    } catch (error) {
      console.error('Project data load error:', error);
      if (!silent) this.showToast('读取项目数据失败，请重新选择博客根目录', 'error');
      return false;
    }
  },

  async writeProjectData({ silent = false } = {}) {
    try {
      if (!await this.ensureProjectAccess()) return false;
      await this.migrateEmbeddedImages();
      await this.flushPendingImagesToProject();
      const dataDirectory = await this.projectDirHandle.getDirectoryHandle('data');
      await this.writeTextFile(dataDirectory, 'articles.json', JSON.stringify({ articles: this.data.articles }, null, 2) + '\n');
      await this.writeTextFile(dataDirectory, 'notes.json', JSON.stringify({ notes: this.data.notes }, null, 2) + '\n');
      this.deleted = { articles: [], notes: [] };
      this.dirty = { articles: [], notes: [] };
      this.saveToStorage();
      if (!silent) this.showToast('数据和图片已直接写入项目，无需复制粘贴', 'success');
      return true;
    } catch (error) {
      console.error('Project write error:', error);
      if (!silent) this.showToast(`写入项目失败：${error.message}`, 'error');
      return false;
    }
  },

  async writeTextFile(directory, filename, content) {
    const fileHandle = await directory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  },

  async writeImageFile(blob, originalName, date) {
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().split('T')[0];
    let directory = await this.projectDirHandle.getDirectoryHandle('images', { create: true });
    directory = await directory.getDirectoryHandle('uploads', { create: true });
    for (const segment of safeDate.split('-')) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    const filename = this.uniqueImageName(originalName, blob.type);
    const fileHandle = await directory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return `/images/uploads/${safeDate.replaceAll('-', '/')}/${filename}`;
  },

  async flushPendingImagesToProject() {
    for (const [imagePath, blob] of Object.entries(this.imageCache)) {
      let directory = this.projectDirHandle;
      const segments = imagePath.replace(/^\//, '').split('/');
      const filename = segments.pop();
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
      const fileHandle = await directory.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    }
    if (Object.keys(this.imageCache).length) await this.clearPendingImages();
  },

  async cacheImageFile(blob, originalName, date) {
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().split('T')[0];
    const imagePath = `/images/uploads/${safeDate.replaceAll('-', '/')}/${this.uniqueImageName(originalName, blob.type)}`;
    this.imageCache[imagePath] = blob;
    await this.savePendingImage(imagePath, blob);
    this.updatePendingImagesStatus();
    return imagePath;
  },

  openImageDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('blog-editor-images', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('images');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async savePendingImage(imagePath, blob) {
    const database = await this.openImageDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('images', 'readwrite');
      transaction.objectStore('images').put(blob, imagePath);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  },

  async loadPendingImages() {
    if (!window.indexedDB) return;
    try {
      const database = await this.openImageDatabase();
      const entries = await new Promise((resolve, reject) => {
        const request = database.transaction('images').objectStore('images').getAllKeys();
        request.onsuccess = async () => {
          const keys = request.result;
          const transaction = database.transaction('images');
          const store = transaction.objectStore('images');
          const values = await Promise.all(keys.map(key => new Promise((resolveValue, rejectValue) => {
            const itemRequest = store.get(key);
            itemRequest.onsuccess = () => resolveValue([key, itemRequest.result]);
            itemRequest.onerror = () => rejectValue(itemRequest.error);
          })));
          resolve(values);
        };
        request.onerror = () => reject(request.error);
      });
      database.close();
      this.imageCache = Object.fromEntries(entries);
      this.updatePendingImagesStatus();
    } catch (error) {
      console.error('Pending image load error:', error);
    }
  },

  async clearPendingImages() {
    if (!window.indexedDB) return;
    const database = await this.openImageDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('images', 'readwrite');
      transaction.objectStore('images').clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    Object.values(this.previewUrls).forEach(url => URL.revokeObjectURL(url));
    this.previewUrls = {};
    this.imageCache = {};
    this.updatePendingImagesStatus();
  },

  async deletePendingImage(imagePath) {
    if (!this.imageCache[imagePath]) return;
    if (window.indexedDB) {
      const database = await this.openImageDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('images', 'readwrite');
        transaction.objectStore('images').delete(imagePath);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    }
    if (this.previewUrls[imagePath]) URL.revokeObjectURL(this.previewUrls[imagePath]);
    delete this.previewUrls[imagePath];
    delete this.imageCache[imagePath];
    this.updatePendingImagesStatus();
  },

  updatePendingImagesStatus() {
    const status = document.getElementById('pending-images-status');
    if (status) status.textContent = `待发布图片：${Object.keys(this.imageCache).length} 张`;
  },

  async publishToGitHub() {
    const tokenInput = document.getElementById('github-token');
    const token = tokenInput?.value.trim();
    if (!token) {
      this.showToast('请输入 GitHub Fine-grained Token', 'error');
      tokenInput?.focus();
      return;
    }
    const button = document.getElementById('github-publish-button');
    if (button) {
      button.disabled = true;
      button.textContent = '正在发布...';
    }
    try {
      await this.migrateEmbeddedImages();
      await this.publishGitHubCommit(token);
      await this.clearPendingImages();
      this.deleted = { articles: [], notes: [] };
      this.dirty = { articles: [], notes: [] };
      this.saveToStorage();
      if (tokenInput) tokenInput.value = '';
      this.showToast('已发布到 GitHub，Pages 正在自动部署', 'success');
    } catch (error) {
      console.error('GitHub publish error:', error);
      this.showToast(`发布失败：${error.message}`, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = '🚀 发布到 GitHub';
      }
    }
  },

  async publishGitHubCommit(token, retry = true) {
    const repository = 'yidoer/yidoer.github.io';
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const reference = await this.githubRequest(`https://api.github.com/repos/${repository}/git/ref/heads/main`, headers);
    const parentSha = reference.object.sha;
    const parentCommit = await this.githubRequest(`https://api.github.com/repos/${repository}/git/commits/${parentSha}`, headers);
    const remoteArticles = await this.loadGitHubData(repository, 'data/articles.json', headers, 'articles');
    const remoteNotes = await this.loadGitHubData(repository, 'data/notes.json', headers, 'notes');
    const articles = this.mergePublishedItems(remoteArticles, this.data.articles, this.deleted.articles, this.dirty.articles);
    const notes = this.mergePublishedItems(remoteNotes, this.data.notes, this.deleted.notes, this.dirty.notes);
    const tree = [
      { path: 'data/articles.json', mode: '100644', type: 'blob', content: JSON.stringify({ articles }, null, 2) + '\n' },
      { path: 'data/notes.json', mode: '100644', type: 'blob', content: JSON.stringify({ notes }, null, 2) + '\n' }
    ];
    for (const [imagePath, blob] of Object.entries(this.imageCache)) {
      const imageBlob = await this.githubRequest(`https://api.github.com/repos/${repository}/git/blobs`, headers, {
        content: await this.blobToBase64(blob),
        encoding: 'base64'
      });
      tree.push({ path: imagePath.replace(/^\//, ''), mode: '100644', type: 'blob', sha: imageBlob.sha });
    }
    const createdTree = await this.githubRequest(`https://api.github.com/repos/${repository}/git/trees`, headers, {
      base_tree: parentCommit.tree.sha,
      tree
    });
    const commit = await this.githubRequest(`https://api.github.com/repos/${repository}/git/commits`, headers, {
      message: `手机发布：${new Date().toLocaleString('zh-CN')}`,
      tree: createdTree.sha,
      parents: [parentSha]
    });
    try {
      await this.githubRequest(`https://api.github.com/repos/${repository}/git/refs/heads/main`, headers, { sha: commit.sha, force: false }, 'PATCH');
    } catch (error) {
      if (retry && error.status === 422) return this.publishGitHubCommit(token, false);
      throw error;
    }
    this.data = { articles, notes };
  },

  async loadGitHubData(repository, filePath, headers, key) {
    const response = await this.githubRequest(`https://api.github.com/repos/${repository}/contents/${filePath}?ref=main`, headers);
    const text = new TextDecoder().decode(Uint8Array.from(atob(response.content.replace(/\s/g, '')), character => character.charCodeAt(0)));
    return JSON.parse(text)[key] || [];
  },

  mergePublishedItems(remoteItems, localItems, deletedIds, dirtyIds) {
    const deleted = new Set(deletedIds || []);
    const dirty = new Set(dirtyIds || []);
    const merged = new Map((remoteItems || []).filter(item => !deleted.has(item.id)).map(item => [item.id, item]));
    (localItems || []).filter(item => dirty.has(item.id) && !deleted.has(item.id)).forEach(item => merged.set(item.id, item));
    return [...merged.values()];
  },

  async githubRequest(url, headers, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(response.status === 401 ? '令牌无效或已过期' : response.status === 403 ? '令牌没有仓库 Contents 写入权限' : data.message || `GitHub 返回 ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  },

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  },

  uniqueImageName(originalName, mimeType) {
    const extensionMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
    const originalExtension = originalName.includes('.') ? originalName.split('.').pop().toLowerCase() : '';
    const extension = extensionMap[mimeType] || originalExtension.replace(/[^a-z0-9]/g, '') || 'img';
    const basename = originalName.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${basename}.${extension}`;
  },

  async migrateEmbeddedImages() {
    let migratedCount = 0;
    for (const collection of [this.data.articles, this.data.notes]) {
      for (const item of collection) {
        const matches = [...(item.content || '').matchAll(/!\[([^\]]*)\]\((data:image\/([a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+)\)/g)];
        if (!matches.length) continue;
        let content = item.content;
        for (const match of matches) {
          const blob = await fetch(match[2]).then(response => response.blob());
          const date = item.date || new Date().toISOString().split('T')[0];
          const imagePath = this.projectDirHandle
            ? await this.writeImageFile(blob, `image.${match[3]}`, date)
            : await this.cacheImageFile(blob, `image.${match[3]}`, date);
          content = content.replace(match[0], `![${match[1]}](${imagePath})`);
          migratedCount += 1;
        }
        item.content = content;
        const type = this.data.articles.includes(item) ? 'articles' : 'notes';
        if (!this.dirty[type].includes(item.id)) this.dirty[type].push(item.id);
      }
    }
    if (migratedCount) this.showToast(`已将 ${migratedCount} 张 Base64 图片迁移到 images/`, 'success');
  },

  updateProjectStatus(connected) {
    const status = document.getElementById('project-storage-status');
    if (status) status.textContent = connected ? '已连接项目目录：保存会同步写入 data/，图片写入 images/' : '尚未连接项目目录';
  },

  updateEnvironmentStatus() {
    const status = document.getElementById('project-storage-status');
    if (!status) return;
    status.textContent = this.supportsProjectDirectory()
      ? '电脑模式：选择项目目录后可直接保存数据和图片。'
      : '手机模式：内容保存在本机浏览器，完成后到“导出/导入”发布到 GitHub。';
  },

  // ==================== 导出/导入 ====================
  exportData() {
    const articlesJson = JSON.stringify({ articles: this.data.articles }, null, 2);
    const notesJson = JSON.stringify({ notes: this.data.notes }, null, 2);
    this.downloadFile(articlesJson, 'articles.json', 'application/json');
    setTimeout(() => this.downloadFile(notesJson, 'notes.json', 'application/json'), 200);
    this.showToast('数据已导出，请用完整 JSON 文件覆盖项目的 data/ 同名文件，不要追加内容', 'success');
  },

  exportSingleFile() {
    const data = {
      articles: this.data.articles,
      notes: this.data.notes
    };
    this.downloadFile(JSON.stringify(data, null, 2), 'blog-data.json', 'application/json');
    this.showToast('完整数据已导出', 'success');
  },

  downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  },

  importArticles() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.articles) {
            this.data.articles = data.articles;
            this.saveToStorage();
            this.renderArticlesList();
            this.showToast('文章数据已导入', 'success');
          } else {
            this.showToast('文件格式不正确，缺少 articles 字段', 'error');
          }
        } catch (err) { this.showToast('解析失败：' + err.message, 'error'); }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  importNotes() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.notes) {
            this.data.notes = data.notes;
            this.saveToStorage();
            this.renderNotesList();
            this.showToast('小记数据已导入', 'success');
          } else {
            this.showToast('文件格式不正确，缺少 notes 字段', 'error');
          }
        } catch (err) { this.showToast('解析失败：' + err.message, 'error'); }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          let imported = 0;
          if (data.articles) { this.data.articles = data.articles; imported++; }
          if (data.notes) { this.data.notes = data.notes; imported++; }
          if (imported) {
            this.saveToStorage();
            this.renderArticlesList();
            this.renderNotesList();
            this.showToast('数据已导入', 'success');
          } else {
            this.showToast('文件格式不正确', 'error');
          }
        } catch (err) { this.showToast('解析失败：' + err.message, 'error'); }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  async resetData() {
    if (!confirm('确定要重置数据吗？这将丢弃所有未导出的修改。')) return;
    await this.loadFromFiles();
    this.deleted = { articles: [], notes: [] };
    this.dirty = { articles: [], notes: [] };
    this.saveToStorage();
    this.renderArticlesList();
    this.renderNotesList();
    this.showToast('数据已重置为原始状态', 'success');
  },

  clearAllData() {
    if (!confirm('⚠️ 警告：确定要清空所有数据吗？此操作不可撤销！')) return;
    this.deleted.articles = [...new Set([...this.deleted.articles, ...this.data.articles.map(article => article.id)])];
    this.deleted.notes = [...new Set([...this.deleted.notes, ...this.data.notes.map(note => note.id)])];
    this.data.articles = [];
    this.data.notes = [];
    this.saveToStorage();
    this.renderArticlesList();
    this.renderNotesList();
    this.showToast('所有数据已清空', 'success');
  },

  // ==================== 模态框 ====================
  closeModal() {
    document.getElementById('article-modal').classList.remove('active');
    document.getElementById('note-modal').classList.remove('active');
  },

  // ==================== 工具函数 ====================
  normalizeContentPaths() {
    let changed = false;
    for (const type of ['articles', 'notes']) {
      const used = new Map();
      const items = [...this.data[type]].sort((first, second) => {
        const dateOrder = String(first.date || '').localeCompare(String(second.date || ''));
        return dateOrder || String(first.id || '').localeCompare(String(second.id || ''));
      });
      for (const item of items) {
        const month = this.contentMonth(item.date);
        if (!used.has(month)) used.set(month, new Set());
        const monthSequences = used.get(month);
        let sequence = this.contentSequence(item, type);
        if (!sequence || monthSequences.has(sequence)) {
          sequence = 1;
          while (monthSequences.has(sequence)) sequence += 1;
        }
        monthSequences.add(sequence);
        const nextPath = this.contentPath(type, item.date, sequence);
        if (item.sequence !== sequence || item.path !== nextPath) {
          const legacyPaths = this.contentLegacyPaths(item, nextPath);
          item.sequence = sequence;
          item.path = nextPath;
          if (legacyPaths.length) item.legacyPaths = legacyPaths;
          if (!this.dirty[type].includes(item.id)) this.dirty[type].push(item.id);
          changed = true;
        }
      }
    }
    if (changed) this.saveToStorage();
  },

  nextContentSequence(type, date, currentId = null) {
    const current = this.data[type].find(item => item.id === currentId);
    const month = this.contentMonth(date);
    if (current && this.contentMonth(current.date) === month) {
      const existingSequence = this.contentSequence(current, type);
      if (existingSequence) return existingSequence;
    }
    const sequences = this.data[type]
      .filter(item => item.id !== currentId && this.contentMonth(item.date) === month)
      .map(item => this.contentSequence(item, type))
      .filter(Boolean);
    return (sequences.length ? Math.max(...sequences) : 0) + 1;
  },

  contentSequence(item, type) {
    const direct = Number.parseInt(item?.sequence, 10);
    if (direct > 0) return direct;
    const singular = type === 'articles' ? 'article' : 'note';
    const pathMatch = String(item?.path || '').match(new RegExp(`/${singular}-(\\d+)/?$`));
    if (pathMatch) return Number.parseInt(pathMatch[1], 10);
    const idMatch = String(item?.id || '').match(new RegExp(`^${singular}-(\\d+)$`));
    return idMatch ? Number.parseInt(idMatch[1], 10) : 0;
  },

  contentMonth(date) {
    const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().split('T')[0];
    return safeDate.slice(0, 7);
  },

  contentPath(type, date, sequence) {
    const [year, month] = this.contentMonth(date).split('-');
    const singular = type === 'articles' ? 'article' : 'note';
    return `/${type}/${year.slice(-2)}/${month}/${singular}-${String(sequence).padStart(2, '0')}/`;
  },

  contentLegacyPaths(existing, nextPath) {
    const paths = [...(existing?.legacyPaths || [])];
    if (existing?.path && existing.path !== nextPath) paths.push(existing.path);
    return [...new Set(paths)].filter(path => path && path !== nextPath);
  },

  showToast(message, type = 'info') {
    let toast = document.getElementById('editor-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'editor-toast'; toast.className = 'editor-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `editor-toast ${type}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  },

  slugify(text) {
    return text
      .normalize('NFKD')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// ==================== 页面初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.classList.contains('mobile-editor-page')) return;
  Editor.init();

  // 点击模态框背景关闭
  document.querySelectorAll('.editor-modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) Editor.closeModal();
    });
  });

  // ESC 关闭模态框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') Editor.closeModal();
  });
});
