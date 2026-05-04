function redact(value, visible = 4) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= visible) {
    return "*".repeat(text.length);
  }
  return `${"*".repeat(Math.max(0, text.length - visible))}${text.slice(-visible)}`;
}

function normalizeSeverity(value) {
  return String(value || "low").trim().toLowerCase();
}

function isHighPriorityFinding(finding) {
  const severity = normalizeSeverity(finding?.severity);
  return severity === "critical" || severity === "high";
}

async function sendSlackAlert(message, options = {}) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return {
      sent: false,
      reason: "slack_webhook_not_configured"
    };
  }

  const findings = Array.isArray(options.findings) ? options.findings : [];
  const highPriority = findings.filter(isHighPriorityFinding);

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "VENOM Security Alert"
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: message
      }
    }
  ];

  if (options.engagementId) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Engagement: \`${options.engagementId}\``
        }
      ]
    });
  }

  if (highPriority.length > 0) {
    const preview = highPriority
      .slice(0, 3)
      .map((finding) => `- [${normalizeSeverity(finding.severity).toUpperCase()}] ${finding.title}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*High-priority findings (${highPriority.length}):*\n${preview}`
      }
    });
  }

  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ blocks }),
    signal:
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(10000)
        : undefined
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Slack webhook failed (${response.status}): ${body.slice(0, 180)}`);
  }

  return {
    sent: true,
    destination: `slack:${redact(webhook)}`
  };
}

function toJiraPriority(severity) {
  const value = normalizeSeverity(severity);
  if (value === "critical") {
    return "Highest";
  }
  if (value === "high") {
    return "High";
  }
  if (value === "medium") {
    return "Medium";
  }
  return "Low";
}

async function createJiraTicket(finding, engagementName = "VENOM Engagement") {
  const baseUrl = process.env.JIRA_API_URL;
  const projectKey = process.env.JIRA_PROJECT_KEY;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !projectKey || !email || !token) {
    return {
      created: false,
      reason: "jira_not_fully_configured"
    };
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const summary = `[VENOM] ${finding?.title || "Security Finding"} - ${engagementName}`;
  const description = finding?.description || "Finding captured by VENOM.";

  const payload = {
    fields: {
      project: { key: projectKey },
      summary,
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: description }]
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `Recommendation: ${finding?.recommendation || "Review and patch according to policy."}`
              }
            ]
          }
        ]
      },
      issuetype: { name: "Bug" },
      priority: { name: toJiraPriority(finding?.severity) },
      labels: ["venom", "security"]
    }
  };

  const endpoint = `${baseUrl.replace(/\/$/, "")}/rest/api/3/issue`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${auth}`
    },
    body: JSON.stringify(payload),
    signal:
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(15000)
        : undefined
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Jira issue create failed (${response.status}): ${body.slice(0, 180)}`);
  }

  const data = await response.json().catch(() => ({}));
  return {
    created: true,
    issueKey: data?.key || null
  };
}

async function notifyCriticalFindings({
  engagementId,
  engagementName,
  findings
}) {
  const relevant = Array.isArray(findings)
    ? findings.filter(isHighPriorityFinding)
    : [];
  if (relevant.length === 0) {
    return {
      notified: false,
      reason: "no_high_priority_findings"
    };
  }

  const summary = `High-priority findings detected in engagement ${engagementName || engagementId}.`;

  const slack = await sendSlackAlert(summary, {
    engagementId,
    findings: relevant
  }).catch((error) => ({
    sent: false,
    reason: error.message
  }));

  const jiraResults = [];
  for (const finding of relevant.slice(0, 5)) {
    // eslint-disable-next-line no-await-in-loop
    const jira = await createJiraTicket(
      finding,
      engagementName || engagementId
    ).catch((error) => ({
      created: false,
      reason: error.message
    }));
    jiraResults.push({
      title: finding.title,
      ...jira
    });
  }

  return {
    notified: true,
    highPriorityFindings: relevant.length,
    slack,
    jiraResults
  };
}

module.exports = {
  sendSlackAlert,
  createJiraTicket,
  notifyCriticalFindings
};

