const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('renderer keeps canonical navigation resolution unchanged for active routes', () => {
  const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');

  global.window = {};
  global.document = {
    getElementById() {
      return null;
    },
  };

  delete require.cache[rendererPath];
  const renderer = require(rendererPath);

  assert.equal(renderer.resolveNavigableView('notifications'), 'notifications');
  assert.equal(renderer.resolveNavigableView('submissions-history'), 'submissions');

  delete global.window;
  delete global.document;
});
