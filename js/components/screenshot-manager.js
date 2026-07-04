// ============================================================================
// Screenshot Manager — mounts into a container element for a given trade.
// Supports: unlimited screenshots, drag & drop, clipboard paste, an upload
// button, captions, reordering (up/down), fullscreen zoom with rotate,
// replace, and delete. Images are compressed client-side before upload and
// served back only to their owner via an authenticated blob fetch.
// ============================================================================

import { api } from '../api.js';
import { compressImage, rotateImageBlob, fetchAuthenticatedImage } from '../lib/image-utils.js';

// Only one screenshot manager (and therefore one paste listener) should be
// active at a time — the trade modal is reused across opens rather than
// recreated, so without this, every re-open would stack another listener
// and pasting an image would upload it multiple times.
let activePasteHandler = null;

export function mountScreenshotManager(container, tradeId) {
  if (activePasteHandler) {
    document.removeEventListener('paste', activePasteHandler);
    activePasteHandler = null;
  }

  let screenshots = [];
  const blobUrlCache = new Map(); // screenshot id -> object URL, so we don't re-fetch on every render

  container.innerHTML = `
    <div class="shot-dropzone" id="shotDropzone" tabindex="0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
      <div>Drag &amp; drop, <strong>paste</strong> from clipboard, or <u>click to upload</u></div>
    </div>
    <input type="file" id="shotFileInput" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
    <div class="shot-grid" id="shotGrid"></div>
  `;

  const dropzone = container.querySelector('#shotDropzone');
  const fileInput = container.querySelector('#shotFileInput');
  const grid = container.querySelector('#shotGrid');

  // ---- Upload plumbing ----
  async function uploadFiles(files) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const placeholder = document.createElement('div');
      placeholder.className = 'shot-thumb shot-uploading';
      placeholder.textContent = 'Uploading…';
      grid.prepend(placeholder);

      try {
        const { blob, width, height } = await compressImage(file);
        const formData = new FormData();
        formData.append('file', blob, file.name.replace(/\.[^.]+$/, '') + '.jpg');
        formData.append('trade_id', tradeId);
        formData.append('filename', file.name);
        formData.append('width', width);
        formData.append('height', height);
        formData.append('sort_order', screenshots.length);

        const { screenshot } = await api.uploadScreenshot(formData);
        screenshots.push(screenshot);
      } catch (err) {
        console.error('Screenshot upload failed:', err);
        alert('Could not upload that image. ' + (err.message || ''));
      } finally {
        placeholder.remove();
      }
    }
    await render();
  }

  fileInput.addEventListener('change', (e) => uploadFiles(e.target.files).then(() => { fileInput.value = ''; }));
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  // Clipboard paste — scoped to this container's lifetime via a document listener,
  // but only acts while this modal/section is actually in the DOM.
  function pasteHandler(e) {
    if (!document.body.contains(container) || container.offsetParent === null) {
      document.removeEventListener('paste', pasteHandler);
      if (activePasteHandler === pasteHandler) activePasteHandler = null;
      return;
    }
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((i) => i.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    uploadFiles(imageItems.map((i) => i.getAsFile()).filter(Boolean));
  }
  activePasteHandler = pasteHandler;
  document.addEventListener('paste', pasteHandler);

  // ---- Rendering ----
  async function render() {
    const { screenshots: rows } = await api.listScreenshots(tradeId);
    screenshots = rows.sort((a, b) => a.sort_order - b.sort_order);
    grid.innerHTML = '';

    for (const [index, shot] of screenshots.entries()) {
      const thumb = document.createElement('div');
      thumb.className = 'shot-thumb';
      thumb.innerHTML = `
        <div class="shot-uploading">Loading…</div>
        <div class="shot-actions">
          <div class="shot-mini-btn" data-action="up" title="Move earlier">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </div>
          <div class="shot-mini-btn" data-action="down" title="Move later">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          </div>
          <div class="shot-mini-btn danger" data-action="delete" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </div>
        </div>
        ${shot.caption ? `<div class="shot-caption">${escapeHtml(shot.caption)}</div>` : ''}
      `;
      thumb.dataset.id = shot.id;
      grid.appendChild(thumb);

      loadThumbImage(shot.id, thumb);

      thumb.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        openLightbox(index);
      });
      thumb.querySelector('[data-action="up"]').addEventListener('click', (e) => { e.stopPropagation(); reorder(index, -1); });
      thumb.querySelector('[data-action="down"]').addEventListener('click', (e) => { e.stopPropagation(); reorder(index, 1); });
      thumb.querySelector('[data-action="delete"]').addEventListener('click', (e) => { e.stopPropagation(); removeShot(shot.id); });
    }
  }

  async function loadThumbImage(id, thumbEl) {
    try {
      let url = blobUrlCache.get(id);
      if (!url) {
        url = await fetchAuthenticatedImage(id);
        blobUrlCache.set(id, url);
      }
      const img = document.createElement('img');
      img.src = url;
      thumbEl.querySelector('.shot-uploading')?.replaceWith(img);
    } catch (err) {
      console.error('Failed to load screenshot', id, err);
    }
  }

  async function reorder(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= screenshots.length) return;
    const a = screenshots[index];
    const b = screenshots[target];
    await Promise.all([
      api.updateScreenshot(a.id, { sort_order: b.sort_order }),
      api.updateScreenshot(b.id, { sort_order: a.sort_order }),
    ]);
    await render();
  }

  async function removeShot(id) {
    if (!confirm('Delete this screenshot? This cannot be undone.')) return;
    await api.deleteScreenshot(id);
    const url = blobUrlCache.get(id);
    if (url) { URL.revokeObjectURL(url); blobUrlCache.delete(id); }
    await render();
  }

  // ---- Lightbox (fullscreen, zoom, rotate, caption edit, replace) ----
  let lightbox = document.getElementById('shotLightboxOverlay');
  if (!lightbox) {
    document.body.insertAdjacentHTML('beforeend', `
      <div class="shot-lightbox-overlay hidden" id="shotLightboxOverlay">
        <div class="shot-lightbox-close" id="shotLightboxClose">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="26" height="26"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <img class="shot-lightbox-img" id="shotLightboxImg">
        <input class="shot-lightbox-caption-input" id="shotLightboxCaption" placeholder="Add a caption…">
        <div class="shot-lightbox-controls">
          <button class="btn-ghost" id="shotZoomIn" type="button">Zoom +</button>
          <button class="btn-ghost" id="shotZoomOut" type="button">Zoom −</button>
          <button class="btn-ghost" id="shotRotate" type="button">Rotate</button>
          <button class="btn-ghost" id="shotReplace" type="button">Replace</button>
          <button class="btn-primary" id="shotSaveCaption" type="button">Save Caption</button>
        </div>
      </div>
    `);
    lightbox = document.getElementById('shotLightboxOverlay');
  }

  let currentIndex = null;
  let zoomLevel = 1;

  function openLightbox(index) {
    currentIndex = index;
    zoomLevel = 1;
    const shot = screenshots[index];
    const img = document.getElementById('shotLightboxImg');
    img.style.transform = 'scale(1)';
    img.src = blobUrlCache.get(shot.id) || '';
    document.getElementById('shotLightboxCaption').value = shot.caption || '';
    lightbox.classList.remove('hidden');
  }
  function closeLightbox() { lightbox.classList.add('hidden'); currentIndex = null; }

  document.getElementById('shotLightboxClose').onclick = closeLightbox;
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

  document.getElementById('shotZoomIn').onclick = () => {
    zoomLevel = Math.min(3, zoomLevel + 0.25);
    document.getElementById('shotLightboxImg').style.transform = `scale(${zoomLevel})`;
  };
  document.getElementById('shotZoomOut').onclick = () => {
    zoomLevel = Math.max(0.5, zoomLevel - 0.25);
    document.getElementById('shotLightboxImg').style.transform = `scale(${zoomLevel})`;
  };

  document.getElementById('shotSaveCaption').onclick = async () => {
    if (currentIndex === null) return;
    const shot = screenshots[currentIndex];
    const caption = document.getElementById('shotLightboxCaption').value;
    await api.updateScreenshot(shot.id, { caption });
    closeLightbox();
    await render();
  };

  document.getElementById('shotRotate').onclick = async () => {
    if (currentIndex === null) return;
    const shot = screenshots[currentIndex];
    const img = document.getElementById('shotLightboxImg');
    try {
      const response = await fetch(img.src);
      const originalBlob = await response.blob();
      const { blob, width, height } = await rotateImageBlob(originalBlob);
      const formData = new FormData();
      formData.append('file', blob, 'rotated.jpg');
      formData.append('width', width);
      formData.append('height', height);
      await api.replaceScreenshotFile(shot.id, formData);
      const oldUrl = blobUrlCache.get(shot.id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      blobUrlCache.delete(shot.id);
      const newUrl = await fetchAuthenticatedImage(shot.id);
      blobUrlCache.set(shot.id, newUrl);
      img.src = newUrl;
      await render();
    } catch (err) {
      console.error('Rotate failed:', err);
      alert('Could not rotate this image.');
    }
  };

  document.getElementById('shotReplace').onclick = () => {
    if (currentIndex === null) return;
    const shot = screenshots[currentIndex];
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/png,image/jpeg,image/webp';
    picker.onchange = async () => {
      const file = picker.files[0];
      if (!file) return;
      try {
        const { blob, width, height } = await compressImage(file);
        const formData = new FormData();
        formData.append('file', blob, 'replacement.jpg');
        formData.append('width', width);
        formData.append('height', height);
        await api.replaceScreenshotFile(shot.id, formData);
        const oldUrl = blobUrlCache.get(shot.id);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        blobUrlCache.delete(shot.id);
        closeLightbox();
        await render();
      } catch (err) {
        console.error('Replace failed:', err);
        alert('Could not replace this image.');
      }
    };
    picker.click();
  };

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  render();
}
