(function (global, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (global && typeof global === 'object') { global.flowbiteWrappers = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeOptions(options) {
    if (!options || typeof options !== 'object') {
      return {};
    }
    return options;
  }

  function normalizeString(value) {
    if (value == null) { return ''; }
    return String(value).trim();
  }

  function mergeClasses() {
    var classes = [];
    var seen = Object.create(null);
    for (var i = 0; i < arguments.length; i += 1) {
      var value = normalizeString(arguments[i]);
      if (!value) { continue; }
      value.split(/\s+/).forEach(function (name) {
        if (!name || seen[name]) { return; }
        seen[name] = true;
        classes.push(name);
      });
    }
    return classes.join(' ');
  }

  function readOption(options, keys) {
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (Object.prototype.hasOwnProperty.call(options, key) && options[key] != null) {
        return options[key];
      }
    }
    return undefined;
  }

  function buildDataAttributes(wrapperName, options) {
    var control = readOption(options, ['control', 'dataUiControl', 'data-ui-control']);
    var testId = readOption(options, ['testId', 'dataTestId', 'data-testid']);
    var uiId = readOption(options, ['uiId', 'dataUiId', 'data-ui-id']);
    var attrs = {
      'data-ui-wrapper': wrapperName,
      'data-ui-control': normalizeString(control) || wrapperName,
    };
    if (testId != null && testId !== '') { attrs['data-testid'] = String(testId); }
    if (uiId != null && uiId !== '') { attrs['data-ui-id'] = String(uiId); }
    return attrs;
  }

  function mergeAttributes(base, extra) {
    var attrs = {};
    Object.keys(base || {}).forEach(function (key) {
      attrs[key] = base[key];
    });
    Object.keys(extra || {}).forEach(function (key) {
      if (extra[key] === undefined || extra[key] === null || extra[key] === false) {
        return;
      }
      attrs[key] = extra[key];
    });
    return attrs;
  }

  function escapeAttribute(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildAttributeString(attrs) {
    var keys = Object.keys(attrs || {}).filter(function (key) {
      return attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== false;
    }).sort();
    return keys.map(function (key) {
      var value = attrs[key];
      if (value === true) {
        return key;
      }
      return key + '="' + escapeAttribute(value) + '"';
    }).join(' ');
  }

  function buildWrapperOutput(className, attrs) {
    return {
      className: className,
      attrs: attrs,
      attrString: buildAttributeString(attrs),
    };
  }

  function button(options) {
    var opts = normalizeOptions(options);
    var size = normalizeString(opts.size) || 'md';
    var tone = normalizeString(opts.tone) || 'primary';
    var sizes = {
      sm: 'px-3.5 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-5 py-2.5 text-base',
    };
    var tones = {
      primary: 'border border-brand-border bg-brand-accent text-brand-text-strong shadow-[3px_3px_0_0_var(--ds-color-text)] hover:brightness-95 hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_var(--ds-color-text)]',
      secondary: 'border border-brand-border bg-brand-bg text-brand-text shadow-[3px_3px_0_0_var(--ds-color-text)] hover:bg-brand-surface-alt hover:translate-y-[1px] hover:shadow-[2px_2px_0_0_var(--ds-color-text)]',
      ghost: 'border border-transparent bg-transparent text-brand-text hover:bg-brand-surface-alt',
      danger: 'bg-brand-danger text-white hover:brightness-95',
    };
    var className = mergeClasses(
      'inline-flex items-center justify-center gap-2 rounded-brand-pill font-semibold transition duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:opacity-60 disabled:cursor-not-allowed',
      sizes[size] || sizes.md,
      tones[tone] || tones.primary,
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('button', opts), {
      type: normalizeString(opts.type) || 'button',
      disabled: opts.disabled ? true : undefined,
      'aria-disabled': opts.disabled ? 'true' : undefined,
    });
    return buildWrapperOutput(className, attrs);
  }

  function input(options) {
    var opts = normalizeOptions(options);
    var className = mergeClasses(
      'block w-full rounded-brand-sm border border-brand-border/70 bg-brand-bg px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('input', opts), {
      type: normalizeString(opts.type) || 'text',
      disabled: opts.disabled ? true : undefined,
      'aria-disabled': opts.disabled ? 'true' : undefined,
      'aria-invalid': opts.invalid ? 'true' : undefined,
      'aria-describedby': normalizeString(opts.describedBy) || undefined,
    });
    return buildWrapperOutput(className, attrs);
  }

  function select(options) {
    var opts = normalizeOptions(options);
    var className = mergeClasses(
      'block w-full rounded-brand-sm border border-brand-border/70 bg-brand-bg px-3 py-2 text-sm text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('select', opts), {
      disabled: opts.disabled ? true : undefined,
      'aria-disabled': opts.disabled ? 'true' : undefined,
      'aria-invalid': opts.invalid ? 'true' : undefined,
      'aria-describedby': normalizeString(opts.describedBy) || undefined,
    });
    return buildWrapperOutput(className, attrs);
  }

  function textarea(options) {
    var opts = normalizeOptions(options);
    var className = mergeClasses(
      'block w-full rounded-brand-sm border border-brand-border/70 bg-brand-bg px-3 py-2 text-sm text-brand-text placeholder:text-brand-text/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('textarea', opts), {
      rows: opts.rows ? String(opts.rows) : undefined,
      disabled: opts.disabled ? true : undefined,
      'aria-disabled': opts.disabled ? 'true' : undefined,
      'aria-invalid': opts.invalid ? 'true' : undefined,
      'aria-describedby': normalizeString(opts.describedBy) || undefined,
    });
    return buildWrapperOutput(className, attrs);
  }

  function badge(options) {
    var opts = normalizeOptions(options);
    var className = mergeClasses(
      'inline-flex items-center gap-1 rounded-brand-pill bg-brand-accent px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-text-strong',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('badge', opts), {
      role: normalizeString(opts.role) || 'status',
    });
    return buildWrapperOutput(className, attrs);
  }

  function tabsList(options) {
    var opts = normalizeOptions(options);
    var orientation = normalizeString(opts.orientation) || 'horizontal';
    var className = mergeClasses(
      'flex items-center gap-2',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('tabs-list', opts), {
      role: 'tablist',
      'aria-orientation': orientation,
    });
    return buildWrapperOutput(className, attrs);
  }

  function tabTrigger(options) {
    var opts = normalizeOptions(options);
    var selected = !!opts.selected;
    var className = mergeClasses(
      'inline-flex items-center gap-2 rounded-brand-pill px-3.5 py-2 text-sm font-semibold text-brand-text transition duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
      selected ? 'border border-brand-border bg-brand-accent text-brand-text-strong shadow-[2px_2px_0_0_var(--ds-color-text)]' : 'border border-transparent hover:bg-brand-surface-alt',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('tab-trigger', opts), {
      role: 'tab',
      id: normalizeString(opts.id) || undefined,
      'aria-selected': selected ? 'true' : 'false',
      'aria-controls': normalizeString(opts.controls) || undefined,
      tabindex: selected ? '0' : '-1',
    });
    return buildWrapperOutput(className, attrs);
  }

  function dropdownTrigger(options) {
    var opts = normalizeOptions(options);
    var expanded = !!opts.expanded;
    var className = mergeClasses(
      'inline-flex items-center justify-center gap-2 rounded-brand-sm border border-brand-border bg-brand-surface-alt px-3 py-2 text-sm font-semibold text-brand-text transition duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('dropdown-trigger', opts), {
      type: normalizeString(opts.type) || 'button',
      id: normalizeString(opts.id) || undefined,
      'aria-haspopup': 'menu',
      'aria-expanded': expanded ? 'true' : 'false',
      'aria-controls': normalizeString(opts.controls) || undefined,
    });
    return buildWrapperOutput(className, attrs);
  }

  function dropdownMenu(options) {
    var opts = normalizeOptions(options);
    var className = mergeClasses(
      'min-w-[12rem] rounded-brand-sm border border-brand-border bg-brand-surface p-2 shadow-brand-md',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('dropdown-menu', opts), {
      role: 'menu',
      'aria-orientation': 'vertical',
      'aria-labelledby': normalizeString(opts.labelledBy) || undefined,
      tabindex: opts.tabIndex != null ? String(opts.tabIndex) : '-1',
    });
    return buildWrapperOutput(className, attrs);
  }

  function modalContainer(options) {
    var opts = normalizeOptions(options);
    var className = mergeClasses(
      'fixed inset-0 z-50 flex items-center justify-center bg-black/40',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('modal-container', opts), {
      role: normalizeString(opts.role) || 'presentation',
      'aria-hidden': opts.hidden ? 'true' : undefined,
    });
    return buildWrapperOutput(className, attrs);
  }

  function modalPanel(options) {
    var opts = normalizeOptions(options);
    var className = mergeClasses(
      'w-full max-w-lg rounded-brand-lg bg-brand-surface p-6 text-brand-text shadow-brand-md',
      opts.className
    );
    var attrs = mergeAttributes(buildDataAttributes('modal-panel', opts), {
      role: normalizeString(opts.role) || 'dialog',
      'aria-modal': opts.ariaModal === false ? undefined : 'true',
      'aria-labelledby': normalizeString(opts.labelledBy) || undefined,
      'aria-describedby': normalizeString(opts.describedBy) || undefined,
      tabindex: opts.tabIndex != null ? String(opts.tabIndex) : '-1',
    });
    return buildWrapperOutput(className, attrs);
  }

  return {
    button: button,
    input: input,
    select: select,
    textarea: textarea,
    badge: badge,
    tabsList: tabsList,
    tabTrigger: tabTrigger,
    dropdownTrigger: dropdownTrigger,
    dropdownMenu: dropdownMenu,
    modalContainer: modalContainer,
    modalPanel: modalPanel,
    buildAttributeString: buildAttributeString,
  };
});
