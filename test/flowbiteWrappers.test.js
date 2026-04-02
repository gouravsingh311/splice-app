const test = require('node:test');
const assert = require('node:assert/strict');

const wrappers = require('../src/renderer/ui/flowbite-wrappers.js');
const {
  button,
  input,
  select,
  textarea,
  badge,
  tabsList,
  tabTrigger,
  dropdownTrigger,
  dropdownMenu,
  modalContainer,
  modalPanel,
  buildAttributeString,
} = wrappers;

const wrapperEntries = [
  ['button', button],
  ['input', input],
  ['select', select],
  ['textarea', textarea],
  ['badge', badge],
  ['tabsList', tabsList],
  ['tabTrigger', tabTrigger],
  ['dropdownTrigger', dropdownTrigger],
  ['dropdownMenu', dropdownMenu],
  ['modalContainer', modalContainer],
  ['modalPanel', modalPanel],
];

test('Flowbite wrappers expose the expected API surface', () => {
  wrapperEntries.forEach(([name, fn]) => {
    assert.equal(typeof fn, 'function', `${name} should be a function`);
  });
});

function assertWrapperData(attrs, wrapperName, expectedControl) {
  assert.strictEqual(attrs['data-ui-wrapper'], wrapperName);
  assert.strictEqual(attrs['data-ui-control'], expectedControl || wrapperName);
}

test('button wrapper enforces stable data attributes and accessibility flags', () => {
  const output = button({
    size: 'lg',
    tone: 'danger',
    control: 'confirm-action',
    testId: 'confirm-btn',
    uiId: 'confirm-button',
    disabled: true,
  });
  assertWrapperData(output.attrs, 'button', 'confirm-action');
  assert.strictEqual(output.attrs.disabled, true);
  assert.strictEqual(output.attrs['aria-disabled'], 'true');
  assert.strictEqual(output.attrs['data-testid'], 'confirm-btn');
  assert.strictEqual(output.attrs['data-ui-id'], 'confirm-button');
  assert.strictEqual(output.attrs.type, 'button');
});

test('form field wrappers propagate invalid, described, and disabled states with stable hooks', () => {
  const inputOutput = input({
    type: 'email',
    invalid: true,
    describedBy: 'email-hint',
    disabled: true,
    control: 'email-field',
    testId: 'email-input',
  });
  assertWrapperData(inputOutput.attrs, 'input', 'email-field');
  assert.strictEqual(inputOutput.attrs['aria-invalid'], 'true');
  assert.strictEqual(inputOutput.attrs['aria-describedby'], 'email-hint');
  assert.strictEqual(inputOutput.attrs['aria-disabled'], 'true');
  assert.strictEqual(inputOutput.attrs['data-testid'], 'email-input');

  const selectOutput = select({
    invalid: false,
    describedBy: 'select-hint',
    control: 'filter-select',
  });
  assertWrapperData(selectOutput.attrs, 'select', 'filter-select');
  assert.strictEqual(selectOutput.attrs['aria-describedby'], 'select-hint');

  const textareaOutput = textarea({
    rows: 4,
    describedBy: 'notes-hint',
    control: 'notes-field',
  });
  assertWrapperData(textareaOutput.attrs, 'textarea', 'notes-field');
  assert.strictEqual(textareaOutput.attrs.rows, '4');
});

test('badge wrapper keeps role semantics and optional selectors', () => {
  const badgeOutput = badge({
    role: 'status',
    control: 'status-chip',
    uiId: 'status-chip',
    testId: 'status-chip',
  });
  assertWrapperData(badgeOutput.attrs, 'badge', 'status-chip');
  assert.strictEqual(badgeOutput.attrs.role, 'status');
  assert.strictEqual(badgeOutput.attrs['data-testid'], 'status-chip');
});

test('tab wrappers expose tablist semantics and selection hooks', () => {
  const tabsOutput = tabsList({ orientation: 'vertical', control: 'review-tabs' });
  assertWrapperData(tabsOutput.attrs, 'tabs-list', 'review-tabs');
  assert.strictEqual(tabsOutput.attrs.role, 'tablist');
  assert.strictEqual(tabsOutput.attrs['aria-orientation'], 'vertical');

  const triggerOutput = tabTrigger({
    id: 'tab-1',
    controls: 'panel-1',
    selected: true,
  });
  assertWrapperData(triggerOutput.attrs, 'tab-trigger');
  assert.strictEqual(triggerOutput.attrs.role, 'tab');
  assert.strictEqual(triggerOutput.attrs['aria-selected'], 'true');
  assert.strictEqual(triggerOutput.attrs['aria-controls'], 'panel-1');
  assert.strictEqual(triggerOutput.attrs.tabindex, '0');
});

test('dropdown wrappers expose menu semantics and aria-state hooks', () => {
  const triggerOutput = dropdownTrigger({
    id: 'dropdown-toggle',
    controls: 'dropdown-menu',
    expanded: true,
    testId: 'filters-toggle',
  });
  assertWrapperData(triggerOutput.attrs, 'dropdown-trigger');
  assert.strictEqual(triggerOutput.attrs['aria-haspopup'], 'menu');
  assert.strictEqual(triggerOutput.attrs['aria-expanded'], 'true');
  assert.strictEqual(triggerOutput.attrs['aria-controls'], 'dropdown-menu');
  assert.strictEqual(triggerOutput.attrs['data-testid'], 'filters-toggle');

  const menuOutput = dropdownMenu({
    labelledBy: 'dropdown-toggle',
    tabIndex: 2,
  });
  assertWrapperData(menuOutput.attrs, 'dropdown-menu');
  assert.strictEqual(menuOutput.attrs.role, 'menu');
  assert.strictEqual(menuOutput.attrs['aria-labelledby'], 'dropdown-toggle');
  assert.strictEqual(menuOutput.attrs.tabindex, '2');
});

test('modal wrappers keep presentation semantics and aria hooks', () => {
  const containerOutput = modalContainer({ hidden: true, control: 'alert-modal' });
  assertWrapperData(containerOutput.attrs, 'modal-container', 'alert-modal');
  assert.strictEqual(containerOutput.attrs.role, 'presentation');
  assert.strictEqual(containerOutput.attrs['aria-hidden'], 'true');

  const panelOutput = modalPanel({
    labelledBy: 'modal-title',
    describedBy: 'modal-description',
    tabIndex: 0,
  });
  assertWrapperData(panelOutput.attrs, 'modal-panel');
  assert.strictEqual(panelOutput.attrs.role, 'dialog');
  assert.strictEqual(panelOutput.attrs['aria-modal'], 'true');
  assert.strictEqual(panelOutput.attrs['aria-labelledby'], 'modal-title');
  assert.strictEqual(panelOutput.attrs['aria-describedby'], 'modal-description');
  assert.strictEqual(panelOutput.attrs.tabindex, '0');
});

test('buildAttributeString sorts keys and emits boolean attributes', () => {
  const attrString = buildAttributeString({
    b: 'two',
    a: 'one',
    disabled: true,
  });
  assert.strictEqual(attrString, 'a="one" b="two" disabled');
});
