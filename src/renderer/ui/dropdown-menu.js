(function (global) {
  function isElement(value) {
    return Boolean(value) && typeof value === 'object' && typeof value.addEventListener === 'function';
  }

  function mergeClassNames() {
    var seen = Object.create(null);
    var result = [];
    for (var i = 0; i < arguments.length; i += 1) {
      var value = arguments[i];
      if (!value) { continue; }
      String(value).split(/\s+/).forEach(function (token) {
        if (!token || seen[token]) { return; }
        seen[token] = true;
        result.push(token);
      });
    }
    return result.join(' ');
  }

  function wireDropdownMenus(specs, options) {
    var menuSpecs = Array.isArray(specs) ? specs.slice() : [];
    var cfg = options || {};
    var rootSelector = cfg.rootSelector || '.ui-dropdown';
    var opened = null;

    function getOptionButtons(spec) {
      if (!spec.menuEl || typeof spec.menuEl.querySelectorAll !== 'function') { return []; }
      return Array.from(spec.menuEl.querySelectorAll('[data-dropdown-option]'));
    }

    function getSelectedOption(spec) {
      var selectEl = spec.selectEl;
      if (!selectEl || !selectEl.options || selectEl.selectedIndex < 0) { return null; }
      return selectEl.options[selectEl.selectedIndex] || null;
    }

    function syncLabel(spec) {
      var selected = getSelectedOption(spec);
      if (spec.labelEl && selected) {
        spec.labelEl.textContent = selected.textContent || spec.labelEl.textContent;
      }
      var buttons = getOptionButtons(spec);
      buttons.forEach(function (btn) {
        var value = btn.getAttribute('data-value') || '';
        var selectedValue = spec.selectEl ? String(spec.selectEl.value || '') : '';
        var isCurrent = value === selectedValue;
        btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
        btn.classList.toggle('is-selected', isCurrent);
      });
    }

    function setPlacement(spec) {
      if (!spec.triggerEl || !spec.menuEl) { return; }
      if (typeof spec.triggerEl.getBoundingClientRect !== 'function' || typeof spec.menuEl.getBoundingClientRect !== 'function') {
        return;
      }
      var triggerRect = spec.triggerEl.getBoundingClientRect();
      var menuRect = spec.menuEl.getBoundingClientRect();
      var viewportHeight = (global.innerHeight || 0);
      var viewportWidth = (global.innerWidth || 0);
      var showAbove = triggerRect.bottom + menuRect.height + 12 > viewportHeight && triggerRect.top - menuRect.height - 12 > 0;

      spec.menuEl.classList.toggle('ui-dropdown-menu--top', showAbove);
      spec.menuEl.classList.toggle('ui-dropdown-menu--bottom', !showAbove);

      var left = triggerRect.left;
      var maxLeft = Math.max(8, viewportWidth - menuRect.width - 8);
      if (left > maxLeft) { left = maxLeft; }
      if (left < 8) { left = 8; }

      spec.menuEl.style.position = 'fixed';
      spec.menuEl.style.left = String(left) + 'px';
      spec.menuEl.style.minWidth = String(Math.max(triggerRect.width, 160)) + 'px';
      spec.menuEl.style.maxWidth = String(Math.max(triggerRect.width, 160)) + 'px';
      if (showAbove) {
        spec.menuEl.style.top = String(Math.max(8, triggerRect.top - menuRect.height - 6)) + 'px';
      } else {
        spec.menuEl.style.top = String(Math.min(viewportHeight - menuRect.height - 8, triggerRect.bottom + 6)) + 'px';
      }
      spec.menuEl.style.maxHeight = '260px';
      spec.menuEl.style.overflowY = 'auto';
    }

    function close(spec) {
      if (!spec) { return; }
      spec.menuEl.classList.add('hidden');
      spec.triggerEl.setAttribute('aria-expanded', 'false');
      if (spec.rootEl) { spec.rootEl.classList.remove('is-open'); }
      spec.triggerEl.classList.remove('is-open');
      if (opened === spec) {
        opened = null;
      }
    }

    function closeAll(except) {
      prepared.forEach(function (spec) {
        if (spec === except) { return; }
        close(spec);
      });
    }

    function open(spec) {
      if (!spec) { return; }
      closeAll(spec);
      syncLabel(spec);
      spec.menuEl.classList.remove('hidden');
      spec.triggerEl.setAttribute('aria-expanded', 'true');
      if (spec.rootEl) { spec.rootEl.classList.add('is-open'); }
      spec.triggerEl.classList.add('is-open');
      opened = spec;
      setPlacement(spec);
    }

    function focusOption(spec, direction) {
      var options = getOptionButtons(spec);
      if (!options.length) { return; }
      var idx = options.findIndex(function (btn) { return btn === global.document.activeElement; });
      var nextIndex = idx;
      if (idx === -1) {
        nextIndex = direction > 0 ? 0 : options.length - 1;
      } else {
        nextIndex = (idx + direction + options.length) % options.length;
      }
      options[nextIndex].focus();
    }

    var prepared = menuSpecs.map(function (spec) {
      var selectEl = global.document.getElementById(spec.selectId);
      var triggerEl = global.document.getElementById(spec.triggerId);
      var menuEl = global.document.getElementById(spec.menuId);
      var labelEl = global.document.getElementById(spec.labelId);
      if (!isElement(selectEl) || !isElement(triggerEl) || !isElement(menuEl) || !isElement(labelEl)) {
        return null;
      }
      var rootEl = triggerEl.closest(rootSelector);
      return {
        selectEl: selectEl,
        triggerEl: triggerEl,
        menuEl: menuEl,
        labelEl: labelEl,
        rootEl: rootEl,
      };
    }).filter(Boolean);

    prepared.forEach(function (spec) {
      syncLabel(spec);
      spec.selectEl.addEventListener('change', function () {
        syncLabel(spec);
      });

      spec.triggerEl.addEventListener('click', function (event) {
        event.preventDefault();
        if (opened === spec) {
          close(spec);
          return;
        }
        open(spec);
      });

      spec.triggerEl.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          open(spec);
          focusOption(spec, event.key === 'ArrowDown' ? 1 : -1);
        }
      });

      getOptionButtons(spec).forEach(function (optBtn) {
        optBtn.addEventListener('click', function () {
          var value = optBtn.getAttribute('data-value') || '';
          spec.selectEl.value = value;
          spec.selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          close(spec);
          spec.triggerEl.focus();
        });

        optBtn.addEventListener('keydown', function (event) {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusOption(spec, 1);
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusOption(spec, -1);
            return;
          }
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            optBtn.click();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            close(spec);
            spec.triggerEl.focus();
          }
        });
      });

      spec.menuEl.addEventListener('keydown', function (event) {
        if (event.key === 'Tab') {
          close(spec);
        }
      });
    });

    function onDocumentClick(event) {
      var target = event.target;
      if (!target || typeof target.closest !== 'function') {
        closeAll(null);
        return;
      }
      if (!target.closest(rootSelector)) {
        closeAll(null);
      }
    }

    function onDocumentKeydown(event) {
      if (event.key === 'Escape') {
        closeAll(null);
      }
    }

    function onViewportChange() {
      if (opened) {
        setPlacement(opened);
      }
    }

    if (global.document && typeof global.document.addEventListener === 'function') {
      global.document.addEventListener('click', onDocumentClick);
      global.document.addEventListener('keydown', onDocumentKeydown);
    }
    if (typeof global.addEventListener === 'function') {
      global.addEventListener('resize', onViewportChange);
      global.addEventListener('scroll', onViewportChange, true);
    }

    return {
      closeAll: function () { closeAll(null); },
      syncAll: function () { prepared.forEach(syncLabel); },
      destroy: function () {
        if (global.document && typeof global.document.removeEventListener === 'function') {
          global.document.removeEventListener('click', onDocumentClick);
          global.document.removeEventListener('keydown', onDocumentKeydown);
        }
        if (typeof global.removeEventListener === 'function') {
          global.removeEventListener('resize', onViewportChange);
          global.removeEventListener('scroll', onViewportChange, true);
        }
      },
    };
  }

  global.uiDropdownMenu = {
    wire: wireDropdownMenus,
    mergeClassNames: mergeClassNames,
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
