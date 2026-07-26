(async function() {
  BlogApp.initComments();
  const noteId = document.body.dataset.noteId;
  const notes = await BlogApp.loadData('notes');
  const note = notes.find(item => item.id === noteId);
  const content = document.getElementById('note-content');
  if (!note) { content.textContent = '小记未找到。'; return; }
  const formattedDate = BlogApp.formatDate(note.date);
  document.title = `${formattedDate} - 小记 - 人间浊物 琅上清书`;
  const publishedDate = document.getElementById('note-published-date');
  const breadcrumbDate = document.getElementById('note-breadcrumb-date');
  if (publishedDate) {
    publishedDate.dateTime = note.date || '';
    publishedDate.textContent = `📅 ${formattedDate}`;
  }
  if (breadcrumbDate) breadcrumbDate.textContent = formattedDate;
  content.classList.add('markdown-body');
  content.innerHTML = Markdown.parse(note.content || '');
})();
