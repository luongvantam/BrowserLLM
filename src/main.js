import { renderMarkdown } from './markdown.js';
import './style.css';

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
  modalClearCacheBtn: document.getElementById('modal-clear-cache-btn'),
  modalClearHistoryBtn: document.getElementById('modal-clear-history-btn'),
  userLang: document.getElementById('user-lang'),
  userTone: document.getElementById('user-tone'),
  prefEnterSend: document.getElementById('pref-enter-send'),
  prefShowStats: document.getElementById('pref-show-stats'),
  prefAutoScroll: document.getElementById('pref-auto-scroll'),
  statusDot: document.getElementById('status-dot'),
  serverModelName: document.getElementById('server-model-name'),
  capsBadges: document.getElementById('caps-badges'),
  loadBtn: document.getElementById('load-btn'),
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
  isLoading: true,
  isGenerating: false,
  abortController: null,
  pollTimer: null,
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
  if (extraContext) parts.push(extraContext);
  if (els.userLang.value === 'vi') parts.push('Luôn trả lời bằng tiếng Việt.');
  else if (els.userLang.value === 'en') parts.push('Always reply in English.');
  const toneMap = {
    concise: 'Hãy trả lời thật ngắn gọn, đi thẳng vào trọng tâm.',
    detailed: 'Hãy giải thích đầy đủ, rõ ràng từng bước và có ví dụ.',
    technical: 'Hãy dùng thuật ngữ kỹ thuật chính xác và đi sâu vào chi tiết triển khai.',
  };
  if (toneMap[els.userTone.value]) parts.push(toneMap[els.userTone.value]);
  return parts.join(' ');
}

function updateControls() {
  const hasContent = els.promptInput.value.trim().length > 0 || state.attachments.length > 0;
  els.loadBtn.disabled = state.isGenerating;
  els.promptInput.disabled = !state.isReady || state.isGenerating;
  els.attachBtn.disabled = !state.isReady || state.isGenerating;
  els.starterCards.forEach((btn) => {
    btn.disabled = !state.isReady || state.isGenerating;
  });

  els.promptInput.placeholder = state.isReady
    ? 'Nhắn tin cho AI Server... (Enter để gửi, Shift+Enter xuống dòng)'
    : state.isLoading
      ? 'Server đang nạp model, vui lòng đợi trong giây lát...'
      : 'Chưa kết nối được AI Server (/api/health)...';

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

async function pollServerHealth() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const shortModel = String(data.model || 'Server AI').split('/').pop();
    els.serverModelName.textContent = shortModel;
    els.capsBadges.innerHTML = [
      `<span class="cap-pill ok">${data.backend || 'SERVER'}</span>`,
      `<span class="cap-pill ok">0 MB Client</span>`,
    ].join('');

    if (data.status === 'ready') {
      const wasLoading = !state.isReady;
      state.isReady = true;
      state.isLoading = false;
      setStatus('ready', data.backend || 'SERVER');
      if (wasLoading) {
        showBanner({
          label: `Server sẵn sàng (${shortModel}) • Dùng ngay, không cần tải về máy`,
          percent: 100,
          numbersText: '100%',
        });
        state.progressHideTimer = setTimeout(() => {
          els.progressBanner.hidden = true;
        }, 2000);
      }
      updateControls();
      return;
    }

    if (data.status === 'error') {
      state.isReady = false;
      state.isLoading = false;
      setStatus('error', 'Lỗi Server');
      showBanner({
        label: data.message || 'Lỗi khởi tạo model trên server',
        percent: 0,
        numbersText: 'Lỗi',
        required: true,
        showLoadBtn: true,
      });
      updateControls();
      return;
    }

    state.isReady = false;
    state.isLoading = true;
    setStatus('loading', 'Server đang nạp...');
    showBanner({
      label: data.message || 'Server đang nạp model...',
      percent: data.progress || 0,
      numbersText: `${data.progress || 0}%`,
    });
    updateControls();
    state.pollTimer = setTimeout(pollServerHealth, 1200);
  } catch {
    state.isReady = false;
    state.isLoading = false;
    setStatus('error', 'Mất kết nối');
    els.capsBadges.innerHTML = '<span class="cap-pill">Không thấy AI Server (:3001)</span>';
    showBanner({
      label: 'Chưa kết nối được AI Server. Hãy chạy "npm run server" (hoặc "npm start").',
      percent: 0,
      numbersText: 'Offline',
      required: true,
      showLoadBtn: true,
    });
    updateControls();
  }
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

async function sendPrompt(text) {
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

  const assistantNode = appendMessageNode('assistant', '', 'Đang xử lý trên server...');
  state.activeAssistantBody = assistantNode.body;
  state.activeAssistantMeta = assistantNode.meta;
  state.activeAssistantText = '';
  state.isGenerating = true;
  state.abortController = new AbortController();
  updateControls();

  let finalMeta = '';
  let wasInterrupted = false;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: state.abortController.signal,
      body: JSON.stringify({
        messages: historyMessages,
        maxNewTokens: Number.parseInt(els.maxTokens.value, 10),
        temperature: Number.parseFloat(els.temperature.value),
        topP: Number.parseFloat(els.topP.value),
        topK: Number.parseInt(els.topK.value, 10),
        repetitionPenalty: Number.parseFloat(els.repPenalty.value),
        doSample: els.doSample.checked,
      }),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = JSON.parse(trimmed.slice(5).trim());
        if (data.type === 'token') {
          state.activeAssistantText += data.text;
          state.activeAssistantBody.innerHTML = renderMarkdown(state.activeAssistantText);
          if (els.prefShowStats.checked) {
            state.activeAssistantMeta.hidden = false;
            state.activeAssistantMeta.textContent =
              `${data.backend || 'SERVER'} • ${data.tokenCount} tokens • ${data.tokensPerSecond} tok/s` +
              (data.ttftMs ? ` • TTFT ${data.ttftMs}ms` : '');
          }
          if (els.prefAutoScroll.checked) {
            els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
          }
        } else if (data.type === 'done') {
          finalMeta =
            `${data.backend || 'SERVER'} • ${data.tokenCount} tokens • ` +
            `${data.tokensPerSecond} tok/s • TTFT ${data.ttftMs}ms • ${(data.totalMs / 1000).toFixed(2)}s` +
            (data.interrupted ? ' • Đã dừng' : '');
        } else if (data.type === 'error') {
          throw new Error(data.message);
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      wasInterrupted = true;
      finalMeta = `${state.activeAssistantMeta?.textContent || 'SERVER'} • Đã dừng`;
    } else {
      state.activeAssistantBody.innerHTML = `<p>Lỗi server: ${err.message}</p>`;
    }
  } finally {
    const finalReply = state.activeAssistantText.trim();
    if (finalReply) {
      state.activeAssistantBody.innerHTML = renderMarkdown(finalReply);
      session.messages.push({ role: 'assistant', content: finalReply, meta: finalMeta });
    } else if (wasInterrupted) {
      state.activeAssistantBody.innerHTML = '<p>(Đã dừng)</p>';
    }
    if (state.activeAssistantMeta && finalMeta) {
      state.activeAssistantMeta.hidden = !els.prefShowStats.checked;
      state.activeAssistantMeta.textContent = finalMeta;
    }

    state.isGenerating = false;
    state.abortController = null;
    state.activeAssistantBody = null;
    state.activeAssistantMeta = null;
    updateControls();
  }
}

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
els.modalClearCacheBtn.addEventListener('click', async () => {
  if (typeof caches !== 'undefined') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  els.settingsModal.hidden = true;
});
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

// Server connection checks
els.loadBtn.addEventListener('click', pollServerHealth);
els.bannerLoadBtn.addEventListener('click', pollServerHealth);
els.actionBtn.addEventListener('click', () => {
  if (state.isGenerating) {
    state.abortController?.abort();
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
  const clamped = Math.max(16, Math.min(8192, Number.parseInt(val, 10) || 2048));
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
pollServerHealth();
