export interface SampleDataDocument {
  filename: string;
  text: string;
}

export const SAMPLE_DATA_DOCUMENTS: SampleDataDocument[] = [
  {
    filename: 'sample-openapi.md',
    text: `# Acme Sample API

## Overview
The Acme Sample API lets documentation teams create, review, and publish release notes from structured product changes.

## Endpoints
- POST /v1/release-notes creates a draft from a product change summary.
- GET /v1/release-notes/{id} returns the latest draft state.
- POST /v1/release-notes/{id}/review runs terminology and structure checks.

## Authentication
Use a workspace API token in the Authorization header. Tokens are scoped to one documentation workspace.

## Example
Request a release note draft when a new API endpoint launches, then review the result before publishing.`,
  },
  {
    filename: 'sample-release-process.md',
    text: `# Sample Release Documentation Process

## Intake
Product managers submit a short change summary, affected users, launch date, and known limitations.

## Drafting
Technical writers turn the summary into release notes, migration notes, and API reference updates.

## Review
The reviewer checks audience fit, terminology, citations, and whether diagrams explain the workflow accurately.

## Publish
Approved drafts move to the docs site and the team archives only metadata about the publishing task.`,
  },
];

export const SAMPLE_DATA_READY_MESSAGE = 'Sample data is loaded in this open session. Ask about the sample API, release process, or documentation review workflow.';
export const SAMPLE_DATA_PROMPT = 'Summarize the sample API and release documentation workflow.';

export function createSampleDataFiles(): File[] {
  return SAMPLE_DATA_DOCUMENTS.map((document) => new File(
    [document.text],
    document.filename,
    { type: 'text/markdown' },
  ));
}
