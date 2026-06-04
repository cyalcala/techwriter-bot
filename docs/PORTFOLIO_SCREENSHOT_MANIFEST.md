# Portfolio Screenshot Manifest

Date: 2026-06-05
Status: Phase 5C screenshot checklist captured

This manifest records the production screenshots captured for portfolio,
buyer, and recruiter collateral. The screenshots were captured from the
production alias `https://tw-bot.pages.dev` after docs commit `d575f1f`
deployed successfully in GitHub Actions run `26979708985`.

Deployment evidence:

- Commit: `d575f1f` (`docs: record phase 5c collateral acceptance`)
- GitHub Actions run: `26979708985`
- Immutable deployment: `https://502ec3e0.tw-bot.pages.dev`
- Graphify CI graph: 1112 nodes and 1677 edges
- Production health: `ok`, 4 active providers out of 6, app version `0.0.1`,
  no version mismatch

## Screenshot Set

Images are stored in `output/playwright/phase-5c-portfolio/`.

1. [App shell, privacy notice, empty session, and export/import controls](../output/playwright/phase-5c-portfolio/01-app-shell-empty-session.png)
2. [Sample data loaded into the active session](../output/playwright/phase-5c-portfolio/02-sample-data-loaded.png)
3. [Tools panel with Review Document selected](../output/playwright/phase-5c-portfolio/03-tools-review-document.png)
4. [Glossary rules textarea](../output/playwright/phase-5c-portfolio/04-glossary-rules-textarea.png)
5. [Document review result showing no findings](../output/playwright/phase-5c-portfolio/05-document-review-no-findings.png)
6. [Bounded graph lookup result](../output/playwright/phase-5c-portfolio/06-bounded-graph-lookup-result.png)
7. [Documentation coverage map result](../output/playwright/phase-5c-portfolio/07-documentation-coverage-map.png)
8. [Explain code area result for `createCodeAreaExplanation`](../output/playwright/phase-5c-portfolio/08-code-area-explanation-result.png)
9. [Artifact split view with rendered Mermaid diagram](../output/playwright/phase-5c-portfolio/09-artifact-split-view-rendered-diagram.png)
10. [Artifact source and export controls](../output/playwright/phase-5c-portfolio/10-artifact-source-export-controls.png)
11. [`/api/health` response evidence](../output/playwright/phase-5c-portfolio/11-health-response-evidence.png)
12. [GitHub Actions successful deployment run](../output/playwright/phase-5c-portfolio/12-github-actions-success-run.png)
13. [Expanded privacy notice in an empty session](../output/playwright/phase-5c-portfolio/13-privacy-notice-expanded-empty-session.png)

## Checklist Coverage

- App shell with `Technical Writer`, privacy notice, and `Try sample data`:
  screenshots 1 and 13.
- Empty session suggested prompts: screenshot 1.
- Sample data loaded into the active session: screenshot 2.
- Tools panel with `Review Document` selected: screenshot 3.
- Glossary rules textarea: screenshot 4.
- Document review findings or `No findings`: screenshot 5.
- Tools panel with `Find Code References` selected: screenshots 6 through 8.
- Bounded graph lookup result: screenshot 6.
- Documentation coverage map result: screenshot 7.
- `Explain code area` result for `createCodeAreaExplanation`: screenshot 8.
- Artifact split view with a rendered diagram: screenshot 9.
- Artifact source/export controls: screenshot 10.
- Session export/import controls: screenshot 1.
- `/api/health` response evidence with sanitized provider availability: screenshot 11.
- GitHub Actions successful deployment run: screenshot 12.

## Notes

- The screenshots are external collateral only. They do not add an in-app
  marketing page or broaden product scope.
- The artifact flow first surfaced a Mermaid syntax error from one generated
  diagram, then produced a clean rendered Mermaid flowchart after a shorter
  valid-diagram prompt. The committed screenshots use the clean rendered state.
- The remaining Phase 5 readiness work is client-specific onboarding and a
  real-client credential deployment pilot.
