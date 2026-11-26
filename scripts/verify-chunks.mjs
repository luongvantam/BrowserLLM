import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const outArg = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const modelDir = path.resolve(
    process.cwd(),
    outArg || 'public/models/gemma-3-1b-it'
  );
  const manifestPath = path.join(modelDir, 'chunks-manifest.json');

  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  console.log(`Verifying chunks in ${modelDir}`);
  console.log(`Repo: ${manifest.repo} | Max chunk size: ${manifest.chunkSize.toLocaleString()} bytes\n`);

  let totalChunksVerified = 0;

  for (const [fileKey, fileMeta] of Object.entries(manifest.files)) {
    const fullHash = createHash('sha256');
    let accumulatedBytes = 0;

    for (const chunk of fileMeta.chunks) {
      const chunkPath = path.join(modelDir, chunk.path);
      const data = await fs.readFile(chunkPath);

      if (data.length > manifest.chunkSize) {
        throw new Error(`Chunk ${chunk.path} exceeds limit: ${data.length} > ${manifest.chunkSize}`);
      }
      if (data.length !== chunk.bytes) {
        throw new Error(`Chunk ${chunk.path} byte mismatch: got ${data.length}, expected ${chunk.bytes}`);
      }

      const chunkHash = createHash('sha256').update(data).digest('hex');
      if (chunkHash !== chunk.sha256) {
        throw new Error(`Chunk ${chunk.path} SHA-256 mismatch`);
      }

      fullHash.update(data);
      accumulatedBytes += data.length;
      totalChunksVerified += 1;
    }

    if (accumulatedBytes !== fileMeta.totalBytes) {
      throw new Error(
        `Total byte mismatch for ${fileKey}: got ${accumulatedBytes}, expected ${fileMeta.totalBytes}`
      );
    }

    const combinedSha = fullHash.digest('hex');
    if (combinedSha !== fileMeta.sha256) {
      throw new Error(`Combined SHA-256 mismatch for ${fileKey}`);
    }

    console.log(
      `[OK] ${fileKey} (${fileMeta.variant}): ${fileMeta.chunkCount} chunks, ${(accumulatedBytes / 1_000_000).toFixed(2)} MB, SHA-256 verified`
    );
  }

  console.log(`\nAll ${totalChunksVerified} chunks verified successfully.`);
}

main().catch((err) => {
  console.error('\nVerification failed:', err.message);
  process.exit(1);
});
