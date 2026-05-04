# 🐍 VENOM — FULL 12-WEEK AUTONOMOUS EVOLUTION IMPLEMENTATION PLAN

> **Project:** VENOM (Versatile Evolutionary Network Offensive Methodology)  
> **Baseline:** v0.8 — Live on Render + Vercel + MongoDB Atlas  
> **Goal:** Transform VENOM from a structured tool into a fully autonomous, self-researching, self-evolving AI-powered penetration testing system that improves itself without human interaction.  
> **Philosophy:** Director's cut. Spec everything. Build once. Let it run forever.

---

## 🧠 MASTER ARCHITECTURE VISION

Before the plan begins — understand what VENOM becomes by Week 12:

```
┌─────────────────────────────────────────────────────────────────┐
│                        VENOM v1.0 — FINAL STATE                 │
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │ Operator  │───▶│  Dashboard   │───▶│   Engagement Engine   │  │
│  └──────────┘    └──────────────┘    └──────────┬────────────┘  │
│                                                  │               │
│                         ┌────────────────────────▼────────────┐ │
│                         │         CLAUDE BRAIN LAYER          │ │
│                         │  Plan → Execute → Analyze → Learn   │ │
│                         └────────────────────────┬────────────┘ │
│                                                  │               │
│            ┌─────────────────────────────────────▼────────────┐ │
│            │               TOOL EXECUTION LAYER               │ │
│            │  nmap │ ZAP │ Nikto │ Nuclei │ SQLMap │ Custom   │ │
│            └─────────────────────────────────────┬────────────┘ │
│                                                  │               │
│   ┌──────────────────┐    ┌─────────────────────▼────────────┐ │
│   │  SELF-RESEARCH   │    │         KNOWLEDGE ENGINE          │ │
│   │  NVD/CVE Feeds   │◀──▶│  Patterns │ Chains │ Templates   │ │
│   │  ArXiv/Papers    │    │  Git-versioned prompts + trees   │ │
│   │  PoC Trackers    │    └──────────────────────────────────┘ │
│   └──────────────────┘                                          │
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                  AUTONOMOUS EVOLUTION LOOP               │  │
│   │  Weekly: Ingest CVEs → Evaluate gaps → Update patterns   │  │
│   │  Monthly: Prompt self-review → Improve reasoning chains  │  │
│   │  Continuous: Success metrics → Confidence recalibration  │  │
│   └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📊 FEATURE-TO-WEEK MAP

| # | Feature | Week | Impact |
|---|---------|------|--------|
| 1 | Claude API Real Planning | Week 8 | 🔴 Critical |
| 2 | Pattern Learning Loop | Week 9 | 🔴 Critical |
| 3 | Auto PDF + Email Reports | Week 9 | 🟠 High |
| 4 | Real Tool Integration (nmap/ZAP/Nuclei) | Week 10 | 🔴 Critical |
| 5 | Self-Improving Prompts | Week 11 | 🔴 Critical |
| 6 | CVE/NVD Integration | Week 8 | 🔴 Critical |
| 7 | Automated Exploitation Chains | Week 10 | 🔴 Critical |
| 8 | Multi-Target Orchestration | Week 11 | 🟠 High |
| 9 | Real-Time Collaboration | Week 12 | 🟡 Medium |
| 10 | Compliance Reporting (CVSS/OWASP) | Week 9 | 🟠 High |
| 11 | Evidence Chain of Custody | Week 10 | 🟠 High |
| 12 | External Integrations (Slack/Jira) | Week 12 | 🟡 Medium |
| 13 | Self-Research Engine (AUTONOMOUS) | Week 11–12 | 🔴 Critical |

---

## ⚙️ PRE-WEEK BASELINE CONFIRMATION

Before Week 8 begins, verify all of the following are true:

```bash
# Cloud health checks
curl https://venom-backend-x2pj.onrender.com/health        # → 200
curl https://venom-backend-x2pj.onrender.com/ready         # → 200
curl https://dashboard-sigma-puce-87.vercel.app/api/system/ready  # → 200

# Local test suite
cd backend && npm test       # → 8/8 pass
cd dashboard && npm run lint # → pass
cd dashboard && npm run build # → pass

# Env vars confirmed present on Render:
# CLAUDE_API_KEY ✓
# MONGODB_URI ✓
# VENOM_API_KEY ✓
# ENABLE_DOCKER_TOOLS ✓
```

**DO NOT PROCEED** to any week until baseline is confirmed green.

---

---

# 📅 WEEK 8 — THE BRAIN AWAKENS

## Goal
Replace the template fallback planner with a real Claude API planning loop. Integrate CVE/NVD data feeds as the first autonomous knowledge input. VENOM begins thinking — not template-filling.

---

## Feature 1: Claude API Real Planning (UPDATE #1)

### Problem
`backend/services/planner.js` falls back to a hardcoded template when `CLAUDE_API_KEY` is present but the Claude call path is not properly wired with context enrichment.

### Solution — Replace `planner.js`

```javascript
// backend/services/planner.js — FULL REPLACEMENT

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const Pattern = require('../models/Pattern');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function generatePlan(engagement) {
  const promptV2 = fs.readFileSync(
    path.join(__dirname, '../prompts/planning-agent-v2.txt'),
    'utf-8'
  );

  // Pull top 5 highest-confidence patterns as context
  const topPatterns = await Pattern.find({})
    .sort({ confidence: -1 })
    .limit(5)
    .lean();

  const patternContext = topPatterns.map(p => ({
    name: p.name,
    description: p.description,
    successRate: p.successRate,
    confidence: p.confidence,
    tags: p.tags
  }));

  // Pull latest CVEs from local store (populated by Feature 6)
  const CveSnapshot = require('../models/CveSnapshot');
  const recentCves = await CveSnapshot.find({})
    .sort({ publishedAt: -1 })
    .limit(10)
    .lean();

  const systemPrompt = `${promptV2}

You are VENOM's autonomous planning agent. You must:
1. Analyze the target engagement deeply.
2. Consider the known attack patterns and their historical success rates.
3. Cross-reference recent CVEs that may apply.
4. Output a multi-phase penetration testing plan with prioritized attack vectors.
5. Flag any legal/scope concerns explicitly.

KNOWN PATTERNS (use to inform strategy):
${JSON.stringify(patternContext, null, 2)}

RECENT CVEs (consider applicability to target):
${JSON.stringify(recentCves.map(c => ({ id: c.cveId, description: c.description, cvss: c.cvssScore })), null, 2)}

Output as valid JSON matching the Plan schema. Do not output anything else.`;

  const userPrompt = `Target: ${engagement.targetUrl}
Target Type: ${engagement.targetType}
Scope: ${JSON.stringify({
  allowedDomains: engagement.allowedDomains,
  restrictedPaths: engagement.restrictedPaths,
  toolWhitelist: engagement.toolWhitelist,
  noDestructiveOps: engagement.noDestructiveOps
})}
Authorized By: ${engagement.authorizedBy}
Valid Until: ${engagement.validUntil}
Objective: ${engagement.description}

Generate a complete penetration testing plan.`;

  const response = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const rawOutput = response.content[0].text;

  // Parse JSON plan from Claude output
  let planData;
  try {
    const cleaned = rawOutput.replace(/```json|```/g, '').trim();
    planData = JSON.parse(cleaned);
  } catch (err) {
    // Fallback: ask Claude to re-format
    const fixResponse = await client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: `Convert this to valid JSON only:\n${rawOutput}` }
      ]
    });
    const fixedText = fixResponse.content[0].text.replace(/```json|```/g, '').trim();
    planData = JSON.parse(fixedText);
  }

  return {
    plannerSource: 'claude-api',
    promptVersion: 'planning_v2_2026_05_03',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    rawModelOutput: rawOutput,
    ...planData
  };
}

module.exports = { generatePlan };
```

### Test
```bash
# Create engagement + generate plan via Vercel bridge
curl -X POST https://dashboard.vercel.app/api/backend/api/plan \
  -H "x-api-key: $VENOM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"engagementId": "<id>"}'

# Verify: plannerSource === "claude-api" in response
# Verify: phases contain intelligent, context-specific content (not template phrases)
```

---

## Feature 6: CVE/NVD Integration (AUTONOMOUS KNOWLEDGE INPUT)

### Why Week 8
CVE data feeds Claude's planning brain. Without this, plans are contextless. This is the first autonomous knowledge ingestion.

### MongoDB Model — `backend/models/CveSnapshot.js`

```javascript
const mongoose = require('mongoose');

const CveSnapshotSchema = new mongoose.Schema({
  cveId: { type: String, required: true, unique: true },
  description: String,
  cvssScore: Number,
  cvssVector: String,
  severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  publishedAt: Date,
  modifiedAt: Date,
  affectedProducts: [String],
  references: [String],
  exploitAvailable: { type: Boolean, default: false },
  applicabilityTags: [String], // e.g. ['web', 'cms', 'auth', 'rce']
  venom_relevanceScore: { type: Number, default: 0 },
  ingestedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('CveSnapshot', CveSnapshotSchema);
```

### CVE Ingestion Service — `backend/services/cveIngester.js`

```javascript
const axios = require('axios');
const CveSnapshot = require('../models/CveSnapshot');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const NVD_API = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

async function ingestLatestCves(daysBack = 7) {
  const startDate = new Date(Date.now() - daysBack * 86400000).toISOString();
  const endDate = new Date().toISOString();

  console.log(`[CVE Ingester] Pulling CVEs from ${startDate} to ${endDate}`);

  let startIndex = 0;
  const batchSize = 100;
  let totalIngested = 0;

  while (true) {
    const res = await axios.get(NVD_API, {
      params: {
        pubStartDate: startDate,
        pubEndDate: endDate,
        startIndex,
        resultsPerPage: batchSize
      },
      headers: {
        'apiKey': process.env.NVD_API_KEY || undefined
      },
      timeout: 30000
    });

    const data = res.data;
    const items = data.vulnerabilities || [];
    if (items.length === 0) break;

    for (const item of items) {
      const cve = item.cve;
      const cvssData = cve.metrics?.cvssMetricV31?.[0]?.cvssData ||
                       cve.metrics?.cvssMetricV30?.[0]?.cvssData ||
                       cve.metrics?.cvssMetricV2?.[0]?.cvssData;

      const description = cve.descriptions?.find(d => d.lang === 'en')?.value || '';
      const score = cvssData?.baseScore || 0;
      const severity = cvssData?.baseSeverity || scoreSeverity(score);

      // Use Claude to tag applicability for VENOM context
      const tags = await tagCveForVenom(cve.id, description, score);

      await CveSnapshot.findOneAndUpdate(
        { cveId: cve.id },
        {
          cveId: cve.id,
          description,
          cvssScore: score,
          cvssVector: cvssData?.vectorString,
          severity,
          publishedAt: new Date(cve.published),
          modifiedAt: new Date(cve.lastModified),
          affectedProducts: extractProducts(cve),
          references: (cve.references || []).map(r => r.url).slice(0, 5),
          applicabilityTags: tags,
          venom_relevanceScore: computeRelevance(score, tags),
          ingestedAt: new Date()
        },
        { upsert: true, new: true }
      );

      totalIngested++;
    }

    if (startIndex + batchSize >= data.totalResults) break;
    startIndex += batchSize;

    // Rate-limit: NVD recommends 6s between requests without API key
    await new Promise(r => setTimeout(r, process.env.NVD_API_KEY ? 1000 : 6000));
  }

  console.log(`[CVE Ingester] Done. Ingested/updated ${totalIngested} CVEs.`);
  return totalIngested;
}

async function tagCveForVenom(cveId, description, cvssScore) {
  if (cvssScore < 5.0) return ['low-severity'];

  const response = await client.messages.create({
    model: 'claude-haiku-20241022', // use cheap model for tagging
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `CVE: ${cveId}\nDescription: ${description}\n\nTag this CVE with 1-5 short tags from this list: [web, cms, auth, rce, sqli, xss, ssrf, idor, lfi, rfi, deserialization, cloud, container, api, network, windows, linux, privilege-escalation, information-disclosure]. Output ONLY a JSON array of tags. Nothing else.`
    }]
  });

  try {
    return JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());
  } catch {
    return ['untagged'];
  }
}

function scoreSeverity(score) {
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  return 'LOW';
}

function extractProducts(cve) {
  const products = [];
  cve.configurations?.forEach(config => {
    config.nodes?.forEach(node => {
      node.cpeMatch?.forEach(match => {
        const parts = match.criteria?.split(':');
        if (parts?.[4]) products.push(`${parts[3]} ${parts[4]}`);
      });
    });
  });
  return [...new Set(products)].slice(0, 10);
}

function computeRelevance(cvssScore, tags) {
  const highValueTags = ['rce', 'auth', 'web', 'cms', 'sqli', 'ssrf'];
  const tagScore = tags.filter(t => highValueTags.includes(t)).length * 10;
  return Math.min(100, cvssScore * 5 + tagScore);
}

module.exports = { ingestLatestCves };
```

### Cron Schedule — `backend/jobs/cveJob.js`

```javascript
const cron = require('node-cron');
const { ingestLatestCves } = require('../services/cveIngester');

// Run every day at 02:00 AM UTC
cron.schedule('0 2 * * *', async () => {
  console.log('[CVE Job] Starting daily CVE ingestion...');
  try {
    const count = await ingestLatestCves(1); // last 24 hours
    console.log(`[CVE Job] Completed. ${count} CVEs processed.`);
  } catch (err) {
    console.error('[CVE Job] Failed:', err.message);
  }
});

// On startup: ingest last 7 days to bootstrap
if (process.env.NODE_ENV === 'production') {
  setTimeout(() => ingestLatestCves(7), 10000);
}
```

### API Endpoint

```javascript
// backend/routes/cve.js
const router = require('express').Router();
const CveSnapshot = require('../models/CveSnapshot');
const requireDb = require('../middleware/requireDb');

router.get('/', requireDb, async (req, res) => {
  const { severity, tag, limit = 20 } = req.query;
  const query = {};
  if (severity) query.severity = severity.toUpperCase();
  if (tag) query.applicabilityTags = tag;

  const cves = await CveSnapshot.find(query)
    .sort({ venom_relevanceScore: -1, publishedAt: -1 })
    .limit(parseInt(limit));

  res.json({ count: cves.length, cves });
});

router.get('/stats', requireDb, async (req, res) => {
  const total = await CveSnapshot.countDocuments();
  const critical = await CveSnapshot.countDocuments({ severity: 'CRITICAL' });
  const withExploit = await CveSnapshot.countDocuments({ exploitAvailable: true });
  res.json({ total, critical, withExploit });
});

module.exports = router;
```

### Week 8 Deliverables Checklist
- [ ] `planner.js` fully replaced — Claude API drives all plans
- [ ] `CveSnapshot` model created and migrated
- [ ] `cveIngester.js` working — auto-tags CVEs using Claude Haiku
- [ ] Daily cron job active on Render
- [ ] `GET /api/cve` endpoint returns tagged, scored CVEs
- [ ] Plans now reference CVE data in their output
- [ ] `backend npm test` → all pass
- [ ] Cloud smoke: create engagement → plan shows CVE-aware content

---

---

# 📅 WEEK 9 — LEARNING, REPORTING, COMPLIANCE

## Goals
1. Make patterns truly self-improve after every execution
2. Auto-generate PDF reports and email them
3. Output CVSS/OWASP-compliant compliance reports

---

## Feature 2: Pattern Learning Loop (Self-Improvement Engine)

### Problem
Current `learner.js` updates pattern stats but doesn't use Claude to extract new generalizable patterns or update decision logic.

### Solution — `backend/services/learner.js` FULL REPLACEMENT

```javascript
const Pattern = require('../models/Pattern');
const ExecutionJob = require('../models/ExecutionJob');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function runLearningCycle(engagementId) {
  const jobs = await ExecutionJob.find({ engagementId, status: 'completed' })
    .sort({ finishedAt: -1 });

  if (jobs.length === 0) return { message: 'No completed jobs to learn from.' };

  const successfulJobs = jobs.filter(j => j.output?.findings?.length > 0);
  const failedJobs = jobs.filter(j => !j.output?.findings?.length);

  // Step 1: Update numeric stats for matched patterns
  for (const job of jobs) {
    const success = job.output?.findings?.length > 0;
    const matchedPatterns = await Pattern.find({
      tags: { $in: job.output?.applicabilityTags || [] }
    });

    for (const pattern of matchedPatterns) {
      pattern.successCount += success ? 1 : 0;
      pattern.failureCount += success ? 0 : 1;
      const total = pattern.successCount + pattern.failureCount;
      pattern.successRate = pattern.successCount / total;
      pattern.confidence = Math.min(
        1,
        pattern.successRate * Math.log10(total + 1) / 2
      );
      pattern.recentOutcomes.push(success ? 'success' : 'failure');
      if (pattern.recentOutcomes.length > 20) pattern.recentOutcomes.shift();
      const recentSuccesses = pattern.recentOutcomes.filter(o => o === 'success').length;
      pattern.recentSuccessRate = recentSuccesses / pattern.recentOutcomes.length;
      pattern.lastUsedAt = new Date();
      await pattern.save();
    }
  }

  // Step 2: Ask Claude to extract NEW patterns from findings
  if (successfulJobs.length > 0) {
    const findingsSummary = successfulJobs.map(j => ({
      tool: j.toolId,
      targetUrl: j.targetUrl,
      findings: j.output?.findings || [],
      fingerprint: j.output?.technologyFingerprint
    }));

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Analyze these penetration testing findings and extract any NEW generalizable attack patterns not already obvious. For each pattern found, output a JSON array with objects matching:
{
  "name": string,
  "description": string,
  "targetType": "web"|"api"|"network"|"cloud",
  "tags": string[],
  "exploitSequence": string[],
  "prerequisites": string[],
  "estimatedSuccessRate": number (0.0-1.0),
  "generalizationScore": number (0.0-1.0)
}

Findings data:
${JSON.stringify(findingsSummary, null, 2)}

Output ONLY the JSON array. If no new patterns found, output [].`
      }]
    });

    let newPatterns = [];
    try {
      newPatterns = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());
    } catch { /* no new patterns */ }

    for (const np of newPatterns) {
      const exists = await Pattern.findOne({ name: np.name });
      if (!exists && np.generalizationScore >= 0.6) {
        await Pattern.create({
          ...np,
          successRate: np.estimatedSuccessRate,
          confidence: np.estimatedSuccessRate * np.generalizationScore,
          recentOutcomes: ['success'],
          source: 'claude-extracted'
        });
      }
    }
  }

  // Step 3: Mark all jobs as learned
  await ExecutionJob.updateMany(
    { engagementId },
    { learnedAt: new Date() }
  );

  return {
    jobsProcessed: jobs.length,
    successfulJobs: successfulJobs.length,
    newPatternsExtracted: (await Pattern.countDocuments({ source: 'claude-extracted' }))
  };
}

module.exports = { runLearningCycle };
```

---

## Feature 3: Auto PDF Reports + Email Delivery

### Install Dependencies

```bash
npm install puppeteer nodemailer handlebars
```

### Report Generator — `backend/services/reportGenerator.js`

```javascript
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const Engagement = require('../models/Engagement');
const Plan = require('../models/Plan');
const ExecutionJob = require('../models/ExecutionJob');
const Pattern = require('../models/Pattern');

const REPORT_TEMPLATE = fs.readFileSync(
  path.join(__dirname, '../templates/report.html'), 'utf-8'
);

async function generatePdfReport(engagementId) {
  const engagement = await Engagement.findById(engagementId).lean();
  const plans = await Plan.find({ engagementId }).lean();
  const jobs = await ExecutionJob.find({ engagementId }).lean();

  const allFindings = jobs.flatMap(j => j.output?.findings || []);
  const criticalFindings = allFindings.filter(f =>
    ['critical', 'high'].includes(f.severity?.toLowerCase())
  );

  const templateData = {
    engagementName: engagement.name,
    targetUrl: engagement.targetUrl,
    authorizedBy: engagement.authorizedBy,
    validFrom: new Date(engagement.validFrom).toLocaleDateString(),
    validUntil: new Date(engagement.validUntil).toLocaleDateString(),
    generatedAt: new Date().toLocaleString(),
    totalFindings: allFindings.length,
    criticalFindings: criticalFindings.length,
    findings: allFindings.map(f => ({
      ...f,
      severityColor: severityColor(f.severity)
    })),
    plans: plans.map(p => ({
      summary: p.summary,
      phases: p.phases || []
    })),
    executionStats: {
      totalJobs: jobs.length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      successRate: jobs.length > 0
        ? Math.round(jobs.filter(j => j.status === 'completed').length / jobs.length * 100)
        : 0
    },
    cvssBreakdown: computeCvssBreakdown(allFindings)
  };

  const template = handlebars.compile(REPORT_TEMPLATE);
  const html = template(templateData);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
  });

  await browser.close();
  return pdfBuffer;
}

async function emailReport(engagementId, recipientEmail) {
  const pdfBuffer = await generatePdfReport(engagementId);
  const engagement = await Engagement.findById(engagementId).lean();

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: `VENOM Security <${process.env.SMTP_FROM}>`,
    to: recipientEmail,
    subject: `[VENOM] Penetration Test Report — ${engagement.name}`,
    text: `Please find attached the automated penetration test report for ${engagement.targetUrl}.`,
    html: `<p>Dear Security Team,</p><p>VENOM has completed its automated penetration testing engagement for <strong>${engagement.targetUrl}</strong>.</p><p>Please review the attached PDF report for full findings, exploitation details, and remediation recommendations.</p><p><em>This report was generated autonomously by VENOM v1.0.</em></p>`,
    attachments: [{
      filename: `VENOM-Report-${engagement.name}-${Date.now()}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf'
    }]
  });

  return { sent: true, to: recipientEmail };
}

function severityColor(severity) {
  const map = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#65a30d', info: '#2563eb' };
  return map[severity?.toLowerCase()] || '#6b7280';
}

function computeCvssBreakdown(findings) {
  return {
    critical: findings.filter(f => f.severity?.toLowerCase() === 'critical').length,
    high: findings.filter(f => f.severity?.toLowerCase() === 'high').length,
    medium: findings.filter(f => f.severity?.toLowerCase() === 'medium').length,
    low: findings.filter(f => f.severity?.toLowerCase() === 'low').length
  };
}

module.exports = { generatePdfReport, emailReport };
```

### Report HTML Template — `backend/templates/report.html`

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', sans-serif; color: #1a1a2e; margin: 0; }
    .header { background: #0f0f1a; color: #00ff88; padding: 30px; }
    .header h1 { margin: 0; font-size: 28px; }
    .header p { margin: 5px 0; color: #aaa; }
    .section { padding: 20px 30px; border-bottom: 1px solid #e5e7eb; }
    .section h2 { color: #1a1a2e; font-size: 18px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 15px 0; }
    .kpi { background: #f9fafb; border-radius: 8px; padding: 15px; text-align: center; }
    .kpi .num { font-size: 32px; font-weight: bold; color: #1a1a2e; }
    .kpi .label { color: #6b7280; font-size: 12px; }
    .finding { margin: 10px 0; padding: 12px; border-left: 4px solid; border-radius: 4px; background: #f9fafb; }
    .finding .title { font-weight: 600; }
    .finding .desc { color: #374151; font-size: 13px; margin-top: 4px; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; color: white; font-size: 11px; font-weight: 600; }
    .phase { margin: 8px 0; padding: 10px; background: #f3f4f6; border-radius: 6px; }
    .footer { background: #0f0f1a; color: #666; padding: 15px 30px; font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🐍 VENOM Security Report</h1>
    <p>Engagement: {{engagementName}} | Target: {{targetUrl}}</p>
    <p>Authorized by: {{authorizedBy}} | Valid: {{validFrom}} → {{validUntil}}</p>
    <p>Generated: {{generatedAt}}</p>
  </div>

  <div class="section">
    <h2>Executive Summary</h2>
    <div class="kpi-grid">
      <div class="kpi"><div class="num">{{totalFindings}}</div><div class="label">Total Findings</div></div>
      <div class="kpi"><div class="num" style="color:#dc2626">{{criticalFindings}}</div><div class="label">Critical/High</div></div>
      <div class="kpi"><div class="num">{{executionStats.totalJobs}}</div><div class="label">Tests Run</div></div>
      <div class="kpi"><div class="num">{{executionStats.successRate}}%</div><div class="label">Completion Rate</div></div>
    </div>
  </div>

  <div class="section">
    <h2>Findings</h2>
    {{#each findings}}
    <div class="finding" style="border-color: {{severityColor}}">
      <div class="title">
        {{title}}
        <span class="badge" style="background: {{severityColor}}">{{severity}}</span>
      </div>
      <div class="desc">{{description}}</div>
      {{#if exploitationPotential}}<div style="margin-top:6px;color:#6b7280;font-size:12px">Exploitation Potential: {{exploitationPotential}}</div>{{/if}}
    </div>
    {{/each}}
    {{#unless findings}}
    <p style="color:#6b7280">No findings recorded for this engagement.</p>
    {{/unless}}
  </div>

  <div class="section">
    <h2>Attack Plan Summary</h2>
    {{#each plans}}
    <p>{{summary}}</p>
    {{#each phases}}
    <div class="phase"><strong>{{name}}</strong>: {{description}}</div>
    {{/each}}
    {{/each}}
  </div>

  <div class="footer">
    <p>This report was generated autonomously by VENOM (Versatile Evolutionary Network Offensive Methodology). All testing was conducted within the authorized scope as documented. Unauthorized reproduction or distribution of this report is prohibited.</p>
  </div>
</body>
</html>
```

### Report Route — `backend/routes/reports.js`

```javascript
const router = require('express').Router();
const { generatePdfReport, emailReport } = require('../services/reportGenerator');
const requireDb = require('../middleware/requireDb');
const auth = require('../middleware/auth');

router.get('/:engagementId/pdf', auth, requireDb, async (req, res) => {
  try {
    const pdf = await generatePdfReport(req.params.engagementId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="venom-report-${req.params.engagementId}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:engagementId/email', auth, requireDb, async (req, res) => {
  const { recipientEmail } = req.body;
  if (!recipientEmail) return res.status(400).json({ error: 'recipientEmail required' });
  const result = await emailReport(req.params.engagementId, recipientEmail);
  res.json(result);
});

module.exports = router;
```

---

## Feature 10: Compliance Reporting (CVSS/OWASP)

### OWASP Top 10 Mapping Service — `backend/services/complianceMapper.js`

```javascript
const OWASP_TOP_10_2021 = {
  'A01': { name: 'Broken Access Control', tags: ['idor', 'auth', 'privilege-escalation'] },
  'A02': { name: 'Cryptographic Failures', tags: ['tls', 'information-disclosure'] },
  'A03': { name: 'Injection', tags: ['sqli', 'xss', 'rce', 'lfi', 'rfi'] },
  'A04': { name: 'Insecure Design', tags: ['design'] },
  'A05': { name: 'Security Misconfiguration', tags: ['web', 'cloud', 'container', 'api'] },
  'A06': { name: 'Vulnerable Components', tags: ['cms', 'deserialization'] },
  'A07': { name: 'Auth Failures', tags: ['auth'] },
  'A08': { name: 'Data Integrity Failures', tags: ['deserialization', 'api'] },
  'A09': { name: 'Logging Failures', tags: ['information-disclosure'] },
  'A10': { name: 'SSRF', tags: ['ssrf'] }
};

function mapFindingsToOwasp(findings) {
  const owaspMap = {};

  for (const finding of findings) {
    const findingTags = finding.tags || [];
    for (const [code, owasp] of Object.entries(OWASP_TOP_10_2021)) {
      if (owasp.tags.some(t => findingTags.includes(t) || finding.description?.toLowerCase().includes(t))) {
        if (!owaspMap[code]) owaspMap[code] = { ...owasp, code, findings: [] };
        owaspMap[code].findings.push(finding);
      }
    }
  }

  return owaspMap;
}

function computeOverallCvssScore(findings) {
  if (findings.length === 0) return 0;
  const scores = findings.map(f => f.cvssScore || 0).filter(s => s > 0);
  if (scores.length === 0) return 0;
  // Use max score with environmental modifier
  return Math.min(10, Math.max(...scores) * 1.05);
}

function generateComplianceSummary(findings) {
  const owaspCoverage = mapFindingsToOwasp(findings);
  const cvssScore = computeOverallCvssScore(findings);

  return {
    cvssOverallScore: cvssScore,
    cvssSeverity: cvssScore >= 9 ? 'CRITICAL' : cvssScore >= 7 ? 'HIGH' : cvssScore >= 4 ? 'MEDIUM' : 'LOW',
    owaspCoverage: Object.keys(owaspCoverage).length,
    owaspBreakdown: owaspCoverage,
    owaspRating: Object.keys(owaspCoverage).length >= 5 ? 'HIGH_RISK' : 'MODERATE',
    remediationPriority: findings
      .filter(f => f.cvssScore >= 7.0)
      .sort((a, b) => (b.cvssScore || 0) - (a.cvssScore || 0))
      .slice(0, 5)
  };
}

module.exports = { mapFindingsToOwasp, generateComplianceSummary };
```

### Week 9 Deliverables Checklist
- [ ] Pattern learner extracts new Claude-identified patterns
- [ ] PDF report generates end-to-end from engagement data
- [ ] Email delivery works (SMTP configured on Render)
- [ ] OWASP mapping in compliance report endpoint
- [ ] CVSS scoring computed from findings
- [ ] `GET /api/reports/:id/pdf` → returns downloadable PDF
- [ ] `POST /api/reports/:id/email` → sends PDF to recipient
- [ ] `GET /api/compliance/:engagementId` → CVSS + OWASP breakdown

---

---

# 📅 WEEK 10 — REAL TOOLS + EXPLOITATION CHAINS

## Goals
1. Integrate real security tools: nmap, Nuclei, Nikto, SQLMap (Docker-gated)
2. Build automated exploitation chain logic
3. Implement full evidence chain of custody

---

## Feature 4: Real Tool Integration

### Docker Tool Runner — `backend/tooling/realTools.js`

```javascript
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const ExecutionJob = require('../models/ExecutionJob');

const DOCKER_ENABLED = process.env.ENABLE_DOCKER_TOOLS === 'true';

const TOOL_REGISTRY = {
  nmap_tcp_scan: {
    description: 'Full TCP port scan with service version detection',
    cost: 0.05,
    timeoutSeconds: 300,
    requiresDocker: true,
    image: 'instrumentisto/nmap',
    buildCommand: (targetUrl) => {
      const host = new URL(targetUrl).hostname;
      return ['nmap', '-sV', '-sC', '-T4', '--open', '-oX', '/dev/stdout', host];
    },
    parseOutput: parseNmapXml
  },
  nuclei_scan: {
    description: 'Template-based vulnerability scanner',
    cost: 0.12,
    timeoutSeconds: 600,
    requiresDocker: true,
    image: 'projectdiscovery/nuclei',
    buildCommand: (targetUrl) => [
      'nuclei', '-u', targetUrl, '-severity', 'medium,high,critical',
      '-json', '-silent', '-no-interactsh'
    ],
    parseOutput: parseNucleiJson
  },
  nikto_scan: {
    description: 'Web server misconfiguration scanner',
    cost: 0.08,
    timeoutSeconds: 300,
    requiresDocker: true,
    image: 'securecodebox/nikto',
    buildCommand: (targetUrl) => ['nikto', '-h', targetUrl, '-Format', 'json'],
    parseOutput: parseNiktoJson
  },
  sqlmap_detect: {
    description: 'SQL injection detection (detection only, no exploitation)',
    cost: 0.15,
    timeoutSeconds: 300,
    requiresDocker: true,
    image: 'paoloo/sqlmap',
    buildCommand: (targetUrl) => [
      'sqlmap', '-u', targetUrl, '--batch', '--detect-level=2',
      '--risk=1', '--output-dir=/tmp', '--forms'
    ],
    parseOutput: parseSqlmapOutput
  }
};

async function executeRealTool(toolId, targetUrl, engagementId, userId) {
  if (!DOCKER_ENABLED) {
    return { error: 'Docker tools disabled. Set ENABLE_DOCKER_TOOLS=true on Render.' };
  }

  const toolDef = TOOL_REGISTRY[toolId];
  if (!toolDef) return { error: `Unknown tool: ${toolId}` };

  const job = await ExecutionJob.create({
    engagementId,
    toolId,
    targetUrl,
    status: 'running',
    startedAt: new Date(),
    createdBy: userId
  });

  try {
    const args = toolDef.buildCommand(targetUrl);
    const dockerArgs = ['run', '--rm', '--network=host', toolDef.image, ...args.slice(1)];

    const { stdout, stderr } = await execFileAsync('docker', dockerArgs, {
      timeout: toolDef.timeoutSeconds * 1000
    });

    const parsed = toolDef.parseOutput(stdout, stderr);
    const durationMs = Date.now() - job.startedAt.getTime();

    await ExecutionJob.findByIdAndUpdate(job._id, {
      status: 'completed',
      finishedAt: new Date(),
      durationMs,
      rawOutput: stdout.substring(0, 50000),
      output: parsed
    });

    return { jobId: job._id, ...parsed };
  } catch (err) {
    await ExecutionJob.findByIdAndUpdate(job._id, {
      status: 'failed',
      errorMessage: err.message,
      finishedAt: new Date()
    });
    return { error: err.message, jobId: job._id };
  }
}

function parseNmapXml(stdout) {
  // Parse nmap XML output
  const ports = [];
  const portMatches = stdout.matchAll(/<port protocol="(\w+)" portid="(\d+)">.*?<state state="open".*?<service name="([^"]*)"[^>]*version="([^"]*)"[^>]*\/>/gs);
  for (const match of portMatches) {
    ports.push({ protocol: match[1], port: parseInt(match[2]), service: match[3], version: match[4] });
  }
  const findings = ports
    .filter(p => ['21','22','23','25','445','3389','8080','8443'].includes(String(p.port)))
    .map(p => ({
      title: `Open ${p.service} port (${p.port})`,
      description: `${p.protocol.toUpperCase()} port ${p.port} (${p.service} ${p.version}) is open`,
      severity: criticalPorts(p.port),
      tags: ['network'],
      port: p.port
    }));
  return { ports, findings, technologyFingerprint: ports.map(p => p.service).join(', ') };
}

function parseNucleiJson(stdout) {
  const findings = [];
  const lines = stdout.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      findings.push({
        title: item['template-id'],
        description: item.info?.description || item.matched,
        severity: item.info?.severity?.toUpperCase() || 'MEDIUM',
        tags: item.info?.tags || [],
        matched: item.matched,
        cvssScore: item.info?.classification?.['cvss-score'] || null
      });
    } catch { /* skip malformed */ }
  }
  return { findings };
}

function parseNiktoJson(stdout) {
  try {
    const data = JSON.parse(stdout);
    const findings = (data.vulnerabilities || []).map(v => ({
      title: v.id,
      description: v.msg,
      severity: 'MEDIUM',
      tags: ['web', 'misconfiguration'],
      url: v.url
    }));
    return { findings };
  } catch {
    return { findings: [], rawText: stdout.substring(0, 5000) };
  }
}

function parseSqlmapOutput(stdout) {
  const isVulnerable = stdout.includes('is vulnerable') || stdout.includes('Parameter:');
  const findings = isVulnerable ? [{
    title: 'SQL Injection Detected',
    description: 'SQLMap detected potential SQL injection vulnerability',
    severity: 'HIGH',
    tags: ['sqli', 'web'],
    exploitationPotential: 'Database extraction possible if confirmed'
  }] : [];
  return { findings, isVulnerable };
}

function criticalPorts(port) {
  if ([21, 23, 3389].includes(port)) return 'HIGH';
  if ([22, 25, 445].includes(port)) return 'MEDIUM';
  return 'LOW';
}

module.exports = { executeRealTool, TOOL_REGISTRY };
```

---

## Feature 7: Automated Exploitation Chains

### Chain Engine — `backend/services/chainEngine.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const ExecutionJob = require('../models/ExecutionJob');
const Pattern = require('../models/Pattern');
const { executeRealTool } = require('../tooling/realTools');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function runExploitationChain(engagementId, targetUrl, userId) {
  // Step 1: Get all findings so far
  const jobs = await ExecutionJob.find({ engagementId, status: 'completed' }).lean();
  const existingFindings = jobs.flatMap(j => j.output?.findings || []);

  if (existingFindings.length === 0) {
    return { message: 'No findings to chain from. Run initial scans first.' };
  }

  // Step 2: Ask Claude to plan the exploitation chain
  const chainResponse = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are VENOM's chain planner. Based on these security findings, design an automated exploitation chain.

IMPORTANT: Only recommend PASSIVE detection techniques. No destructive operations.
Target: ${targetUrl}
Findings: ${JSON.stringify(existingFindings, null, 2)}

Output a JSON array of chain steps:
[{
  "step": number,
  "name": string,
  "toolId": "nmap_tcp_scan"|"nuclei_scan"|"nikto_scan"|"sqlmap_detect"|"http_headers_probe"|"tls_metadata_probe"|"dns_lookup_probe",
  "rationale": string,
  "dependsOnFinding": string or null,
  "expectedOutcome": string
}]

Only output the JSON array.`
    }]
  });

  let chainSteps = [];
  try {
    chainSteps = JSON.parse(chainResponse.content[0].text.replace(/```json|```/g, '').trim());
  } catch {
    return { error: 'Failed to parse chain plan from Claude.' };
  }

  // Step 3: Execute chain steps sequentially
  const chainResults = [];
  for (const step of chainSteps) {
    console.log(`[Chain] Step ${step.step}: ${step.name} using ${step.toolId}`);
    const result = await executeRealTool(step.toolId, targetUrl, engagementId, userId);
    chainResults.push({ step: step.step, name: step.name, result });

    // If no findings at this step, Claude decides if chain should continue
    if (!result.findings?.length && chainSteps.indexOf(step) < chainSteps.length - 1) {
      const continueResponse = await client.messages.create({
        model: 'claude-haiku-20241022',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: `Step "${step.name}" found no new findings. Should the chain continue to step ${step.step + 1}? Reply with only "yes" or "no".`
        }]
      });
      if (continueResponse.content[0].text.toLowerCase().includes('no')) {
        console.log('[Chain] Claude decided to halt chain early.');
        break;
      }
    }
  }

  return { chainSteps: chainSteps.length, chainResults };
}

module.exports = { runExploitationChain };
```

---

## Feature 11: Evidence Chain of Custody

### Evidence Model — `backend/models/Evidence.js`

```javascript
const mongoose = require('mongoose');
const crypto = require('crypto');

const EvidenceSchema = new mongoose.Schema({
  engagementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Engagement', required: true },
  jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExecutionJob' },
  evidenceType: { type: String, enum: ['screenshot', 'raw_output', 'finding', 'network_capture', 'report'] },
  content: String,
  contentHash: String, // SHA-256 of content
  chainHash: String,   // SHA-256 of contentHash + previousChainHash
  previousChainHash: String,
  chainIndex: Number,
  collectedAt: { type: Date, default: Date.now },
  collectedBy: String, // 'venom-system' or user ID
  toolId: String,
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

// Auto-compute hashes before save
EvidenceSchema.pre('save', async function(next) {
  if (!this.contentHash) {
    this.contentHash = crypto.createHash('sha256').update(this.content || '').digest('hex');
  }
  if (!this.chainHash) {
    const prev = await this.constructor.findOne(
      { engagementId: this.engagementId },
      null,
      { sort: { chainIndex: -1 } }
    );
    this.previousChainHash = prev?.chainHash || '0000000000000000';
    this.chainIndex = (prev?.chainIndex || 0) + 1;
    this.chainHash = crypto
      .createHash('sha256')
      .update(this.contentHash + this.previousChainHash)
      .digest('hex');
  }
  next();
});

// Verify chain integrity
EvidenceSchema.statics.verifyChain = async function(engagementId) {
  const chain = await this.find({ engagementId }).sort({ chainIndex: 1 });
  for (let i = 1; i < chain.length; i++) {
    const expected = crypto
      .createHash('sha256')
      .update(chain[i].contentHash + chain[i - 1].chainHash)
      .digest('hex');
    if (expected !== chain[i].chainHash) {
      return { valid: false, brokenAt: chain[i].chainIndex };
    }
  }
  return { valid: true, totalItems: chain.length };
};

module.exports = mongoose.model('Evidence', EvidenceSchema);
```

### Week 10 Deliverables Checklist
- [ ] nmap TCP scan executing via Docker
- [ ] Nuclei scan running with medium+ severity templates
- [ ] Nikto running against web targets
- [ ] SQLMap detection-only mode running
- [ ] `POST /api/chain/:engagementId` triggers Claude-planned exploitation chain
- [ ] Evidence model records all findings with hash chain
- [ ] `GET /api/evidence/:engagementId/verify` confirms chain integrity
- [ ] All tool outputs surfaced in dashboard findings panel

---

---

# 📅 WEEK 11 — SELF-IMPROVING PROMPTS + MULTI-TARGET ORCHESTRATION

## Goals
1. VENOM improves its own prompts autonomously
2. Handle multiple targets simultaneously
3. Begin the self-research engine

---

## Feature 5: Self-Improving Prompts (PROMPT EVOLVER)

This is the most autonomous feature — VENOM improves its own thinking.

### Prompt Version Model — `backend/models/PromptVersion.js`

```javascript
const mongoose = require('mongoose');

const PromptVersionSchema = new mongoose.Schema({
  promptType: { type: String, enum: ['planning', 'tagging', 'chain', 'learning', 'research'] },
  version: String,        // e.g., "planning_v3_2026_06_01"
  content: String,        // Full prompt text
  parentVersion: String,  // Which version it evolved from
  evolutionReason: String, // Why Claude changed it
  performanceMetrics: {
    avgFindingsPerEngagement: Number,
    avgPlanQualityScore: Number,
    totalEngagementsUsed: Number,
    successRate: Number
  },
  isActive: { type: Boolean, default: false },
  createdByAI: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PromptVersion', PromptVersionSchema);
```

### Prompt Evolver Service — `backend/services/promptEvolver.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const PromptVersion = require('../models/PromptVersion');
const ExecutionJob = require('../models/ExecutionJob');
const Engagement = require('../models/Engagement');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

async function evolvePrompts() {
  console.log('[PromptEvolver] Starting weekly prompt evolution cycle...');

  const promptTypes = ['planning', 'chain', 'learning'];

  for (const promptType of promptTypes) {
    await evolvePromptType(promptType);
  }

  console.log('[PromptEvolver] Evolution cycle complete.');
}

async function evolvePromptType(promptType) {
  const currentVersion = await PromptVersion.findOne({ promptType, isActive: true });
  const currentContent = currentVersion?.content ||
    fs.readFileSync(path.join(__dirname, `../prompts/${promptType}-agent-v2.txt`), 'utf-8');

  // Gather performance data
  const recentEngagements = await Engagement.find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const performanceData = await Promise.all(recentEngagements.map(async (eng) => {
    const jobs = await ExecutionJob.find({ engagementId: eng._id, status: 'completed' });
    const findings = jobs.flatMap(j => j.output?.findings || []);
    return {
      targetType: eng.targetType,
      findingCount: findings.length,
      criticalCount: findings.filter(f => f.severity === 'CRITICAL').length,
      toolsUsed: [...new Set(jobs.map(j => j.toolId))]
    };
  }));

  const avgFindings = performanceData.reduce((s, p) => s + p.findingCount, 0) / performanceData.length;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `You are VENOM's autonomous prompt engineer. Analyze this ${promptType} prompt's performance and improve it.

CURRENT PROMPT:
${currentContent}

PERFORMANCE OVER LAST 20 ENGAGEMENTS:
Average findings per engagement: ${avgFindings.toFixed(2)}
Performance breakdown: ${JSON.stringify(performanceData, null, 2)}

Your task:
1. Identify weaknesses in the current prompt
2. Write an improved version that would generate better, more thorough results
3. Explain what you changed and why

Output as JSON:
{
  "improvedPrompt": "<full new prompt text>",
  "changes": ["change 1", "change 2", ...],
  "expectedImpact": "description of improvement",
  "confidenceScore": 0.0-1.0
}`
    }]
  });

  let result;
  try {
    result = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());
  } catch {
    console.log(`[PromptEvolver] Could not parse improvement for ${promptType}`);
    return;
  }

  if (result.confidenceScore < 0.7) {
    console.log(`[PromptEvolver] Low confidence (${result.confidenceScore}) for ${promptType}. Skipping.`);
    return;
  }

  // Deactivate old version
  await PromptVersion.updateMany({ promptType }, { isActive: false });

  // Save new evolved version
  const newVersion = await PromptVersion.create({
    promptType,
    version: `${promptType}_v${Date.now()}`,
    content: result.improvedPrompt,
    parentVersion: currentVersion?.version || 'base',
    evolutionReason: result.changes.join('; '),
    isActive: true,
    createdByAI: true
  });

  // Write to disk for fallback
  fs.writeFileSync(
    path.join(__dirname, `../prompts/${promptType}-agent-evolved.txt`),
    result.improvedPrompt
  );

  console.log(`[PromptEvolver] Evolved ${promptType} prompt → ${newVersion.version}`);
}

module.exports = { evolvePrompts };
```

### Weekly Evolution Cron — `backend/jobs/evolutionJob.js`

```javascript
const cron = require('node-cron');
const { evolvePrompts } = require('../services/promptEvolver');

// Every Sunday at 03:00 AM UTC
cron.schedule('0 3 * * 0', async () => {
  console.log('[EvolutionJob] Weekly prompt evolution triggered...');
  try {
    await evolvePrompts();
  } catch (err) {
    console.error('[EvolutionJob] Failed:', err.message);
  }
});
```

---

## Feature 8: Multi-Target Orchestration

### Orchestrator — `backend/services/orchestrator.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const Engagement = require('../models/Engagement');
const { generatePlan } = require('./planner');
const { executeRealTool } = require('../tooling/realTools');
const { runLearningCycle } = require('./learner');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_TARGETS || '3');
const activeOrchestrations = new Map();

async function orchestrateMultiple(engagementIds, userId) {
  // Validate not exceeding concurrency limit
  const currentActive = activeOrchestrations.size;
  if (currentActive + engagementIds.length > MAX_CONCURRENT) {
    return { error: `Concurrency limit reached. Max ${MAX_CONCURRENT} concurrent orchestrations.` };
  }

  const results = await Promise.allSettled(
    engagementIds.map(id => orchestrateSingle(id, userId))
  );

  return results.map((r, i) => ({
    engagementId: engagementIds[i],
    status: r.status,
    result: r.status === 'fulfilled' ? r.value : r.reason?.message
  }));
}

async function orchestrateSingle(engagementId, userId) {
  activeOrchestrations.set(engagementId, { startedAt: new Date(), userId });

  try {
    const engagement = await Engagement.findById(engagementId);
    if (!engagement) throw new Error('Engagement not found');

    console.log(`[Orchestrator] Starting full autonomous run for ${engagement.targetUrl}`);

    // Phase 1: Generate intelligent plan
    const plan = await generatePlan(engagement);

    // Phase 2: Execute tool sequence from plan
    const toolSequence = plan.phases?.flatMap(p => p.tools || []) || [
      'http_headers_probe', 'tls_metadata_probe', 'dns_lookup_probe', 'nmap_tcp_scan', 'nuclei_scan'
    ];

    for (const toolId of toolSequence) {
      await executeRealTool(toolId, engagement.targetUrl, engagementId, userId);
    }

    // Phase 3: Learn from results
    await runLearningCycle(engagementId);

    // Phase 4: Update engagement status
    await Engagement.findByIdAndUpdate(engagementId, {
      status: 'completed',
      completedAt: new Date()
    });

    return { success: true, engagementId };
  } finally {
    activeOrchestrations.delete(engagementId);
  }
}

function getOrchestratorStatus() {
  return {
    activeCount: activeOrchestrations.size,
    maxConcurrent: MAX_CONCURRENT,
    active: Object.fromEntries(activeOrchestrations)
  };
}

module.exports = { orchestrateMultiple, orchestrateSingle, getOrchestratorStatus };
```

### Week 11 Deliverables Checklist
- [ ] Prompt evolver running weekly on cron
- [ ] `PromptVersion` model stores all evolved prompts with lineage
- [ ] `GET /api/prompts/history` shows prompt evolution log
- [ ] Multi-target orchestration accepts array of engagement IDs
- [ ] Concurrency capped at `MAX_CONCURRENT_TARGETS` env var
- [ ] Full autonomous run: plan → execute → learn → complete, no human input
- [ ] `POST /api/orchestrate` triggers multi-target run

---

---

# 📅 WEEK 12 — SELF-RESEARCH ENGINE + INTEGRATIONS + FULL AUTONOMY

## Goals
1. VENOM researches new techniques from the internet autonomously
2. External integrations: Slack + Jira
3. Real-time collaboration
4. Full autonomous loop active — VENOM runs itself forever

---

## Feature 13 (CRITICAL): Self-Research Engine

This is the crown feature — VENOM searches the internet for new techniques, evaluates them, and adds them to its knowledge base without any human action.

### Research Engine — `backend/services/researchEngine.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const Pattern = require('../models/Pattern');
const CveSnapshot = require('../models/CveSnapshot');
const PromptVersion = require('../models/PromptVersion');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const RESEARCH_SOURCES = [
  { name: 'ExploitDB RSS', url: 'https://www.exploit-db.com/rss.xml', type: 'exploitdb' },
  { name: 'NVD Recent', url: 'https://services.nvd.nist.gov/rest/json/cves/2.0', type: 'nvd' },
  { name: 'CISA Advisories', url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', type: 'cisa' },
  { name: 'GitHub Security Advisories', url: 'https://api.github.com/advisories?type=reviewed&per_page=20', type: 'github' }
];

async function runResearchCycle() {
  console.log('[ResearchEngine] Starting autonomous research cycle...');
  const report = { sourcesChecked: 0, newTechniquesFound: 0, patternsUpdated: 0, errors: [] };

  for (const source of RESEARCH_SOURCES) {
    try {
      const rawData = await fetchSource(source);
      if (!rawData) continue;

      report.sourcesChecked++;

      // Ask Claude to analyze and extract actionable techniques
      const analysisResponse = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `You are VENOM's autonomous research analyst. Analyze this security feed data and extract NEW techniques or vulnerability classes that VENOM should learn.

Source: ${source.name}
Data: ${JSON.stringify(rawData).substring(0, 8000)}

For each new technique found that is actionable and within scope of web/network penetration testing, output JSON:
{
  "techniques": [
    {
      "name": string,
      "description": string,
      "targetType": "web"|"api"|"network"|"cloud",
      "tags": string[],
      "exploitSequence": string[],
      "estimatedSuccessRate": number,
      "generalizationScore": number,
      "sourceReference": string,
      "cvssScore": number or null
    }
  ],
  "researchSummary": string
}

Only include techniques with generalizationScore >= 0.6. Output only JSON.`
        }]
      });

      let analysis;
      try {
        analysis = JSON.parse(analysisResponse.content[0].text.replace(/```json|```/g, '').trim());
      } catch {
        report.errors.push(`Failed to parse analysis for ${source.name}`);
        continue;
      }

      // Add new patterns to the knowledge base
      for (const technique of analysis.techniques || []) {
        const exists = await Pattern.findOne({ name: technique.name });
        if (!exists) {
          await Pattern.create({
            ...technique,
            successRate: technique.estimatedSuccessRate,
            confidence: technique.estimatedSuccessRate * technique.generalizationScore,
            source: `research-${source.name}`,
            recentOutcomes: [],
            researchSource: technique.sourceReference
          });
          report.newTechniquesFound++;
        }
      }

      report.patternsUpdated += analysis.techniques?.length || 0;
      console.log(`[ResearchEngine] ${source.name}: ${analysis.techniques?.length || 0} techniques extracted`);

    } catch (err) {
      report.errors.push(`${source.name}: ${err.message}`);
    }
  }

  // After research: trigger prompt evolution if significant new knowledge
  if (report.newTechniquesFound >= 5) {
    const { evolvePrompts } = require('./promptEvolver');
    await evolvePrompts();
    report.promptEvolutionTriggered = true;
  }

  console.log('[ResearchEngine] Cycle complete:', report);
  return report;
}

async function fetchSource(source) {
  try {
    if (source.type === 'nvd') {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const res = await axios.get(source.url, {
        params: { pubStartDate: yesterday, resultsPerPage: 20 },
        timeout: 15000
      });
      return res.data.vulnerabilities?.slice(0, 10);
    }

    if (source.type === 'cisa') {
      const res = await axios.get(source.url, { timeout: 15000 });
      return res.data.vulnerabilities?.slice(0, 20);
    }

    if (source.type === 'github') {
      const res = await axios.get(source.url, {
        headers: { 'Accept': 'application/vnd.github+json' },
        timeout: 15000
      });
      return res.data?.slice(0, 15);
    }

    // Generic RSS/XML fetch
    const res = await axios.get(source.url, { timeout: 15000 });
    return res.data;

  } catch (err) {
    console.error(`[ResearchEngine] Failed to fetch ${source.name}:`, err.message);
    return null;
  }
}

module.exports = { runResearchCycle };
```

### Research Cron — `backend/jobs/researchJob.js`

```javascript
const cron = require('node-cron');
const { runResearchCycle } = require('../services/researchEngine');
const ResearchLog = require('../models/ResearchLog');

// Every Tuesday and Friday at 04:00 AM UTC
cron.schedule('0 4 * * 2,5', async () => {
  console.log('[ResearchJob] Starting bi-weekly research cycle...');
  try {
    const result = await runResearchCycle();
    await ResearchLog.create({ ...result, runAt: new Date() });
  } catch (err) {
    console.error('[ResearchJob] Failed:', err.message);
  }
});
```

---

## Feature 12: External Integrations (Slack + Jira)

### Notification Service — `backend/services/notifier.js`

```javascript
const axios = require('axios');

async function sendSlackAlert(message, findings = []) {
  if (!process.env.SLACK_WEBHOOK_URL) return;

  const criticalFindings = findings.filter(f =>
    ['critical', 'high'].includes(f.severity?.toLowerCase())
  );

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🐍 VENOM Alert' }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: message }
    }
  ];

  if (criticalFindings.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Critical Findings (${criticalFindings.length}):*\n` +
          criticalFindings.slice(0, 3).map(f => `• ${f.title}`).join('\n')
      }
    });
  }

  await axios.post(process.env.SLACK_WEBHOOK_URL, { blocks }, { timeout: 10000 });
}

async function createJiraTicket(finding, engagementName) {
  if (!process.env.JIRA_API_URL) return null;

  const res = await axios.post(
    `${process.env.JIRA_API_URL}/rest/api/3/issue`,
    {
      fields: {
        project: { key: process.env.JIRA_PROJECT_KEY },
        summary: `[VENOM] ${finding.title} — ${engagementName}`,
        description: {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: finding.description }]
          }]
        },
        issuetype: { name: 'Bug' },
        priority: { name: jiraPriority(finding.severity) },
        labels: ['venom', 'security', ...(finding.tags || [])]
      }
    },
    {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  return res.data.key;
}

function jiraPriority(severity) {
  const map = { CRITICAL: 'Highest', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
  return map[severity?.toUpperCase()] || 'Medium';
}

module.exports = { sendSlackAlert, createJiraTicket };
```

---

## Feature 9: Real-Time Collaboration

### WebSocket Server — `backend/services/realtimeServer.js`

```javascript
const { WebSocketServer } = require('ws');

let wss;
const roomMap = new Map(); // engagementId → Set of clients

function initWebSocketServer(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'ws://localhost');
    const engagementId = url.searchParams.get('engagementId');
    const apiKey = url.searchParams.get('apiKey');

    if (apiKey !== process.env.VENOM_API_KEY) {
      ws.close(1008, 'Unauthorized');
      return;
    }

    if (engagementId) {
      if (!roomMap.has(engagementId)) roomMap.set(engagementId, new Set());
      roomMap.get(engagementId).add(ws);
    }

    ws.on('close', () => {
      if (engagementId) roomMap.get(engagementId)?.delete(ws);
    });
  });

  console.log('[WebSocket] Real-time server initialized.');
}

function broadcastToEngagement(engagementId, event, data) {
  const room = roomMap.get(String(engagementId));
  if (!room) return;
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of room) {
    if (client.readyState === 1) client.send(message);
  }
}

function broadcastToolResult(engagementId, toolId, result) {
  broadcastToEngagement(engagementId, 'tool_result', { toolId, result });
}

function broadcastFinding(engagementId, finding) {
  broadcastToEngagement(engagementId, 'new_finding', { finding });
}

function broadcastResearchUpdate(summary) {
  // Broadcast to all connected clients
  if (!wss) return;
  const message = JSON.stringify({ event: 'research_update', data: summary });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

module.exports = { initWebSocketServer, broadcastToEngagement, broadcastToolResult, broadcastFinding, broadcastResearchUpdate };
```

### Dashboard WebSocket Hook — `dashboard/src/hooks/useVenomSocket.ts`

```typescript
import { useEffect, useCallback, useRef } from 'react';

type VenomEvent = 'tool_result' | 'new_finding' | 'research_update' | 'plan_ready';

export function useVenomSocket(
  engagementId: string,
  handlers: Partial<Record<VenomEvent, (data: any) => void>>
) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const apiKey = localStorage.getItem('apiKey');
    const wsUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL?.replace('https', 'wss')}/ws?engagementId=${engagementId}&apiKey=${apiKey}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const { event: eventName, data } = JSON.parse(event.data);
        handlers[eventName as VenomEvent]?.(data);
      } catch {}
    };

    ws.onclose = () => {
      setTimeout(connect, 3000); // Auto-reconnect
    };
  }, [engagementId]);

  useEffect(() => {
    if (engagementId) connect();
    return () => wsRef.current?.close();
  }, [engagementId, connect]);
}
```

### Week 12 Deliverables Checklist
- [ ] Research engine pulling from ExploitDB, NVD, CISA, GitHub advisories
- [ ] New techniques auto-added to Pattern library with Claude analysis
- [ ] Research log stored in MongoDB
- [ ] Slack webhook fires on critical findings
- [ ] Jira ticket auto-created for HIGH/CRITICAL findings
- [ ] WebSocket server initialized on backend startup
- [ ] Dashboard subscribes to real-time findings via `useVenomSocket`
- [ ] `GET /api/research/log` returns all research cycle history
- [ ] `POST /api/research/trigger` manually triggers research cycle

---

---

# 🤖 THE AUTONOMOUS LOOP — FULL SYSTEM DIAGRAM

After Week 12, VENOM runs this loop forever without human input:

```
DAILY (02:00 UTC):
  CVE Ingester ──▶ NVD API ──▶ Claude tags CVEs ──▶ MongoDB

BI-WEEKLY (Tue/Fri 04:00 UTC):
  Research Engine ──▶ ExploitDB + CISA + GitHub ──▶ Claude analyzes
      ──▶ New Patterns added to library
      ──▶ If 5+ new patterns: trigger Prompt Evolution

WEEKLY (Sun 03:00 UTC):
  Prompt Evolver ──▶ Analyze last 20 engagements ──▶ Claude improves prompts
      ──▶ New PromptVersion saved ──▶ Active prompt updated

ON ENGAGEMENT:
  Operator creates engagement ──▶ Orchestrator takes over:
    ──▶ generatePlan() [Claude API + CVE context + top patterns]
    ──▶ executeRealTool() sequence [nmap → nuclei → nikto → sqlmap]
    ──▶ runExploitationChain() [Claude-planned multi-step chain]
    ──▶ runLearningCycle() [extract new patterns, update confidence]
    ──▶ generatePdfReport() + emailReport() [auto-delivery]
    ──▶ sendSlackAlert() + createJiraTickets() [notifications]
    ──▶ Evidence chain committed [immutable audit trail]
    ──▶ WebSocket broadcast to collaborators [real-time updates]
```

---

# 🌍 GLOBAL RESEARCH REFERENCES

These are real-world frameworks and research bodies VENOM draws from:

| Source | Why It Matters |
|--------|---------------|
| NIST NVD | Official CVE database, CVSS scores |
| CISA KEV | Known Exploited Vulnerabilities — highest priority |
| MITRE ATT&CK | Industry-standard attack taxonomy |
| OWASP Top 10 | Web vulnerability classification standard |
| ExploitDB | PoC exploit database |
| Nuclei Templates | Community vulnerability detection templates |
| ProjectDiscovery | OSS security tooling ecosystem |
| Google Project Zero | 0-day research and disclosure |
| Shodan.io | Internet-exposed asset intelligence |
| Censys | Certificate and network intelligence |

VENOM's research engine checks: NVD, CISA, GitHub Advisories, ExploitDB. As it matures, Shodan and Censys APIs can be added for passive reconnaissance enrichment.

---

# 🔐 SECURITY & ETHICS ARCHITECTURE

VENOM is built for authorized testing only. These controls are non-negotiable:

```javascript
// Enforced at every layer:
{
  "scopeEnforcement": {
    "allowedDomains": "✓ Hard-enforced via engagementConstraints middleware",
    "restrictedPaths": "✓ Blocked at route level",
    "authorizationWindow": "✓ validFrom/validUntil enforced",
    "toolWhitelist": "✓ Only whitelisted tools execute",
    "noDestructiveOps": "✓ SQLMap runs in detect-only mode",
    "legalBasis": "✓ SOW/engagement ID required"
  },
  "auditTrail": {
    "evidenceChain": "✓ SHA-256 chain of custody on all findings",
    "activityLogger": "✓ Every API call logged with user/IP",
    "reportSigning": "✓ Reports timestamped + engagement-bound"
  },
  "autonomyLimits": {
    "noSelfTargeting": "✓ System cannot target its own infrastructure",
    "noCVSSabove9AutoExploit": "✓ CRITICAL CVEs flagged but not auto-exploited",
    "humanApprovalForChains": "✓ Exploitation chains require explicit trigger",
    "maxConcurrentTargets": "✓ Capped at MAX_CONCURRENT_TARGETS env var"
  }
}
```

---

# 📦 ENVIRONMENT VARIABLES — COMPLETE LIST

Add these to Render (backend) before the corresponding week:

```bash
# ─── WEEK 8 ───────────────────────────
CLAUDE_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-20250514
NVD_API_KEY=<your-nvd-api-key>  # Free at nvd.nist.gov/developers

# ─── WEEK 9 ───────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=<gmail-app-password>
SMTP_FROM=venom@yourdomain.com

# ─── WEEK 10 ──────────────────────────
ENABLE_DOCKER_TOOLS=true
MAX_CONCURRENT_TARGETS=3

# ─── WEEK 12 ──────────────────────────
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
JIRA_API_URL=https://yourteam.atlassian.net
JIRA_PROJECT_KEY=SEC
JIRA_EMAIL=your@email.com
JIRA_API_TOKEN=<jira-api-token>
```

---

# 📈 SUCCESS METRICS

VENOM v1.0 is complete when all of these are true:

| Metric | Target |
|--------|--------|
| Plans generated by Claude API | 100% (0% template fallback) |
| Patterns in library | 50+ (mix of manual + Claude-extracted + research-found) |
| CVEs ingested | Daily updates running |
| Research cycles completed | 2+ completed autonomously |
| Prompt versions evolved | 3+ evolved versions per type |
| Real tools executing | nmap + Nuclei + Nikto operational |
| PDF reports | Auto-delivered on engagement completion |
| Evidence chains | Verified integrity on 100% of engagements |
| Slack/Jira integrations | Live alerts on critical findings |
| Human touches needed after setup | 0 (create engagement → everything else autonomous) |

---

# 🚀 DEPLOYMENT REFERENCE

| Service | URL | Env |
|---------|-----|-----|
| Backend (Render) | https://venom-backend-x2pj.onrender.com | Production |
| Dashboard (Vercel) | https://dashboard-sigma-puce-87.vercel.app | Production |
| Database (Atlas) | MongoDB Atlas cluster | Production |
| Render Service ID | srv-d7rnm4pkh4rs73euh4h0 | — |

### Git Discipline (Every Week)
```bash
git add -A
git commit -m "feat(week-N): [description]"
git push origin main
# Render auto-deploys from main
# Vercel auto-deploys from main
```

### Rollback Protocol
```bash
git revert HEAD
git push origin main
# Render/Vercel redeploy previous working state
```

---

# ✅ MASTER CHECKLIST — ALL 12 WEEKS

```
WEEK 8:  [ ] Claude API plans live   [ ] CVE ingestion running   [ ] /api/cve working
WEEK 9:  [ ] Pattern learner Claude  [ ] PDF reports working     [ ] OWASP compliance endpoint
WEEK 10: [ ] nmap via Docker         [ ] Nuclei scanning         [ ] Exploitation chains   [ ] Evidence chain of custody
WEEK 11: [ ] Prompt evolver weekly   [ ] Multi-target active     [ ] Full autonomous engagement run
WEEK 12: [ ] Research engine live    [ ] Slack alerts            [ ] Jira tickets          [ ] WebSocket collab
         [ ] VENOM runs itself — no human input required
```

---

*This document is VENOM's director's cut. Every feature here is a scene written in full — not to be edited later, but to be built exactly as designed.*

*Built by ZeroOps. Designed to evolve itself.*

**VENOM v1.0 — The system that hunts, learns, and grows. Forever.**
