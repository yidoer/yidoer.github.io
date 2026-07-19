(async function() {
  const articleId = document.body.dataset.articleId;
  const header = document.getElementById('article-header');
  const content = document.getElementById('article-content');
  const navigation = document.getElementById('article-nav');
  const previousLink = document.getElementById('prev-article');
  const nextLink = document.getElementById('next-article');

  const articles = await BlogApp.loadData('articles');
  const sortedArticles = [...articles].sort((a, b) => new Date(b.date) - new Date(a.date));
  const currentIndex = sortedArticles.findIndex(article => article.id === articleId);
  const article = sortedArticles[currentIndex];

  if (!article) {
    header.innerHTML = '<h1 class="article-header-title">文章未找到</h1>';
    content.innerHTML = '<div class="empty-state"><p class="empty-state-text">请返回文章列表重新选择。</p><p><a href="/articles.html">返回文章列表 →</a></p></div>';
    return;
  }

  document.title = `${article.title} - 人间浊物 琅上清书`;
  document.querySelector('meta[name="description"]').content = article.excerpt || article.title;

  const title = document.createElement('h1');
  title.className = 'article-header-title';
  title.textContent = article.title;

  const meta = document.createElement('div');
  meta.className = 'article-meta';
  meta.innerHTML = `<span>📅 ${BlogApp.formatDate(article.date)}</span><span>📁 ${article.category || '未分类'}</span><span>🏷️ ${(article.tags || []).join(', ') || '无标签'}</span>`;

  header.replaceChildren(title, meta);
  content.innerHTML = Markdown.parse(article.content);
  navigation.style.display = 'flex';

  if (currentIndex > 0) {
    const previousArticle = sortedArticles[currentIndex - 1];
    previousLink.href = previousArticle.path;
    previousLink.querySelector('.article-nav-title').textContent = previousArticle.title;
  } else {
    previousLink.hidden = true;
  }

  if (currentIndex < sortedArticles.length - 1) {
    const nextArticle = sortedArticles[currentIndex + 1];
    nextLink.href = nextArticle.path;
    nextLink.querySelector('.article-nav-title').textContent = nextArticle.title;
  } else {
    nextLink.hidden = true;
  }

  BlogApp.initComments();
})();
