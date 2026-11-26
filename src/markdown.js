function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(text) {
  const codeSpans = [];
  let tokenized = text.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  tokenized = escapeHtml(tokenized);
  tokenized = tokenized.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  tokenized = tokenized.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  tokenized = tokenized.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  return tokenized.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => codeSpans[Number(i)]);
}

function renderTextBlock(blockText) {
  const lines = blockText.split('\n');
  const html = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(listType === 'ul' ? '</ul>' : '</ol>');
      listType = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      closeList();
      html.push(`<blockquote>${renderInline(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (ulMatch) {
      if (listType !== 'ul') {
        closeList();
        listType = 'ul';
        html.push('<ul>');
      }
      html.push(`<li>${renderInline(ulMatch[1])}</li>`);
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (listType !== 'ol') {
        closeList();
        listType = 'ol';
        html.push('<ol>');
      }
      html.push(`<li>${renderInline(olMatch[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  closeList();
  return html.join('');
}

export function renderMarkdown(markdown) {
  if (!markdown) return '';
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderTextBlock(markdown.slice(lastIndex, match.index)));
    }
    const lang = escapeHtml(match[1] || 'code');
    const code = escapeHtml(match[2].replace(/\n$/, ''));
    parts.push(
      `<div class="code-block">` +
        `<div class="code-header"><span>${lang}</span><button type="button" class="copy-code-btn">Sao chép</button></div>` +
        `<pre><code>${code}</code></pre>` +
      `</div>`
    );
    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < markdown.length) {
    parts.push(renderTextBlock(markdown.slice(lastIndex)));
  }

  return parts.join('');
}
