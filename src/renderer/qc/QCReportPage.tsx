import * as React from "react";
import { CATEGORY_ORDER, guidanceCatalog } from "./guidanceCatalog";

type Severity = "blocking" | "warning";
type DiffTag = "new" | "resolved" | "unchanged";

type Finding = {
  findingId: string;
  ruleId: string;
  severity: Severity;
  category: (typeof CATEGORY_ORDER)[number];
  fileRef: string | null;
  message: string;
  remediation: string;
  diffTag?: DiffTag;
};

type QcRun = {
  runId: string;
  status: "passed" | "failed";
  startedAt: string;
  completedAt: string;
  findings: Finding[];
};

type Props = {
  run: QcRun;
  severityFilter: "all" | Severity;
  categoryFilter: "all" | (typeof CATEGORY_ORDER)[number];
  onSeverityFilterChange: (value: "all" | Severity) => void;
  onCategoryFilterChange: (value: "all" | (typeof CATEGORY_ORDER)[number]) => void;
  onRerun: () => void;
  onExport: () => void;
};

const categoryLabel: Record<(typeof CATEGORY_ORDER)[number], string> = {
  "folder": "Folder",
  "audio-zip": "Audio ZIP",
  "samples": "Samples",
  "demo": "Demo",
  "description": "Description",
  "artwork": "Artwork",
  "presets": "Presets",
  "midi": "MIDI",
};

export function QCReportPage({
  run,
  severityFilter,
  categoryFilter,
  onSeverityFilterChange,
  onCategoryFilterChange,
  onRerun,
  onExport,
}: Props) {
  const filtered = React.useMemo(() => {
    return run.findings
      .filter((finding) => (severityFilter === "all" ? true : finding.severity === severityFilter))
      .filter((finding) => (categoryFilter === "all" ? true : finding.category === categoryFilter))
      .sort((a, b) => {
        if (a.severity !== b.severity) {
          return a.severity === "blocking" ? -1 : 1;
        }
        return a.ruleId.localeCompare(b.ruleId);
      });
  }, [run.findings, severityFilter, categoryFilter]);

  const grouped = React.useMemo(() => {
    const map = new Map<(typeof CATEGORY_ORDER)[number], Finding[]>();
    CATEGORY_ORDER.forEach((category) => {
      map.set(category, []);
    });
    filtered.forEach((finding) => {
      map.get(finding.category)?.push(finding);
    });
    return map;
  }, [filtered]);

  const blocking = run.findings.filter((finding) => finding.severity === "blocking").length;
  const warnings = run.findings.filter((finding) => finding.severity === "warning").length;

  return (
    <div>
      <header>
        <h2>QC Report</h2>
        <p>{blocking} blocking | {warnings} warnings</p>
        <p>{run.status === "passed" ? "PASS" : "FAIL"}</p>
      </header>

      <div>
        <select value={severityFilter} onChange={(event) => onSeverityFilterChange(event.target.value as "all" | Severity)}>
          <option value="all">All severities</option>
          <option value="blocking">Blocking</option>
          <option value="warning">Warning</option>
        </select>
        <select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value as "all" | (typeof CATEGORY_ORDER)[number])}>
          <option value="all">All categories</option>
          {CATEGORY_ORDER.map((category) => (
            <option key={category} value={category}>{categoryLabel[category]}</option>
          ))}
        </select>
        <button onClick={onRerun}>Re-run QC</button>
        <button onClick={onExport}>Export findings</button>
      </div>

      {CATEGORY_ORDER.map((category) => {
        const rows = grouped.get(category) ?? [];
        if (rows.length === 0) {
          return null;
        }
        return (
          <section key={category}>
            <h3>{categoryLabel[category]}</h3>
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Rule ID</th>
                  <th>File</th>
                  <th>Message</th>
                  <th>Remediation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((finding) => {
                  const normalizedRule = finding.ruleId.toUpperCase();
                  const catalogRemediation = guidanceCatalog[normalizedRule]?.remediation;
                  return (
                    <tr key={finding.findingId}>
                      <td>{finding.severity}</td>
                      <td>{finding.diffTag ?? "unchanged"}</td>
                      <td>{finding.ruleId}</td>
                      <td>{finding.fileRef ?? "-"}</td>
                      <td>{finding.message}</td>
                      <td>{catalogRemediation ?? finding.remediation}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
