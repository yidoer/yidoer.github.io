const MobileEditor = {
  currentType: null,
  currentId: null,
  articleImages: [],
  noteImages: [],
  cursorPositions: { article: 0, note: 0 },

  async init() {
    await Editor.init();
    this.loadFromEditor();
    this.initTabs();
    this.initTheme();
    this.renderArticlesList();
    this.renderNotesList();
    this.updatePendingStatus();
    this.initImageUploadAreas();
    this.initToolbar();
    this.initCursorTracking();
    this.setDefaultDates();
    this.hideFooter();
  },

  loadFromEditor() {
    this.data = Editor.data;
    this.deleted = Editor.deleted;
    this.dirty = Editor.dirty;
    this.imageCache = Editor.imageCache;
    this.projectDirHandle = Editor.projectDirHandle;
  },

  initTabs() {
    document.querySelectorAll('.mobile-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });
  },

  switchTab(tab) {
    document.querySelectorAll('.mobile-tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.mobile-panel').forEach(p => p.classList.remove('active'));
    const activeTab = document.querySelector(`[data-tab="${tab}"]`);
    const activePanel = document.getElementById(`panel-${tab}`);
    if (activeTab) { activeTab.classList.add('active'); activeTab.setAttribute('aria-selected', 'true'); }
    if (activePanel) activePanel.classList.add('active');
    if (tab === 'publish') this.updatePendingStatus();
  },

  initTheme() {
    const toggle = document.getElementById('theme-toggle');
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    toggle.textContent = saved === 'dark' ? '☀' : '☾';
    toggle.onclick = () => {
      const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      toggle.textContent = theme === 'dark' ? '☀' : '☾';
    };
  },

  setDefaultDates() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('m-article-date').value = today;
    document.getElementById('m-note-date').value = today;
  },

  initToolbar() {
    const actions = [
      { label: '<strong>B</strong>', title: '粗体', cmd: 'bold' },
      { label: '<em>I</em>', title: '斜体', cmd: 'italic' },
      { label: 'H2', title: '二级标题', cmd: 'heading' },
      { label: 'H3', title: '三级标题', cmd: 'heading2' },
      { label: '"', title: '引用', cmd: 'quote' },
      { label: '•', title: '列表', cmd: 'list' },
      { label: '🔗', title: '链接', cmd: 'link' },
      { label: '🖼', title: '图片语法', cmd: 'image' },
      { label: '{}', title: '代码', cmd: 'code' },
      { label: '—', title: '分隔线', cmd: 'hr' },
    ];
    for (const type of ['article', 'note']) {
      const toolbar = document.getElementById(`m-${type}-toolbar`);
      if (!toolbar) continue;
      toolbar.innerHTML = actions.map(action => `<button type="button" class="mobile-toolbar-btn" title="${action.title}" onclick="MobileEditor.insertMarkdown('${action.cmd}', '${type}')">${action.label}</button>`).join('');
    }
  },

  initCursorTracking() {
    for (const type of ['article', 'note']) {
      const textarea = this.contentTextarea(type);
      if (!textarea) continue;
      const remember = () => { this.cursorPositions[type] = textarea.selectionStart ?? textarea.value.length; };
      ['focus', 'click', 'keyup', 'select', 'input'].forEach(event => textarea.addEventListener(event, remember));
    }
  },

  contentTextarea(type) {
    return document.getElementById(type === 'article' ? 'm-article-content' : 'm-note-content');
  },

  insertMarkdown(command, type = 'article') {
    const textarea = this.contentTextarea(type);
    if (!textarea) return;
    const start = textarea.selectionStart ?? this.cursorPositions[type] ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const selected = textarea.value.substring(start, end);
    let ins = '';
    switch (command) {
      case 'bold': ins = `**${selected || '粗体'}**`; break;
      case 'italic': ins = `*${selected || '斜体'}*`; break;
      case 'heading': ins = `\n## ${selected || '标题'}\n`; break;
      case 'heading2': ins = `\n### ${selected || '标题'}\n`; break;
      case 'quote': ins = `\n> ${selected || '引用'}\n`; break;
      case 'list': ins = `\n- ${selected || '列表项'}\n- \n`; break;
      case 'link': ins = `[${selected || '链接'}](https://)`; break;
      case 'image': ins = `\n![${selected || '图片描述'}](图片URL)\n`; break;
      case 'code': ins = `\n\`\`\`\n${selected || '代码'}\n\`\`\``; break;
      case 'hr': ins = `\n---\n`; break;
    }
    this.insertAtCursor(type, ins, start, end);
  },

  insertAtCursor(type, text, start = this.cursorPositions[type], end = start) {
    const textarea = this.contentTextarea(type);
    if (!textarea) return;
    const position = Number.isInteger(start) ? start : textarea.value.length;
    const selectionEnd = Number.isInteger(end) ? end : position;
    textarea.value = textarea.value.substring(0, position) + text + textarea.value.substring(selectionEnd);
    const nextPosition = position + text.length;
    textarea.selectionStart = textarea.selectionEnd = nextPosition;
    this.cursorPositions[type] = nextPosition;
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  },

  chooseImages(type) {
    const textarea = this.contentTextarea(type);
    if (textarea) this.cursorPositions[type] = textarea.selectionStart ?? textarea.value.length;
    document.getElementById(`m-${type}-image-input`).click();
  },

  initImageUploadAreas() {
    ['m-article-image-upload', 'm-note-image-upload'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('dragover'); });
      el.addEventListener('dragleave', e => { e.preventDefault(); el.classList.remove('dragover'); });
      el.addEventListener('drop', async e => {
        e.preventDefault(); el.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        const type = id.includes('article') ? 'article' : 'note';
        for (const file of files) await this.insertImageFile(file, type);
      });
    });
  },

  async handleImageUpload(input, type) {
    const files = Array.from(input.files || []);
    for (const file of files) await this.insertImageFile(file, type);
    input.value = '';
  },

  async insertImageFile(file, type) {
    if (file.size > 20 * 1024 * 1024) {
      this.toast(`「${file.name}」超过 20MB，请先压缩`, 'error');
      return;
    }
    try {
      if (Editor.supportsProjectDirectory() && !await Editor.ensureProjectAccess()) return;
      const dateInput = type === 'article' ? 'm-article-date' : 'm-note-date';
      const date = document.getElementById(dateInput)?.value || new Date().toISOString().split('T')[0];
      const imagePath = Editor.projectDirHandle
        ? await Editor.writeImageFile(file, file.name, date)
        : await Editor.cacheImageFile(file, file.name, date);
      if (type === 'article') {
        if (!this.articleImages.includes(imagePath)) this.articleImages.push(imagePath);
        this.insertImageMarkdown('article', imagePath, file.name);
        this.renderArticleImages();
      } else {
        if (!this.noteImages.includes(imagePath)) this.noteImages.push(imagePath);
        this.insertImageMarkdown('note', imagePath, file.name);
        this.renderNoteImages();
      }
      const loc = Editor.projectDirHandle ? '项目目录' : '待发布区';
      this.toast(`图片「${file.name}」已保存到${loc}`, 'success');
      this.updatePendingStatus();
    } catch (err) {
      console.error(err);
      this.toast(`图片保存失败：${err.message}`, 'error');
    }
  },

  insertImageMarkdown(type, imagePath, alt = '图片') {
    const safeAlt = alt.replace(/\.[^.]+$/, '').replaceAll(']', '');
    this.insertAtCursor(type, `\n\n![${safeAlt}](${imagePath})\n\n`);
  },

  imagePreviewUrl(imagePath) {
    const blob = Editor.imageCache[imagePath];
    if (!blob) return imagePath;
    if (!Editor.previewUrls[imagePath]) Editor.previewUrls[imagePath] = URL.createObjectURL(blob);
    return Editor.previewUrls[imagePath];
  },

  renderArticleImages() {
    const el = document.getElementById('m-article-images-preview');
    el.innerHTML = this.articleImages.map((path, index) => `
      <div class="mobile-image-item">
        <button type="button" class="mobile-image-preview" onclick="MobileEditor.insertStoredImage('article', ${index})" title="插入到光标位置">
          <img src="${this.imagePreviewUrl(path)}" alt="图片${index + 1}" loading="lazy">
        </button>
        <div class="mobile-image-actions">
          <button type="button" onclick="MobileEditor.insertStoredImage('article', ${index})">插入</button>
          <button type="button" class="danger" onclick="MobileEditor.removeArticleImage(${index})">移除</button>
        </div>
      </div>
    `).join('');
  },

  renderNoteImages() {
    const el = document.getElementById('m-note-images-preview');
    el.innerHTML = this.noteImages.map((path, index) => `
      <div class="mobile-image-item">
        <button type="button" class="mobile-image-preview" onclick="MobileEditor.insertStoredImage('note', ${index})" title="插入到光标位置">
          <img src="${this.imagePreviewUrl(path)}" alt="图片${index + 1}" loading="lazy">
        </button>
        <div class="mobile-image-actions">
          <button type="button" onclick="MobileEditor.insertStoredImage('note', ${index})">插入</button>
          <button type="button" class="danger" onclick="MobileEditor.removeNoteImage(${index})">移除</button>
        </div>
      </div>
    `).join('');
  },

  insertStoredImage(type, index) {
    const images = type === 'article' ? this.articleImages : this.noteImages;
    const imagePath = images[index];
    if (imagePath) this.insertImageMarkdown(type, imagePath);
  },

  async removeArticleImage(index) {
    const [imagePath] = this.articleImages.splice(index, 1);
    await this.removeImageFromEditor('article', imagePath);
    this.renderArticleImages();
  },

  async removeNoteImage(index) {
    const [imagePath] = this.noteImages.splice(index, 1);
    await this.removeImageFromEditor('note', imagePath);
    this.renderNoteImages();
  },

  async removeImageFromEditor(type, imagePath) {
    if (!imagePath) return;
    const textarea = this.contentTextarea(type);
    const escapedPath = imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const imagePattern = new RegExp(`\\n*!\\[[^\\]]*\\]\\(${escapedPath}\\)\\n*`, 'g');
    textarea.value = textarea.value.replace(imagePattern, '\n\n').trim();
    this.cursorPositions[type] = textarea.value.length;
    await Editor.deletePendingImage(imagePath);
    this.updatePendingStatus();
  },

  newArticle() {
    this.currentType = 'article';
    this.currentId = null;
    this.articleImages = [];
    document.getElementById('article-modal-title').textContent = '新建文章';
    document.getElementById('m-article-title').value = '';
    document.getElementById('m-article-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('m-article-category').value = '';
    document.getElementById('m-article-tags').value = '';
    document.getElementById('m-article-excerpt').value = '';
    document.getElementById('m-article-content').value = '';
    this.cursorPositions.article = 0;
    this.renderArticleImages();
    document.getElementById('article-modal').classList.add('active');
    this.showFooter('article');
  },

  editArticle(id) {
    const art = Editor.data.articles.find(a => a.id === id);
    if (!art) return;
    this.currentType = 'article';
    this.currentId = id;
    this.articleImages = this.extractImagesFromContent(art.content || '');
    document.getElementById('article-modal-title').textContent = '编辑文章';
    document.getElementById('m-article-title').value = art.title || '';
    document.getElementById('m-article-date').value = art.date || '';
    document.getElementById('m-article-category').value = art.category || '';
    document.getElementById('m-article-tags').value = (art.tags || []).join(', ');
    document.getElementById('m-article-excerpt').value = art.excerpt || '';
    document.getElementById('m-article-content').value = art.content || '';
    this.cursorPositions.article = (art.content || '').length;
    this.renderArticleImages();
    document.getElementById('article-modal').classList.add('active');
    this.showFooter('article');
  },

  extractImagesFromContent(content) {
    const matches = [...content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
    return matches.map(m => m[1]).filter(p => p.startsWith('/images/'));
  },

  newNote() {
    this.currentType = 'note';
    this.currentId = null;
    this.noteImages = [];
    document.getElementById('note-modal-title').textContent = '新建小记';
    document.getElementById('m-note-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('m-note-content').value = '';
    this.cursorPositions.note = 0;
    this.renderNoteImages();
    document.getElementById('note-modal').classList.add('active');
    this.showFooter('note');
  },

  editNote(id) {
    const note = Editor.data.notes.find(n => n.id === id);
    if (!note) return;
    this.currentType = 'note';
    this.currentId = id;
    this.noteImages = this.extractImagesFromContent(note.content || '');
    document.getElementById('note-modal-title').textContent = '编辑小记';
    document.getElementById('m-note-date').value = note.date || '';
    document.getElementById('m-note-content').value = note.content || '';
    this.cursorPositions.note = (note.content || '').length;
    this.renderNoteImages();
    document.getElementById('note-modal').classList.add('active');
    this.showFooter('note');
  },

  showFooter(type) {
    const saveBtn = document.getElementById('modal-save-btn');
    const cancelBtn = saveBtn.previousElementSibling;
    saveBtn.onclick = () => this.saveCurrent();
    cancelBtn.onclick = () => this.closeModal();
    document.querySelector('.mobile-footer').style.display = 'flex';
  },

  hideFooter() {
    document.querySelector('.mobile-footer').style.display = 'none';
  },

  async saveCurrent() {
    if (this.currentType === 'article') await this.saveArticle();
    else await this.saveNote();
  },

  async saveArticle() {
    const title = document.getElementById('m-article-title').value.trim();
    if (!title) { this.toast('请输入标题', 'error'); return; }
    const date = document.getElementById('m-article-date').value || new Date().toISOString().split('T')[0];
    const articleId = this.currentId || 'article-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const existing = Editor.data.articles.find(a => a.id === this.currentId);
    const sequence = Editor.nextContentSequence('articles', date, this.currentId);
    const articlePath = Editor.contentPath('articles', date, sequence);
    const legacyPaths = Editor.contentLegacyPaths(existing, articlePath);
    const art = {
      id: articleId,
      path: articlePath,
      sequence,
      title,
      date,
      category: document.getElementById('m-article-category').value.trim(),
      tags: document.getElementById('m-article-tags').value.split(',').map(t => t.trim()).filter(t => t),
      excerpt: document.getElementById('m-article-excerpt').value.trim(),
      content: document.getElementById('m-article-content').value,
      ...(legacyPaths.length ? { legacyPaths } : {})
    };
    if (this.currentId) {
      const idx = Editor.data.articles.findIndex(a => a.id === this.currentId);
      if (idx !== -1) Editor.data.articles[idx] = art;
    } else {
      Editor.data.articles.push(art);
    }
    Editor.deleted.articles = Editor.deleted.articles.filter(id => id !== articleId);
    if (!Editor.dirty.articles.includes(articleId)) Editor.dirty.articles.push(articleId);
    Editor.saveToStorage();
    this.renderArticlesList();
    this.closeModal();
    const synced = await Editor.syncProjectDataIfConnected();
    this.toast(synced ? '文章已保存并写入项目' : '文章已保存到本地', 'success');
  },

  async saveNote() {
    const content = document.getElementById('m-note-content').value.trim();
    if (!content) { this.toast('请输入内容', 'error'); return; }
    const date = document.getElementById('m-note-date').value || new Date().toISOString().split('T')[0];
    const noteId = this.currentId || 'note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const existing = Editor.data.notes.find(note => note.id === this.currentId);
    const sequence = Editor.nextContentSequence('notes', date, this.currentId);
    const notePath = Editor.contentPath('notes', date, sequence);
    const legacyPaths = Editor.contentLegacyPaths(existing, notePath);
    const note = {
      id: noteId,
      path: notePath,
      sequence,
      date,
      content,
      ...(legacyPaths.length ? { legacyPaths } : {})
    };
    if (this.currentId) {
      const idx = Editor.data.notes.findIndex(n => n.id === this.currentId);
      if (idx !== -1) Editor.data.notes[idx] = note;
    } else {
      Editor.data.notes.push(note);
    }
    Editor.deleted.notes = Editor.deleted.notes.filter(id => id !== noteId);
    if (!Editor.dirty.notes.includes(noteId)) Editor.dirty.notes.push(noteId);
    Editor.saveToStorage();
    this.renderNotesList();
    this.closeModal();
    const synced = await Editor.syncProjectDataIfConnected();
    this.toast(synced ? '小记已保存并写入项目' : '小记已保存到本地', 'success');
  },

  async deleteArticle(id) {
    const article = Editor.data.articles.find(item => item.id === id);
    if (!confirm(`确定删除文章「${article?.title || '未命名'}」？发布后将从网站移除。`)) return;
    Editor.data.articles = Editor.data.articles.filter(a => a.id !== id);
    if (!Editor.deleted.articles.includes(id)) Editor.deleted.articles.push(id);
    Editor.saveToStorage();
    this.renderArticlesList();
    const synced = await Editor.syncProjectDataIfConnected();
    this.toast(synced ? '已删除并写入项目' : '已删除', 'success');
  },

  async deleteNote(id) {
    const note = Editor.data.notes.find(item => item.id === id);
    if (!confirm(`确定删除 ${this.contentOrderLabel('notes', note)}？发布后将从网站移除。`)) return;
    Editor.data.notes = Editor.data.notes.filter(n => n.id !== id);
    if (!Editor.deleted.notes.includes(id)) Editor.deleted.notes.push(id);
    Editor.saveToStorage();
    this.renderNotesList();
    const synced = await Editor.syncProjectDataIfConnected();
    this.toast(synced ? '已删除并写入项目' : '已删除', 'success');
  },

  renderArticlesList() {
    const el = document.getElementById('articles-list');
    const articles = [...Editor.data.articles].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!articles.length) {
      el.innerHTML = `<div class="mobile-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><p>暂无文章，点击上方新建</p></div>`;
      return;
    }
    el.innerHTML = articles.map(art => `
      <div class="mobile-list-item">
        <div class="mobile-list-item-header">
          <div class="mobile-list-item-title">${Editor.escapeHtml(art.title)}</div>
          <span class="mobile-list-item-meta">${this.contentOrderLabel('articles', art)}</span>
        </div>
        <div class="mobile-list-item-path">${Editor.escapeHtml(art.path || '')}</div>
        <div class="mobile-list-item-content">${Editor.escapeHtml((art.excerpt || art.content || '').replace(/[#*`>\[\]!]/g, '').slice(0, 100))}</div>
        <div class="mobile-list-item-actions">
          <button class="mobile-btn mobile-btn-secondary" onclick="MobileEditor.editArticle('${art.id}')">编辑</button>
          <button class="mobile-btn mobile-btn-danger" onclick="MobileEditor.deleteArticle('${art.id}')">删除</button>
        </div>
      </div>
    `).join('');
  },

  renderNotesList() {
    const el = document.getElementById('notes-list');
    const notes = [...Editor.data.notes].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!notes.length) {
      el.innerHTML = `<div class="mobile-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg><p>暂无小记，点击上方新建</p></div>`;
      return;
    }
    el.innerHTML = notes.map(note => `
      <div class="mobile-list-item">
        <div class="mobile-list-item-header">
          <div class="mobile-list-item-title">${this.contentOrderLabel('notes', note)}</div>
          <span class="mobile-list-item-meta">${note.date}</span>
        </div>
        <div class="mobile-list-item-path">${Editor.escapeHtml(note.path || '')}</div>
        <div class="mobile-list-item-content">${Editor.escapeHtml(note.content.replace(/[#*`>\[\]!]/g, '').slice(0, 120))}</div>
        <div class="mobile-list-item-actions">
          <button class="mobile-btn mobile-btn-secondary" onclick="MobileEditor.editNote('${note.id}')">编辑</button>
          <button class="mobile-btn mobile-btn-danger" onclick="MobileEditor.deleteNote('${note.id}')">删除</button>
        </div>
      </div>
    `).join('');
  },

  contentOrderLabel(type, item) {
    if (!item) return type === 'articles' ? '文章' : '小记';
    const [year, month] = Editor.contentMonth(item.date).split('-');
    const sequence = Editor.contentSequence(item, type) || 1;
    return `${year.slice(-2)}年${month}月第${sequence}篇${type === 'articles' ? '文章' : '小记'}`;
  },

  closeModal() {
    document.getElementById('article-modal').classList.remove('active');
    document.getElementById('note-modal').classList.remove('active');
    this.hideFooter();
    this.currentType = null;
    this.currentId = null;
    this.articleImages = [];
    this.noteImages = [];
  },

  async refreshPublishedData() {
    const refreshed = await Editor.refreshPublishedData({ silent: true });
    if (!refreshed) {
      this.toast('刷新失败，请检查网络后重试', 'error');
      return;
    }
    this.loadFromEditor();
    this.renderArticlesList();
    this.renderNotesList();
    this.toast('已刷新已发布文章和小记', 'success');
  },

  updatePendingStatus() {
    const el = document.getElementById('pending-images-status');
    if (el) el.textContent = `待发布图片：${Object.keys(Editor.imageCache).length} 张`;
  },

  async publishToGitHub() {
    const token = document.getElementById('github-token').value.trim();
    if (!token) { this.toast('请输入 GitHub Token', 'error'); return; }
    const btn = document.getElementById('github-publish-btn');
    btn.disabled = true; btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;margin-right:8px;"></span>发布中...';
    if (!document.getElementById('spin-style')) {
      const s = document.createElement('style');
      s.id = 'spin-style';
      s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    try {
      await Editor.publishToGitHub();
      document.getElementById('github-token').value = '';
      this.updatePendingStatus();
      this.renderArticlesList();
      this.renderNotesList();
      this.toast('已发布到 GitHub，Pages 正在部署', 'success');
    } catch (err) {
      console.error(err);
      this.toast(`发布失败：${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>发布到 GitHub';
    }
  },

  exportData() {
    Editor.exportData();
    this.toast('数据已导出', 'success');
  },

  importData() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data.articles) { Editor.data.articles = data.articles; Editor.renderArticlesList(); this.renderArticlesList(); }
          if (data.notes) { Editor.data.notes = data.notes; Editor.renderNotesList(); this.renderNotesList(); }
          Editor.saveToStorage();
          this.toast('数据已导入', 'success');
        } catch { this.toast('解析失败', 'error'); }
      };
      reader.readAsText(file);
    };
    input.click();
  },

  clearAllData() {
    if (!confirm('⚠️ 确定清空所有本地数据？')) return;
    Editor.clearAllData();
    this.renderArticlesList();
    this.renderNotesList();
    this.toast('已清空', 'success');
  },

  toast(msg, type = 'info') {
    const el = document.getElementById('mobile-toast');
    el.textContent = msg;
    el.className = `mobile-toast ${type} show`;
    setTimeout(() => el.classList.remove('show'), 3000);
  }
};

document.addEventListener('DOMContentLoaded', () => MobileEditor.init());
document.addEventListener('keydown', e => { if (e.key === 'Escape') MobileEditor.closeModal(); });
document.querySelectorAll('.mobile-modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) MobileEditor.closeModal(); }));
