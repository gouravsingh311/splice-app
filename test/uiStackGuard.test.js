const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { runGuard } = require('../scripts/guards/ui-stack-guard.js');

async function createFixture(pkg, extraFiles = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-stack-')); 
  await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(pkg));
  const fileEntries = Object.entries(extraFiles);
  for (const [relative, content] of fileEntries) {
    const filePath = path.join(tempDir, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  }
  return tempDir;
}

test('guard passes on clean project', async () => {
  const pkg = { dependencies: { flowbite: '^4.0.1' }, devDependencies: {} };
  const tempDir = await createFixture(pkg, { 'src/index.js': 'console.log("safe");' });
  await assert.doesNotReject(async () => runGuard(tempDir));
});

test('guard fails when banned dependency exists', async () => {
  const banned = ['sha', 'dcn'].join('');
  const pkg = { dependencies: { [banned]: '^1.0.0' } };
  const tempDir = await createFixture(pkg);
  await assert.rejects(
    async () => runGuard(tempDir),
    err => {
      assert.ok(err.message.includes('Banned dependency'));
      return true;
    }
  );
});

module.exports = {};
