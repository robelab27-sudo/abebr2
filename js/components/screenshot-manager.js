// ============================================================================
// Screenshot Manager — mounts into a container element, scoped to either a
// trade or a journal entry (optionally further tagged with a category like
// 'pre_trade' / 'during_trade' / 'post_trade'). Supports: unlimited
// screenshots, drag & drop, clipboard paste, an upload button, captions,
// reordering, fullscreen zoom with rotate/replace, and delete.
//
// Multiple instances can be mounted on the same page at once (e.g. three
// side-by-side sections in the Journal editor). Two things are shared
// across instances rather than duplicated per-mount:
//   1. The paste listener — only one is ever registered; pastes are routed
//      to whichever instance was most recently focused/hovered.
//   2. The fullscreen lightbox — one DOM node, reused by whichever instance
//      opened it (tracked via `activeLightboxContext`).
// ============================================================================

import { api } from '../api.js';
import { compressImage, rotateImageBlob, fetchAuthenticatedImage } from '../lib/image-utils.js';

const instances = new Set(); // { container, uploadFiles }
let lastActiveInstance = null;
let pasteListenerAttached = false;

function ensurePasteListener() {
  if (pasteListenerAttached) return;
  pasteListenerAttached = true;
  document.addEventListener('paste', (e) => {
    for (const inst of [...instances]) {
      if (!document.body.contains(inst.container)) instances.delete(inst);
    }
    const target = (lastActiveInstance && instances.has(lastActiveInstance)) ? lastActiveInstance : [...instances].pop();
    if (!target) return;

    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((i) => i.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    target.uploadFiles(imageItems.map((i) => i.getAsFile()).filter(Boolean));
  });
}

// ---------------------------------------------------------------------------
// Shared fullscreen lightbox (one DOM instance, rebindable "active context")
// ---------------------------------------------------------------------------
let activeLightboxContext = null; // { screenshots, index, blobUrlCache, onChanged }

function ensureLightbox() {
  let lightbox = document.getElementById('shotLightboxOverlay');
  if (lightbox) return lightbox;

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

  let zoomLevel = 1;
  const img = () => document.getElementById('shotLightboxImg');
  const closeLightbox = () => { lightbox.classList.add('hidden'); activeLightboxContext = null; };

  document.getElementById('shotLightboxClose').onclick = closeLightbox;
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

  document.getElementById('shotZoomIn').onclick = () => { zoomLevel = Math.min(3, zoomLevel + 0.25); img().style.transform = `scale(${zoomLevel})`; };
  document.getElementById('shotZoomOut').onclick = () => { zoomLevel = Math.max(0.5, zoomLevel - 0.25); img().style.transform = `scale(${zoomLevel})`; };

  document.getElementById('shotSaveCaption').onclick = async () => {
    if (!activeLightboxContext) return;
    const { screenshots, index, onChanged } = activeLightboxContext;
    const caption = document.getElementById('shotLightboxCaption').value;
    await api.updateScreenshot(screenshots[index].id, { caption });
    closeLightbox();
    await onChanged();
  };

  document.getElementById('shotRotate').onclick = async () => {
    if (!activeLightboxContext) return;
    const { screenshots, index, blobUrlCache, onChanged } = activeLightboxContext;
    const shot = screenshots[index];
    try {
      const response = await fetch(img().src);
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
      img().src = newUrl;
      await onChanged();
    } catch (err) {
      console.error('Rotate failed:', err);
      alert('Could not rotate this image.');
    }
  };

  document.getElementById('shotReplace').onclick = () => {
    if (!activeLightboxContext) return;
    const { screenshots, index, blobUrlCache, onChanged } = activeLightboxContext;
    const shot = screenshots[index];
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
        await onChanged();
      } catch (err) {
        console.error('Replace failed:', err);
        alert('Could not replace this image.');
      }
    };
    picker.click();
  };

  return lightbox;
}

function openLightbox(context) {
  const lightbox = ensureLightbox();
  activeLightboxContext = context;
  const { screenshots, index, blobUrlCache } = context;
  const shot = screenshots[index];

  const img = document.getElementById('shotLightboxImg');
  img.style.transform = 'scale(1)';
  img.src = blobUrlCache.get(shot.id) || '';
  document.getElementById('shotLightboxCaption').value = shot.caption || '';
  lightbox.classList.remove('hidden');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container - where the widget renders.
 * @param {object} options
 * @param {string} [options.tradeId] - attach uploads to this trade.
 * @param {string} [options.journalEntryId] - attach uploads to this journal entry.
 * @param {string} [options.category] - 'general' | 'pre_trade' | 'during_trade' | 'post_trade'.
 */
export function mountScreenshotManager(container, options = {}) {
  const { tradeId = null, journalEntryId = null, category = 'general' } = options;

  let screenshots = [];
  const blobUrlCache = new Map();

  container.innerHTML = `
    <div class="shot-dropzone" tabindex="0">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
      <div>Drag &amp; drop, <strong>paste</strong>, or <u>click to upload</u></div>
    </div>
    <input type="file" accept="image/png,image/jpeg,image/webp" multiple style="display:none;">
    <div class="shot-grid"></div>
  `;

  const dropzone = container.querySelector('.shot-dropzone');
  const fileInput = container.querySelector('input[type="file"]');
  const grid = container.querySelector('.shot-grid');

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
        if (tradeId) formData.append('trade_id', tradeId);
        if (journalEntryId) formData.append('journal_entry_id', journalEntryId);
        formData.append('category', category);
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

  const instance = { container, uploadFiles };
  instances.add(instance);
  ensurePasteListener();

  const markActive = () => { lastActiveInstance = instance; };
  container.addEventListener('mouseenter', markActive);
  container.addEventListener('focusin', markActive);
  container.addEventListener('click', markActive);

  fileInput.addEventListener('change', (e) => uploadFiles(e.target.files).then(() => { fileInput.value = ''; }));
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    markActive();
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  async function render() {
    const { screenshots: rows } = await api.listScreenshots({ tradeId, journalEntryId, category });
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
      grid.appendChild(thumb);
      loadThumbImage(shot.id, thumb);

      thumb.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        openLightbox({ screenshots, index, blobUrlCache, onChanged: render });
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

  render();
}
