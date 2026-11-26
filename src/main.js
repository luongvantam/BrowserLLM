import { renderMarkdown } from './markdown.js';
import './style.css';

const worker = new Worker(new URL('./worker/ai.worker.js', import.meta.url), {
  type: 'module',
});

const SYSTEM_PRESETS = {
  default: 'Bạn là trợ lý AI thông minh, trả lời rõ ràng, chính xác và tự nhiên theo ngôn ngữ của người dùng.',
  code: 'Bạn là kỹ sư phần mềm cao cấp. Hãy phân tích kỹ, viết code sạch, tối ưu, giải thích ngắn gọn và nêu rõ các edge case quan trọng.',
  translate: 'Bạn là biên dịch viên chuyên nghiệp. Hãy dịch tự nhiên, chuẩn ngữ cảnh và giữ nguyên thuật ngữ chuyên môn khi cần thiết.',
  summary: 'Hãy tóm tắt nội dung thành các ý chính ngắn gọn, dễ quét bằng gạch đầu dòng và nêu rõ kết luận quan trọng nhất.',
};

const MAX_FILE_CHARS = 24_000;

const els = {
  layout: document.querySelector('.layout'),
  leftToggleBtn: document.getElementById('left-toggle-btn'),
  leftCloseBtn: document.getElementById('left-close-btn'),
  rightToggleBtn: document.getElementById('right-toggle-btn'),
  rightCloseBtn: document.getElementById('right-close-btn'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  newChatBtn: document.getElementById('new-chat-btn'),
  clearHistoryBtn: document.getElementById('clear-history-btn'),
  chatList: document.getElementById('chat-list'),
  openSettingsBtn: document.getElementById('open-settings-btn'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  settingsModal: document.getElementById('settings-modal'),
  settingsTabs: document.querySelectorAll('.settings-tab'),
  settingsPanels: document.querySelectorAll('.settings-panel'),
  prefFontSize: document.getElementById('pref-font-size'),
  prefDensity: document.getElementById('pref-density'),
  prefShowStarters: document.getElementById('pref-show-starters'),
  userContext: document.getElementById('user-context'),
  modalClearHistoryBtn: document.getElementById('modal-clear-history-btn'),
  userLang: document.getElementById('user-lang'),
  userTone: document.getElementById('user-tone'),
  prefEnterSend: document.getElementById('pref-enter-send'),
  prefShowStats: document.getElementById('pref-show-stats'),
  prefAutoScroll: document.getElementById('pref-auto-scroll'),
  statusDot: document.getElementById('status-dot'),
  capsBadges: document.getElementById('caps-badges'),
  backendSelect: document.getElementById('backend-select'),
  loadBtn: document.getElementById('load-btn'),
  unloadBtn: document.getElementById('unload-btn'),
  backendPill: document.getElementById('backend-pill'),
  progressBanner: document.getElementById('progress-banner'),
  progressLabel: document.getElementById('progress-label'),
  progressNumbers: document.getElementById('progress-numbers'),
  bannerLoadBtn: document.getElementById('banner-load-btn'),
  progressTrack: document.getElementById('progress-track'),
  progressFill: document.getElementById('progress-fill'),
  chatScroll: document.getElementById('chat-scroll'),
  chatMessages: document.getElementById('chat-messages'),
  welcomeScreen: document.getElementById('welcome-screen'),
  systemPrompt: document.getElementById('system-prompt'),
  maxTokens: document.getElementById('max-tokens'),
  maxTokensInput: document.getElementById('max-tokens-input'),
  temperature: document.getElementById('temperature'),
  tempVal: document.getElementById('temp-val'),
  topP: document.getElementById('top-p'),
  topPVal: document.getElementById('top-p-val'),
  topK: document.getElementById('top-k'),
  topKVal: document.getElementById('top-k-val'),
  repPenalty: document.getElementById('rep-penalty'),
  repPenaltyVal: document.getElementById('rep-penalty-val'),
  contextTurns: document.getElementById('context-turns'),
  contextTurnsVal: document.getElementById('context-turns-val'),
  doSample: document.getElementById('do-sample'),
  resetAiSettingsBtn: document.getElementById('reset-ai-settings-btn'),
  attachedFiles: document.getElementById('attached-files'),
  fileInput: document.getElementById('file-input'),
  attachBtn: document.getElementById('attach-btn'),
  chatForm: document.getElementById('chat-form'),
  promptInput: document.getElementById('prompt-input'),
  actionBtn: document.getElementById('action-btn'),
  iconSend: document.getElementById('icon-send'),
  iconStop: document.getElementById('icon-stop'),
  starterCards: document.querySelectorAll('.starter-card'),
};

const state = {
  isReady: false,
  isLoading: false,
  isGenerating: false,
  requestCounter: 0,
  sessions: [],
  activeSessionId: null,
  attachments: [],
  activeAssistantBody: null,
  activeAssistantMeta: null,
  activeAssistantText: '',
  progressHideTimer: null,
};

function createSession() {
  const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const session = { id, title: 'Đoạn chat mới', messages: [] };
  state.sessions.unshift(session);
  state.activeSessionId = id;
  renderSessionList();
  renderCurrentMessages();
}

function getActiveSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId) || null;
}

function renderSessionList() {
  els.chatList.innerHTML = '';
  for (const s of state.sessions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chat-item${s.id === state.activeSessionId ? ' active' : ''}`;
    btn.textContent = s.title;
    btn.addEventListener('click', () => {
      if (state.isGenerating) return;
      state.activeSessionId = s.id;
      renderSessionList();
      renderCurrentMessages();
      els.layout.classList.remove('left-open', 'right-open');
    });
    els.chatList.appendChild(btn);
  }
}

function renderCurrentMessages() {
  const session = getActiveSession();
  els.chatMessages.innerHTML = '';

  if (!session || session.messages.length === 0) {
    els.chatMessages.appendChild(els.welcomeScreen);
    els.welcomeScreen.hidden = false;
    return;
  }

  for (const msg of session.messages) {
    appendMessageNode(msg.role, msg.displayContent ?? msg.content, msg.meta || '', msg.files || []);
  }
  els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
}

function appendMessageNode(role, content, metaText = '', fileNames = []) {
  if (els.welcomeScreen.parentNode === els.chatMessages) {
    els.welcomeScreen.remove();
  }

  const row = document.createElement('div');
  row.className = `msg-row ${role}`;

  if (role === 'user') {
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    if (fileNames.length > 0) {
      const filesTag = document.createElement('div');
      filesTag.className = 'user-files-tag';
      for (const name of fileNames) {
        const pill = document.createElement('span');
        pill.className = 'user-file-pill';
        pill.textContent = `📄 ${name}`;
        filesTag.appendChild(pill);
      }
      bubble.appendChild(filesTag);
    }
    const textNode = document.createElement('div');
    textNode.textContent = content;
    bubble.appendChild(textNode);
    row.appendChild(bubble);
    els.chatMessages.appendChild(row);
    els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
    return { row, body: bubble, meta: null };
  }

  const avatar = document.createElement('div');
  avatar.className = 'assistant-avatar';
  avatar.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2z"/></svg>';

  const contentWrap = document.createElement('div');
  contentWrap.className = 'assistant-content';

  const body = document.createElement('div');
  body.className = 'assistant-body';
  body.innerHTML = content ? renderMarkdown(content) : '<p>Đang suy nghĩ...</p>';

  const meta = document.createElement('div');
  meta.className = 'assistant-meta';
  meta.textContent = els.prefShowStats.checked ? metaText : '';
  meta.hidden = !els.prefShowStats.checked;

  contentWrap.appendChild(body);
  contentWrap.appendChild(meta);
  row.appendChild(avatar);
  row.appendChild(contentWrap);
  els.chatMessages.appendChild(row);
  els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
  return { row, body, meta };
}

function renderAttachments() {
  els.attachedFiles.innerHTML = '';
  if (state.attachments.length === 0) {
    els.attachedFiles.hidden = true;
    return;
  }
  els.attachedFiles.hidden = false;
  state.attachments.forEach((file, idx) => {
    const chip = document.createElement('span');
    chip.className = 'file-chip';
    const label = document.createElement('span');
    label.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-chip-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Gỡ file';
    removeBtn.addEventListener('click', () => {
      state.attachments.splice(idx, 1);
      renderAttachments();
      updateControls();
    });
    chip.appendChild(label);
    chip.appendChild(removeBtn);
    els.attachedFiles.appendChild(chip);
  });
}

function formatMB(bytes) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function setStatus(mode, pillText) {
  els.statusDot.classList.remove('loading', 'ready', 'error');
  els.backendPill.classList.remove('ready');
  if (mode) els.statusDot.classList.add(mode);
  if (mode === 'ready') els.backendPill.classList.add('ready');
  if (pillText) els.backendPill.textContent = pillText;
}

function showBanner({ label, percent, numbersText, required = false, showLoadBtn = false }) {
  if (state.progressHideTimer) {
    clearTimeout(state.progressHideTimer);
    state.progressHideTimer = null;
  }
  els.progressBanner.hidden = false;
  els.progressBanner.classList.toggle('required', required);
  els.bannerLoadBtn.hidden = !showLoadBtn;
  els.progressLabel.textContent = label;
  const clamped = Math.max(0, Math.min(100, percent));
  els.progressFill.style.width = `${clamped}%`;
  els.progressTrack.setAttribute('aria-valuenow', String(clamped));
  els.progressNumbers.textContent = numbersText ?? `${clamped}%`;
}

function renderCapabilities(caps) {
  const pills = [];
  if (caps.webgpuSupported) {
    pills.push(`<span class="cap-pill ok">WebGPU (${caps.gpuAdapterName || 'GPU'})</span>`);
  } else {
    pills.push('<span class="cap-pill">Không có WebGPU → WASM</span>');
  }
  pills.push(
    `<span class="cap-pill ${caps.crossOriginIsolated ? 'ok' : ''}">WASM ${caps.wasmThreads} luồng</span>`
  );
  if (caps.wasmSimd) {
    pills.push('<span class="cap-pill ok">SIMD</span>');
  }
  els.capsBadges.innerHTML = pills.join('');
}

function applyUiSettings() {
  els.layout.classList.remove('font-sm', 'font-lg', 'ui-compact');
  if (els.prefFontSize.value === 'sm') els.layout.classList.add('font-sm');
  if (els.prefFontSize.value === 'lg') els.layout.classList.add('font-lg');
  if (els.prefDensity.value === 'compact') els.layout.classList.add('ui-compact');
  const starterGrid = els.welcomeScreen.querySelector('.starter-grid');
  if (starterGrid) {
    starterGrid.hidden = !els.prefShowStarters.checked;
  }
}

function buildEffectiveSystemPrompt() {
  const parts = [els.systemPrompt.value.trim() || SYSTEM_PRESETS.default];
  const extraContext = els.userContext.value.trim();
  if (extraContext) {
    parts.push(extraContext);
  }
  if (els.userLang.value === 'vi') {
    parts.push('Luôn trả lời bằng tiếng Việt.');
  } else if (els.userLang.value === 'en') {
    parts.push('Always reply in English.');
  }
  const toneMap = {
    concise: 'Hãy trả lời thật ngắn gọn, đi thẳng vào trọng tâm.',
    detailed: 'Hãy giải thích đầy đủ, rõ ràng từng bước và có ví dụ.',
    technical: 'Hãy dùng thuật ngữ kỹ thuật chính xác và đi sâu vào chi tiết triển khai.',
  };
  if (toneMap[els.userTone.value]) {
    parts.push(toneMap[els.userTone.value]);
  }
  return parts.join(' ');
}

function updateControls() {
  const hasContent = els.promptInput.value.trim().length > 0 || state.attachments.length > 0;
  els.loadBtn.disabled = state.isLoading || state.isGenerating;
  els.unloadBtn.disabled = (!state.isReady && !state.isLoading) || state.isGenerating;
  els.backendSelect.disabled = state.isLoading || state.isGenerating;

  // Enforce model load before chatting
  els.promptInput.disabled = !state.isReady || state.isGenerating;
  els.attachBtn.disabled = !state.isReady || state.isGenerating;
  els.starterCards.forEach((btn) => {
    btn.disabled = !state.isReady || state.isGenerating;
  });

  els.promptInput.placeholder = state.isReady
    ? 'Nhắn tin cho Gemma 3 1B... (Enter để gửi, Shift+Enter xuống dòng)'
    : state.isLoading
      ? 'Đang nạp model vào RAM, vui lòng đợi...'
      : 'Vui lòng nạp model ở thanh phía trên trước khi nhắn tin...';

  if (state.isGenerating) {
    els.actionBtn.disabled = false;
    els.actionBtn.classList.remove('send-btn');
    els.actionBtn.classList.add('stop-btn');
    els.actionBtn.title = 'Dừng trả lời';
    els.actionBtn.setAttribute('aria-label', 'Dừng trả lời');
    els.iconSend.hidden = true;
    els.iconStop.hidden = false;
  } else {
    els.actionBtn.disabled = !state.isReady || !hasContent;
    els.actionBtn.classList.remove('stop-btn');
    els.actionBtn.classList.add('send-btn');
    els.actionBtn.title = 'Gửi';
    els.actionBtn.setAttribute('aria-label', 'Gửi');
    els.iconSend.hidden = false;
    els.iconStop.hidden = true;
  }
}

function startLoadModel() {
  if (state.isLoading || state.isGenerating) return;
  state.isLoading = true;
  state.isReady = false;
  setStatus('loading', 'Đang nạp...');
  showBanner({
    label: 'Đang chuẩn bị truyền Gemma 3 1B vào RAM...',
    percent: 0,
    numbersText: '0%',
    required: false,
    showLoadBtn: false,
  });
  updateControls();

  worker.postMessage({
    type: 'load',
    payload: { preferredBackend: els.backendSelect.value },
  });
}

function buildPromptWithAttachments(userText, files) {
  if (files.length === 0) return userText;
  const fileBlocks = files.map((f) => {
    const truncated =
      f.content.length > MAX_FILE_CHARS
        ? `${f.content.slice(0, MAX_FILE_CHARS)}\n...[đã cắt bớt do vượt ${MAX_FILE_CHARS} ký tự]`
        : f.content;
    return `--- File: ${f.name} ---\n\`\`\`\n${truncated}\n\`\`\``;
  });
  const basePrompt = userText || 'Hãy đọc và phân tích nội dung các file đính kèm sau:';
  return `${basePrompt}\n\n${fileBlocks.join('\n\n')}`;
}

function sendPrompt(text) {
  const userText = text.trim();
  const files = [...state.attachments];
  if ((!userText && files.length === 0) || !state.isReady || state.isGenerating) return;

  state.attachments = [];
  renderAttachments();

  let session = getActiveSession();
  if (!session) {
    createSession();
    session = getActiveSession();
  }

  const displayText = userText || 'Phân tích các file đính kèm';
  const fullContent = buildPromptWithAttachments(userText, files);
  const fileNames = files.map((f) => f.name);

  if (session.messages.length === 0) {
    session.title = displayText.length > 32 ? `${displayText.slice(0, 32)}...` : displayText;
    renderSessionList();
  }

  session.messages.push({
    role: 'user',
    content: fullContent,
    displayContent: displayText,
    files: fileNames,
  });
  appendMessageNode('user', displayText, '', fileNames);

  const turns = Number.parseInt(els.contextTurns.value, 10) || 10;
  const historyMessages = [
    { role: 'system', content: buildEffectiveSystemPrompt() },
    ...session.messages.slice(-turns).map(({ role, content }) => ({ role, content })),
  ];

  const assistantNode = appendMessageNode('assistant', '', 'Đang xử lý...');
  state.activeAssistantBody = assistantNode.body;
  state.activeAssistantMeta = assistantNode.meta;
  state.activeAssistantText = '';
  state.isGenerating = true;
  state.requestCounter += 1;
  updateControls();

  worker.postMessage({
    type: 'generate',
    payload: {
      requestId: state.requestCounter,
      messages: historyMessages,
      maxNewTokens: Number.parseInt(els.maxTokens.value, 10),
      temperature: Number.parseFloat(els.temperature.value),
      topP: Number.parseFloat(els.topP.value),
      topK: Number.parseInt(els.topK.value, 10),
      repetitionPenalty: Number.parseFloat(els.repPenalty.value),
      doSample: els.doSample.checked,
    },
  });
}

worker.addEventListener('message', (event) => {
  const { type, data } = event.data || {};

  if (type === 'capabilities') {
    renderCapabilities(data);
  } else if (type === 'status') {
    const currentPct = Number.parseInt(els.progressTrack.getAttribute('aria-valuenow') || '0', 10);
    showBanner({
      label: data.message,
      percent: currentPct,
      numbersText: `${currentPct}%`,
    });
  } else if (type === 'load-progress') {
    const isTokenizer = data.file === 'tokenizer.json';
    const label = isTokenizer
      ? `Đang nạp tokenizer vào RAM (${data.completedChunks}/${data.totalChunks} mảnh)...`
      : `Đang truyền Gemma 3 1B vào RAM (${data.completedChunks}/${data.totalChunks} mảnh ≤20MB)...`;
    const numbersText = `${data.percent}% • ${formatMB(data.loadedBytes)} / ${formatMB(data.totalBytes)} • ${data.speedMBs} MB/s`;
    showBanner({ label, percent: data.percent, numbersText });
  } else if (type === 'ready') {
    state.isLoading = false;
    state.isReady = true;
    const label = `${data.device.toUpperCase()} (${data.dtype})`;
    setStatus('ready', label);
    const doneMsg = data.fallbackReason
      ? `Sẵn sàng trên ${label} • ${data.fallbackReason}`
      : `Sẵn sàng trên ${label} (${(data.loadTimeMs / 1000).toFixed(1)}s • RAM-only)`;
    showBanner({ label: doneMsg, percent: 100, numbersText: '100%' });
    state.progressHideTimer = setTimeout(() => {
      els.progressBanner.hidden = true;
    }, 2500);
    updateControls();
    els.promptInput.focus();
  } else if (type === 'token') {
    if (data.requestId !== state.requestCounter || !state.activeAssistantBody) return;
    state.activeAssistantText += data.text;
    state.activeAssistantBody.innerHTML = renderMarkdown(state.activeAssistantText);
    if (els.prefShowStats.checked) {
      state.activeAssistantMeta.hidden = false;
      state.activeAssistantMeta.textContent =
        `${data.device.toUpperCase()} • ${data.tokenCount} tokens • ${data.tokensPerSecond} tok/s` +
        (data.ttftMs ? ` • TTFT ${data.ttftMs}ms` : '');
    }
    if (els.prefAutoScroll.checked) {
      els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
    }
  } else if (type === 'done') {
    if (data.requestId !== state.requestCounter) return;
    const finalReply = state.activeAssistantText.trim();
    const metaText =
      `${data.device.toUpperCase()} (${data.dtype}) • ${data.tokenCount} tokens • ` +
      `${data.tokensPerSecond} tok/s • TTFT ${data.ttftMs}ms • ${(data.totalMs / 1000).toFixed(2)}s` +
      (data.interrupted ? ' • Đã dừng' : '');

    if (state.activeAssistantBody) {
      state.activeAssistantBody.innerHTML = renderMarkdown(finalReply || '(Không có phản hồi)');
    }
    if (state.activeAssistantMeta) {
      state.activeAssistantMeta.hidden = !els.prefShowStats.checked;
      state.activeAssistantMeta.textContent = metaText;
    }

    const session = getActiveSession();
    if (session && finalReply) {
      session.messages.push({ role: 'assistant', content: finalReply, meta: metaText });
    }

    state.isGenerating = false;
    state.activeAssistantBody = null;
    state.activeAssistantMeta = null;
    updateControls();
  } else if (type === 'unloaded') {
    state.isReady = false;
    state.isLoading = false;
    setStatus('', 'Chưa nạp');
    showBanner({
      label: 'Đã giải phóng RAM. Hãy nạp lại model để tiếp tục trò chuyện.',
      percent: 0,
      numbersText: 'Chưa nạp',
      required: true,
      showLoadBtn: true,
    });
    updateControls();
  } else if (type === 'error') {
    state.isLoading = false;
    state.isGenerating = false;
    setStatus('error', 'Lỗi');
    showBanner({
      label: `Lỗi: ${data.message}`,
      percent: 0,
      numbersText: 'Lỗi',
      required: true,
      showLoadBtn: true,
    });
    if (state.activeAssistantBody) {
      state.activeAssistantBody.innerHTML = `<p>Lỗi khi sinh văn bản: ${data.message}</p>`;
      state.activeAssistantBody = null;
    }
    updateControls();
  }
});

// Sidebar toggles
els.leftToggleBtn.addEventListener('click', () => {
  if (window.innerWidth <= 1024) {
    els.layout.classList.remove('right-open');
    els.layout.classList.toggle('left-open');
  } else {
    els.layout.classList.toggle('left-collapsed');
  }
});

els.rightToggleBtn.addEventListener('click', () => {
  if (window.innerWidth <= 1024) {
    els.layout.classList.remove('left-open');
    els.layout.classList.toggle('right-open');
  } else {
    els.layout.classList.toggle('right-collapsed');
  }
});

els.leftCloseBtn.addEventListener('click', () => els.layout.classList.remove('left-open'));
els.rightCloseBtn.addEventListener('click', () => els.layout.classList.remove('right-open'));
els.sidebarBackdrop.addEventListener('click', () => {
  els.layout.classList.remove('left-open', 'right-open');
});

// Sessions
els.newChatBtn.addEventListener('click', () => {
  if (state.isGenerating) return;
  createSession();
  els.layout.classList.remove('left-open', 'right-open');
  if (state.isReady) els.promptInput.focus();
});

els.clearHistoryBtn.addEventListener('click', () => {
  if (state.isGenerating) return;
  state.sessions = [];
  createSession();
});

// Settings modal & UI preferences
els.openSettingsBtn.addEventListener('click', () => {
  els.settingsModal.hidden = false;
  els.layout.classList.remove('left-open', 'right-open');
});

els.closeSettingsBtn.addEventListener('click', () => {
  els.settingsModal.hidden = true;
});

els.settingsModal.addEventListener('click', (e) => {
  if (e.target === els.settingsModal) {
    els.settingsModal.hidden = true;
  }
});

els.settingsTabs.forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    const target = tabBtn.dataset.tab;
    els.settingsTabs.forEach((t) => t.classList.toggle('active', t === tabBtn));
    els.settingsPanels.forEach((p) => p.classList.toggle('active', p.dataset.panel === target));
  });
});

els.prefFontSize.addEventListener('change', applyUiSettings);
els.prefDensity.addEventListener('change', applyUiSettings);
els.prefShowStarters.addEventListener('change', applyUiSettings);
els.modalClearHistoryBtn.addEventListener('click', () => {
  if (state.isGenerating) return;
  state.sessions = [];
  createSession();
  els.settingsModal.hidden = true;
});
els.prefShowStats.addEventListener('change', () => {
  document.querySelectorAll('.assistant-meta').forEach((el) => {
    el.hidden = !els.prefShowStats.checked;
  });
});

// Model actions
els.loadBtn.addEventListener('click', startLoadModel);
els.bannerLoadBtn.addEventListener('click', startLoadModel);
els.unloadBtn.addEventListener('click', () => {
  if (state.isGenerating) return;
  worker.postMessage({ type: 'unload' });
});
els.actionBtn.addEventListener('click', () => {
  if (state.isGenerating) {
    worker.postMessage({ type: 'interrupt' });
    return;
  }
  els.chatForm.requestSubmit();
});

// System prompt presets & AI settings sync
document.querySelectorAll('.preset-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = SYSTEM_PRESETS[btn.dataset.preset];
    if (preset) els.systemPrompt.value = preset;
  });
});

function syncMaxTokens(val) {
  const clamped = Math.max(16, Math.min(4096, Number.parseInt(val, 10) || 2048));
  els.maxTokens.value = String(clamped);
  els.maxTokensInput.value = String(clamped);
}

els.maxTokens.addEventListener('input', () => syncMaxTokens(els.maxTokens.value));
els.maxTokensInput.addEventListener('change', () => syncMaxTokens(els.maxTokensInput.value));
els.temperature.addEventListener('input', () => {
  els.tempVal.textContent = Number.parseFloat(els.temperature.value).toFixed(2);
});
els.topP.addEventListener('input', () => {
  els.topPVal.textContent = Number.parseFloat(els.topP.value).toFixed(2);
});
els.topK.addEventListener('input', () => {
  els.topKVal.textContent = els.topK.value;
});
els.repPenalty.addEventListener('input', () => {
  els.repPenaltyVal.textContent = Number.parseFloat(els.repPenalty.value).toFixed(2);
});
els.contextTurns.addEventListener('input', () => {
  els.contextTurnsVal.textContent = els.contextTurns.value;
});

els.resetAiSettingsBtn.addEventListener('click', () => {
  els.systemPrompt.value = SYSTEM_PRESETS.default;
  syncMaxTokens(2048);
  els.temperature.value = '0.6';
  els.tempVal.textContent = '0.60';
  els.topP.value = '0.9';
  els.topPVal.textContent = '0.90';
  els.topK.value = '40';
  els.topKVal.textContent = '40';
  els.repPenalty.value = '1.05';
  els.repPenaltyVal.textContent = '1.05';
  els.contextTurns.value = '10';
  els.contextTurnsVal.textContent = '10';
  els.doSample.checked = true;
});

// File input handling
els.attachBtn.addEventListener('click', () => {
  if (!state.isReady || state.isGenerating) return;
  els.fileInput.click();
});

els.fileInput.addEventListener('change', async () => {
  const selected = Array.from(els.fileInput.files || []);
  for (const file of selected) {
    try {
      const content = await file.text();
      state.attachments.push({ name: file.name, size: file.size, content });
    } catch {
      // Ignore unreadable binary files
    }
  }
  els.fileInput.value = '';
  renderAttachments();
  updateControls();
});

// Composer & starters
els.promptInput.addEventListener('input', () => {
  els.promptInput.style.height = 'auto';
  els.promptInput.style.height = `${Math.min(els.promptInput.scrollHeight, 180)}px`;
  updateControls();
});

els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.isReady || state.isGenerating) return;
  const value = els.promptInput.value;
  if (!value.trim() && state.attachments.length === 0) return;
  els.promptInput.value = '';
  els.promptInput.style.height = 'auto';
  updateControls();
  sendPrompt(value);
});

els.promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && els.prefEnterSend.checked) {
    e.preventDefault();
    els.chatForm.requestSubmit();
  }
});

els.starterCards.forEach((btn) => {
  btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt || '';
    if (!prompt || !state.isReady || state.isGenerating) return;
    sendPrompt(prompt);
  });
});

els.chatMessages.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('.copy-code-btn');
  if (!copyBtn) return;
  const codeText = copyBtn.closest('.code-block')?.querySelector('pre code')?.textContent || '';
  try {
    await navigator.clipboard.writeText(codeText);
    copyBtn.textContent = 'Đã chép';
    setTimeout(() => {
      copyBtn.textContent = 'Sao chép';
    }, 1500);
  } catch {
    copyBtn.textContent = 'Lỗi';
  }
});

createSession();
applyUiSettings();
updateControls();
worker.postMessage({ type: 'init' });
