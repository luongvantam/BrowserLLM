import {
  AutoModelForCausalLM,
  AutoTokenizer,
  InterruptableStoppingCriteria,
  TextStreamer,
  env,
} from '@huggingface/transformers';
import { clearChunkCache, installChunkedFetch } from './chunked-fetch.js';

const MODEL_ID = 'qwen3-4b-thinking';
const REMOTE_WEBGPU_MODEL_ID = 'onnx-community/Qwen3-4B-Thinking-2507-ONNX';
const REMOTE_WASM_MODEL_ID = 'onnx-community/Qwen2.5-Coder-1.5B-Instruct';
const BASE_PATH = import.meta.env.BASE_URL || '/';
const MODEL_BASE_PATH = `${BASE_PATH}models/${MODEL_ID}/`;
const MODEL_BASE_URL = new URL(MODEL_BASE_PATH, self.location.origin).href;
const MANIFEST_URL = new URL('chunks-manifest.json', MODEL_BASE_URL).href;

const patchedFetch = installChunkedFetch({
  modelBasePath: MODEL_BASE_PATH,
  modelBaseUrl: MODEL_BASE_URL,
  manifestUrl: MANIFEST_URL,
  prefetchWindow: 4,
  onProgress: (progress) => {
    self.postMessage({ type: 'load-progress', data: progress });
  },
});

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.useWasmCache = false;
env.localModelPath = `${BASE_PATH}models/`;
env.fetch = patchedFetch;

if (env.backends?.onnx?.wasm) {
  const maxThreads = Math.min(self.navigator?.hardwareConcurrency || 4, 4);
  env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? maxThreads : 1;
}

let tokenizer = null;
let model = null;
let activeBackend = null;
let activeDtype = null;
let stoppingCriteria = null;

function isWasmSimdSupported() {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0,
        253, 15, 253, 98, 11,
      ])
    );
  } catch {
    return false;
  }
}

async function detectCapabilities() {
  const wasmSupported = typeof WebAssembly === 'object';
  const wasmSimd = wasmSupported ? isWasmSimdSupported() : false;
  const crossOriginIsolated = Boolean(self.crossOriginIsolated);
  const hardwareConcurrency = self.navigator?.hardwareConcurrency || 1;
  const wasmThreads = crossOriginIsolated ? Math.min(hardwareConcurrency, 4) : 1;

  let webgpuSupported = false;
  let gpuAdapterName = null;
  let webgpuReason = null;

  if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        webgpuSupported = true;
        const info = adapter.info || {};
        gpuAdapterName =
          [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU Adapter';
      } else {
        webgpuReason = 'Không tìm thấy WebGPU adapter';
      }
    } catch (err) {
      webgpuReason = err?.message || 'Lỗi khởi tạo WebGPU adapter';
    }
  } else {
    webgpuReason = 'Trình duyệt không bật WebGPU';
  }

  return {
    webgpuSupported,
    gpuAdapterName,
    webgpuReason,
    wasmSupported,
    wasmSimd,
    crossOriginIsolated,
    hardwareConcurrency,
    wasmThreads,
    recommendedBackend: webgpuSupported ? 'webgpu' : 'wasm',
  };
}

function normalizeMessages(rawMessages) {
  const cleaned = [];
  for (const msg of rawMessages || []) {
    const content = String(msg?.content || '').trim();
    if (!content) continue;
    if (msg.role === 'system' || msg.role === 'user' || msg.role === 'assistant') {
      cleaned.push({ role: msg.role, content });
    }
  }
  return cleaned;
}

async function disposeModel() {
  if (model && typeof model.dispose === 'function') {
    try {
      await model.dispose();
    } catch {
      // Ignore disposal errors
    }
  }
  model = null;
  activeBackend = null;
  activeDtype = null;
}

async function hasLocalShardedModel() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return false;
    const data = await res.json();
    return Boolean(data && data.files);
  } catch {
    return false;
  }
}

async function loadVariant(device, dtype = 'q4') {
  const useLocal = device === 'webgpu' ? await hasLocalShardedModel() : false;
  const targetModel = useLocal
    ? MODEL_ID
    : device === 'webgpu'
      ? REMOTE_WEBGPU_MODEL_ID
      : REMOTE_WASM_MODEL_ID;
  const modelLabel = device === 'webgpu' ? 'Qwen3-4B-Thinking' : 'Qwen2.5-Coder-1.5B';

  env.allowLocalModels = useLocal;
  env.allowRemoteModels = !useLocal;
  env.useBrowserCache = !useLocal;

  const progress_callback = useLocal
    ? undefined
    : (info) => {
        if (info?.status === 'progress' && info.total) {
          self.postMessage({
            type: 'load-progress',
            data: {
              file: info.file || modelLabel,
              completedChunks: 0,
              totalChunks: 0,
              loadedBytes: info.loaded || 0,
              totalBytes: info.total || 0,
              percent: Math.min(100, Math.round(info.progress || 0)),
              speedMBs: 0,
            },
          });
        }
      };

  self.postMessage({
    type: 'status',
    data: {
      stage: 'loading-tokenizer',
      device,
      dtype,
      message: `Đang nạp tokenizer ${modelLabel} (${device.toUpperCase()})...`,
    },
  });

  tokenizer = await AutoTokenizer.from_pretrained(targetModel, {
    local_files_only: useLocal,
    progress_callback,
  });

  self.postMessage({
    type: 'status',
    data: {
      stage: 'loading-model',
      device,
      dtype,
      message: `Đang truyền trọng số ${modelLabel} (${dtype}) (${device.toUpperCase()})...`,
    },
  });

  await disposeModel();

  model = await AutoModelForCausalLM.from_pretrained(targetModel, {
    device,
    dtype,
    local_files_only: useLocal,
    use_external_data_format: device === 'webgpu' ? undefined : false,
    progress_callback,
  });

  activeBackend = device;
  activeDtype = dtype;
}

async function handleLoad({ preferredBackend = 'auto' } = {}) {
  const caps = await detectCapabilities();
  self.postMessage({ type: 'capabilities', data: caps });

  const startedAt = performance.now();
  let fallbackReason = null;

  if (preferredBackend === 'webgpu') {
    await loadVariant('webgpu', 'q4');
  } else if (preferredBackend === 'wasm') {
    await loadVariant('wasm', 'q8');
  } else {
    if (caps.webgpuSupported) {
      try {
        await loadVariant('webgpu', 'q4');
      } catch (err) {
        fallbackReason = `WebGPU không khả dụng (${err?.message || err}), tự động chuyển sang WASM CPU (Qwen2.5-Coder-1.5B)`;
        self.postMessage({
          type: 'status',
          data: {
            stage: 'fallback',
            device: 'wasm',
            dtype: 'q8',
            message: fallbackReason,
          },
        });
        await loadVariant('wasm', 'q8');
      }
    } else {
      fallbackReason = caps.webgpuReason || 'Chuyển sang WASM CPU (Qwen2.5-Coder-1.5B)';
      await loadVariant('wasm', 'q8');
    }
  }

  self.postMessage({
    type: 'ready',
    data: {
      device: activeBackend,
      dtype: activeDtype,
      fallbackReason,
      loadTimeMs: Math.round(performance.now() - startedAt),
    },
  });
}

async function handleGenerate({
  requestId,
  messages,
  maxNewTokens = 2048,
  temperature = 0.6,
  topP = 0.9,
  topK = 40,
  repetitionPenalty = 1.05,
  doSample = true,
}) {
  if (!model || !tokenizer) {
    throw new Error('Model chưa được nạp vào RAM.');
  }

  const normalized = normalizeMessages(messages);
  if (normalized.length === 0 || normalized[normalized.length - 1].role !== 'user') {
    throw new Error('Tin nhắn người dùng không hợp lệ.');
  }

  stoppingCriteria = new InterruptableStoppingCriteria();
  const inputs = tokenizer.apply_chat_template(normalized, {
    add_generation_prompt: true,
    return_dict: true,
  });

  const startedAt = performance.now();
  let firstTokenAt = null;
  let tokenCount = 0;

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: (tokens) => {
      if (firstTokenAt === null) {
        firstTokenAt = performance.now();
      }
      tokenCount += tokens?.length || 1;
    },
    callback_function: (text) => {
      const elapsedSec = Math.max((performance.now() - (firstTokenAt ?? startedAt)) / 1000, 0.001);
      self.postMessage({
        type: 'token',
        data: {
          requestId,
          text,
          tokenCount,
          ttftMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : null,
          tokensPerSecond: Number((tokenCount / elapsedSec).toFixed(1)),
          device: activeBackend,
          dtype: activeDtype,
        },
      });
    },
  });

  const safeMaxTokens = Math.max(16, Math.min(Number(maxNewTokens) || 2048, 16384));
  const useSample = Boolean(doSample) && temperature > 0.01;
  await model.generate({
    ...inputs,
    max_new_tokens: safeMaxTokens,
    do_sample: useSample,
    temperature: useSample ? temperature : undefined,
    top_p: useSample ? topP : undefined,
    top_k: useSample ? Math.max(1, Math.round(topK)) : undefined,
    repetition_penalty: Math.max(1.0, Number(repetitionPenalty) || 1.05),
    stopping_criteria: stoppingCriteria,
    streamer,
  });

  const totalMs = Math.round(performance.now() - startedAt);
  const decodeSec = Math.max((performance.now() - (firstTokenAt ?? startedAt)) / 1000, 0.001);

  self.postMessage({
    type: 'done',
    data: {
      requestId,
      tokenCount,
      ttftMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : totalMs,
      totalMs,
      tokensPerSecond: Number((tokenCount / decodeSec).toFixed(1)),
      interrupted: stoppingCriteria?.interrupted || false,
      device: activeBackend,
      dtype: activeDtype,
    },
  });
}

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data || {};
  try {
    if (type === 'init') {
      const caps = await detectCapabilities();
      self.postMessage({ type: 'capabilities', data: caps });
    } else if (type === 'load') {
      await handleLoad(payload);
    } else if (type === 'generate') {
      await handleGenerate(payload);
    } else if (type === 'interrupt') {
      stoppingCriteria?.interrupt();
    } else if (type === 'unload') {
      await disposeModel();
      tokenizer = null;
      self.postMessage({ type: 'unloaded' });
    } else if (type === 'clear-cache') {
      await clearChunkCache();
      self.postMessage({ type: 'cache-cleared' });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      data: {
        message: err?.message || String(err),
        stack: err?.stack || '',
      },
    });
  }
});
