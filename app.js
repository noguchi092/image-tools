(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const refs = { input: $('file-input'), drop: $('drop-zone'), area: $('file-area'), list: $('file-list'), count: $('file-count'), format: $('format'), quality: $('quality'), qualityValue: $('quality-value'), width: $('max-width'), height: $('max-height'), cropOn: $('crop-enabled'), cropBox: $('crop-box'), frame: $('preview-frame'), preview: $('preview-image'), empty: $('preview-empty'), name: $('preview-name'), info: $('preview-info'), status: $('status'), button: $('process-files'), results: $('results') };
  const items = [];
  let selected = 0, rotation = 0, flipX = false, flipY = false;
  let crop = { x: .08, y: .08, w: .84, h: .84 };
  let outputUrls = [];
  let busy = false;
  const mime = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const isHeic = (file) => /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
  const supported = (file) => isHeic(file) || /^image\/(jpeg|png|webp)$/i.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
  const byteSize = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  function status(message, error = false) { refs.status.textContent = message; refs.status.style.color = error ? '#ac3e35' : ''; }
  function revokeOutputs() { outputUrls.forEach(URL.revokeObjectURL); outputUrls = []; refs.results.hidden = true; refs.results.replaceChildren(); }
  function decodeImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像を読み込めませんでした。')); };
      img.src = url;
    });
  }
  async function sourceFor(item) {
    if (item.source) return item.source;
    if (isHeic(item.file)) {
      if (typeof window.heic2any !== 'function') throw new Error('HEIC変換の準備ができませんでした。ページを再読み込みしてください。');
      const converted = await window.heic2any({ blob: item.file, toType: 'image/png' });
      item.source = Array.isArray(converted) ? converted[0] : converted;
    } else item.source = item.file;
    return item.source;
  }
  function renderList() {
    refs.area.hidden = items.length === 0;
    refs.count.textContent = `${items.length}枚`;
    refs.button.disabled = !items.length || busy;
    refs.list.replaceChildren();
    items.forEach((item, index) => {
      const card = document.createElement('button');
      card.type = 'button'; card.className = `file-item${selected === index ? ' selected' : ''}${item.error ? ' error' : ''}`;
      const thumb = document.createElement('img'); thumb.alt = ''; thumb.src = item.thumb || '';
      const name = document.createElement('strong'); name.textContent = item.file.name;
      const size = document.createElement('small'); size.textContent = item.error ? item.error : byteSize(item.file.size);
      card.append(thumb, name, size); card.addEventListener('click', () => { selected = index; renderList(); renderPreview(); });
      refs.list.append(card);
    });
  }
  async function addFiles(files) {
    const incoming = [...files];
    const valid = incoming.filter(supported);
    if (valid.length !== incoming.length) status(`${incoming.length - valid.length}件の未対応ファイルを除外しました。`, true);
    if (!valid.length) return;
    revokeOutputs();
    const start = items.length;
    valid.forEach(file => items.push({ file, source: null, thumb: null, error: null }));
    if (start === 0) selected = 0;
    renderList();
    await renderPreview();
    for (let i = start; i < items.length; i++) {
      const item = items[i];
      try {
        const img = await decodeImage(await sourceFor(item));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth / Math.max(1, img.naturalWidth / 160, img.naturalHeight / 100)));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * canvas.width / img.naturalWidth));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        item.thumb = canvas.toDataURL('image/jpeg', .65);
      } catch (err) { item.error = err.message || '読み込みに失敗しました'; }
      renderList();
    }
    status(`${valid.length}枚の画像を追加しました。`);
  }
  async function renderPreview() {
    const item = items[selected];
    if (!item) { refs.frame.hidden = true; refs.empty.hidden = false; refs.name.textContent = '画像を選ぶと表示されます'; refs.info.textContent = '複数画像もまとめて編集できます。'; return; }
    refs.name.textContent = item.file.name;
    const index = selected;
    try {
      const source = await sourceFor(item);
      const img = await decodeImage(source);
      if (index !== selected || items[index] !== item) return;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      refs.preview.src = canvas.toDataURL('image/png');
      refs.preview.onload = () => { if (items[selected] === item) updateCropBox(); };
      refs.frame.hidden = false; refs.empty.hidden = true;
      refs.info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${byteSize(item.file.size)}${rotation || flipX || flipY ? ` · 出力時に${rotation}°回転／反転を適用` : ''}`;
    } catch (err) { refs.frame.hidden = true; refs.empty.hidden = false; refs.empty.textContent = err.message; refs.info.textContent = '別の画像を選択してください。'; }
  }
  function updateCropBox() {
    refs.cropBox.hidden = !refs.cropOn.checked || refs.frame.hidden;
    if (refs.cropBox.hidden) return;
    Object.assign(refs.cropBox.style, { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` });
  }
  let drag = null;
  refs.cropBox.addEventListener('pointerdown', event => {
    const rect = refs.frame.getBoundingClientRect();
    drag = { handle: event.target.dataset.handle || 'move', startX: event.clientX, startY: event.clientY, initial: { ...crop }, width: rect.width, height: rect.height };
    refs.cropBox.setPointerCapture(event.pointerId); event.preventDefault();
  });
  refs.cropBox.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.width, dy = (event.clientY - drag.startY) / drag.height;
    const c = drag.initial;
    if (drag.handle === 'move') { crop.x = clamp(c.x + dx, 0, 1 - c.w); crop.y = clamp(c.y + dy, 0, 1 - c.h); }
    else {
      const left = drag.handle.includes('w') ? clamp(c.x + dx, 0, c.x + c.w - .02) : c.x;
      const top = drag.handle.includes('n') ? clamp(c.y + dy, 0, c.y + c.h - .02) : c.y;
      const right = drag.handle.includes('e') ? clamp(c.x + c.w + dx, c.x + .02, 1) : c.x + c.w;
      const bottom = drag.handle.includes('s') ? clamp(c.y + c.h + dy, c.y + .02, 1) : c.y + c.h;
      crop = { x: left, y: top, w: right - left, h: bottom - top };
    }
    updateCropBox();
  });
  refs.cropBox.addEventListener('pointerup', () => { drag = null; });
  refs.cropBox.addEventListener('pointercancel', () => { drag = null; });
  function dimension(field) { const raw = field.value.trim(); if (!raw) return null; const n = Number(raw); if (!Number.isInteger(n) || n < 1 || n > 30000) throw new Error('最大幅・高さは1～30000の整数で入力してください。'); return n; }
  async function convert(item) {
    const img = await decodeImage(await sourceFor(item));
    const sx = refs.cropOn.checked ? Math.floor(img.naturalWidth * crop.x) : 0;
    const sy = refs.cropOn.checked ? Math.floor(img.naturalHeight * crop.y) : 0;
    const sw = refs.cropOn.checked ? Math.max(1, Math.min(img.naturalWidth - sx, Math.round(img.naturalWidth * crop.w))) : img.naturalWidth;
    const sh = refs.cropOn.checked ? Math.max(1, Math.min(img.naturalHeight - sy, Math.round(img.naturalHeight * crop.h))) : img.naturalHeight;
    const maxW = dimension(refs.width), maxH = dimension(refs.height);
    const factor = Math.min(1, maxW ? maxW / sw : 1, maxH ? maxH / sh : 1);
    const w = Math.max(1, Math.round(sw * factor)), h = Math.max(1, Math.round(sh * factor));
    const turned = rotation % 180 !== 0;
    const canvas = document.createElement('canvas'); canvas.width = turned ? h : w; canvas.height = turned ? w : h;
    if (canvas.width * canvas.height > 50000000) throw new Error('画像が大きすぎます。最大幅・高さを小さくしてください。');
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('画像処理を開始できませんでした。');
    if (refs.format.value === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(rotation * Math.PI / 180);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
    const type = refs.format.value;
    const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('このブラウザでは画像を書き出せません。')), type, Number(refs.quality.value) / 100));
    if (blob.type !== type) throw new Error('選択した保存形式にこのブラウザが対応していません。');
    return blob;
  }
  function crc32(data) { let crc = -1; for (const b of data) { crc ^= b; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
  function zipFiles(entries) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    const u16 = (view, at, val) => view.setUint16(at, val, true), u32 = (view, at, val) => view.setUint32(at, val, true);
    for (const { name, bytes } of entries) {
      const filename = enc.encode(name), crc = crc32(bytes);
      const local = new Uint8Array(30 + filename.length), l = new DataView(local.buffer);
      u32(l, 0, 0x04034b50); u16(l, 4, 20); u16(l, 6, 0x0800); u32(l, 14, crc); u32(l, 18, bytes.length); u32(l, 22, bytes.length); u16(l, 26, filename.length); local.set(filename, 30);
      parts.push(local, bytes);
      const dir = new Uint8Array(46 + filename.length), d = new DataView(dir.buffer);
      u32(d, 0, 0x02014b50); u16(d, 4, 20); u16(d, 6, 20); u16(d, 8, 0x0800); u32(d, 16, crc); u32(d, 20, bytes.length); u32(d, 24, bytes.length); u16(d, 28, filename.length); u32(d, 42, offset); dir.set(filename, 46); central.push(dir);
      offset += local.length + bytes.length;
    }
    const centralSize = central.reduce((sum, p) => sum + p.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    u32(e, 0, 0x06054b50); u16(e, 8, entries.length); u16(e, 10, entries.length); u32(e, 12, centralSize); u32(e, 16, offset);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  function downloadLink(blob, name, label) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); outputUrls.push(a.href); a.download = name; a.textContent = label; return a; }
  async function process() {
    if (!items.length || busy) return;
    try { dimension(refs.width); dimension(refs.height); } catch (err) { status(err.message, true); return; }
    busy = true; refs.button.disabled = true; revokeOutputs();
    const completed = [], failures = [], names = new Set();
    for (let i = 0; i < items.length; i++) {
      const item = items[i]; status(`${i + 1} / ${items.length} 枚を処理中…`);
      await new Promise(resolve => setTimeout(resolve, 0));
      try {
        const blob = await convert(item);
        let base = item.file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'image';
        let filename = `${base}.${mime[refs.format.value]}`, suffix = 2;
        while (names.has(filename.toLowerCase())) filename = `${base}-${suffix++}.${mime[refs.format.value]}`;
        names.add(filename.toLowerCase()); completed.push({ name: filename, blob });
      } catch (err) { failures.push(`${item.file.name}: ${err.message || '処理に失敗しました'}`); }
    }
    if (completed.length) {
      refs.results.hidden = false;
      const heading = document.createElement('h3'); heading.textContent = `${completed.length}枚の処理が完了しました`; refs.results.append(heading);
      if (completed.length > 1) {
        try {
          const buffers = [];
          for (const item of completed) buffers.push({ name: item.name, bytes: new Uint8Array(await item.blob.arrayBuffer()) });
          refs.results.append(downloadLink(zipFiles(buffers), 'image-tools.zip', 'すべてZIPで保存 ↓'));
        } catch (err) { failures.push(`ZIPの作成: ${err.message}`); }
      }
      for (const item of completed) refs.results.append(downloadLink(item.blob, item.name, `${item.name} (${byteSize(item.blob.size)}) ↓`));
    }
    if (failures.length) { const p = document.createElement('p'); p.textContent = failures.join(' ／ '); refs.results.hidden = false; refs.results.append(p); }
    status(`${completed.length}枚を処理しました${failures.length ? `。${failures.length}枚でエラー` : '。保存リンクを押してください。'}`, !!failures.length);
    busy = false; refs.button.disabled = !items.length;
  }
  refs.drop.addEventListener('click', () => refs.input.click());
  refs.drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); refs.input.click(); } });
  refs.input.addEventListener('change', async () => { await addFiles(refs.input.files); refs.input.value = ''; });
  $('add-files').addEventListener('click', () => refs.input.click());
  $('clear-files').addEventListener('click', () => { items.length = 0; selected = 0; revokeOutputs(); renderList(); renderPreview(); status('画像を選択してください。'); });
  ['dragenter', 'dragover'].forEach(type => refs.drop.addEventListener(type, event => { event.preventDefault(); refs.drop.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(type => refs.drop.addEventListener(type, event => { event.preventDefault(); refs.drop.classList.remove('drag-over'); }));
  refs.drop.addEventListener('drop', event => addFiles(event.dataTransfer.files));
  refs.quality.addEventListener('input', () => { refs.qualityValue.value = `${refs.quality.value}%`; });
  refs.format.addEventListener('change', () => { refs.quality.disabled = refs.format.value === 'image/png'; });
  refs.cropOn.addEventListener('change', updateCropBox);
  $('reset-crop').addEventListener('click', () => { crop = { x: .08, y: .08, w: .84, h: .84 }; updateCropBox(); });
  $('rotate-left').addEventListener('click', () => { rotation = (rotation + 270) % 360; renderPreview(); });
  $('rotate-right').addEventListener('click', () => { rotation = (rotation + 90) % 360; renderPreview(); });
  $('flip-x').addEventListener('click', () => { flipX = !flipX; renderPreview(); });
  $('flip-y').addEventListener('click', () => { flipY = !flipY; renderPreview(); });
  $('reset-transform').addEventListener('click', () => { rotation = 0; flipX = flipY = false; renderPreview(); });
  refs.button.addEventListener('click', process);
})();
