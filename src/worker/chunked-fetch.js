const LEGACY_CACHE_NAMES = [
  'ai-model-chunks-v1',
  'transformers-cache',
  'transformers-wasm-cache',
];

let originalFetch = null;
let installedConfig = null;
let manifestPromise = null;

export async function purgeLegacyCaches() {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => LEGACY_CACHE_NAMES.includes(k) || k.startsWith('transformers'))
        .map((k) => caches.delete(k))
    );
  } catch {
    // Ignore cache access errors
  }
}

export function installChunkedFetch({
  modelBasePath,
  modelBaseUrl,
  manifestUrl,
  prefetchWindow = 4,
  onProgress = null,
}) {
  if (!originalFetch) {
    originalFetch = globalThis.fetch.bind(globalThis);
  }

  installedConfig = {
    modelBasePath,
    modelBaseUrl,
    manifestUrl,
    prefetchWindow,
    onProgress,
  };

  const loadManifestOnce = () => {
    if (!manifestPromise) {
      manifestPromise = originalFetch(installedConfig.manifestUrl, { cache: 'no-store' }).then((res) => {
        if (!res.ok) {
          manifestPromise = null;
          throw new Error(`Không thể tải chunks-manifest.json (HTTP ${res.status})`);
        }
        return res.json();
      });
    }
    return manifestPromise;
  };

  const patchedFetch = async (input, init) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl, self.location?.origin || modelBaseUrl);
    } catch {
      return originalFetch(input, init);
    }

    const basePathname = new URL(installedConfig.modelBasePath, self.location?.origin || modelBaseUrl).pathname;
    if (!parsedUrl.pathname.startsWith(basePathname)) {
      return originalFetch(input, init);
    }

    const relPath = decodeURIComponent(parsedUrl.pathname.slice(basePathname.length)).replace(/^\/+/, '');
    const manifest = await loadManifestOnce();
    const fileMeta = manifest.files?.[relPath];

    // Normal unsplit files inside /models/ (config, model_q4.onnx, etc.) also bypass disk HTTP cache
    if (!fileMeta) {
      const nextInit = { ...(init || {}), cache: 'no-store' };
      return originalFetch(input, nextInit);
    }

    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const headers = new Headers({
      'Content-Type': fileMeta.contentType || 'application/octet-stream',
      'Content-Length': String(fileMeta.totalBytes),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });

    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    const chunks = fileMeta.chunks;
    const totalChunks = chunks.length;
    const totalBytes = fileMeta.totalBytes;
    const chunkUrls = chunks.map((c) => new URL(c.path, installedConfig.modelBaseUrl).href);
    const inFlight = new Map();

    let completedChunks = 0;
    let loadedBytes = 0;
    const startedAt = performance.now();

    const emitProgress = () => {
      const elapsedMs = Math.max(performance.now() - startedAt, 1);
      const speedMBs = Number((loadedBytes / 1_000_000 / (elapsedMs / 1000)).toFixed(1));
      const percent = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0;

      installedConfig.onProgress?.({
        file: relPath,
        variant: fileMeta.variant,
        completedChunks,
        totalChunks,
        loadedBytes,
        totalBytes,
        percent,
        speedMBs,
        elapsedMs,
      });
    };

    const startFetchChunk = (idx) => {
      if (idx < 0 || idx >= totalChunks || inFlight.has(idx)) return;
      const chunk = chunks[idx];
      const promise = (async () => {
        const res = await originalFetch(chunkUrls[idx], {
          cache: 'no-store',
          signal: init?.signal,
        });
        if (!res.ok) {
          throw new Error(`Tải chunk ${chunk.path} thất bại (HTTP ${res.status})`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength !== chunk.bytes) {
          throw new Error(
            `Kích thước chunk ${chunk.path} không khớp (${bytes.byteLength} != ${chunk.bytes})`
          );
        }
        completedChunks += 1;
        loadedBytes += bytes.byteLength;
        emitProgress();
        return bytes;
      })();
      inFlight.set(idx, promise);
    };

    emitProgress();
    const initialWindow = Math.min(installedConfig.prefetchWindow, totalChunks);
    for (let i = 0; i < initialWindow; i += 1) {
      startFetchChunk(i);
    }

    let streamIndex = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        if (streamIndex >= totalChunks) {
          inFlight.clear();
          controller.close();
          return;
        }
        const idx = streamIndex;
        streamIndex += 1;

        startFetchChunk(idx + installedConfig.prefetchWindow);

        try {
          const promise = inFlight.get(idx);
          const bytes = await promise;
          inFlight.delete(idx);
          controller.enqueue(bytes);
        } catch (err) {
          inFlight.clear();
          controller.error(err);
        }
      },
      cancel() {
        inFlight.clear();
      },
    });

    return new Response(stream, { status: 200, headers });
  };

  globalThis.fetch = patchedFetch;
  return patchedFetch;
}
