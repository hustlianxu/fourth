/**
 * 轻量级 Markdown → HTML 转换器
 * 专为微信小程序 rich-text 组件设计，输出受支持的 HTML 子集。
 * 输出带内联样式的 HTML，确保 rich-text 渲染与主题风格一致。
 *
 * 支持：标题 / 粗体 / 斜体 / 列表 / 代码块 / 行内代码 / 链接 / 引用 / 分割线 / 段落
 */
function mdToHtml(md) {
  if (!md) return '';
  let text = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const lines = text.split('\n');
  const html = [];
  let i = 0;
  let inCodeBlock = false;
  let codeBuf = [];

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // ── 代码块 ──
    if (/^```/.test(line)) {
      if (inCodeBlock) {
        html.push('<pre style="background:#f5f5f7;padding:16rpx;border-radius:8rpx;overflow-x:auto;font-size:22rpx;line-height:1.5;"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
        codeBuf = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      i++;
      continue;
    }
    if (inCodeBlock) {
      codeBuf.push(raw);
      i++;
      continue;
    }

    // ── 空行 ──
    if (line === '') { i++; continue; }

    // ── 分割线 ──
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      html.push('<hr style="border:none;border-top:2rpx solid #ececee;margin:20rpx 0;"/>');
      i++; continue;
    }

    // ── 引用 ──
    if (line.startsWith('> ')) {
      html.push('<blockquote style="border-left:6rpx solid #4a6cf7;padding:12rpx 20rpx;margin:12rpx 0;background:#f5f5f7;border-radius:4rpx;color:#6e6e73;font-size:26rpx;">' + inlineMd(line.slice(2)) + '</blockquote>');
      i++; continue;
    }

    // ── 标题 ──
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      const lv = hm[1].length;
      const sizes = {1:'36rpx',2:'32rpx',3:'30rpx',4:'28rpx',5:'26rpx',6:'26rpx'};
      html.push(`<h${lv} style="font-size:${sizes[lv]||'28rpx'};font-weight:700;margin:16rpx 0 8rpx;color:#1d1d1f;">` + inlineMd(hm[2]) + `</h${lv}>`);
      i++; continue;
    }

    // ── 无序列表 ──
    if (/^[-*+]\s/.test(line)) {
      html.push('<ul style="padding-left:32rpx;margin:8rpx 0;">');
      while (i < lines.length && /^[-*+]\s/.test(lines[i].trimEnd())) {
        html.push('<li style="font-size:26rpx;line-height:1.6;margin:4rpx 0;color:#1d1d1f;">' + inlineMd(lines[i].trimEnd().replace(/^[-*+]\s/, '')) + '</li>');
        i++;
      }
      html.push('</ul>');
      continue;
    }

    // ── 有序列表 ──
    if (/^\d+[.、]\s/.test(line)) {
      html.push('<ol style="padding-left:32rpx;margin:8rpx 0;">');
      while (i < lines.length && /^\d+[.、]\s/.test(lines[i].trimEnd())) {
        html.push('<li style="font-size:26rpx;line-height:1.6;margin:4rpx 0;color:#1d1d1f;">' + inlineMd(lines[i].trimEnd().replace(/^\d+[.、]\s/, '')) + '</li>');
        i++;
      }
      html.push('</ol>');
      continue;
    }

    // ── 段落 ──
    html.push('<p style="font-size:26rpx;line-height:1.7;margin:8rpx 0;color:#1d1d1f;">' + inlineMd(line) + '</p>');
    i++;
  }

  if (inCodeBlock && codeBuf.length > 0) {
    html.push('<pre style="background:#f5f5f7;padding:16rpx;border-radius:8rpx;overflow-x:auto;font-size:22rpx;"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  }

  return html.join('\n');
}

/**
 * 行内 Markdown → HTML，带内联样式
 */
function inlineMd(text) {
  return text
    .replace(/`([^`]+)`/g, '<code style="background:#f0f0f2;padding:2rpx 8rpx;border-radius:4rpx;font-size:24rpx;color:#e74c3c;">$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:8rpx;margin:8rpx 0;"/>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#4a6cf7;text-decoration:none;">$1</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '<strong style="font-weight:700;">$1$2</strong>')
    .replace(/\*([^*]+)\*/g, '<em style="font-style:italic;">$1</em>')
    .replace(/(?<!\w)_(\w[^_]*\w)_(?!\w)/g, '<em style="font-style:italic;">$1</em>')
    .replace(/~~([^~]+)~~/g, '<del style="text-decoration:line-through;color:#aeaeb2;">$1</del>');
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

module.exports = { mdToHtml };
