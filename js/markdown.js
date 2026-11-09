/*!
 * 共享 Markdown 解析器
 * 浏览器端挂到 window.Markdown；Node 端通过 module.exports 导出。
 * app.js 与 scripts/generate-feed.js 共用同一份实现，避免
 * 网页渲染与 RSS 正文出现两套不一致的语法。
 */
(function (root, factory) {
  const Markdown = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = Markdown;
  }
  if (root) {
    root.Markdown = Markdown;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

    // 图片 ![alt](url)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" decoding="async">');

    // 链接 [text](url)，必须在图片之后处理，避免把图片语法误解析成链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 引用
    // 注意：此时 & < > 已被转义，行首的 ">" 变成了 "&gt;"，所以两种都要认。
    const lines = html.split('\n');
    let inQuote = false;
    let quoteLines = [];
    const processed = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const quoteMatch = line.match(/^(?:&gt;|>)\s?(.*)$/);
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
    // 表格
    // 行尾的 \n 用 (?:\n|$) 兼容「表格位于文本末尾、没有结尾换行」的情况，
    // 否则最后一行数据会被漏掉（tbody 为空）。
    html = html.replace(/(?:^\|([^\n]+)\|[ \t]*(?:\n|$))(?:^\|[-:|\t ]+\|[ \t]*(?:\n|$))((?:^\|[^\n]+\|[ \t]*(?:\n|$))*)/gm, (match, header, rows) => {
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
    // 块级标签（含闭合标签，如 </ul>）不能包进 <p>，否则会产生非法嵌套。
    const BLOCK_START = /^<\/?(?:h[1-6]|blockquote|ul|ol|pre|table|hr|li)\b/;
    const paraLines = html.split('\n');
    const paraProcessed = [];
    let currentPara = [];

    for (const line of paraLines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (currentPara.length > 0) {
          const paraContent = currentPara.join(' ').replace(/\s+/g, ' ');
          if (!BLOCK_START.test(paraContent)) {
            paraProcessed.push(`<p>${paraContent}</p>`);
          } else {
            paraProcessed.push(paraContent);
          }
          currentPara = [];
        }
      } else if (BLOCK_START.test(trimmed)) {
        if (currentPara.length > 0) {
          const paraContent = currentPara.join(' ').replace(/\s+/g, ' ');
          if (!BLOCK_START.test(paraContent)) {
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
      if (!BLOCK_START.test(paraContent)) {
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

  return Markdown;
});
