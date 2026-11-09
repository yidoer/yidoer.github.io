/* Markdown 解析器见 js/markdown.js（浏览器与 Node 共用同一份实现） */

/**
 * 博客应用核心逻辑
 */
const BlogApp = {
  dataRequests: new Map(),

  // 主题管理
  theme: {
    init() {
      const savedTheme = localStorage.getItem('blog-theme') || 'light';
      this.set(savedTheme);

      const toggleBtn = document.getElementById('theme-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => this.toggle());
      }
    },

    set(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('blog-theme', theme);
      this.updateIcon(theme);
    },

    toggle() {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const next = current === 'light' ? 'dark' : 'light';
      this.set(next);
    },

    updateIcon(theme) {
      const toggleBtn = document.getElementById('theme-toggle');
      if (!toggleBtn) return;
      toggleBtn.innerHTML = theme === 'light' ? '&#9790;' : '&#9728;';
      toggleBtn.title = theme === 'light' ? '切换到深色模式' : '切换到浅色模式';
    }
  },

  // 数据加载
  loadData(type) {
    if (this.dataRequests.has(type)) return this.dataRequests.get(type);
    const request = fetch(`/data/${type}.json`)
      .then(response => {
        if (!response.ok) throw new Error(`Failed to load ${type}.json`);
        return response.json();
      })
      .then(data => data[type] || [])
      .catch(error => {
        console.error(`Error loading ${type}:`, error);
        this.dataRequests.delete(type);
        return [];
      });
    this.dataRequests.set(type, request);
    return request;
  },

  // 文章永久链接
  articleUrl(article) {
    if (article.path && article.path.startsWith('/articles/')) {
      return article.path.endsWith('/') ? article.path : `${article.path}/`;
    }
    const date = String(article.date || new Date().toISOString().slice(0, 10)).split('-');
    const sequence = String(article.sequence || 1).padStart(2, '0');
    return `/articles/${String(date[0]).slice(-2)}/${date[1] || '01'}/article-${sequence}/`;
  },

  // 小记永久链接
  noteUrl(note) {
    if (note.path && note.path.startsWith('/notes/')) {
      return note.path.endsWith('/') ? note.path : `${note.path}/`;
    }
    const date = String(note.date || new Date().toISOString().slice(0, 10)).split('-');
    const sequence = String(note.sequence || 1).padStart(2, '0');
    return `/notes/${String(date[0]).slice(-2)}/${String(date[1] || '01').padStart(2, '0')}/note-${sequence}/`;
  },

  sortByDateDesc(items) {
    return [...items].sort((first, second) => new Date(second.date) - new Date(first.date));
  },

  // 格式化日期
  formatDate(dateStr) {
    const value = String(dateStr || '');
    const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoDate) return `${isoDate[1]}.${isoDate[2]}.${isoDate[3]}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  },

  // 预览文本截断：超出长度时以省略号结尾，保证预览卡片整齐
  truncate(text, maxLen = 100) {
    const str = String(text || '');
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + '…';
  },

  // HTML 转义：拼接 innerHTML 前必须处理，避免标题/标签里的尖括号破坏结构
  escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // 空状态占位
  emptyStateHtml(icon, text) {
    return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><p class="empty-state-text">${this.escapeHtml(text)}</p></div>`;
  },

  // 文章卡片：首页最新文章、文章列表页共用
  articleCardHtml(article, index = 0) {
    const delay = Math.min(index + 1, 4);
    const tags = (article.tags || [])
      .map(tag => `<span class="article-tag">${this.escapeHtml(tag)}</span>`)
      .join('');
    return `<a href="${this.escapeHtml(this.articleUrl(article))}" class="article-card fade-in fade-in-delay-${delay}">
              <div class="article-card-header">
                <span class="article-date">${this.escapeHtml(this.formatDate(article.date))}</span>
                <span class="article-category">${this.escapeHtml(article.category || '未分类')}</span>
              </div>
              <h3 class="article-card-title">${this.escapeHtml(article.title)}</h3>
              <p class="article-card-excerpt">${this.escapeHtml(this.truncate(article.excerpt || '', 80))}</p>
              <div class="article-card-tags">${tags}</div>
            </a>`;
  },

  // 小记卡片：首页最新小记、小记列表页共用
  noteCardHtml(note, index = 0) {
    const delay = Math.min(index + 1, 4);
    return `<a href="${this.escapeHtml(this.noteUrl(note))}" class="note-item note-link fade-in fade-in-delay-${delay}">
              <div class="note-date">${this.escapeHtml(this.formatDate(note.date))}</div>
              <div class="note-content">${this.escapeHtml(this.truncate(note.content, 80))}</div>
              <span class="note-comment-link">查看与评论 →</span>
            </a>`;
  },

  // 分页：articles.html / notes.html 共用
  renderPagination({ totalPages, currentPage, pagination, pageInfo, prevBtn, nextBtn }) {
    if (!pagination || !pageInfo || !prevBtn || !nextBtn) return;
    if (totalPages > 1) {
      pagination.style.display = 'flex';
      pageInfo.textContent = `${currentPage} / ${totalPages}`;
      prevBtn.disabled = currentPage <= 1;
      nextBtn.disabled = currentPage >= totalPages;
    } else {
      pagination.style.display = 'none';
    }
  },

  // 导航高亮
  highlightNav() {
    const pathname = window.location.pathname;
    const currentPath = pathname.split('/').pop() || 'index.html';
    const isArticlePage = pathname.includes('/articles/') || currentPath === 'article.html';
    document.querySelectorAll('.nav-menu a').forEach(link => {
      const linkPath = link.getAttribute('href');
      const normalizedLinkPath = linkPath ? linkPath.replace(/^\//, '') : '';
      if (normalizedLinkPath === currentPath ||
          (currentPath === 'index.html' && normalizedLinkPath === '') ||
          (isArticlePage && normalizedLinkPath === 'articles.html')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  },

  // 返回顶部
  initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    let scheduled = false;
    const updateVisibility = () => {
      btn.classList.toggle('visible', window.scrollY > 300);
      scheduled = false;
    };
    window.addEventListener('scroll', () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(updateVisibility);
    }, { passive: true });

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  },

  // 初始化评论组件（Utterances，按文章 pathname 独立建帖）
  initComments() {
    const commentsContainer = document.getElementById('comments-container') || document.getElementById('giscus-container');
    if (!commentsContainer || ['loading', 'true'].includes(commentsContainer.dataset.loaded)) return;

    commentsContainer.dataset.loaded = 'loading';
    commentsContainer.replaceChildren();
    const createGitHubFallback = () => {
      const fallback = document.createElement('div');
      fallback.className = 'comments-fallback';
      const canonicalHref = document.querySelector('link[rel="canonical"]')?.href || window.location.href;
      let issueTerm = window.location.pathname.replace(/^\/+/, '') || 'index';
      try {
        issueTerm = new URL(canonicalHref, window.location.origin).pathname.replace(/^\/+/, '') || issueTerm;
      } catch (_) {}
      const repositoryUrl = 'https://github.com/yidoer/yidoer.github.io';
      const searchLink = document.createElement('a');
      searchLink.href = `${repositoryUrl}/issues?q=${encodeURIComponent(`is:issue in:title "${issueTerm}"`)}`;
      searchLink.target = '_blank';
      searchLink.rel = 'noopener noreferrer';
      searchLink.textContent = '在 GitHub 查看评论';
      const newIssueLink = document.createElement('a');
      newIssueLink.href = `${repositoryUrl}/issues/new?title=${encodeURIComponent(issueTerm)}&body=${encodeURIComponent(`页面：${canonicalHref}\n\n请在这里发表评论。`)}`;
      newIssueLink.target = '_blank';
      newIssueLink.rel = 'noopener noreferrer';
      newIssueLink.textContent = '发表第一条评论';
      fallback.append(searchLink, newIssueLink);
      return fallback;
    };

    const status = document.createElement('p');
    status.className = 'comments-status';
    status.textContent = '正在加载评论...';
    commentsContainer.append(status, createGitHubFallback());

    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'github-dark' : 'github-light';
    const script = document.createElement('script');
    script.src = 'https://utteranc.es/client.js';
    script.setAttribute('repo', 'yidoer/yidoer.github.io');
    script.setAttribute('issue-term', commentsContainer.dataset.issueTerm || 'pathname');
    script.setAttribute('theme', theme);
    script.setAttribute('crossorigin', 'anonymous');
    script.async = true;

    let settled = false;
    const finishLoading = () => {
      const iframe = commentsContainer.querySelector('iframe.utterances-frame');
      if (!iframe) return false;
      iframe.loading = 'eager';
      iframe.removeAttribute('loading');
      const wrapper = iframe.closest('.utterances');
      if (!wrapper) return false;
      wrapper.style.minHeight = '220px';
      if (!(Number.parseFloat(wrapper.style.height) > 0)) return false;
      settled = true;
      commentsContainer.dataset.loaded = 'true';
      status.remove();
      return true;
    };
    const showLoadError = () => {
      if (settled || finishLoading()) return;
      settled = true;
      commentsContainer.dataset.loaded = 'false';
      commentsContainer.replaceChildren();
      const message = document.createElement('p');
      message.className = 'comments-status comments-status-error';
      message.textContent = '评论服务加载失败，可能被网络或浏览器扩展拦截。';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'comments-retry';
      retry.textContent = '重新加载评论';
      retry.addEventListener('click', () => {
        commentsContainer.dataset.loaded = 'false';
        this.initComments();
      });
      commentsContainer.append(message, retry, createGitHubFallback());
    };

    const loadObserver = new MutationObserver(() => {
      if (finishLoading()) loadObserver.disconnect();
    });
    loadObserver.observe(commentsContainer, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    script.addEventListener('error', showLoadError, { once: true });
    commentsContainer.appendChild(script);
    setTimeout(showLoadError, 8000);

    if (!this.commentsThemeObserver) {
      this.commentsThemeObserver = new MutationObserver(mutations => {
        if (!mutations.some(mutation => mutation.attributeName === 'data-theme')) return;
        const iframe = document.querySelector('iframe.utterances-frame');
        if (!iframe) return;
        const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'github-dark' : 'github-light';
        iframe.contentWindow.postMessage({ type: 'set-theme', theme: nextTheme }, 'https://utteranc.es');
      });
      this.commentsThemeObserver.observe(document.documentElement, { attributes: true });
    }
  },

  analytics: {
    scriptUrl: 'https://www.21sdk.com/tjs?id=ws_bfd320116d33734c21ec59a0e9c0a287',

    shouldLoad() {
      const editorPages = new Set(['/editor.html', '/mobile-editor.html']);
      return !editorPages.has(location.pathname) && navigator.doNotTrack !== '1';
    },

    load() {
      if (!this.shouldLoad() || document.querySelector('script[data-site-analytics]')) return;
      const script = document.createElement('script');
      script.src = this.scriptUrl;
      script.async = true;
      script.dataset.siteAnalytics = '21sdk';
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      document.head.appendChild(script);
    }
  },

  // 通用初始化
  init() {
    this.theme.init();
    this.highlightNav();
    this.initBackToTop();
    this.analytics.load();
  }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  BlogApp.init();
});
