/**
 * 轻量 Markdown 解析器
 * 支持常见语法，无需外部依赖
 */
const Markdown = {
  parse(text) {
    if (!text) return '';
    let html = text;

    // 转义 HTML 特殊字符
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 代码块 (```lang\ncode\n```)
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const langClass = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${langClass}>${code.trim()}</code></pre>`;
    });

    // 行内代码 (`code`)
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 分隔线
    html = html.replace(/^[\s]*(-{3,}|\*{3,}|_{3,})[\s]*$/gm, '<hr>');

    // 标题
    html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

    // 粗体 + 斜体
    html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');

    // 粗体
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // 斜体
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 删除线
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 图片 ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

    // 引用
    const lines = html.split('\n');
    let inQuote = false;
    let quoteLines = [];
    const processed = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const quoteMatch = line.match(/^\>\s?(.*)$/);
      if (quoteMatch) {
        if (!inQuote) {
          inQuote = true;
          quoteLines = [quoteMatch[1]];
        } else {
          quoteLines.push(quoteMatch[1]);
        }
      } else {
        if (inQuote) {
          processed.push(`<blockquote>\n${quoteLines.join('\n')}\n</blockquote>`);
          inQuote = false;
          quoteLines = [];
        }
        processed.push(line);
      }
    }
    if (inQuote) {
      processed.push(`<blockquote>\n${quoteLines.join('\n')}\n</blockquote>`);
    }
    html = processed.join('\n');

    // 无序列表
    const listProcessed = [];
    let inList = false;
    let listItems = [];
    let listType = '';

    const listLines = html.split('\n');
    for (let i = 0; i < listLines.length; i++) {
      const line = listLines[i];
      const ulMatch = line.match(/^[\s]*[-\*\+]\s+(.*)$/);
      const olMatch = line.match(/^[\s]*\d+\.\s+(.*)$/);

      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) {
            listProcessed.push(`</${listType}>`);
          }
          listProcessed.push('<ul>');
          inList = true;
          listType = 'ul';
        }
        listProcessed.push(`<li>${ulMatch[1]}</li>`);
      } else if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) {
            listProcessed.push(`</${listType}>`);
          }
          listProcessed.push('<ol>');
          inList = true;
          listType = 'ol';
        }
        listProcessed.push(`<li>${olMatch[1]}</li>`);
      } else if (line.trim() === '' && inList) {
        // 空行结束列表
        listProcessed.push(`</${listType}>`);
        inList = false;
        listType = '';
        listProcessed.push(line);
      } else {
        if (inList && line.trim() !== '') {
          // 列表中的延续行
          listProcessed.push(`<li>${line.trim()}</li>`);
        } else {
          if (inList) {
            listProcessed.push(`</${listType}>`);
            inList = false;
            listType = '';
          }
          listProcessed.push(line);
        }
      }
    }
    if (inList) {
      listProcessed.push(`</${listType}>`);
    }
    html = listProcessed.join('\n');

    // 表格
    html = html.replace(/(?:^\|([^\n]+)\|[\s]*\n)(?:^\|[-:\|\s]+\|[\s]*\n)((?:^\|[^\n]+\|[\s]*\n)*)/gm, (match, header, rows) => {
      const headers = header.split('|').map(h => h.trim()).filter(h => h);
      const headerHtml = `<thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>`;
      const rowLines = rows.trim().split('\n').filter(l => l.trim());
      const bodyHtml = `<tbody>${rowLines.map(line => {
        const cells = line.split('|').map(c => c.trim()).filter(c => c);
        return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
      }).join('')}</tbody>`;
      return `<table>${headerHtml}${bodyHtml}</table>`;
    });

    // 段落
    const paraLines = html.split('\n');
    const paraProcessed = [];
    let currentPara = [];

    for (const line of paraLines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (currentPara.length > 0) {
          const paraContent = currentPara.join(' ').replace(/\s+/g, ' ');
          if (!paraContent.match(/^<(h[1-6]|blockquote|ul|ol|pre|table|hr)/)) {
            paraProcessed.push(`<p>${paraContent}</p>`);
          } else {
            paraProcessed.push(paraContent);
          }
          currentPara = [];
        }
      } else if (trimmed.match(/^<(h[1-6]|blockquote|ul|ol|pre|table|li|hr)/)) {
        if (currentPara.length > 0) {
          const paraContent = currentPara.join(' ').replace(/\s+/g, ' ');
          if (!paraContent.match(/^<(h[1-6]|blockquote|ul|ol|pre|table|hr)/)) {
            paraProcessed.push(`<p>${paraContent}</p>`);
          } else {
            paraProcessed.push(paraContent);
          }
          currentPara = [];
        }
        paraProcessed.push(line);
      } else {
        currentPara.push(line);
      }
    }
    if (currentPara.length > 0) {
      const paraContent = currentPara.join(' ').replace(/\s+/g, ' ');
      if (!paraContent.match(/^<(h[1-6]|blockquote|ul|ol|pre|table|hr)/)) {
        paraProcessed.push(`<p>${paraContent}</p>`);
      } else {
        paraProcessed.push(paraContent);
      }
    }
    html = paraProcessed.join('\n');

    // 清理多余的空行
    html = html.replace(/\n{3,}/g, '\n\n');

    return html.trim();
  }
};

/**
 * 博客应用核心逻辑
 */
const BlogApp = {
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
  async loadData(type) {
    try {
      const response = await fetch(`/data/${type}.json`);
      if (!response.ok) throw new Error(`Failed to load ${type}.json`);
      const data = await response.json();
      return data[type] || [];
    } catch (error) {
      console.error(`Error loading ${type}:`, error);
      return [];
    }
  },

  // 文章永久链接
  articleUrl(article) {
    if (article.path) return article.path;
    const date = String(article.date || new Date().toISOString().slice(0, 10)).split('-');
    const slug = (article.slug || article.id || 'article').toString().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
    return `/articles/${date[0]}/${date[1] || '01'}/${date[2] || '01'}/${slug}/`;
  },

  // 格式化日期
  formatDate(dateStr) {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
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

  // 移动端菜单
  initMobileMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    const navMenu = document.getElementById('nav-menu');
    if (menuToggle && navMenu) {
      menuToggle.addEventListener('click', () => {
        navMenu.classList.toggle('show');
      });
      // 点击菜单项后关闭菜单
      navMenu.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
          navMenu.classList.remove('show');
        });
      });
    }
  },

  // 返回顶部
  initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) {
        btn.classList.add('visible');
      } else {
        btn.classList.remove('visible');
      }
    }, { passive: true });

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  },

  // 初始化评论组件（Utterances，按文章 pathname 独立建帖）
  initComments() {
    const commentsContainer = document.getElementById('comments-container') || document.getElementById('giscus-container');
    if (!commentsContainer || commentsContainer.dataset.loaded === 'true') return;

    commentsContainer.dataset.loaded = 'true';
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'github-dark' : 'github-light';
    const script = document.createElement('script');
    script.src = 'https://utteranc.es/client.js';
    script.setAttribute('repo', 'yidoer/yidoer.github.io');
    script.setAttribute('issue-term', 'pathname');
    script.setAttribute('label', 'comment');
    script.setAttribute('theme', theme);
    script.setAttribute('crossorigin', 'anonymous');
    script.async = true;
    commentsContainer.appendChild(script);

    const observer = new MutationObserver(mutations => {
      if (!mutations.some(mutation => mutation.attributeName === 'data-theme')) return;
      const iframe = document.querySelector('iframe.utterances-frame');
      if (!iframe) return;
      const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'github-dark' : 'github-light';
      iframe.contentWindow.postMessage({ type: 'set-theme', theme: nextTheme }, 'https://utteranc.es');
    });
    observer.observe(document.documentElement, { attributes: true });
  },

  // 通用初始化
  init() {
    this.theme.init();
    this.highlightNav();
    this.initMobileMenu();
    this.initBackToTop();
  }
};

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  BlogApp.init();
});