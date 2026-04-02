import airtableStepScript from '../renderer/features/workspace/components/airtable-step.js?raw';
import historyPanelScript from '../renderer/features/workspace/components/history-panel.js?raw';
import intakeStepScript from '../renderer/features/workspace/components/intake-step.js?raw';
import reviewStepScript from '../renderer/features/workspace/components/review-step.js?raw';
import submissionDetailScript from '../renderer/features/workspace/components/submission-detail.js?raw';
import wizardNavScript from '../renderer/features/workspace/components/wizard-nav.js?raw';

import { evalUmdScripts, resetGlobals } from './helpers/umd-loader';
import { componentFrame } from './helpers/story-layout';

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export default {
  title: 'App/Workspace Components',
  tags: ['autodocs'],
};

export const AirtableStep = {
  args: {
    hasSyncError: false,
  },
  argTypes: {
    hasSyncError: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceAirtableStep']);
    evalUmdScripts([airtableStepScript]);
    const html = globalThis.workspaceAirtableStep.renderAirtableStep({
      state: {
        airtable: {
          syncStatus: args.hasSyncError ? 'error' : 'linked',
          lastErrorCode: args.hasSyncError ? 'AIRTABLE_422' : '',
          lastErrorDetail: args.hasSyncError ? 'Workflow Status field missing in mapped Airtable table.' : '',
          recordId: args.hasSyncError ? '' : 'rec_123',
          lastSyncedAt: args.hasSyncError ? '' : '2026-03-18T12:00:00Z',
          recordUrl: args.hasSyncError ? '' : 'https://airtable.com/rec_123',
        },
      },
      draft: {
        packName: 'Summer Pack',
        labelName: 'File Eaters',
        releaseMonth: '2026-05',
        tags: ['house', 'vocal'],
        notes: 'Draft notes',
      },
      workflowContext: { airtableFormCompleted: true, airtableLinkedKnown: true, airtableLinked: true },
      escapeHtml,
      buildReleaseMonthOptions: () => '<option value="2026-05" selected>2026-05</option>',
    });
    return componentFrame(html);
  },
};

export const AirtableStepError = {
  args: {
    showError: true,
  },
  argTypes: {
    showError: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceAirtableStep']);
    evalUmdScripts([airtableStepScript]);
    const html = globalThis.workspaceAirtableStep.renderAirtableStep({
      state: {
        airtable: {
          syncStatus: args.showError ? 'error' : 'linked',
          lastErrorCode: args.showError ? 'AIRTABLE_422' : '',
          lastErrorDetail: args.showError ? 'Workflow Status field missing in mapped Airtable table.' : '',
          recordId: '',
          lastSyncedAt: '',
          recordUrl: '',
        },
      },
      draft: {
        packName: 'Summer Pack',
        labelName: 'File Eaters',
        releaseMonth: '2026-05',
        tags: ['house', 'vocal'],
        notes: 'Draft notes',
      },
      workflowContext: { airtableFormCompleted: false, airtableLinkedKnown: true, airtableLinked: false },
      escapeHtml,
      buildReleaseMonthOptions: () => '<option value="2026-05" selected>2026-05</option>',
    });
    return componentFrame(html);
  },
};

export const IntakeStep = {
  args: {
    hasBlockingIssues: false,
  },
  argTypes: {
    hasBlockingIssues: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceIntakeStep']);
    evalUmdScripts([intakeStepScript]);
    const html = globalThis.workspaceIntakeStep.renderIntakeStep({
      state: {
        selectedFolder: { path: '/Users/me/Desktop/pack', fileCount: 128 },
        isSubmitting: false,
        uploadProgress: 0,
        uploadStatus: '',
        isQcRunning: false,
      },
      qcResult: { status: args.hasBlockingIssues ? 'fail' : 'pass', findingCount: args.hasBlockingIssues ? 3 : 0 },
      qcStatusMarkup: args.hasBlockingIssues
        ? '<p class="auth-subtle mt-3">QC found blocking issues.</p>'
        : '<p class="auth-subtle mt-3">QC passed with no blocking findings.</p>',
      checklistMarkup: '<ul class="mt-3 text-sm"><li>Audio folder present</li><li>Project file present</li></ul>',
      hasFolder: true,
      missingFolders: args.hasBlockingIssues ? ['Audio'] : [],
      escapeHtml,
      buildStructureGateMessage: () => (args.hasBlockingIssues ? 'Missing required folders' : 'Folder structure complete'),
      buildMissingRequiredFolderGuidance: () => (args.hasBlockingIssues ? 'Add required folders before running QC again.' : ''),
      buildRemediationMarkup: () => (args.hasBlockingIssues
        ? '<ul class="mt-3 text-sm"><li>Rename ZIP file to match policy</li><li>Add preview MP3</li></ul>'
        : '<p class="auth-subtle">No remediation required.</p>'),
    });
    return componentFrame(html);
  },
};

export const IntakeStepWithBlockers = {
  args: {
    hasManyFindings: true,
    showGuidance: true,
  },
  argTypes: {
    hasManyFindings: { control: { type: 'boolean' } },
    showGuidance: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceIntakeStep']);
    evalUmdScripts([intakeStepScript]);
    const html = globalThis.workspaceIntakeStep.renderIntakeStep({
      state: {
        selectedFolder: { path: '/Users/me/Desktop/pack', fileCount: 96 },
        isSubmitting: false,
        uploadProgress: 0,
        uploadStatus: '',
        isQcRunning: false,
      },
      qcResult: { status: 'fail', findingCount: args.hasManyFindings ? 4 : 2 },
      qcStatusMarkup: '<p class="auth-subtle mt-3">QC found blocking issues.</p>',
      checklistMarkup: '<ul class="mt-3 text-sm"><li>Audio folder missing</li><li>Artwork folder missing</li></ul>',
      hasFolder: true,
      missingFolders: ['Audio', 'Artwork'],
      escapeHtml,
      buildStructureGateMessage: () => 'Missing required folders',
      buildMissingRequiredFolderGuidance: () => (args.showGuidance ? 'Add Audio and Artwork folders to continue.' : ''),
      buildRemediationMarkup: () => '<ul class="mt-3 text-sm"><li>Rename ZIP file to match policy</li><li>Add preview MP3</li></ul>',
    });
    return componentFrame(html);
  },
};

export const ReviewStep = {
  args: {
    canSubmit: true,
  },
  argTypes: {
    canSubmit: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceReviewStep']);
    evalUmdScripts([reviewStepScript]);
    const html = globalThis.workspaceReviewStep.renderReviewStep({
      state: { isSubmitting: false },
      canSubmit: args.canSubmit,
      readiness: { canSubmit: args.canSubmit, blockers: args.canSubmit ? [] : ['Resolve blockers'] },
      escapeHtml,
      buildReadinessSummaryText: () => 'Ready to submit.',
      buildReadinessBlockersMarkup: () => '',
    });
    return componentFrame(html);
  },
};

export const ReviewStepBlocked = {
  args: {
    includeMetadataBlocker: true,
  },
  argTypes: {
    includeMetadataBlocker: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceReviewStep']);
    evalUmdScripts([reviewStepScript]);
    const html = globalThis.workspaceReviewStep.renderReviewStep({
      state: { isSubmitting: false },
      canSubmit: false,
      readiness: {
        canSubmit: false,
        blockers: args.includeMetadataBlocker
          ? ['QC blockers remain', 'Airtable form not completed']
          : ['QC blockers remain'],
      },
      escapeHtml,
      buildReadinessSummaryText: () => 'Resolve blockers before submitting.',
      buildReadinessBlockersMarkup: () => (
        args.includeMetadataBlocker
          ? '<ul class="mt-3 text-sm"><li>QC blockers remain</li><li>Airtable form not completed</li></ul>'
          : '<ul class="mt-3 text-sm"><li>QC blockers remain</li></ul>'
      ),
    });
    return componentFrame(html);
  },
};

export const SubmissionDetail = {
  args: {
    isApproved: false,
    isRejected: false,
  },
  argTypes: {
    isApproved: { control: { type: 'boolean' } },
    isRejected: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceSubmissionDetail']);
    evalUmdScripts([submissionDetailScript]);
    const html = globalThis.workspaceSubmissionDetail.renderSubmissionDetail({
      submission: {
        submissionId: 'sub-001',
        packName: 'Summer Pack',
        currentState: args.isApproved ? 'approved' : (args.isRejected ? 'rejected' : 'under_review'),
        releaseMonth: '2026-05',
        notes: 'Ready for reviewer feedback',
        updatedAt: '2026-03-18T12:10:00Z',
      },
      selectedTimeline: [
        { toState: 'draft', reason: 'created', createdAt: '2026-03-18T10:00:00Z' },
        { toState: 'under_review', reason: 'submitted', createdAt: '2026-03-18T11:00:00Z' },
      ],
      escapeHtml,
    });
    return componentFrame(html);
  },
};

export const WizardNav = {
  args: {
    activeReviewStep: false,
  },
  argTypes: {
    activeReviewStep: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceWizardNav']);
    evalUmdScripts([wizardNavScript]);
    const html = `
      <div class="grid gap-3 max-w-lg">
        ${globalThis.workspaceWizardNav.renderWizardNav(
          [
            { id: 'intake', status: args.activeReviewStep ? 'done' : 'done' },
            { id: 'airtable', status: args.activeReviewStep ? 'done' : 'active' },
            { id: 'review', status: args.activeReviewStep ? 'active' : 'pending' },
          ],
          args.activeReviewStep ? 'review' : 'airtable',
          { intake: 'Intake', airtable: 'Airtable', review: 'Review & Submit' },
          escapeHtml,
        )}
      </div>
    `;
    return componentFrame(html);
  },
};

export const HistoryPanel = {
  args: {
    includeRejected: true,
  },
  argTypes: {
    includeRejected: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceHistoryPanel', 'workspaceSubmissionDetail']);
    evalUmdScripts([submissionDetailScript, historyPanelScript]);
    const html = globalThis.workspaceHistoryPanel.renderHistory({
      submissions: [
        { submissionId: 'sub-001', packName: 'Night Textures', currentState: 'under_review', updatedAt: '2026-03-17T10:56:27Z' },
        ...(args.includeRejected ? [{ submissionId: 'sub-002', packName: 'Skyline Vox', currentState: 'rejected', updatedAt: '2026-03-16T08:00:00Z' }] : []),
      ],
      timelinesBySubmissionId: {
        'sub-001': [{ toState: 'under_review', createdAt: '2026-03-17T10:56:27Z' }],
        'sub-002': [{ toState: 'rejected', reason: 'missing_assets', createdAt: '2026-03-16T08:00:00Z' }],
      },
      escapeHtml,
    });
    return componentFrame(html);
  },
};

export const HistoryPanelEmpty = {
  args: {
    showEmptyState: true,
  },
  argTypes: {
    showEmptyState: { control: { type: 'boolean' } },
  },
  render: (args) => {
    resetGlobals(['workspaceHistoryPanel', 'workspaceSubmissionDetail']);
    evalUmdScripts([submissionDetailScript, historyPanelScript]);
    const html = globalThis.workspaceHistoryPanel.renderHistory({
      submissions: args.showEmptyState
        ? []
        : [{ submissionId: 'sub-003', packName: 'Late Bloom', currentState: 'draft', updatedAt: '2026-03-18T08:00:00Z' }],
      timelinesBySubmissionId: args.showEmptyState
        ? {}
        : { 'sub-003': [{ toState: 'draft', reason: 'created', createdAt: '2026-03-18T08:00:00Z' }] },
      escapeHtml,
    });
    return componentFrame(html);
  },
};
