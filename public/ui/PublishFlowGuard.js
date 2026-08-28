const byId = (id) => document.getElementById(id);

function mediaReady() {
  const image = byId('image-validation');
  const video = byId('video-validation');
  return image?.dataset.state === 'ready' && video?.dataset.state === 'ready';
}

function titleReady() {
  return Boolean(byId('story-title')?.value?.trim());
}

function publishingNow() {
  return byId('build-status')?.dataset.state === 'processing';
}

function syncPublishButton() {
  const button = byId('btn-publish');
  if (!button) return;
  const ready = mediaReady() && titleReady() && !publishingNow();
  button.disabled = !ready;
  button.setAttribute('aria-disabled', String(!ready));
}

function showMissingTitle() {
  const title = byId('story-title');
  const label = byId('build-label');
  const build = byId('build-status');
  if (!title || titleReady()) return false;
  if (build) build.dataset.state = 'warning';
  if (label) label.textContent = 'Escribí un título para poder crear la obra.';
  title.focus();
  return true;
}

function start() {
  const form = byId('publish-form');
  const title = byId('story-title');
  const button = byId('btn-publish');
  if (!form || !title || !button) return;

  title.required = true;
  title.addEventListener('input', syncPublishButton);
  title.addEventListener('change', syncPublishButton);

  const observer = new MutationObserver(syncPublishButton);
  ['image-validation', 'video-validation', 'build-status'].forEach((id) => {
    const node = byId(id);
    if (node) observer.observe(node, { attributes: true, childList: true, subtree: true, characterData: true });
  });

  button.addEventListener('click', (event) => {
    if (showMissingTitle()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      syncPublishButton();
      return;
    }
    const build = byId('build-status');
    const label = byId('build-label');
    if (build) build.dataset.state = 'processing';
    if (label) label.textContent = 'Iniciando publicación…';
  }, { capture: true });

  form.addEventListener('submit', (event) => {
    if (showMissingTitle()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      syncPublishButton();
    }
  }, { capture: true });

  syncPublishButton();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
