/**
 * 图形化编辑后台
 * 支持文章/小记管理、Markdown 编辑、图片上传、数据导入导出
 */
const Editor = {
  data: { articles: [], notes: [] },
  current: { type: null, id: null },
  imageCache: {},

  // ==================== 初始化 ====================
  async init() {
    this.loadFromStorage();
    if (this.data.articles.length === 0 && this.data.notes.length === 0) {
      await this.loadFromFiles();
    }
    this.renderArticlesList();
    this.renderNotesList();
    this.initTabs();
    this.initDragDrop();
    this.initPreviewListeners();
  },

  loadFromStorage() {
    try {
      const a = localStorage.getItem('blog-editor-articles');
      const n = localStorage.getItem('blog-editor-notes');
      if (a) this.data.articles = JSON.parse(a);
      if (n) this.data.notes = JSON.parse(n);
    } catch (e) { console.error('Storage load error:', e); }
  },

  async loadFromFiles() {
    try {
      const [ar, nr] = await Promise.all([
        fetch('data/articles.json').then(r => r.json()).catch(() => ({ articles: [] })),
        fetch('data/notes.json').then(r => r.json()).catch(() => ({ notes: [] }))
      ]);
      this.data.articles = ar.articles || [];
      this.data.notes = nr.notes || [];
      this.saveToStorage();
    } catch (e) { this.showToast('加载原始数据失败，请检查文件是否存在', 'error'); }
  },

  saveToStorage() {
    localStorage.setItem('blog-editor-articles', JSON.stringify(this.data.articles));
    localStorage.setItem('blog-editor-notes', JSON.stringify(this.data.notes));
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

  saveArticle() {
    const title = document.getElementById('article-title').value.trim();
    if (!title) { this.showToast('请输入文章标题', 'error'); return; }
    const articleId = this.current.id || 'article-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    const date = document.getElementById('article-date').value || new Date().toISOString().split('T')[0];
    const existingArticle = this.data.articles.find(article => article.id === this.current.id);
    const slug = this.slugify(title) || articleId;
    const art = {
      id: articleId,
      path: existingArticle?.path || `/articles/${date.replaceAll('-', '/')}/${slug}/`,
      title,
      date,
      category: document.getElementById('article-category').value.trim(),
      tags: document.getElementById('article-tags').value.split(',').map(t => t.trim()).filter(t => t),
      excerpt: document.getElementById('article-excerpt').value.trim(),
      content: document.getElementById('article-content').value
    };
    if (this.current.id) {
      const idx = this.data.articles.findIndex(a => a.id === this.current.id);
      if (idx !== -1) this.data.articles[idx] = art;
    } else {
      this.data.articles.push(art);
    }
    this.saveToStorage();
    this.renderArticlesList();
    this.closeModal();
    this.showToast('文章已保存', 'success');
  },

  deleteArticle(id) {
    if (!confirm('确定删除这篇文章？不可撤销。')) return;
    this.data.articles = this.data.articles.filter(a => a.id !== id);
    this.saveToStorage();
    this.renderArticlesList();
    this.showToast('文章已删除', 'success');
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

  saveNote() {
    const content = document.getElementById('note-content').value.trim();
    if (!content) { this.showToast('请输入小记内容', 'error'); return; }
    const note = {
      id: this.current.id || 'note-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      date: document.getElementById('note-date').value || new Date().toISOString().split('T')[0],
      content
    };
    if (this.current.id) {
      const idx = this.data.notes.findIndex(n => n.id === this.current.id);
      if (idx !== -1) this.data.notes[idx] = note;
    } else {
      this.data.notes.push(note);
    }
    this.saveToStorage();
    this.renderNotesList();
    this.closeModal();
    this.showToast('小记已保存', 'success');
  },

  deleteNote(id) {
    if (!confirm('确定删除这条小记？不可撤销。')) return;
    this.data.notes = this.data.notes.filter(n => n.id !== id);
    this.saveToStorage();
    this.renderNotesList();
    this.showToast('小记已删除', 'success');
  },

  // ==================== Markdown 编辑器 ====================
  updateArticlePreview() {
    const content = document.getElementById('article-content').value;
    const preview = document.getElementById('article-preview');
    if (preview && typeof Markdown !== 'undefined') {
      preview.innerHTML = Markdown.parse(content);
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
  handleImageUpload(input, type) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    files.forEach(file => {
      if (file.size > 3 * 1024 * 1024) {
        this.showToast(`「${file.name}」过大（>3MB），建议压缩后上传`, 'error'); return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target.result;
        const ta = document.getElementById(`${type}-content`);
        if (ta) {
          const pos = ta.selectionStart || ta.value.length;
          const before = ta.value.substring(0, pos);
          const after = ta.value.substring(pos);
          const md = `\n\n![${file.name}](${base64})\n\n`;
          ta.value = before + md + after;
          ta.selectionStart = ta.selectionEnd = pos + md.length;
          this.updateArticlePreview();
        }
        this.showToast(`图片「${file.name}」已插入`, 'success');
      };
      reader.readAsDataURL(file);
    });
    input.value = '';
  },

  initDragDrop() {
    ['article-content', 'note-content'].forEach(id => {
      const ta = document.getElementById(id);
      if (!ta) return;
      ta.addEventListener('dragover', (e) => { e.preventDefault(); ta.style.borderColor = 'var(--accent-color)'; });
      ta.addEventListener('dragleave', (e) => { e.preventDefault(); ta.style.borderColor = ''; });
      ta.addEventListener('drop', (e) => {
        e.preventDefault();
        ta.style.borderColor = '';
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (!files.length) return;
        const type = id === 'article-content' ? 'article' : 'note';
        files.forEach(file => {
          if (file.size > 3 * 1024 * 1024) {
            this.showToast(`「${file.name}」过大（>3MB），建议压缩后上传`, 'error'); return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            const base64 = ev.target.result;
            const pos = ta.selectionStart || ta.value.length;
            const md = `\n\n![${file.name}](${base64})\n\n`;
            ta.value = ta.value.substring(0, pos) + md + ta.value.substring(pos);
            ta.selectionStart = ta.selectionEnd = pos + md.length;
            if (type === 'article') this.updateArticlePreview();
            this.showToast(`图片「${file.name}」已插入`, 'success');
          };
          reader.readAsDataURL(file);
        });
      });
    });
  },

  // ==================== 导出/导入 ====================
  exportData() {
    const articlesJson = JSON.stringify({ articles: this.data.articles }, null, 2);
    const notesJson = JSON.stringify({ notes: this.data.notes }, null, 2);
    this.downloadFile(articlesJson, 'articles.json', 'application/json');
    setTimeout(() => this.downloadFile(notesJson, 'notes.json', 'application/json'), 200);
    this.showToast('数据已导出，请下载后替换到 blog/data/ 目录', 'success');
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

  async resetData() {
    if (!confirm('确定要重置数据吗？这将丢弃所有未导出的修改。')) return;
    await this.loadFromFiles();
    this.renderArticlesList();
    this.renderNotesList();
    this.showToast('数据已重置为原始状态', 'success');
  },

  clearAllData() {
    if (!confirm('⚠️ 警告：确定要清空所有数据吗？此操作不可撤销！')) return;
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