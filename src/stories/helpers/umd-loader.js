import { pageFrame } from './story-layout';

export function resetGlobals(keys) {
  (keys || []).forEach((key) => {
    try {
      delete globalThis[key];
    } catch (_e) {
      globalThis[key] = undefined;
    }
  });
}

export function evalUmdScripts(scripts) {
  (scripts || []).forEach((code) => {
    (0, eval)(String(code));
  });
}

export function ensureTemplateVisible(template) {
  if (!template) return '';
  const html = String(template);
  return html.replace(
    /(<section\b[^>]*\bclass=")([^"]*\bfe-view\b[^"]*)(\bhidden\b)([^"]*)(")/i,
    (_m, prefix, beforeHidden, hiddenToken, afterHidden, suffix) => {
      const merged = `${beforeHidden}${afterHidden}`.replace(/\s+/g, ' ').trim();
      return `${prefix}${merged}${suffix}`;
    },
  );
}

function normalizeStatePatch(patch, prevState) {
  if (typeof patch === 'function') {
    return patch(prevState);
  }
  return patch || {};
}

function createInteractiveRoot({ getHtml, initialState, mount }) {
  const root = document.createElement('div');
  root.dataset.storyInteractive = 'true';
  let state = { ...(initialState || {}) };

  const render = () => {
    root.innerHTML = pageFrame(ensureTemplateVisible(getHtml(state)));
    if (typeof mount === 'function') {
      mount(root, {
        state,
        update(patch) {
          state = { ...state, ...normalizeStatePatch(patch, state) };
          render();
        },
      });
    }
  };

  render();
  return root;
}

export function renderTemplateStory({ scripts, globalsToReset, getTemplate, args, mount, initialState }) {
  resetGlobals(globalsToReset || []);
  evalUmdScripts(scripts || []);
  const currentArgs = args || {};
  const getHtml = (state) => {
    if (typeof getTemplate === 'function') {
      return getTemplate(currentArgs, state);
    }
    return '';
  };

  if (typeof mount === 'function') {
    return createInteractiveRoot({
      getHtml,
      initialState: { ...(initialState || {}), ...currentArgs },
      mount,
    });
  }

  const html = ensureTemplateVisible(getHtml({ ...(initialState || {}), ...currentArgs }));
  return pageFrame(html);
}
