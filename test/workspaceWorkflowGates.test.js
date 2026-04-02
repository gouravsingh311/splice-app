const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext, buildStepState } = require('../src/renderer/workspace/workflow-gates.js');

test('workflow gates block submit when Airtable step is incomplete', () => {
  const context = buildContext({
    draft: {
      submissionId: 'sub-1',
      packName: 'Pack',
      labelName: 'Label',
      releaseMonth: '2026-03',
      notes: '',
      tags: [],
    },
    airtable: {
      formCompleted: false,
      payloadChecksum: '',
      syncStatus: null,
    },
    hasFolder: true,
    missingRequiredFolders: [],
    qcPassed: true,
    isSubmitting: false,
  });

  assert.equal(context.canSubmit, false);
  assert.equal(context.activeStep, 'airtable');
  assert.match(context.blockers.join(' '), /Airtable Submission Details/i);
});

test('workflow gates block submit when required folders are missing', () => {
  const context = buildContext({
    draft: {
      submissionId: 'sub-2',
      packName: 'Pack',
      labelName: 'Label',
      releaseMonth: '2026-03',
      notes: '',
      tags: [],
    },
    airtable: {
      formCompleted: true,
      payloadChecksum: 'checksum',
      syncStatus: 'linked',
    },
    hasFolder: true,
    missingRequiredFolders: ['Demo/Demos'],
    qcPassed: true,
    isSubmitting: false,
  });

  assert.equal(context.canSubmit, false);
  assert.equal(context.activeStep, 'intake');
  assert.match(context.blockers.join(' '), /Demo\/Demos/);
});

test('workflow gates block submit when Airtable sync status is unknown', () => {
  const context = buildContext({
    draft: {
      submissionId: 'sub-unknown',
      packName: 'Pack',
      labelName: 'Label',
      releaseMonth: '2026-03',
      notes: '',
      tags: [],
    },
    airtable: {
      formCompleted: true,
      payloadChecksum: 'checksum',
      syncStatus: null,
    },
    hasFolder: true,
    missingRequiredFolders: [],
    qcPassed: true,
    isSubmitting: false,
  });

  assert.equal(context.canSubmit, false);
  assert.equal(context.activeStep, 'airtable');
  assert.match(context.blockers.join(' '), /could not confirm/i);
});

test('workflow gates allow submit only when all canonical gates pass', () => {
  const context = buildContext({
    draft: {
      submissionId: 'sub-3',
      packName: 'Pack',
      labelName: 'Label',
      releaseMonth: '2026-03',
      notes: '',
      tags: ['drums'],
    },
    airtable: {
      formCompleted: true,
      payloadChecksum: 'checksum',
      syncStatus: 'linked',
    },
    hasFolder: true,
    missingRequiredFolders: [],
    qcPassed: true,
    isSubmitting: false,
  });

  assert.equal(context.canSubmit, true);
  assert.equal(context.activeStep, 'review');
  assert.deepEqual(context.blockers, []);

  const steps = buildStepState(context);
  assert.equal(steps.length, 4);
  assert.equal(steps[0].status, 'done');
  assert.equal(steps[1].status, 'done');
  assert.equal(steps[2].status, 'done');
  assert.equal(steps[3].status, 'done');
});
