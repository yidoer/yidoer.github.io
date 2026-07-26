(async function() {
  BlogApp.initComments();
  const noteId = document.body.dataset.noteId;
  const notes = await BlogApp.loadData('notes');
  const note = notes.find(item => item.id === noteId);
  const content = document.getElementById('note-content');
  if (!note) { content.textContent = '小记未找到。'; return; }
  document.title = `${BlogApp.formatDate(note.date)} - 小记 - 人间浊物 琅上清书`;
  content.classList.add('markdown-body');
  content.innerHTML = Markdown.parse(note.content || '');
})();
