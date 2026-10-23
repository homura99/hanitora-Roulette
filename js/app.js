'use strict';

const COLORS = [
  '#f87171',
  '#fb923c',
  '#fbbf24',
  '#a3e635',
  '#34d399',
  '#2dd4bf',
  '#38bdf8',
  '#60a5fa',
  '#818cf8',
  '#c084fc',
  '#f472b6',
  '#fb7185'
];

const MAX_BULK_FILES = 5;
const MAX_ITEMS = 20;

const AUDIO_TYPES = {
  mp3: ['audio/mpeg', 'audio/mp3'],
  wav: ['audio/wav', 'audio/x-wav', 'audio/wave'],
  ogg: ['audio/ogg', 'application/ogg'],
  m4a: ['audio/mp4', 'audio/x-m4a'],
  aac: ['audio/aac', 'audio/x-aac'],
  webm: ['audio/webm'],
  flac: ['audio/flac', 'audio/x-flac']
};

let items = [];
let pendingBulkFiles = [];
let spinning = false;
let processing = false;
let currentAudio = null;
let currentAudioUrl = null;
let angle = 0;

const $ = id => document.getElementById(id);
const canvas = $('wheel');
const context = canvas.getContext('2d');

function createId() {
  const randomId = window.crypto && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

  return `item_${randomId}`;
}

function showNotice(message, kind = '') {
  const notice = $('notice');
  notice.textContent = message;
  notice.className = kind;
}

function normalizeName(value) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja');
}

function validateAudioFile(file) {
  const extension = file.name.includes('.')
    ? file.name.split('.').pop().toLowerCase()
    : '';
  const acceptedTypes = AUDIO_TYPES[extension];
  const mimeType = (file.type || '').toLowerCase();

  if (!acceptedTypes || !acceptedTypes.includes(mimeType)) {
    throw new Error(`${file.name}: 拡張子とMIMEタイプの組み合わせに対応していません。`);
  }
  if (file.size <= 0) {
    throw new Error(`${file.name}: 空の音声ファイルは使用できません。`);
  }
}

function drawWheel() {
  const count = Math.max(items.length, 1);
  const center = 400;
  const radius = 370;

  context.clearRect(0, 0, 800, 800);
  context.save();
  context.translate(center, center);
  context.rotate(angle);

  if (items.length === 0) {
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = '#e8ebf4';
    context.fill();
    context.fillStyle = '#697386';
    context.font = 'bold 30px sans-serif';
    context.textAlign = 'center';
    context.fillText('項目を追加してください', 0, 10);
    context.restore();
    return;
  }

  const slice = Math.PI * 2 / count;

  items.forEach((item, index) => {
    const start = -Math.PI / 2 + index * slice;

    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, radius, start, start + slice);
    context.closePath();
    context.fillStyle = COLORS[index % COLORS.length];
    context.fill();
    context.strokeStyle = '#fff';
    context.lineWidth = 4;
    context.stroke();

    context.save();
    context.rotate(start + slice / 2);
    context.textAlign = 'right';
    context.fillStyle = '#172033';
    context.font = `700 ${count > 12 ? 17 : count > 8 ? 20 : 24}px system-ui,sans-serif`;

    let label = item.text;
    while (context.measureText(label).width > radius * 0.68 && label.length > 4) {
      label = `${label.slice(0, -2)}…`;
    }

    context.fillText(label, radius - 28, 8);
    context.restore();
  });

  context.beginPath();
  context.arc(0, 0, 48, 0, Math.PI * 2);
  context.fillStyle = '#fff';
  context.fill();
  context.strokeStyle = '#d6dbea';
  context.lineWidth = 5;
  context.stroke();
  context.restore();
}

function createButton(label, action, className = '', disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  button.disabled = processing || disabled;
  button.addEventListener('click', action);
  return button;
}

function renderItems() {
  const root = $('itemsList');
  root.replaceChildren();

  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'item';

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = COLORS[index % COLORS.length];

    const content = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.text;

    const subtitle = document.createElement('div');
    subtitle.className = 'item-sub';
    subtitle.textContent = item.file ? `音声あり：${item.file.name}` : '音声なし';
    content.append(name, subtitle);

    const buttons = document.createElement('div');
    buttons.className = 'item-buttons';
    buttons.append(
      createButton('試聴', () => previewFile(item.file), '', !item.file),
      createButton('音声解除', () => clearItemAudio(item.id), '', !item.file),
      createButton('編集', () => editItem(item.id)),
      createButton('削除', () => deleteItem(item.id), 'danger')
    );

    row.append(dot, content, buttons);
    root.append(row);
  });

  drawWheel();
  $('spinBtn').disabled = items.length < 2 || processing;
  $('stopAudioBtn').disabled = !currentAudio;
  $('bulkApplyBtn').disabled = pendingBulkFiles.length === 0 || processing;
}

function resetForm() {
  $('itemForm').reset();
  $('editId').value = '';
  $('saveItemBtn').textContent = '項目を追加';
  $('audioHint').textContent = 'MP3 / WAV / OGG / M4A / AAC / WebM / FLAC（当選時にこのブラウザーで再生）';
}

function editItem(id) {
  const item = items.find(entry => entry.id === id);
  if (!item || processing) return;

  $('editId').value = id;
  $('itemText').value = item.text;
  $('audioFile').value = '';
  $('audioHint').textContent = item.file
    ? `現在の音声：${item.file.name}（ファイル選択で差し替え）`
    : '音声は未設定';
  $('saveItemBtn').textContent = '変更を適用';
  $('itemText').focus();
}

function deleteItem(id) {
  const item = items.find(entry => entry.id === id);
  if (!item || processing) return;
  if (!confirm(`「${item.text}」を削除しますか？`)) return;

  items = items.filter(entry => entry.id !== id);
  renderItems();
  renderBulkFiles();
  showNotice('項目を削除しました。');
}

function clearItemAudio(id) {
  const item = items.find(entry => entry.id === id);
  if (!item || processing) return;

  item.file = null;
  renderItems();
  showNotice('項目の音声を解除しました。');
}

function previewFile(file) {
  if (!file) {
    showNotice('この項目には音声が設定されていません。', 'error');
    return;
  }

  playFile(file).catch(error => {
    showNotice(`音声を再生できませんでした：${error.message}`, 'error');
  });
}

$('itemForm').addEventListener('submit', event => {
  event.preventDefault();
  if (processing) return;

  const text = $('itemText').value.trim();
  const id = $('editId').value;
  const selectedFile = $('audioFile').files[0] || null;
  if (!text) return;

  try {
    if (selectedFile) validateAudioFile(selectedFile);
  } catch (error) {
    showNotice(error.message, 'error');
    return;
  }

  if (id) {
    const item = items.find(entry => entry.id === id);
    if (!item) return;

    item.text = text;
    if (selectedFile) item.file = selectedFile;
  } else {
    if (items.length >= MAX_ITEMS) {
      showNotice(`項目は最大${MAX_ITEMS}件まで登録できます。`, 'error');
      return;
    }

    items.push({ id: createId(), text, file: selectedFile });
  }

  resetForm();
  renderItems();
  renderBulkFiles();
  showNotice('項目を更新しました。');
});

$('cancelEditBtn').addEventListener('click', resetForm);

function collectBulkFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length > MAX_BULK_FILES) {
    showNotice('一括登録は1回につき最大5ファイルです。', 'error');
    return;
  }

  try {
    files.forEach(validateAudioFile);
  } catch (error) {
    showNotice(error.message, 'error');
    return;
  }

  pendingBulkFiles = files.map(file => {
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const match = items.find(item => normalizeName(item.text) === normalizeName(baseName));
    return { file, targetId: match ? match.id : '__new__' };
  });

  renderBulkFiles();
  showNotice(`${files.length}件を確認してください。割り当ては登録前に変更できます。`);
}

$('bulkFiles').addEventListener('change', event => {
  collectBulkFiles(event.target.files);
});

const dropZone = $('dropZone');
dropZone.addEventListener('dragover', event => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  collectBulkFiles(event.dataTransfer.files);
});

function renderBulkFiles() {
  const root = $('bulkList');
  root.replaceChildren();

  pendingBulkFiles.forEach(entry => {
    if (
      entry.targetId !== '__new__' &&
      !items.some(item => item.id === entry.targetId)
    ) {
      entry.targetId = '__new__';
    }

    const row = document.createElement('div');
    row.className = 'bulk-file';

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = `${entry.file.name} (${(entry.file.size / 1024 / 1024).toFixed(2)}MB)`;

    const select = document.createElement('select');
    select.setAttribute('aria-label', `${entry.file.name} の割り当て`);

    const createOption = document.createElement('option');
    createOption.value = '__new__';
    createOption.textContent = `新しい項目「${entry.file.name.replace(/\.[^.]+$/, '')}」`;
    select.append(createOption);

    items.forEach(item => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `既存項目に割り当て：${item.text}`;
      select.append(option);
    });

    select.value = entry.targetId;
    select.addEventListener('change', () => {
      entry.targetId = select.value;
    });

    const preview = createButton('試聴', () => previewFile(entry.file));
    row.append(name, select, preview);
    root.append(row);
  });

  $('bulkApplyBtn').disabled = pendingBulkFiles.length === 0 || processing;
}

$('bulkApplyBtn').addEventListener('click', () => {
  if (processing || pendingBulkFiles.length === 0) return;

  const assignedIds = pendingBulkFiles
    .filter(entry => entry.targetId !== '__new__')
    .map(entry => entry.targetId);

  if (new Set(assignedIds).size !== assignedIds.length) {
    showNotice('同じ項目への重複割り当てがあります。割り当てを変更してください。', 'error');
    return;
  }

  const newItems = pendingBulkFiles.filter(entry => entry.targetId === '__new__');
  if (items.length + newItems.length > MAX_ITEMS) {
    showNotice(`項目は最大${MAX_ITEMS}件まで登録できます。割り当てを変更してください。`, 'error');
    return;
  }

  const replacements = pendingBulkFiles
    .filter(entry => entry.targetId !== '__new__')
    .map(entry => items.find(item => item.id === entry.targetId))
    .filter(item => item && item.file);

  if (
    replacements.length > 0 &&
    !confirm(
      `既存の音声を差し替えます。\n${replacements.map(item => item.text).join('\n')}\n続行しますか？`
    )
  ) {
    return;
  }

  pendingBulkFiles.forEach(entry => {
    const baseName = entry.file.name.replace(/\.[^.]+$/, '').trim() || '音声項目';

    if (entry.targetId === '__new__') {
      items.push({
        id: createId(),
        text: baseName.slice(0, 100),
        file: entry.file
      });
      return;
    }

    const item = items.find(candidate => candidate.id === entry.targetId);
    if (item) item.file = entry.file;
  });

  const count = pendingBulkFiles.length;
  pendingBulkFiles = [];
  $('bulkFiles').value = '';
  renderItems();
  renderBulkFiles();
  showNotice(`${count}件の音声を割り当てました。`);
});

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }

  $('stopAudioBtn').disabled = true;
}

async function playFile(file) {
  stopAudio();
  currentAudioUrl = URL.createObjectURL(file);
  currentAudio = new Audio(currentAudioUrl);

  const audio = currentAudio;
  const audioUrl = currentAudioUrl;

  audio.addEventListener('ended', () => {
    if (currentAudio === audio) {
      stopAudio();
    } else {
      URL.revokeObjectURL(audioUrl);
    }
  }, { once: true });

  audio.addEventListener('error', () => {
    if (currentAudio === audio) stopAudio();
  }, { once: true });

  $('stopAudioBtn').disabled = false;

  try {
    await audio.play();
  } catch (error) {
    if (currentAudio === audio) stopAudio();
    throw error;
  }
}

$('stopAudioBtn').addEventListener('click', () => {
  stopAudio();
  showNotice('音声を停止しました。');
});

function animateSpin(winnerIndex) {
  return new Promise(resolve => {
    spinning = true;

    const count = items.length;
    const slice = Math.PI * 2 / count;
    const stopOffset = Math.random();
    const desired = (
      (-(winnerIndex + stopOffset) * slice) % (Math.PI * 2) + Math.PI * 2
    ) % (Math.PI * 2);
    const start = angle % (Math.PI * 2);
    const remaining = (desired - start + Math.PI * 2) % (Math.PI * 2);
    const turns = Math.ceil((5 + Math.floor(Math.random() * 3)) * 1.1);
    const revolutions = Math.PI * 2 * turns;
    const delta = remaining + revolutions;
    const startedAt = performance.now();
    const duration = 5200;

    function frame(now) {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      angle = start + delta * eased;
      drawWheel();

      if (progress < 1) {
        requestAnimationFrame(frame);
        return;
      }

      angle = desired;
      drawWheel();
      spinning = false;
      resolve();
    }

    requestAnimationFrame(frame);
  });
}

function validateSpin() {
  if (items.length < 2) {
    throw new Error('項目を2件以上登録してください。');
  }

  if (items.some(item => !item.text.trim() || item.text.length > 100)) {
    throw new Error('項目名は1～100文字で入力してください。');
  }

  items.forEach(item => {
    if (item.file) validateAudioFile(item.file);
  });
}

$('spinBtn').addEventListener('click', async () => {
  if (processing || spinning) return;

  try {
    validateSpin();
  } catch (error) {
    showNotice(error.message, 'error');
    return;
  }

  processing = true;
  stopAudio();
  renderItems();
  $('spinBtn').disabled = true;
  $('resultText').textContent = '抽選中…';
  $('resultAudio').textContent = '';
  showNotice('ルーレット回転中…');

  const winnerIndex = Math.floor(Math.random() * items.length);
  const winner = items[winnerIndex];

  try {
    await animateSpin(winnerIndex);
    $('resultText').textContent = winner.text;
    $('resultAudio').textContent = winner.file
      ? `当選項目の音声：${winner.file.name}`
      : 'この項目には音声が設定されていません。';
    showNotice('抽選が完了しました。');

    if (winner.file) {
      try {
        await playFile(winner.file);
      } catch (error) {
        showNotice(`音声の再生に失敗しました：${error.message}`, 'error');
      }
    }
  } catch (error) {
    $('resultText').textContent = '抽選を実行できませんでした';
    showNotice(`抽選に失敗しました：${error.message}`, 'error');
  } finally {
    processing = false;
    renderItems();
  }
});

renderItems();
