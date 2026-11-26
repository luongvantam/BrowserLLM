import { defineConfig } from 'vite';

function crossOriginIsolationPlugin() {
  const applyHeaders = (res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  };

  return {
    name: 'cross-origin-isolation',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        applyHeaders(res);
        if (req.url?.startsWith('/models/')) {
          res.setHeader('Cache-Control', 'no-store');
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        applyHeaders(res);
        if (req.url?.startsWith('/models/')) {
          res.setHeader('Cache-Control', 'no-store');
        }
        next();
      });
    },
  };
}

function stripOversizedOrtwasmPlugin(limitBytes = 20_000_000) {
  return {
    name: 'strip-oversized-ortwasm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const [fileName, chunkOrAsset] of Object.entries(bundle)) {
        if (/ort-wasm-.*\.wasm$/.test(fileName) && chunkOrAsset.type === 'asset') {
          const byteLen =
            typeof chunkOrAsset.source === 'string'
              ? Buffer.byteLength(chunkOrAsset.source)
              : chunkOrAsset.source.byteLength;
          if (byteLen > limitBytes) {
            delete bundle[fileName];
          }
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [crossOriginIsolationPlugin(), stripOversizedOrtwasmPlugin()],
  worker: {
    format: 'es',
    plugins: () => [stripOversizedOrtwasmPlugin()],
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
});
