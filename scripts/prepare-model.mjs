import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const VARIANT_FILE_MAP = {
  q4: 'onnx/model_q4.onnx',
  q4f16: 'onnx/model_q4f16.onnx',
  q8: 'onnx/model_quantized.onnx',
  int8: 'onnx/model_int8.onnx',
  uint8: 'onnx/model_uint8.onnx',
  bnb4: 'onnx/model_bnb4.onnx',
  fp16: 'onnx/model_fp16.onnx',
  fp32: 'onnx/model.onnx',
};

const METADATA_FILES = [
  'config.json',
  'generation_config.json',
  'chat_template.jinja',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'special_tokens_map.json',
  'added_tokens.json',
  'quantize_config.json',
];

function parseArgs(argv) {
  const opts = {
    repo: 'onnx-community/Qwen3.5-0.8B-Text-ONNX',
    variants: ['q4'],
    chunkSize: 20_000_000,
    out: 'public/models/qwen3.5-0.8b',
    cleanCache: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--repo=')) {
      opts.repo = arg.slice('--repo='.length);
    } else if (arg.startsWith('--variants=')) {
      opts.variants = arg
        .slice('--variants='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--chunk-size=')) {
      opts.chunkSize = Number.parseInt(arg.slice('--chunk-size='.length), 10);
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
    } else if (arg === '--clean-cache') {
      opts.cleanCache = true;
    }
  }

  if (!Number.isFinite(opts.chunkSize) || opts.chunkSize <= 0) {
    throw new Error(`Invalid --chunk-size: ${opts.chunkSize}`);
  }
  for (const variant of opts.variants) {
    if (!VARIANT_FILE_MAP[variant]) {
      throw new Error(
        `Unsupported variant "${variant}". Valid variants: ${Object.keys(VARIANT_FILE_MAP).join(', ')}`
      );
    }
  }
  return opts;
}

function formatMB(bytes) {
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

function buildHfUrl(repo, filePath) {
  return `https://huggingface.co/${repo}/resolve/main/${filePath}`;
}

async function fetchRemoteLength(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (!res.ok) return null;
  const len = res.headers.get('content-length');
  return len ? Number.parseInt(len, 10) : null;
}

async function downloadFileWithProgress(url, destPath, label) {
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  const remoteSize = await fetchRemoteLength(url).catch(() => null);
  if (existsSync(destPath) && remoteSize !== null) {
    const stat = await fs.stat(destPath);
    if (stat.size === remoteSize) {
      console.log(`  [cache-hit] ${label} (${formatMB(stat.size)})`);
      return stat.size;
    }
    console.log(`  [cache-mismatch] ${label}: local ${stat.size} != remote ${remoteSize}, re-downloading...`);
  }

  const tmpPath = `${destPath}.tmp`;
  const maxAttempts = 15;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let existingTmp = 0;
    if (existsSync(tmpPath)) {
      const tmpStat = await fs.stat(tmpPath);
      if (remoteSize && tmpStat.size > 0 && tmpStat.size < remoteSize) {
        existingTmp = tmpStat.size;
      } else {
        await fs.rm(tmpPath, { force: true });
      }
    }

    const headers = existingTmp > 0 ? { Range: `bytes=${existingTmp}-` } : {};
    let res;
    try {
      res = await fetch(url, { headers, redirect: 'follow' });
    } catch (fetchErr) {
      if (attempt < maxAttempts) {
        console.warn(`\n  [retry ${attempt}/${maxAttempts}] ${label} fetch error: ${fetchErr.message}`);
        await new Promise((r) => setTimeout(r, Math.min(3000, 1000 * attempt)));
        continue;
      }
      throw fetchErr;
    }

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
      err.status = res.status;
      throw err;
    }

    const isResumed = res.status === 206 && existingTmp > 0;
    if (!isResumed && existingTmp > 0) {
      existingTmp = 0;
      await fs.rm(tmpPath, { force: true });
    }

    const bodyLen = Number.parseInt(res.headers.get('content-length') || '0', 10);
    const total = remoteSize || (isResumed ? existingTmp + bodyLen : bodyLen) || 0;
    const writer = createWriteStream(tmpPath, { flags: isResumed ? 'a' : 'w' });
    let downloaded = existingTmp;
    let lastLogAt = 0;

    try {
      const nodeStream = Readable.fromWeb(res.body);
      await new Promise((resolve, reject) => {
        nodeStream.on('data', (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (now - lastLogAt > 1500) {
            lastLogAt = now;
            const pct = total ? `${((downloaded / total) * 100).toFixed(1)}%` : formatMB(downloaded);
            process.stdout.write(
              `\r  [download] ${label}: ${pct} (${formatMB(downloaded)}${total ? ` / ${formatMB(total)}` : ''})   `
            );
          }
        });
        nodeStream.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', resolve);
        nodeStream.pipe(writer);
      });
    } catch (streamErr) {
      writer.destroy();
      if (downloaded - existingTmp > 1_000_000) {
        attempt = 0;
      }
      if (attempt < maxAttempts) {
        console.warn(`\n  [retry] ${label} stream error: ${streamErr.message}, resuming from ${formatMB(downloaded)}...`);
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw streamErr;
    }

    if (total && downloaded !== total) {
      if (downloaded - existingTmp > 1_000_000) {
        attempt = 0;
      }
      if (attempt < maxAttempts) {
        console.warn(
          `\n  [retry] ${label} truncated (${downloaded}/${total} bytes), resuming...`
        );
        continue;
      }
      throw new Error(`Incomplete download for ${label}: got ${downloaded} of ${total} bytes`);
    }

    process.stdout.write(`\r  [download] ${label}: 100.0% (${formatMB(downloaded)})                  \n`);
    await fs.rename(tmpPath, destPath);
    return downloaded;
  }
}

async function splitFileToChunks(srcPath, chunksDir, relativeChunksBase, chunkSize) {
  await fs.rm(chunksDir, { recursive: true, force: true });
  await fs.mkdir(chunksDir, { recursive: true });

  const stat = await fs.stat(srcPath);
  const totalBytes = stat.size;
  const fullHash = createHash('sha256');
  const chunks = [];

  const handle = await fs.open(srcPath, 'r');
  try {
    let offset = 0;
    let index = 0;
    const buffer = Buffer.allocUnsafe(Math.min(chunkSize, totalBytes || chunkSize));

    while (offset < totalBytes) {
      const toRead = Math.min(chunkSize, totalBytes - offset);
      let bytesReadTotal = 0;
      while (bytesReadTotal < toRead) {
        const { bytesRead } = await handle.read(
          buffer,
          bytesReadTotal,
          toRead - bytesReadTotal,
          offset + bytesReadTotal
        );
        if (bytesRead === 0) break;
        bytesReadTotal += bytesRead;
      }

      const slice = buffer.subarray(0, bytesReadTotal);
      fullHash.update(slice);
      const chunkSha256 = createHash('sha256').update(slice).digest('hex');

      const partName = `part-${String(index).padStart(3, '0')}.bin`;
      const partDiskPath = path.join(chunksDir, partName);
      await fs.writeFile(partDiskPath, slice);

      chunks.push({
        index,
        path: `${relativeChunksBase}/${partName}`,
        bytes: bytesReadTotal,
        sha256: chunkSha256,
      });

      offset += bytesReadTotal;
      index += 1;
    }
  } finally {
    await handle.close();
  }

  return {
    totalBytes,
    sha256: fullHash.digest('hex'),
    chunkCount: chunks.length,
    chunks,
  };
}

async function placeOrSplitFile({ srcPath, outDir, relPath, chunkSize, variant, manifestFiles }) {
  const stat = await fs.stat(srcPath);
  const outFilePath = path.join(outDir, relPath);
  const relativeChunksBase = `${relPath}.chunks`;
  const chunksDir = path.join(outDir, relativeChunksBase);

  if (stat.size <= chunkSize) {
    await fs.rm(chunksDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(outFilePath), { recursive: true });
    await fs.copyFile(srcPath, outFilePath);
    console.log(`  [direct] ${relPath} (${formatMB(stat.size)} <= ${formatMB(chunkSize)})`);
    return { split: false, bytes: stat.size, chunkCount: 0 };
  }

  await fs.rm(outFilePath, { force: true });
  console.log(`  [split] ${relPath} (${formatMB(stat.size)}) -> ${relativeChunksBase}/ ...`);
  const splitMeta = await splitFileToChunks(srcPath, chunksDir, relativeChunksBase, chunkSize);

  const contentType = relPath.endsWith('.json') ? 'application/json' : 'application/octet-stream';
  manifestFiles[relPath] = {
    variant,
    contentType,
    totalBytes: splitMeta.totalBytes,
    sha256: splitMeta.sha256,
    chunkSize,
    chunkCount: splitMeta.chunkCount,
    chunks: splitMeta.chunks,
  };

  return { split: true, bytes: splitMeta.totalBytes, chunkCount: splitMeta.chunkCount };
}

async function assertAllFilesWithinLimit(dir, limitBytes) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const oversized = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      oversized.push(...(await assertAllFilesWithinLimit(fullPath, limitBytes)));
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      if (stat.size > limitBytes) {
        oversized.push({ path: fullPath, size: stat.size });
      }
    }
  }
  return oversized;
}

async function findExternalDataFiles(repo, relOnnxPath) {
  const externalFiles = [];
  const primaryData = `${relOnnxPath}_data`;
  const primarySize = await fetchRemoteLength(buildHfUrl(repo, primaryData)).catch(() => null);
  if (primarySize === null) return externalFiles;

  externalFiles.push(primaryData);
  for (let i = 1; i < 32; i += 1) {
    const extraData = `${relOnnxPath}_data_${i}`;
    const extraSize = await fetchRemoteLength(buildHfUrl(repo, extraData)).catch(() => null);
    if (extraSize === null) break;
    externalFiles.push(extraData);
  }
  return externalFiles;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();
  const outDir = path.resolve(rootDir, opts.out);
  const repoSlug = opts.repo.replace(/[^a-zA-Z0-9._-]+/g, '__');
  const cacheDir = path.resolve(rootDir, '.model-cache', repoSlug);

  if (opts.cleanCache) {
    console.log(`Cleaning cache directory: ${cacheDir}`);
    await fs.rm(cacheDir, { recursive: true, force: true });
  }

  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });

  console.log(`Preparing model: ${opts.repo}`);
  console.log(`Variants: ${opts.variants.join(', ')}`);
  console.log(`Max chunk size: ${opts.chunkSize.toLocaleString()} bytes (${formatMB(opts.chunkSize)})`);
  console.log(`Output directory: ${outDir}`);

  const manifestFiles = {};
  const variantSummary = {};

  console.log('\n[1/3] Downloading tokenizer & config files...');
  for (const file of METADATA_FILES) {
    const url = buildHfUrl(opts.repo, file);
    const cachedMetaPath = path.join(cacheDir, file);
    try {
      await downloadFileWithProgress(url, cachedMetaPath, file);
      await placeOrSplitFile({
        srcPath: cachedMetaPath,
        outDir,
        relPath: file,
        chunkSize: opts.chunkSize,
        variant: 'shared',
        manifestFiles,
      });
    } catch (err) {
      if (err.status === 404) {
        console.log(`  [skip] ${file} (not present in repo)`);
      } else {
        throw err;
      }
    }
  }

  console.log('\n[2/3] Downloading & splitting ONNX weight variants...');
  const onnxOutDir = path.join(outDir, 'onnx');
  if (existsSync(onnxOutDir)) {
    await fs.rm(onnxOutDir, { recursive: true, force: true });
  }

  for (const variant of opts.variants) {
    const relOnnxPath = VARIANT_FILE_MAP[variant];
    const externalFiles = await findExternalDataFiles(opts.repo, relOnnxPath);
    const variantFiles = [relOnnxPath, ...externalFiles];

    let variantTotalBytes = 0;
    let variantTotalChunks = 0;

    for (const relPath of variantFiles) {
      const url = buildHfUrl(opts.repo, relPath);
      const cachedPath = path.join(cacheDir, relPath);
      await downloadFileWithProgress(url, cachedPath, `${variant} (${relPath})`);
      const placed = await placeOrSplitFile({
        srcPath: cachedPath,
        outDir,
        relPath,
        chunkSize: opts.chunkSize,
        variant,
        manifestFiles,
      });
      variantTotalBytes += placed.bytes;
      variantTotalChunks += placed.chunkCount;
    }

    variantSummary[variant] = {
      files: variantFiles,
      totalBytes: variantTotalBytes,
      chunkCount: variantTotalChunks,
    };
  }

  const manifest = {
    repo: opts.repo,
    modelId: path.basename(outDir),
    chunkSize: opts.chunkSize,
    generatedAt: new Date().toISOString(),
    variants: variantSummary,
    files: manifestFiles,
  };

  const manifestPath = path.join(outDir, 'chunks-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log('\n[3/3] Verifying output size limits...');
  const oversized = await assertAllFilesWithinLimit(outDir, opts.chunkSize);
  if (oversized.length > 0) {
    throw new Error(
      `Found files exceeding ${opts.chunkSize} bytes:\n` +
        oversized.map((f) => `  - ${f.path}: ${f.size} bytes`).join('\n')
    );
  }

  console.log('\nSummary:');
  for (const [variant, info] of Object.entries(variantSummary)) {
    console.log(
      `  - ${variant.padEnd(6)} | ${info.files.join(' + ').padEnd(36)} | ${formatMB(info.totalBytes).padStart(10)} | ${info.chunkCount} chunks (<= ${formatMB(opts.chunkSize)})`
    );
  }
  console.log(`\nManifest written to: ${manifestPath}`);
}

main().catch((err) => {
  console.error('\nFailed to prepare model:', err);
  process.exit(1);
});
