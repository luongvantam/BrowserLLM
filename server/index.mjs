import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SERVER_CACHE_DIR = path.join(ROOT_DIR, '.model-cache', 'server-hf');

const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LLM_API_URL = (process.env.LLM_API_URL || '').replace(/\/+$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const MODEL_ID =
  process.env.MODEL_ID ||
  (LLM_API_URL ? 'qwen3:4b' : 'onnx-community/Qwen2.5-Coder-1.5B-Instruct');
const MODEL_DTYPE = process.env.MODEL_DTYPE || 'q4';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const engineState = {
  mode: LLM_API_URL ? 'upstream' : 'local-node',
  status: LLM_API_URL ? 'ready' : 'loading', // loading | ready | error
  model: MODEL_ID,
  backend: LLM_API_URL ? 'API-UPSTREAM' : 'SERVER-CPU',
  progress: LLM_API_URL ? 100 : 0,
  message: LLM_API_URL
    ? `Kết nối upstream API: ${LLM_API_URL}`
    : `Đang nạp ${MODEL_ID} trên server...`,
  error: null,
};

let tokenizer = null;
let model = null;
let TextStreamerCls = null;
let InterruptableStoppingCriteriaCls = null;

async function initLocalEngine() {
  try {
    await fs.mkdir(SERVER_CACHE_DIR, { recursive: true });

    let tf;
    try {
      tf = await import('@huggingface/transformers');
    } catch (importErr) {
      throw new Error(
        `onnxruntime-node chưa hỗ trợ kiến trúc ${process.platform}/${process.arch} (${importErr.message}). Hãy chạy trên Linux x64 / Apple Silicon (arm64) / Windows x64 hoặc đặt biến LLM_API_URL (VD: Ollama http://127.0.0.1:11434/v1).`
      );
    }

    const { AutoTokenizer, AutoModelForCausalLM, TextStreamer, InterruptableStoppingCriteria, env } = tf;
    TextStreamerCls = TextStreamer;
    InterruptableStoppingCriteriaCls = InterruptableStoppingCriteria;

    env.cacheDir = SERVER_CACHE_DIR;
    env.allowLocalModels = false;
    env.allowRemoteModels = true;

    const progress_callback = (info) => {
      if (info?.status === 'progress' && info.total) {
        engineState.progress = Math.min(99, Math.round(info.progress || 0));
        engineState.message = `Server đang tải ${info.file || MODEL_ID} (${engineState.progress}%)...`;
      }
    };

    engineState.message = `Server đang nạp tokenizer ${MODEL_ID}...`;
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback });

    engineState.message = `Server đang nạp trọng số ${MODEL_ID} (${MODEL_DTYPE})...`;
    model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
      dtype: MODEL_DTYPE,
      progress_callback,
    });

    engineState.status = 'ready';
    engineState.progress = 100;
    engineState.message = `Server sẵn sàng (${MODEL_ID})`;
    console.log(`[BrowserLLM Server] Ready: ${MODEL_ID} (${engineState.backend})`);
  } catch (err) {
    engineState.status = 'error';
    engineState.error = err?.message || String(err);
    engineState.message = `Lỗi khởi tạo model trên server: ${engineState.error}`;
    console.error('[BrowserLLM Server] Init error:', err);
  }
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function writeSse(res, payload) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

async function handleUpstreamChat(req, res, body) {
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });

  const startedAt = performance.now();
  let firstTokenAt = null;
  let tokenCount = 0;

  const headers = { 'Content-Type': 'application/json' };
  if (LLM_API_KEY) {
    headers.Authorization = `Bearer ${LLM_API_KEY}`;
  }

  const upstreamRes = await fetch(`${LLM_API_URL}/chat/completions`, {
    method: 'POST',
    headers,
    signal: controller.signal,
    body: JSON.stringify({
      model: MODEL_ID,
      messages: body.messages,
      max_tokens: body.maxNewTokens ?? 2048,
      temperature: body.doSample === false ? 0 : (body.temperature ?? 0.6),
      top_p: body.topP ?? 0.9,
      stream: true,
    }),
  });

  if (!upstreamRes.ok) {
    const errText = await upstreamRes.text().catch(() => '');
    throw new Error(`Upstream HTTP ${upstreamRes.status}: ${errText.slice(0, 300)}`);
  }

  const reader = upstreamRes.body.getReader();
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
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') continue;
      try {
        const parsed = JSON.parse(dataStr);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (delta) {
          if (firstTokenAt === null) firstTokenAt = performance.now();
          tokenCount += 1;
          const elapsedSec = Math.max((performance.now() - firstTokenAt) / 1000, 0.001);
          writeSse(res, {
            type: 'token',
            text: delta,
            tokenCount,
            ttftMs: Math.round(firstTokenAt - startedAt),
            tokensPerSecond: Number((tokenCount / elapsedSec).toFixed(1)),
            backend: engineState.backend,
          });
        }
      } catch {
        // Ignore partial SSE JSON
      }
    }
  }

  const totalMs = Math.round(performance.now() - startedAt);
  const decodeSec = Math.max((performance.now() - (firstTokenAt ?? startedAt)) / 1000, 0.001);
  writeSse(res, {
    type: 'done',
    tokenCount,
    ttftMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : totalMs,
    totalMs,
    tokensPerSecond: Number((tokenCount / decodeSec).toFixed(1)),
    interrupted: controller.signal.aborted,
    backend: engineState.backend,
  });
  res.end();
}

async function handleLocalChat(req, res, body) {
  if (engineState.status !== 'ready' || !model || !tokenizer) {
    sendJson(res, 503, { error: engineState.message || 'Server model chưa sẵn sàng.' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });

  const stoppingCriteria = new InterruptableStoppingCriteriaCls();
  req.on('close', () => {
    stoppingCriteria.interrupt();
  });

  const inputs = tokenizer.apply_chat_template(body.messages, {
    add_generation_prompt: true,
    return_dict: true,
  });

  const startedAt = performance.now();
  let firstTokenAt = null;
  let tokenCount = 0;

  const streamer = new TextStreamerCls(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    token_callback_function: (tokens) => {
      if (firstTokenAt === null) firstTokenAt = performance.now();
      tokenCount += tokens?.length || 1;
    },
    callback_function: (text) => {
      const elapsedSec = Math.max((performance.now() - (firstTokenAt ?? startedAt)) / 1000, 0.001);
      writeSse(res, {
        type: 'token',
        text,
        tokenCount,
        ttftMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : null,
        tokensPerSecond: Number((tokenCount / elapsedSec).toFixed(1)),
        backend: engineState.backend,
      });
    },
  });

  const maxNewTokens = Math.max(16, Math.min(Number(body.maxNewTokens) || 2048, 16384));
  const temperature = Number(body.temperature ?? 0.6);
  const useSample = body.doSample !== false && temperature > 0.01;

  await model.generate({
    ...inputs,
    max_new_tokens: maxNewTokens,
    do_sample: useSample,
    temperature: useSample ? temperature : undefined,
    top_p: useSample ? Number(body.topP ?? 0.9) : undefined,
    top_k: useSample ? Math.max(1, Math.round(Number(body.topK ?? 40))) : undefined,
    repetition_penalty: Math.max(1.0, Number(body.repetitionPenalty ?? 1.05)),
    stopping_criteria: stoppingCriteria,
    streamer,
  });

  const totalMs = Math.round(performance.now() - startedAt);
  const decodeSec = Math.max((performance.now() - (firstTokenAt ?? startedAt)) / 1000, 0.001);

  writeSse(res, {
    type: 'done',
    tokenCount,
    ttftMs: firstTokenAt ? Math.round(firstTokenAt - startedAt) : totalMs,
    totalMs,
    tokensPerSecond: Number((tokenCount / decodeSec).toFixed(1)),
    interrupted: Boolean(stoppingCriteria.interrupted),
    backend: engineState.backend,
  });
  res.end();
}

async function serveStatic(req, res, pathname) {
  if (!existsSync(DIST_DIR)) {
    sendJson(res, 404, {
      error: 'Chưa build frontend. Hãy chạy "npm run build" hoặc dùng "npm run dev".',
    });
    return;
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(DIST_DIR, safePath === '/' ? 'index.html' : safePath);
  if (!existsSync(filePath) || (await fs.stat(filePath)).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
  });
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && reqUrl.pathname === '/api/health') {
    sendJson(res, 200, engineState);
    return;
  }

  if (req.method === 'POST' && reqUrl.pathname === '/api/chat') {
    try {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        sendJson(res, 400, { error: 'Thiếu danh sách messages.' });
        return;
      }
      if (LLM_API_URL) {
        await handleUpstreamChat(req, res, body);
      } else {
        await handleLocalChat(req, res, body);
      }
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err?.message || String(err) });
      } else {
        writeSse(res, { type: 'error', message: err?.message || String(err) });
        res.end();
      }
    }
    return;
  }

  await serveStatic(req, res, reqUrl.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`[BrowserLLM Server] Listening on http://localhost:${PORT} (mode: ${engineState.mode})`);
  if (!LLM_API_URL) {
    initLocalEngine();
  }
});
