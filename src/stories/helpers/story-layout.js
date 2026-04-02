export function pageFrame(html, options = {}) {
  const width = options.width || 'min(1280px,98vw)';
  const minHeight = options.minHeight || '720px';
  const padding = options.padding || '16px';
  const background = options.background || 'var(--ds-surface-page)';
  return `
    <div style="width:${width};min-height:${minHeight};padding:${padding};background:${background}">
      ${html}
    </div>
  `;
}

export function componentFrame(html, options = {}) {
  const width = options.width || 'min(1000px,96vw)';
  const padding = options.padding || '20px';
  const background = options.background || 'var(--ds-surface-page)';
  return `<div style="width:${width};padding:${padding};background:${background}">${html}</div>`;
}
