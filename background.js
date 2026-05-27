const CACHE_KEY = "ciCache";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function getToken() {
  const data = await chrome.storage.local.get("githubPAT");
  return data.githubPAT || null;
}

async function loadCache() {
  const data = await chrome.storage.local.get(CACHE_KEY);
  return data[CACHE_KEY] || {};
}

async function saveCache(cache) {
  const now = Date.now();
  const pruned = {};
  for (const [sha, entry] of Object.entries(cache)) {
    if (now - entry.ts < CACHE_MAX_AGE_MS) {
      pruned[sha] = entry;
    }
  }
  await chrome.storage.local.set({ [CACHE_KEY]: pruned });
}

function buildShaQuery(prs) {
  const fragments = prs.map((pr, i) =>
    `pr${i}: repository(owner: "${pr.owner}", name: "${pr.repo}") { pullRequest(number: ${pr.number}) { headRefOid mergeable } }`
  );
  return `query { ${fragments.join("\n")} }`;
}

function buildChecksQuery(prs, shas) {
  const fragments = prs.map((pr, i) =>
    `pr${i}: repository(owner: "${pr.owner}", name: "${pr.repo}") {
      pullRequest(number: ${pr.number}) {
        headRefOid
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                state
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { conclusion status }
                    ... on StatusContext { state }
                  }
                }
              }
            }
          }
        }
      }
    }`
  );
  return `query { ${fragments.join("\n")} }`;
}

function aggregateChecks(prData) {
  if (!prData || !prData.pullRequest) return null;
  const sha = prData.pullRequest.headRefOid;
  const commits = prData.pullRequest.commits?.nodes;
  if (!commits || commits.length === 0) return { sha, status: "none", detail: "" };

  const rollup = commits[0].commit.statusCheckRollup;
  if (!rollup) return { sha, status: "none", detail: "" };

  const contexts = rollup.contexts?.nodes || [];
  let total = 0, success = 0, failure = 0, pending = 0, skipped = 0;

  for (const ctx of contexts) {
    if (ctx.__typename === "CheckRun") {
      total++;
      if (ctx.status !== "COMPLETED") pending++;
      else if (ctx.conclusion === "SUCCESS") success++;
      else if (ctx.conclusion === "FAILURE" || ctx.conclusion === "TIMED_OUT" || ctx.conclusion === "CANCELLED") failure++;
      else if (ctx.conclusion === "SKIPPED" || ctx.conclusion === "NEUTRAL") skipped++;
      else success++;
    } else if (ctx.__typename === "StatusContext") {
      total++;
      if (ctx.state === "SUCCESS") success++;
      else if (ctx.state === "FAILURE" || ctx.state === "ERROR") failure++;
      else if (ctx.state === "PENDING") pending++;
    }
  }

  const active = total - skipped;
  if (active === 0) return { sha, status: "none", detail: "" };
  if (failure > 0) return { sha, status: "fail", detail: `${failure}/${active} FAIL` };
  if (pending > 0) return { sha, status: "pending", detail: `${active - pending}/${active} RUNNING` };
  return { sha, status: "pass", detail: "CI PASS" };
}

async function graphqlFetch(token, query) {
  const resp = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("GraphQL error:", resp.status, text);
    return null;
  }
  const json = await resp.json();
  if (json.errors) console.error("GraphQL errors:", json.errors);
  return json.data;
}

async function fetchBatch(prs) {
  const token = await getToken();
  if (!token) return prs.map(() => ({ status: "none", detail: "", error: "No token configured" }));

  const cache = await loadCache();
  const results = new Array(prs.length).fill(null);

  // Step 1: fetch head SHAs for all PRs (lightweight query)
  const shaData = await graphqlFetch(token, buildShaQuery(prs));
  if (!shaData) return prs.map(() => ({ status: "none", detail: "" }));

  const shas = [];
  const mergeables = [];
  const needChecks = [];
  for (let i = 0; i < prs.length; i++) {
    const pr = shaData[`pr${i}`]?.pullRequest;
    const sha = pr?.headRefOid;
    shas[i] = sha;
    mergeables[i] = pr?.mergeable || "UNKNOWN";
    if (sha && cache[sha]) {
      results[i] = { ...cache[sha].result, mergeable: mergeables[i] };
    } else {
      needChecks.push(i);
    }
  }

  // Step 2: fetch full check-runs only for cache misses
  if (needChecks.length > 0) {
    const checksData = await graphqlFetch(
      token,
      buildChecksQuery(needChecks.map((i) => prs[i]))
    );

    for (let j = 0; j < needChecks.length; j++) {
      const i = needChecks[j];
      const prData = checksData?.[`pr${j}`];
      const agg = aggregateChecks(prData);
      if (agg) {
        const result = { status: agg.status, detail: agg.detail, mergeable: mergeables[i] };
        results[i] = result;
        if (agg.status === "pass") {
          cache[agg.sha] = { result, ts: Date.now() };
        }
      } else {
        results[i] = { status: "none", detail: "" };
      }
    }

    await saveCache(cache);
  }

  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetchCIBatch") {
    fetchBatch(msg.prs).then(sendResponse);
    return true;
  }
});
