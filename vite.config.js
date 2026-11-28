import { defineConfig } from 'vite';

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
  base: './',
  plugins: [stripOversizedOrtwasmPlugin()],
  worker: {
    format: 'es',
    plugins: () => [stripOversizedOrtwasmPlugin()],
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
});
