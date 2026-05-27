const PR_ICON_SELECTORS = [
  ".octicon-git-pull-request",
  ".octicon-git-pull-request-draft",
];

const SKIP_ICON_SELECTORS = [
  ".octicon-git-merge",
  ".octicon-git-pull-request-closed",
  ".octicon-issue-opened",
  ".octicon-issue-closed",
  ".octicon-skip",
];

const CHECK_SVG = '<svg viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';
const X_SVG = '<svg viewBox="0 0 16 16"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>';
const DOT_SVG = '<svg viewBox="0 0 16 16"><path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/></svg>';

function makeLoadingBadge() {
  const span = document.createElement("span");
  span.className = "gh-ci-badge gh-ci-loading";
  span.innerHTML = DOT_SVG + "CI…";
  return span;
}

function makeCiBadge(status, detail) {
  const span = document.createElement("span");
  span.className = "gh-ci-badge";
  if (status === "pass") {
    span.classList.add("gh-ci-pass");
    span.innerHTML = CHECK_SVG + "CI PASS";
  } else if (status === "unstable") {
    span.classList.add("gh-ci-unstable");
    span.innerHTML = X_SVG + detail;
  } else if (status === "fail") {
    span.classList.add("gh-ci-fail");
    span.innerHTML = X_SVG + detail;
  } else if (status === "pending") {
    span.classList.add("gh-ci-pending");
    span.innerHTML = DOT_SVG + detail;
  } else if (status === "none") {
    span.classList.add("gh-ci-none");
    span.innerHTML = DOT_SVG + "NO CI";
  }
  return span;
}

function makeMergeableBadge(mergeable) {
  if (mergeable === "MERGEABLE" || mergeable === "UNKNOWN") return null;
  const span = document.createElement("span");
  span.className = "gh-ci-badge gh-merge-conflict";
  span.innerHTML = X_SVG + "CONFLICTS";
  return span;
}

function parsePrUrl(href) {
  const m = href.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

function isPrNotification(row) {
  const combined = PR_ICON_SELECTORS.join(", ");
  return row.querySelector(combined) !== null;
}

function shouldSkip(row) {
  const combined = SKIP_ICON_SELECTORS.join(", ");
  return row.querySelector(combined) !== null;
}

function getTitleLink(row) {
  const link = row.querySelector(".notification-list-item-link a");
  if (link) return link;
  const links = row.querySelectorAll("a");
  for (const a of links) {
    if (a.href && /\/pull\/\d+/.test(a.href)) return a;
  }
  return null;
}

let processing = false;

async function processNotifications() {
  if (processing) return;
  processing = true;

  try {
    const rows = document.querySelectorAll(".notifications-list-item");
    const batch = [];
    const rowMap = [];

    for (const row of rows) {
      if (row.querySelector(".gh-ci-badge")) continue;
      if (shouldSkip(row)) continue;
      if (!isPrNotification(row)) continue;

      const link = getTitleLink(row);
      if (!link) continue;

      const pr = parsePrUrl(link.href);
      if (!pr) continue;

      const loader = makeLoadingBadge();
      link.appendChild(loader);
      batch.push(pr);
      rowMap.push({ link, loader });
    }

    if (batch.length === 0) return;

    const results = await chrome.runtime.sendMessage({
      type: "fetchCIBatch",
      prs: batch,
    });

    if (!results) return;

    for (let i = 0; i < results.length; i++) {
      const { status, detail, mergeable } = results[i];
      const { link, loader } = rowMap[i];
      loader.remove();
      link.appendChild(makeCiBadge(status, detail));
      const mergeBadge = makeMergeableBadge(mergeable);
      if (mergeBadge) link.appendChild(mergeBadge);
    }
  } finally {
    processing = false;
  }
}

let debounceTimer = null;

function scheduleProcess() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(processNotifications, 100);
}

scheduleProcess();

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.addedNodes.length > 0) {
      scheduleProcess();
      return;
    }
  }
});

const target = document.querySelector(".js-check-all-container") || document.body;
observer.observe(target, { childList: true, subtree: true });
