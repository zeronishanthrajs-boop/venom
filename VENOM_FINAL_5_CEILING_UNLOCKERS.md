# 🐍 VENOM — THE FINAL 5: CEILING UNLOCKERS
## From Powerful Tool → Sellable, Self-Aware, Living System

> **These are not features. These are the difference between a system that works and a system that wins.**  
> The 12-week plan built the engine. The Final 5 build the product.  
> Read this document as a mandatory extension to `VENOM_12_WEEK_PLAN.md`.

---

## 🗺️ WHERE THESE FIT IN THE TIMELINE

The Final 5 are **not a 13th week**. They are **woven across Weeks 8–12** as a parallel track.  
Each unlocker has a primary home week, but bleeds across the full system.

```
Week 8  ────────── Unlocker 5 (Use Case Lock-in begins here)
Week 9  ────────── Unlocker 2 (Human-Readable Output)
Week 10 ────────── Unlocker 3 (Trust + Control Interface)
Week 11 ────────── Unlocker 1 (Decision Intelligence)
         ────────── Unlocker 4 (Change Detection Mode)
Week 12 ────────── All 5 fully active. VENOM is a product.
```

---

---

# 🧠 UNLOCKER 1: DECISION INTELLIGENCE LAYER

## The Gap
VENOM finds things. But it doesn't tell you **what to do about them** in a way that creates urgency and direction. An operator looking at 47 findings still has to think. That's VENOM's failure, not theirs.

## The Transformation
```
BEFORE: Here are 47 findings sorted by CVE score.
AFTER:  Fix these 3 first. Ignore these 12 forever. Here's why.
```

## Architecture

### The Decision Engine — `backend/services/decisionEngine.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const ExecutionJob = require('../models/ExecutionJob');
const Engagement = require('../models/Engagement');
const CveSnapshot = require('../models/CveSnapshot');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

/**
 * Context-Aware Severity: NOT just CVSS score.
 * Factors in: asset exposure, business impact, exploitability, target type.
 */
async function computeContextualSeverity(finding, engagement) {
  const contextFactors = {
    isPublicFacing: engagement.targetType === 'web' || engagement.targetUrl.startsWith('https'),
    isAuthRequired: finding.tags?.includes('auth'),
    hasKnownExploit: finding.exploitAvailable || false,
    dataAtRisk: finding.tags?.some(t => ['sqli', 'idor', 'information-disclosure'].includes(t)),
    businessContext: engagement.description || ''
  };

  // Base score from CVSS (0-10) → normalize to 0-100
  let contextScore = (finding.cvssScore || 5) * 10;

  // Multipliers
  if (contextFactors.isPublicFacing) contextScore *= 1.3;
  if (contextFactors.hasKnownExploit) contextScore *= 1.5;
  if (contextFactors.dataAtRisk) contextScore *= 1.2;
  if (contextFactors.isAuthRequired) contextScore *= 0.8; // Harder to reach

  return Math.min(100, Math.round(contextScore));
}

/**
 * Core function: Given all findings for an engagement,
 * produce a prioritized decision brief.
 */
async function generateDecisionBrief(engagementId) {
  const engagement = await Engagement.findById(engagementId).lean();
  const jobs = await ExecutionJob.find({ engagementId, status: 'completed' }).lean();
  const allFindings = jobs.flatMap(j => j.output?.findings || []);

  if (allFindings.length === 0) {
    return {
      topRisks: [],
      ignoreList: [],
      decisionSummary: 'No findings yet. Run scans first.',
      riskScore: 0,
      engagementId
    };
  }

  // Step 1: Compute contextual severity for every finding
  const scoredFindings = await Promise.all(
    allFindings.map(async (f) => ({
      ...f,
      contextualSeverity: await computeContextualSeverity(f, engagement),
      rawCvss: f.cvssScore || 0
    }))
  );

  // Step 2: Sort by contextual severity
  scoredFindings.sort((a, b) => b.contextualSeverity - a.contextualSeverity);

  // Step 3: Identify ignore candidates (low impact, no exploit, not public-facing)
  const ignoreThreshold = 25;
  const ignoreList = scoredFindings.filter(f =>
    f.contextualSeverity <= ignoreThreshold &&
    !f.exploitAvailable &&
    (f.severity?.toLowerCase() === 'info' || f.severity?.toLowerCase() === 'low')
  );

  const actionableFindings = scoredFindings.filter(f =>
    !ignoreList.find(i => i.title === f.title)
  );

  // Step 4: Ask Claude to produce the decision brief in plain language
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `You are VENOM's decision intelligence layer. Analyze these security findings for a ${engagement.targetType} target and produce a concise, actionable decision brief.

TARGET: ${engagement.targetUrl}
BUSINESS CONTEXT: ${engagement.description}
ALL FINDINGS (sorted by contextual severity):
${JSON.stringify(actionableFindings.slice(0, 20), null, 2)}

IGNORE CANDIDATES (low impact, not worth time):
${JSON.stringify(ignoreList.map(f => ({ title: f.title, reason: 'Low contextual severity' })), null, 2)}

Produce a JSON object with:
{
  "topThreeRisks": [
    {
      "rank": 1,
      "title": string,
      "whyThisFirst": string (1 sentence, plain English, business impact focused),
      "whatCouldHappen": string (worst case scenario, non-technical),
      "fixDifficulty": "easy"|"medium"|"hard",
      "estimatedFixTime": string (e.g. "2 hours", "1 day"),
      "immediateAction": string (one concrete step to take RIGHT NOW)
    }
  ],
  "ignoreReasons": [
    {
      "title": string,
      "reason": string (why this is not worth engineer time right now)
    }
  ],
  "overallRiskSentence": string (one sentence summary a CEO would understand),
  "riskLevel": "critical"|"high"|"medium"|"low"|"clean",
  "shouldPageOnCall": boolean
}

Only output valid JSON.`
    }]
  });

  let brief;
  try {
    brief = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());
  } catch {
    brief = { topThreeRisks: [], ignoreReasons: [], overallRiskSentence: 'Analysis failed.', riskLevel: 'unknown' };
  }

  // Step 5: Compute single aggregate risk score
  const riskScore = actionableFindings.length > 0
    ? Math.round(actionableFindings.slice(0, 5).reduce((s, f) => s + f.contextualSeverity, 0) / 5)
    : 0;

  return {
    engagementId,
    topRisks: brief.topThreeRisks,
    ignoreList: brief.ignoreReasons,
    overallRiskSentence: brief.overallRiskSentence,
    riskLevel: brief.riskLevel,
    shouldPageOnCall: brief.shouldPageOnCall || false,
    riskScore,
    totalFindings: allFindings.length,
    actionableFindings: actionableFindings.length,
    ignoredFindings: ignoreList.length,
    generatedAt: new Date()
  };
}

module.exports = { generateDecisionBrief, computeContextualSeverity };
```

### Route — `backend/routes/decisions.js`

```javascript
const router = require('express').Router();
const { generateDecisionBrief } = require('../services/decisionEngine');
const auth = require('../middleware/auth');
const requireDb = require('../middleware/requireDb');

// Generate or refresh decision brief for an engagement
router.post('/:engagementId/brief', auth, requireDb, async (req, res) => {
  try {
    const brief = await generateDecisionBrief(req.params.engagementId);
    res.json(brief);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get cached decision brief
router.get('/:engagementId/brief', auth, requireDb, async (req, res) => {
  const DecisionBrief = require('../models/DecisionBrief');
  const brief = await DecisionBrief.findOne({ engagementId: req.params.engagementId })
    .sort({ generatedAt: -1 });
  if (!brief) return res.status(404).json({ error: 'No brief yet. POST to generate.' });
  res.json(brief);
});

module.exports = router;
```

### Dashboard Component — `dashboard/src/components/DecisionBrief.tsx`

```tsx
'use client';
import { useState, useEffect } from 'react';

interface TopRisk {
  rank: number;
  title: string;
  whyThisFirst: string;
  whatCouldHappen: string;
  fixDifficulty: 'easy' | 'medium' | 'hard';
  estimatedFixTime: string;
  immediateAction: string;
}

interface Brief {
  topRisks: TopRisk[];
  ignoreList: { title: string; reason: string }[];
  overallRiskSentence: string;
  riskLevel: string;
  riskScore: number;
  actionableFindings: number;
  ignoredFindings: number;
}

const difficultyColor = { easy: '#22c55e', medium: '#f59e0b', hard: '#ef4444' };
const riskLevelColor: Record<string, string> = {
  critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#65a30d', clean: '#22c55e'
};

export function DecisionBrief({ engagementId }: { engagementId: string }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchBrief = async (generate = false) => {
    setLoading(true);
    const method = generate ? 'POST' : 'GET';
    const res = await fetch(`/api/backend/api/decisions/${engagementId}/brief`, {
      method,
      headers: { 'x-api-key': localStorage.getItem('apiKey') || '' }
    });
    if (res.ok) setBrief(await res.json());
    setLoading(false);
  };

  useEffect(() => { fetchBrief(); }, [engagementId]);

  if (loading) return (
    <div style={{ padding: 24, color: '#6b7280', textAlign: 'center' }}>
      🧠 Generating decision brief...
    </div>
  );

  if (!brief) return (
    <button
      onClick={() => fetchBrief(true)}
      style={{ padding: '10px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
    >
      Generate Decision Brief
    </button>
  );

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 700 }}>
      {/* Risk Score Banner */}
      <div style={{
        background: riskLevelColor[brief.riskLevel] || '#6b7280',
        color: '#fff', padding: '16px 20px', borderRadius: 12, marginBottom: 20
      }}>
        <div style={{ fontSize: 13, opacity: 0.8, textTransform: 'uppercase', letterSpacing: 1 }}>
          Overall Assessment
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
          {brief.overallRiskSentence}
        </div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {brief.actionableFindings} issues need attention · {brief.ignoredFindings} safely ignored
        </div>
      </div>

      {/* Top 3 Risks */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ color: '#111', margin: '0 0 12px', fontSize: 16 }}>
          🎯 Fix These First
        </h3>
        {brief.topRisks.map((risk) => (
          <div key={risk.rank} style={{
            border: '1px solid #e5e7eb', borderRadius: 10, padding: 16,
            marginBottom: 12, background: '#fff'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                #{risk.rank} {risk.title}
              </div>
              <span style={{
                background: difficultyColor[risk.fixDifficulty],
                color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600
              }}>
                {risk.fixDifficulty} fix · {risk.estimatedFixTime}
              </span>
            </div>
            <div style={{ color: '#374151', marginTop: 8, fontSize: 14 }}>
              <strong>Why first:</strong> {risk.whyThisFirst}
            </div>
            <div style={{ color: '#6b7280', marginTop: 6, fontSize: 13 }}>
              <strong>Worst case:</strong> {risk.whatCouldHappen}
            </div>
            <div style={{
              background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8,
              padding: '8px 12px', marginTop: 10, fontSize: 13, color: '#15803d'
            }}>
              <strong>Do this now →</strong> {risk.immediateAction}
            </div>
          </div>
        ))}
      </div>

      {/* Ignore List */}
      {brief.ignoreList.length > 0 && (
        <div>
          <h3 style={{ color: '#6b7280', margin: '0 0 10px', fontSize: 14 }}>
            🗑️ Safely Ignore ({brief.ignoreList.length})
          </h3>
          {brief.ignoreList.map((item, i) => (
            <div key={i} style={{ color: '#9ca3af', fontSize: 13, marginBottom: 4 }}>
              <s>{item.title}</s> — {item.reason}
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => fetchBrief(true)}
        style={{ marginTop: 16, padding: '8px 16px', background: '#f3f4f6', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
      >
        🔄 Refresh Brief
      </button>
    </div>
  );
}
```

---

---

# 🧾 UNLOCKER 2: HUMAN-READABLE OUTPUT LAYER

## The Gap
Security output reads like it was written for the scanner, not the reader. A founder looking at VENOM's report right now sees CVE IDs, severity enums, and JSON blobs. They close the tab.

## The Transformation
```
BEFORE: CVE-2024-23113 | CVSS 9.8 | CRITICAL | RCE via auth bypass
AFTER:  Anyone on the internet could take over your server without a password.
        This is your most urgent problem. It takes 2 hours to fix.
```

## Three Modes: Every Output Gets All Three

```
Mode 1: FOUNDER  — Plain English. Business impact. No jargon.
Mode 2: ENGINEER — Technical detail. Fix instructions. CVE refs.
Mode 3: BRIEF    — One paragraph. 100 words. Decision-ready.
```

### Translation Service — `backend/services/translator.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const AUDIENCE_PROMPTS = {
  founder: `Translate this security finding into plain English for a non-technical startup founder.
Rules:
- Zero technical jargon. No CVE IDs, no port numbers unless critical.
- Lead with business impact (revenue, reputation, legal risk).
- Use analogies (e.g., "like leaving your front door unlocked").
- End with ONE clear action in under 10 words.
- Max 3 sentences total.`,

  engineer: `Translate this security finding for a senior software engineer.
Rules:
- Include technical specifics: affected endpoint, vulnerable parameter, attack vector.
- Reference relevant CWE/CVE if present.
- Provide a concrete fix with code example if applicable.
- Include verification step (how to confirm it's fixed).
- Max 5 sentences.`,

  brief: `Write a one-sentence executive summary of this security finding.
Rules:
- One sentence, max 25 words.
- Business impact + urgency in one breath.
- No jargon.`
};

async function translateFinding(finding, audience = 'founder') {
  const prompt = AUDIENCE_PROMPTS[audience] || AUDIENCE_PROMPTS.founder;

  const response = await client.messages.create({
    model: 'claude-haiku-20241022', // Fast + cheap for translation
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `${prompt}

FINDING:
Title: ${finding.title}
Severity: ${finding.severity}
Description: ${finding.description}
Tags: ${(finding.tags || []).join(', ')}
CVSS Score: ${finding.cvssScore || 'N/A'}
Exploitation Potential: ${finding.exploitationPotential || 'Unknown'}

Output ONLY the translated text. Nothing else.`
    }]
  });

  return response.content[0].text.trim();
}

async function translateAllFindings(findings, audiences = ['founder', 'engineer', 'brief']) {
  const results = await Promise.all(
    findings.map(async (finding) => {
      const translations = {};
      for (const audience of audiences) {
        translations[audience] = await translateFinding(finding, audience);
      }
      return { ...finding, translations };
    })
  );
  return results;
}

async function translatePlan(plan, audience = 'founder') {
  const prompt = audience === 'founder'
    ? `Explain this penetration testing plan to a startup founder in 3 bullet points. Plain English only. Focus on what will be tested and why it matters for their business.`
    : `Summarize this penetration testing plan for an engineering team. Include phases, tools, and expected outputs.`;

  const response = await client.messages.create({
    model: 'claude-haiku-20241022',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `${prompt}\n\nPLAN:\n${JSON.stringify(plan, null, 2)}\n\nOutput ONLY the explanation.`
    }]
  });

  return response.content[0].text.trim();
}

module.exports = { translateFinding, translateAllFindings, translatePlan };
```

### Auto-Translate on Job Completion — Add to `executor.js`

```javascript
// In ExecutionJob completion handler, after findings are stored:
const { translateAllFindings } = require('./translator');

if (findings.length > 0 && process.env.CLAUDE_API_KEY) {
  const translated = await translateAllFindings(findings);
  await ExecutionJob.findByIdAndUpdate(job._id, {
    'output.findings': translated
  });
}
```

### Dashboard — One-Click Summary Component

```tsx
// dashboard/src/components/OneLiner.tsx
'use client';
import { useState } from 'react';

export function OneLiner({ engagementId }: { engagementId: string }) {
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);

  const getSummary = async () => {
    setLoading(true);
    const res = await fetch(`/api/backend/api/decisions/${engagementId}/brief`, {
      headers: { 'x-api-key': localStorage.getItem('apiKey') || '' }
    });
    if (res.ok) {
      const data = await res.json();
      setSummary(data.overallRiskSentence);
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {summary ? (
        <div style={{
          background: '#fef3c7', border: '1px solid #fcd34d',
          borderRadius: 8, padding: '10px 14px', fontSize: 15, color: '#92400e', flex: 1
        }}>
          💡 {summary}
        </div>
      ) : (
        <button
          onClick={getSummary}
          disabled={loading}
          style={{
            padding: '8px 16px', background: '#0f0f1a', color: '#00ff88',
            border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13
          }}
        >
          {loading ? 'Thinking...' : '⚡ One-Click Summary'}
        </button>
      )}
    </div>
  );
}
```

### Finding Card — Audience Toggle

```tsx
// In FindingCard component — add audience switcher:
const [audience, setAudience] = useState<'founder' | 'engineer' | 'brief'>('founder');

const audiences = [
  { key: 'founder', label: '👔 Founder' },
  { key: 'engineer', label: '👨‍💻 Engineer' },
  { key: 'brief', label: '⚡ Brief' }
] as const;

// In render:
<div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
  {audiences.map(a => (
    <button
      key={a.key}
      onClick={() => setAudience(a.key)}
      style={{
        padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12,
        background: audience === a.key ? '#0f0f1a' : '#f3f4f6',
        color: audience === a.key ? '#00ff88' : '#374151',
        fontWeight: audience === a.key ? 700 : 400
      }}
    >
      {a.label}
    </button>
  ))}
</div>

<div style={{ color: '#374151', fontSize: 14, lineHeight: 1.6 }}>
  {finding.translations?.[audience] || finding.description}
</div>
```

---

---

# 🔒 UNLOCKER 3: TRUST + CONTROL INTERFACE

## The Gap
VENOM has safety controls — but they're invisible. A real user about to let an AI system scan their infrastructure needs to SEE the cage before they'll trust it.

## The Transformation
```
BEFORE: Safety constraints exist in middleware code.
AFTER:  "VENOM will scan these 2 domains. It will NOT touch /admin.
         Here is every action it is about to take. [Cancel] [Approve]"
```

## Three Components

### 1. Scope Dashboard — What will be scanned

```tsx
// dashboard/src/components/ScopeDashboard.tsx
'use client';

interface Scope {
  allowedDomains: string[];
  restrictedPaths: string[];
  toolWhitelist: string[];
  validFrom: string;
  validUntil: string;
  noDestructiveOps: boolean;
  authorizedBy: string;
}

const toolDescriptions: Record<string, string> = {
  http_headers_probe: 'Read HTTP response headers only',
  tls_metadata_probe: 'Check SSL certificate details',
  dns_lookup_probe: 'Look up DNS records',
  nmap_tcp_scan: 'Scan open ports (passive detection)',
  nuclei_scan: 'Check for known vulnerability patterns',
  nikto_scan: 'Check for web server misconfigurations',
  sqlmap_detect: 'Detect SQL injection (no exploitation)'
};

export function ScopeDashboard({ engagement }: { engagement: any }) {
  const scope: Scope = {
    allowedDomains: engagement.allowedDomains || [new URL(engagement.targetUrl).hostname],
    restrictedPaths: engagement.restrictedPaths || [],
    toolWhitelist: engagement.toolWhitelist || [],
    validFrom: engagement.validFrom,
    validUntil: engagement.validUntil,
    noDestructiveOps: engagement.noDestructiveOps !== false,
    authorizedBy: engagement.authorizedBy
  };

  const isExpired = new Date(scope.validUntil) < new Date();

  return (
    <div style={{ border: '2px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ background: '#0f0f1a', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#00ff88', fontWeight: 700, fontSize: 15 }}>🔒 Scope & Safety Controls</span>
        <span style={{
          background: isExpired ? '#dc2626' : '#22c55e',
          color: '#fff', fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 600
        }}>
          {isExpired ? 'EXPIRED' : 'AUTHORIZED'}
        </span>
      </div>

      <div style={{ padding: 20 }}>
        {/* Auth window */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Authorization Window
          </div>
          <div style={{ fontSize: 14 }}>
            {new Date(scope.validFrom).toLocaleString()} → {new Date(scope.validUntil).toLocaleString()}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
            Authorized by: {scope.authorizedBy}
          </div>
        </div>

        {/* Will scan */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            ✅ Will Scan
          </div>
          {scope.allowedDomains.map(d => (
            <div key={d} style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '6px 12px', marginBottom: 4, fontSize: 14, color: '#15803d' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Will NOT touch */}
        {scope.restrictedPaths.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              🚫 Will NOT Touch
            </div>
            {scope.restrictedPaths.map(p => (
              <div key={p} style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '6px 12px', marginBottom: 4, fontSize: 14, color: '#dc2626' }}>
                {p}
              </div>
            ))}
          </div>
        )}

        {/* Tools */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            🔧 Tools Authorized
          </div>
          {scope.toolWhitelist.map(t => (
            <div key={t} style={{ display: 'flex', gap: 10, marginBottom: 4, fontSize: 13 }}>
              <span style={{ color: '#22c55e', fontWeight: 700 }}>✓</span>
              <span style={{ color: '#374151' }}>
                <strong>{t}</strong> — {toolDescriptions[t] || 'Approved tool'}
              </span>
            </div>
          ))}
        </div>

        {/* Safety flags */}
        <div style={{ background: '#f9fafb', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Safety Guarantees
          </div>
          {[
            { flag: scope.noDestructiveOps, label: 'No destructive operations' },
            { flag: true, label: 'All actions logged with timestamp' },
            { flag: true, label: 'Evidence chain of custody active' },
            { flag: true, label: 'Scope enforcement at middleware level' }
          ].map(({ flag, label }) => (
            <div key={label} style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: flag ? '#22c55e' : '#dc2626' }}>{flag ? '✓' : '✗'}</span>
              <span style={{ color: flag ? '#374151' : '#6b7280' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### 2. Action Preview — "This is what will happen"

```javascript
// backend/services/actionPreviewer.js
async function previewEngagementActions(engagementId) {
  const Engagement = require('../models/Engagement');
  const { TOOL_REGISTRY } = require('../tooling/realTools');

  const engagement = await Engagement.findById(engagementId).lean();
  const tools = engagement.toolWhitelist || Object.keys(TOOL_REGISTRY);

  const preview = {
    target: engagement.targetUrl,
    willHappen: tools.map(toolId => {
      const tool = TOOL_REGISTRY[toolId];
      return {
        action: toolId,
        description: tool?.description || 'Passive probe',
        estimatedDuration: `${tool?.timeoutSeconds || 30}s`,
        costEstimate: `$${tool?.cost?.toFixed(3) || '0.010'}`,
        isDestructive: false // VENOM never destructive without explicit override
      };
    }),
    willNotHappen: [
      'No files will be modified on the target system',
      'No accounts will be created or deleted',
      'No data will be exfiltrated or stored externally',
      'No service will be disrupted or taken offline',
      'No actions outside the authorized domain scope'
    ],
    totalEstimatedTime: `${tools.reduce((s, t) => s + (TOOL_REGISTRY[t]?.timeoutSeconds || 30), 0)}s`,
    totalEstimatedCost: `$${tools.reduce((s, t) => s + (TOOL_REGISTRY[t]?.cost || 0.01), 0).toFixed(3)}`
  };

  return preview;
}

module.exports = { previewEngagementActions };
```

### 3. Kill Switch — Immediate halt, all operations

```javascript
// backend/routes/control.js
const router = require('express').Router();
const ExecutionJob = require('../models/ExecutionJob');
const Engagement = require('../models/Engagement');
const auth = require('../middleware/auth');

// Global kill switch state
let globalKillSwitchActive = false;

router.post('/killswitch', auth, async (req, res) => {
  const { scope, engagementId } = req.body;

  if (scope === 'global') {
    globalKillSwitchActive = true;
    // Fail all running jobs
    await ExecutionJob.updateMany(
      { status: 'running' },
      { status: 'killed', errorMessage: 'Global kill switch activated', finishedAt: new Date() }
    );
    console.warn(`[KILL SWITCH] Global halt by ${req.headers['x-user-id']} at ${new Date().toISOString()}`);
    return res.json({ killed: true, scope: 'global' });
  }

  if (scope === 'engagement' && engagementId) {
    await ExecutionJob.updateMany(
      { engagementId, status: 'running' },
      { status: 'killed', errorMessage: 'Engagement kill switch activated', finishedAt: new Date() }
    );
    await Engagement.findByIdAndUpdate(engagementId, { status: 'halted' });
    return res.json({ killed: true, scope: 'engagement', engagementId });
  }

  res.status(400).json({ error: 'Provide scope: "global" or "engagement" + engagementId' });
});

router.delete('/killswitch', auth, (req, res) => {
  globalKillSwitchActive = false;
  res.json({ killSwitchActive: false });
});

router.get('/killswitch/status', auth, (req, res) => {
  res.json({ killSwitchActive: globalKillSwitchActive });
});

// Export for use in executor middleware
function isKillSwitchActive() { return globalKillSwitchActive; }

module.exports = router;
module.exports.isKillSwitchActive = isKillSwitchActive;
```

```javascript
// In executor.js — check kill switch before every tool run:
const { isKillSwitchActive } = require('../routes/control');

async function executeRealTool(toolId, targetUrl, engagementId, userId) {
  if (isKillSwitchActive()) {
    return { error: 'System halted. Kill switch is active.' };
  }
  // ... rest of execution
}
```

### Kill Switch Button in Dashboard

```tsx
// Big red button in header
<button
  onClick={async () => {
    if (confirm('HALT ALL VENOM OPERATIONS? This stops all running scans immediately.')) {
      await fetch('/api/backend/api/control/killswitch', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'global' })
      });
      window.location.reload();
    }
  }}
  style={{
    padding: '8px 16px', background: '#dc2626', color: '#fff',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13
  }}
>
  ⛔ KILL SWITCH
</button>
```

---

---

# 🔁 UNLOCKER 4: CONTINUOUS + CHANGE DETECTION MODE

## The Gap
Right now VENOM is a one-shot scanner. A user runs it, gets results, closes the tab. That's a feature, not a product. Products are alive.

## The Transformation
```
BEFORE: "I ran VENOM last month."
AFTER:  "VENOM has been watching since last month.
         3 new vulnerabilities appeared since your last deploy.
         Your TLS config regressed on Tuesday."
```

## Architecture

### Baseline Snapshot Model — `backend/models/SecurityBaseline.js`

```javascript
const mongoose = require('mongoose');

const SecurityBaselineSchema = new mongoose.Schema({
  engagementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Engagement', required: true },
  targetUrl: String,
  snapshotAt: { type: Date, default: Date.now },
  snapshotType: { type: String, enum: ['manual', 'scheduled', 'post-deploy'], default: 'manual' },

  // The actual security state at this moment in time
  openPorts: [{ port: Number, service: String, version: String }],
  tlsInfo: {
    grade: String,
    expiresAt: Date,
    issuer: String,
    protocols: [String]
  },
  headers: mongoose.Schema.Types.Mixed,
  findings: [{
    title: String,
    severity: String,
    fingerprint: String, // SHA-256 of title+description for dedup
    firstSeenAt: Date
  }],
  technologyStack: [String],
  riskScore: Number,

  // Delta from previous snapshot
  isBaseline: { type: Boolean, default: false },
  parentSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: 'SecurityBaseline' }
}, { timestamps: true });

module.exports = mongoose.model('SecurityBaseline', SecurityBaselineSchema);
```

### Change Detection Service — `backend/services/changeDetector.js`

```javascript
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');
const SecurityBaseline = require('../models/SecurityBaseline');
const ExecutionJob = require('../models/ExecutionJob');
const { sendSlackAlert } = require('./notifier');

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

function fingerprintFinding(finding) {
  return crypto.createHash('sha256')
    .update(`${finding.title}::${finding.description || ''}`)
    .digest('hex')
    .substring(0, 16);
}

async function createSnapshot(engagementId, snapshotType = 'scheduled') {
  const jobs = await ExecutionJob.find({ engagementId, status: 'completed' })
    .sort({ finishedAt: -1 })
    .limit(10);

  const allFindings = jobs.flatMap(j => j.output?.findings || []);
  const latestJob = jobs[0];

  const snapshot = await SecurityBaseline.create({
    engagementId,
    targetUrl: latestJob?.targetUrl,
    snapshotType,
    findings: allFindings.map(f => ({
      ...f,
      fingerprint: fingerprintFinding(f),
      firstSeenAt: new Date()
    })),
    openPorts: latestJob?.output?.ports || [],
    technologyStack: latestJob?.output?.technologyFingerprint?.split(', ') || [],
    tlsInfo: latestJob?.output?.tlsInfo || null
  });

  return snapshot;
}

async function detectChanges(engagementId) {
  const snapshots = await SecurityBaseline.find({ engagementId })
    .sort({ snapshotAt: -1 })
    .limit(2);

  if (snapshots.length < 2) {
    return { message: 'Need at least 2 snapshots to detect changes.', changesFound: false };
  }

  const [current, previous] = snapshots;

  const currentFingerprints = new Set(current.findings.map(f => f.fingerprint));
  const previousFingerprints = new Set(previous.findings.map(f => f.fingerprint));

  // New findings (appeared since last scan)
  const newFindings = current.findings.filter(f => !previousFingerprints.has(f.fingerprint));
  // Resolved findings (disappeared since last scan — fixed!)
  const resolvedFindings = previous.findings.filter(f => !currentFingerprints.has(f.fingerprint));

  // Port changes
  const newPorts = current.openPorts.filter(p =>
    !previous.openPorts.find(pp => pp.port === p.port)
  );
  const closedPorts = previous.openPorts.filter(p =>
    !current.openPorts.find(cp => cp.port === p.port)
  );

  const hasSignificantChanges =
    newFindings.some(f => ['CRITICAL', 'HIGH'].includes(f.severity?.toUpperCase())) ||
    newPorts.length > 0;

  // Ask Claude to summarize changes in plain English
  let changeSummary = '';
  if (newFindings.length > 0 || resolvedFindings.length > 0 || newPorts.length > 0) {
    const summaryResponse = await client.messages.create({
      model: 'claude-haiku-20241022',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Summarize these security changes in 2-3 plain English sentences. Focus on business impact.

NEW FINDINGS (bad): ${JSON.stringify(newFindings.map(f => ({ title: f.title, severity: f.severity })))}
RESOLVED (good): ${JSON.stringify(resolvedFindings.map(f => f.title))}
NEW OPEN PORTS: ${JSON.stringify(newPorts)}
CLOSED PORTS: ${JSON.stringify(closedPorts)}

Time since last scan: ${Math.round((current.snapshotAt - previous.snapshotAt) / 3600000)} hours

Output only the summary text.`
      }]
    });
    changeSummary = summaryResponse.content[0].text.trim();
  } else {
    changeSummary = 'No significant security changes detected since last scan. Your security posture is stable.';
  }

  // Alert on new critical/high findings
  if (hasSignificantChanges && process.env.SLACK_WEBHOOK_URL) {
    await sendSlackAlert(
      `⚠️ *VENOM Change Alert* — ${newFindings.length} new finding(s) detected.\n${changeSummary}`,
      newFindings
    );
  }

  return {
    changesFound: newFindings.length > 0 || resolvedFindings.length > 0 || newPorts.length > 0,
    newFindings,
    resolvedFindings,
    newPorts,
    closedPorts,
    changeSummary,
    scanGapHours: Math.round((current.snapshotAt - previous.snapshotAt) / 3600000),
    currentSnapshotId: current._id,
    previousSnapshotId: previous._id
  };
}

module.exports = { createSnapshot, detectChanges };
```

### Scheduled Continuous Monitoring — `backend/jobs/monitoringJob.js`

```javascript
const cron = require('node-cron');
const Engagement = require('../models/Engagement');
const { createSnapshot, detectChanges } = require('../services/changeDetector');
const { orchestrateSingle } = require('../services/orchestrator');

// Run full re-scan + change detection every 24 hours for all active engagements
cron.schedule('0 6 * * *', async () => {
  console.log('[MonitoringJob] Starting daily re-scan for all active engagements...');

  const activeEngagements = await Engagement.find({ status: 'completed' }).lean();

  for (const engagement of activeEngagements) {
    try {
      // Re-run the full orchestration
      await orchestrateSingle(engagement._id, 'venom-scheduler');

      // Create new snapshot
      await createSnapshot(engagement._id, 'scheduled');

      // Detect changes vs last snapshot
      const delta = await detectChanges(engagement._id);
      console.log(`[MonitoringJob] ${engagement.targetUrl}: ${delta.changesFound ? 'CHANGES DETECTED' : 'No changes'}`);

    } catch (err) {
      console.error(`[MonitoringJob] Failed for ${engagement.targetUrl}:`, err.message);
    }
  }
});
```

### Timeline Component — `dashboard/src/components/SecurityTimeline.tsx`

```tsx
'use client';
import { useState, useEffect } from 'react';

interface Snapshot {
  _id: string;
  snapshotAt: string;
  snapshotType: string;
  findings: { title: string; severity: string }[];
  riskScore: number;
}

const severityDot: Record<string, string> = {
  CRITICAL: '#dc2626', HIGH: '#ea580c', MEDIUM: '#d97706', LOW: '#65a30d', INFO: '#2563eb'
};

export function SecurityTimeline({ engagementId }: { engagementId: string }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [delta, setDelta] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/backend/api/monitoring/${engagementId}/snapshots`, {
        headers: { 'x-api-key': localStorage.getItem('apiKey') || '' }
      });
      if (res.ok) setSnapshots(await res.json());

      const deltaRes = await fetch(`/api/backend/api/monitoring/${engagementId}/changes`, {
        headers: { 'x-api-key': localStorage.getItem('apiKey') || '' }
      });
      if (deltaRes.ok) setDelta(await deltaRes.json());
    };
    load();
  }, [engagementId]);

  return (
    <div>
      {/* Change Summary Banner */}
      {delta?.changesFound && (
        <div style={{
          background: '#fef3c7', border: '1px solid #fcd34d',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20
        }}>
          <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
            🔔 Changes Since Last Scan ({delta.scanGapHours}h ago)
          </div>
          <div style={{ color: '#78350f', fontSize: 14 }}>{delta.changeSummary}</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 13 }}>
            {delta.newFindings.length > 0 && (
              <span style={{ color: '#dc2626', fontWeight: 600 }}>
                +{delta.newFindings.length} new findings
              </span>
            )}
            {delta.resolvedFindings.length > 0 && (
              <span style={{ color: '#22c55e', fontWeight: 600 }}>
                ✓ {delta.resolvedFindings.length} resolved
              </span>
            )}
          </div>
        </div>
      )}

      {!delta?.changesFound && snapshots.length >= 2 && (
        <div style={{
          background: '#f0fdf4', border: '1px solid #86efac',
          borderRadius: 10, padding: '12px 16px', marginBottom: 20, color: '#15803d', fontSize: 14
        }}>
          ✅ No changes detected since last scan. Security posture is stable.
        </div>
      )}

      {/* Timeline */}
      <div style={{ position: 'relative', paddingLeft: 24 }}>
        <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: '#e5e7eb' }} />
        {snapshots.map((snap, i) => (
          <div key={snap._id} style={{ position: 'relative', marginBottom: 24 }}>
            <div style={{
              position: 'absolute', left: -20, top: 4, width: 12, height: 12,
              borderRadius: '50%', background: i === 0 ? '#7c3aed' : '#d1d5db',
              border: '2px solid #fff', boxShadow: '0 0 0 2px ' + (i === 0 ? '#7c3aed' : '#d1d5db')
            }} />
            <div style={{ marginLeft: 16 }}>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                {new Date(snap.snapshotAt).toLocaleString()} · {snap.snapshotType}
                {i === 0 && <span style={{ marginLeft: 6, background: '#7c3aed', color: '#fff', fontSize: 10, padding: '1px 6px', borderRadius: 10 }}>LATEST</span>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {snap.findings.slice(0, 5).map((f, fi) => (
                  <span key={fi} style={{
                    background: severityDot[f.severity?.toUpperCase()] + '20',
                    color: severityDot[f.severity?.toUpperCase()] || '#6b7280',
                    border: `1px solid ${severityDot[f.severity?.toUpperCase()] || '#e5e7eb'}`,
                    fontSize: 11, padding: '2px 8px', borderRadius: 12
                  }}>
                    {f.title}
                  </span>
                ))}
                {snap.findings.length > 5 && (
                  <span style={{ color: '#6b7280', fontSize: 11 }}>+{snap.findings.length - 5} more</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

---

# 🎯 UNLOCKER 5: ONE SHARP USE CASE

## The Decision

> **VENOM is "The Startup Security Scanner."**

Not "AI pentesting platform." Not "autonomous offensive security." Not "enterprise security automation."

**"The Startup Security Scanner."**

This is not a marketing decision. This is an architectural decision. Everything about how VENOM thinks, communicates, prioritizes, and presents itself must be tuned for one person: **the technical co-founder of a startup who just raised a seed round and got asked by investors: "Is your infrastructure secure?"**

That person has:
- 2 hours to figure this out
- No security team
- A Vercel + MongoDB stack not unlike VENOM's own stack
- A domain, a login endpoint, an API
- Real users whose data they can't afford to lose

VENOM is the tool that lets them answer "yes" confidently.

---

## What Changes Architecturally

### 1. The Onboarding Flow — From Zero to First Report in 10 Minutes

```tsx
// dashboard/src/app/onboard/page.tsx — New guided setup flow

const ONBOARDING_STEPS = [
  {
    id: 'target',
    title: 'What\'s your product\'s URL?',
    subtitle: 'The main domain your users visit.',
    placeholder: 'https://yourproduct.com'
  },
  {
    id: 'authorization',
    title: 'Confirm you own this domain.',
    subtitle: 'VENOM only scans what you authorize. We need to confirm.',
    options: [
      'I am the founder/owner of this domain',
      'I have written authorization from the domain owner'
    ]
  },
  {
    id: 'concern',
    title: 'What are you most worried about?',
    subtitle: 'This helps VENOM prioritize.',
    options: [
      'Investor due diligence / SOC2 prep',
      'We just launched and want to check safety',
      'A customer asked us about our security',
      'We had an incident / scare',
      'Routine security check'
    ]
  },
  {
    id: 'launch',
    title: 'VENOM is ready.',
    subtitle: 'Your first scan takes about 5 minutes.',
    action: 'Start Scan'
  }
];
```

### 2. Pre-Built Startup Scan Profile

```javascript
// backend/profiles/startupScan.js
// When a startup creates an engagement, apply this profile automatically.

const STARTUP_SCAN_PROFILE = {
  toolWhitelist: [
    'http_headers_probe',     // Check security headers
    'tls_metadata_probe',     // Check HTTPS/cert
    'dns_lookup_probe',       // Check DNS config
    'nuclei_scan'             // Check known web vulns
  ],
  noDestructiveOps: true,
  quietMode: false,
  maxConcurrentOps: 2,
  timeoutMinutes: 15,

  // Pre-built restricted paths — startups should never probe these
  restrictedPaths: ['/admin', '/internal', '/api/admin', '/metrics', '/_health'],

  // Phase names that make sense to founders
  phaseLabels: {
    recon: 'Checking your public footprint',
    scanning: 'Looking for known vulnerabilities',
    analysis: 'Analyzing what we found',
    reporting: 'Preparing your report'
  }
};

module.exports = { STARTUP_SCAN_PROFILE };
```

### 3. Startup-Specific Report Framing

```javascript
// In reportGenerator.js — add startup framing to PDF:
const STARTUP_REPORT_INTRO = `
This report was generated by VENOM for ${engagement.name}.

What this report is:
A clear picture of your product's current security posture,
written for founders and engineers — not security consultants.

What to do with it:
1. Fix the top 3 issues first.
2. Share the Executive Summary with your investors.
3. Re-run VENOM after each fix to confirm resolution.

What this report is not:
A replacement for a formal penetration test or SOC2 audit.
It is a powerful starting point and ongoing monitoring tool.
`;
```

### 4. Positioning Locked Into the System — Dashboard Copy

```tsx
// dashboard/src/app/layout.tsx — Update meta + branding

// Page title:
<title>VENOM — Security Scanner for Startups</title>

// Header tagline:
<span style={{ color: '#6b7280', fontSize: 13 }}>
  Know your security posture. Fix what matters. Ship confidently.
</span>

// Empty state (no engagements yet):
<div style={{ textAlign: 'center', padding: 60 }}>
  <div style={{ fontSize: 40, marginBottom: 16 }}>🐍</div>
  <h2 style={{ color: '#111', marginBottom: 8 }}>
    What's your product's URL?
  </h2>
  <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
    VENOM scans your startup's infrastructure and tells you exactly
    what to fix — in plain English, in under 10 minutes.
  </p>
  <button onClick={() => router.push('/onboard')}>
    Start Free Scan →
  </button>
</div>
```

### 5. The "Share with Investors" Button

This is the monetization hook. One-click PDF export, branded, ready to attach to a due diligence packet.

```tsx
// In the report view:
<button
  onClick={async () => {
    const res = await fetch(`/api/backend/api/reports/${engagementId}/pdf`, {
      headers: { 'x-api-key': apiKey }
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Security-Report-${engagementName}.pdf`;
    a.click();
  }}
  style={{
    padding: '10px 20px', background: '#0f0f1a', color: '#00ff88',
    border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700
  }}
>
  📄 Download Investor-Ready Report
</button>
```

---

## What to STOP Doing

This section is as important as everything above. Discipline is architecture.

| Stop | Start |
|------|-------|
| Calling it "an autonomous penetration testing platform" | Calling it "the security scanner for startups" |
| Building for imaginary enterprise buyers | Building for the technical co-founder you can reach today |
| Adding features before fixing the output layer | Making existing output so clear it sells itself |
| Showing raw JSON findings to users | Always showing the founder-mode translation first |
| Running scans with no action preview | Always showing "this is what will happen" before execution |
| Treating each engagement as isolated | Treating every engagement as part of a continuous monitoring timeline |
| Measuring success by tool count | Measuring success by "did the user understand and fix something" |

---

---

# 📐 FINAL SYSTEM OVERVIEW — AFTER ALL 5 UNLOCKERS

```
USER JOURNEY (after Final 5):

Founder lands on VENOM ─▶ Onboarding: "What's your URL?"
                        ─▶ Scope Dashboard: "Here's what we'll check"
                        ─▶ Action Preview: "Here's exactly what will happen"
                        ─▶ [Approve Scan]
                                │
                     ┌──────────▼──────────┐
                     │  VENOM RUNS ITSELF   │
                     │  Tools → Findings    │
                     │  Evidence logged     │
                     │  Translated to plain │
                     │  English auto        │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────────────────┐
                     │        DECISION BRIEF            │
                     │  "Fix these 3 first. Why. How." │
                     │  "Ignore these 11. Why."         │
                     │  Risk score. Plain sentence.     │
                     └──────────┬──────────────────────┘
                                │
                 ┌──────────────┼──────────────┐
                 │              │              │
           [Founder Mode] [Engineer Mode] [Brief Mode]
           Plain English   Tech detail   One sentence
                 │              │              │
                 └──────────────┼──────────────┘
                                │
                     ┌──────────▼──────────┐
                     │  📄 Download Report  │  ← "Investor-Ready"
                     │  📧 Email to team    │
                     │  🔔 Slack alert      │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │  CONTINUOUS WATCH   │  ← Runs every 24h
                     │  "3 new issues since │
                     │   your last deploy." │
                     │  Timeline view       │
                     └─────────────────────┘
```

---

# ✅ FINAL 5 COMPLETION CHECKLIST

```
UNLOCKER 1 — DECISION INTELLIGENCE:
  [ ] generateDecisionBrief() produces top 3 risks with why/how/how-long
  [ ] Contextual severity overrides raw CVSS score
  [ ] Ignore list filters low-impact findings automatically
  [ ] Risk score (0-100) computed per engagement
  [ ] DecisionBrief component renders in dashboard

UNLOCKER 2 — HUMAN-READABLE OUTPUT:
  [ ] translateFinding() runs on all findings at job completion
  [ ] Founder / Engineer / Brief modes all return distinct text
  [ ] Audience toggle in FindingCard component
  [ ] One-Click Summary button returns one sentence

UNLOCKER 3 — TRUST + CONTROL:
  [ ] ScopeDashboard shows exactly what will/won't be touched
  [ ] previewEngagementActions() returns action list before execution
  [ ] Kill switch (global + per-engagement) working
  [ ] Kill switch button visible in dashboard header
  [ ] Activity logs surface in UI

UNLOCKER 4 — CHANGE DETECTION:
  [ ] SecurityBaseline model stores snapshots
  [ ] createSnapshot() runs after every engagement completion
  [ ] detectChanges() compares last 2 snapshots
  [ ] Slack alert fires on new HIGH/CRITICAL findings
  [ ] SecurityTimeline component renders in dashboard
  [ ] Daily cron re-scans all active engagements

UNLOCKER 5 — ONE USE CASE:
  [ ] Dashboard headline: "Security Scanner for Startups"
  [ ] Onboarding flow: URL → Authorization → Concern → Launch
  [ ] STARTUP_SCAN_PROFILE applied automatically
  [ ] Report says "Investor-Ready" on download button
  [ ] All findings default to Founder mode
  [ ] "Share with Investors" PDF export working
  [ ] STOP list reviewed — no scope creep added this week
```

---

# 🔢 ENV VARS ADDED BY FINAL 5

No new required env vars. The Final 5 run on the existing infrastructure.  
Optional additions:
```bash
CONTINUOUS_SCAN_ENABLED=true          # Enables daily re-scan cron
CONTINUOUS_SCAN_CRON="0 6 * * *"     # Override scan schedule
DECISION_BRIEF_MIN_FINDINGS=1         # Min findings before brief generates
TRANSLATE_FINDINGS_ON_COMPLETE=true   # Auto-translate after job completion
```

---

*The 12-week plan built a system that works.*  
*The Final 5 build a system that wins.*  
*One use case. Clear output. Visible control. Living monitoring. Decisions, not data.*

**VENOM — The Startup Security Scanner. Now it's a product.**
