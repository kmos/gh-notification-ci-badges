# GitHub Notification CI Badges

A Chrome extension that adds inline CI status badges to pull request notifications on [github.com/notifications](https://github.com/notifications). See at a glance which PRs are passing, failing, running, or have merge conflicts — without clicking through to each one.

## Badges

| Badge | Meaning |
|-------|---------|
| **CI PASS** (green) | All check runs succeeded |
| **N/M FAIL** (red) | N out of M active checks failed |
| **N/M RUNNING** (yellow) | Checks are still in progress |
| **NO CI** (gray) | No check runs found |
| **CONFLICTS** (red) | PR has merge conflicts |

## Requirements

A GitHub Personal Access Token (PAT) with the `repo` scope is required. The extension uses the GitHub GraphQL API to fetch CI status and mergeability for each PR in a single batched request.

### Creating a token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token** (classic)
3. Give it a descriptive name (e.g., "CI Badges Extension")
4. Select the **repo** scope
5. Click **Generate token** and copy it

If you already have a PAT with `repo` scope (e.g., from Refined GitHub), you can reuse it.

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `gh-notification-ci-badges` directory
6. Click the extension's **Options** link (or right-click the extension icon and choose "Options")
7. Paste your GitHub PAT and click **Save**
8. Navigate to [github.com/notifications](https://github.com/notifications) — CI badges will appear inline next to each PR title

## How it works

When the notifications page loads, the extension:

1. Scans for PR notification rows and injects a loading indicator
2. Sends a batched GraphQL query to fetch the head SHA and mergeability for all visible PRs
3. Checks a local cache (keyed by commit SHA) for previously successful results
4. Fetches full check-run status only for cache misses
5. Replaces the loading indicators with the final CI and merge-conflict badges

Only successful CI results are cached (keyed by SHA, 7-day TTL). Failures, pending, and no-CI states are always re-fetched to reflect the latest status. There is no background polling — badges only update on page load or navigation.

## Updating

After pulling new changes, go to `chrome://extensions` and click the reload button on the extension card.
