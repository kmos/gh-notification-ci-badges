async function getToken() {
  const data = await chrome.storage.local.get("githubPAT");
  return data.githubPAT || null;
}

function buildQuery(prs) {
  const fragments = prs.map((pr, i) =>
    `pr${i}: repository(owner: "${pr.owner}", name: "${pr.repo}") {
      pullRequest(number: ${pr.number}) {
        mergeable
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
  if (!prData?.pullRequest) return { status: "none", detail: "", mergeable: "UNKNOWN" };
  const pr = prData.pullRequest;
  const mergeable = pr.mergeable || "UNKNOWN";
  const commits = pr.commits?.nodes;
  if (!commits || commits.length === 0) return { status: "none", detail: "", mergeable };

  const rollup = commits[0].commit.statusCheckRollup;
  if (!rollup) return { status: "none", detail: "", mergeable };

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
  if (active === 0) return { status: "none", detail: "", mergeable };
  if (failure > 0 && pending > 0) return { status: "unstable", detail: `${failure}/${active} FAIL (${pending} RUNNING)`, mergeable };
  if (failure > 0) return { status: "fail", detail: `${failure}/${active} FAIL`, mergeable };
  if (pending > 0) return { status: "pending", detail: `${active - pending}/${active} RUNNING`, mergeable };
  return { status: "pass", detail: "CI PASS", mergeable };
}

async function fetchBatch(prs) {
  const token = await getToken();
  if (!token) return prs.map(() => ({ status: "none", detail: "", mergeable: "UNKNOWN" }));

  const resp = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: buildQuery(prs) }),
  });

  if (!resp.ok) {
    console.error("GraphQL error:", resp.status, await resp.text());
    return prs.map(() => ({ status: "none", detail: "", mergeable: "UNKNOWN" }));
  }

  const json = await resp.json();
  if (json.errors) console.error("GraphQL errors:", json.errors);
  const data = json.data;
  if (!data) return prs.map(() => ({ status: "none", detail: "", mergeable: "UNKNOWN" }));

  return prs.map((_, i) => aggregateChecks(data[`pr${i}`]));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetchCIBatch") {
    fetchBatch(msg.prs).then(sendResponse);
    return true;
  }
});
