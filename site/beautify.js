// ChatVault Phase 2 — document beautification pipeline.
// Rules: never rewrite the content layer. Only presentation is normalized.
// Code fences and inline code are protected before any transformation.
// Pure, dependency-free ESM — shared by the web app, CLI and generated userscript.
import { renderMarkdown } from './core.js';

export const STYLES = [
  { id: 'clean', label: 'Clean Markdown', description: 'Minimal, readable, portable.' },
  { id: 'report', label: 'Technical Report', description: 'Metadata header, TOC, consistent sections.' },
  { id: 'kb', label: 'Knowledge Base', description: 'At-a-glance summary, topics and references.' },
  { id: 'raw', label: 'Raw Archive', description: 'Original content, untouched.' }
];

const DATE_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.getUTCDate();
  const month = DATE_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const time = date.toISOString().slice(11, 16);
  return `${day} ${month} ${year}, ${time} UTC`;
}

export function detectInputType(text) {
  const value = String(text || '').trim();
  if (!value) return 'empty';
  if (/^[\[{]/.test(value)) {
    try { JSON.parse(value); return 'json'; } catch { /* not JSON */ }
  }
  if (/<(?:!doctype|html|body|div|p|article|section)\b/i.test(value)) return 'html';
  if (/^#{1,6}\s/m.test(value) || /```/.test(value) || /^\s*[-*+]\s+/m.test(value)) return 'markdown';
  return 'text';
}

// ---------- protected content manager ----------

function tokenizer(text, tag) {
  let prefix = '\uE000CV' + tag;
  while (text.includes(prefix)) prefix += '\uE001';
  const tokens = new Map();
  return {
    store(value) {
      const key = prefix + tokens.size + '\uE001';
      tokens.set(key, value);
      return key;
    },
    tokens
  };
}

function isFenceLine(line, char, length) {
  const trimmed = line.trim();
  return trimmed.length === length && [...trimmed].every(c => c === char);
}

export function protectContent(sourceText) {
  const text = String(sourceText ?? '');
  const fences = tokenizer(text, 'F');
  const lines = text.split('\n');
  const masked = [];

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!open) { masked.push(lines[i]); continue; }
    const marker = open[1];
    const char = marker[0];
    const length = marker.length;
    const block = [lines[i]];
    let closed = false;
    while (++i < lines.length) {
      block.push(lines[i]);
      if (isFenceLine(lines[i], char, length)) { closed = true; break; }
    }
    if (!closed) { masked.push(...block); continue; }
    masked.push(fences.store(block.join('\n')));
  }

  const inline = tokenizer(masked.join('\n'), 'I');
  let out = '';
  const maskedText = masked.join('\n');
  for (let i = 0; i < maskedText.length;) {
    if (maskedText[i] === '`') {
      let run = 1;
      while (maskedText[i + run] === '`') run++;
      const marker = '`'.repeat(run);
      const end = maskedText.indexOf(marker, i + run);
      if (end >= 0 && maskedText[end + run] !== '`') {
        out += inline.store(maskedText.slice(i, end + run));
        i = end + run;
        continue;
      }
    }
    out += maskedText[i++];
  }
  return { text: out, tokens: new Map([...fences.tokens, ...inline.tokens]) };
}

export function restoreContent(text, tokens) {
  let out = String(text ?? '');
  // Longest keys first so a short key can never partially consume a longer one.
  for (const [key, value] of [...tokens].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(key).join(value);
  }
  return out;
}

// ---------- normalizers ----------

const META_RE = /^\s*>?\s*\*{0,2}(Title|Source|Exported|Messages|Platform|Extraction)\*{0,2}\s*:\s*(.*?)\s*$/i;
const SEPARATOR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,}|={4,})\s*$/;

export function extractMetadata(text) {
  const meta = {};
  for (const line of String(text).split('\n')) {
    const match = line.match(META_RE);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].replace(/^\[([^\]]+)\]\([^)]+\)$/, '$1').replace(/\*+/g, '').trim();
    if (value && !meta[key]) meta[key] = value;
  }
  return meta;
}

function isSetextUnderline(line) {
  return /^\s*(=+|-+)\s*$/.test(line);
}

export function normalizeHeadings(text) {
  const lines = String(text).split('\n');
  const converted = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    if (line.trim() && !SEPARATOR_RE.test(line) && isSetextUnderline(next) && !/^\s*[-*+]\s/.test(line) && line.length < 160) {
      converted.push(next.trim()[0] === '=' ? '# ' + line.trim() : '## ' + line.trim());
      i++;
      continue;
    }
    const atx = line.match(/^\s*(#{1,6})\s*(.*?)\s*#*\s*$/);
    if (atx) {
      converted.push('#'.repeat(atx[1].length) + ' ' + atx[2].trim());
      continue;
    }
    converted.push(line);
  }
  const headingIndexes = converted.map((line, index) => line.match(/^#{1,6} /) ? index : -1).filter(i => i >= 0);
  const firstHeading = headingIndexes[0];
  let previous = 0;
  return converted.map((line, index) => {
    const match = line.match(/^(#{1,6}) (.*)$/);
    if (!match) return line;
    let level = match[1].length;
    if (index === firstHeading && index <= 1) level = 1;
    else if (previous && level > previous + 1) level = previous + 1;
    previous = level;
    return '#'.repeat(level) + ' ' + match[2];
  }).join('\n');
}

export function normalizeWhitespace(text) {
  const lines = String(text).replace(/[ \t]+$/gm, '').split('\n');
  const out = [];
  let blanks = 0;
  for (const line of lines) {
    if (!line.trim()) { blanks++; if (blanks <= 1) out.push(''); continue; }
    blanks = 0;
    out.push(line);
  }
  return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
}

export function normalizeSeparators(text) {
  const lines = String(text).split('\n');
  const out = [];
  for (const line of lines) {
    if (SEPARATOR_RE.test(line)) {
      if (out.length && SEPARATOR_RE.test(out[out.length - 1] || '')) continue;
      out.push('---');
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function normalizeLists(text) {
  return String(text)
    .split('\n')
    .map(line => line.replace(/^(\s*)([*+])\s+/, (_, indent, marker) => {
      const width = Math.floor(indent.length / 2) * 2;
      return ' '.repeat(width) + (marker === '*' || marker === '+' ? '-' : marker) + ' ';
    }))
    .join('\n');
}

export function normalizeTables(text) {
  return String(text).split('\n').map(line => {
    if (!line.includes('|')) return line;
    if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) return line;
    const columns = line.split('|').length - (line.trim().startsWith('|') ? 2 : 1);
    if (columns <= 0) return line;
    return '| ' + Array(columns).fill('---').join(' | ') + ' |';
  }).join('\n');
}

export function autolinkUrls(text) {
  return String(text).replace(
    /(?<![\]("'`<])https?:\/\/[^\s<>)\]"'`]+/g,
    url => `[${url}](${url})`
  );
}

export function normalizeTimestamps(text) {
  return String(text)
    .replace(/<time>\s*([^<]+)\s*<\/time>/gi, (_, iso) => formatDate(iso) || iso)
    .replace(/\b(20\d\d-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:\.\d+)?Z)\b/g, (_, iso) => formatDate(iso));
}

function stripMd(value) {
  return String(value).replace(/\uE000.*?\uE001/g, '').replace(/\*+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').trim();
}

export function anchorSlug(value) {
  return stripMd(value).toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-') || 'section';
}

export function generateToc(text, { maxLevel = 3, skipFirst = true } = {}) {
  const headings = String(text).split('\n')
    .map(line => line.match(/^(#{1,6}) (.*)$/))
    .filter(Boolean)
    .map((match, index) => ({ level: match[1].length, title: match[2], index }))
    .filter(h => h.level <= maxLevel);
  if (skipFirst && headings.length && headings[0].level === 1) headings.shift();
  if (!headings.length) return '';
  const seen = new Map();
  const lines = headings.map(h => {
    const base = anchorSlug(h.title);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    const anchor = count === 1 ? base : base + '-' + count;
    return `${'  '.repeat(Math.max(0, h.level - 1))}- [${stripMd(h.title)}](#${anchor})`;
  });
  return '## Contents\n\n' + lines.join('\n') + '\n';
}

function insertAfterHeading(text, block) {
  const lines = String(text).split('\n');
  let insertAt = -1;
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (/^# /.test(lines[i])) { insertAt = i + 1; break; }
  }
  if (insertAt < 0) insertAt = 0;
  while (insertAt < lines.length && !lines[insertAt].trim()) insertAt++;
  lines.splice(insertAt, 0, '', block.trim(), '');
  return lines.join('\n');
}

export function formatMetadataHeader(meta = {}) {
  const rows = [];
  if (meta.source) rows.push(`**Source:** [Original conversation](${meta.source})`);
  if (meta.exported) rows.push(`**Exported:** ${formatDate(meta.exported)}`);
  if (meta.messages) rows.push(`**Messages:** ${meta.messages}`);
  if (meta.platform) rows.push(`**Platform:** ${meta.platform}`);
  if (meta.extraction) rows.push(`**Extraction:** ${meta.extraction}`);
  if (!rows.length) return '';
  return rows.map(row => '> ' + row).join('\n') + '\n';
}

function sectionSummaries(text) {
  const lines = String(text).split('\n');
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^## (.+)$/);
    if (!match) continue;
    const title = stripMd(match[1]);
    if (/^(Contents|At a glance|References)$/i.test(title)) continue;
    const body = [];
    for (let j = i + 1; j < lines.length && !/^#{1,2} /.test(lines[j]); j++) {
      if (lines[j].trim() && !/^(>|---|```)/.test(lines[j])) body.push(lines[j]);
    }
    const sentence = stripMd(body.join(' ')).match(/[^.!?\n]+[.!?]?/);
    if (sentence && sentence[0].length > 12) sections.push(`- **${title}:** ${sentence[0].trim().slice(0, 180)}`);
    if (sections.length >= 12) break;
  }
  return sections;
}

function collectReferences(text) {
  const urls = new Set();
  for (const match of String(text).matchAll(/https?:\/\/[^\s<>)\]"'`]+/g)) urls.add(match[0]);
  return [...urls].slice(0, 30).map((url, i) => `${i + 1}. ${url}`);
}

function enrichKnowledgeBase(text) {
  const summary = sectionSummaries(text);
  const references = collectReferences(text);
  let out = text;
  if (summary.length) out = insertAfterHeading(out, '## At a glance\n\n' + summary.join('\n'));
  if (references.length) out += '\n\n## References\n\n' + references.join('\n') + '\n';
  return out;
}

// ---------- main entry point ----------

export function beautifyMarkdown(input, options = {}) {
  const source = String(input ?? '');
  const style = options.style || 'clean';
  if (style === 'raw') return source;

  const detected = extractMetadata(source);
  const { text: masked, tokens } = protectContent(source);
  let out = masked;

  if (options.normalize !== false) {
    out = normalizeHeadings(out);
    out = normalizeWhitespace(out);
    out = normalizeSeparators(out);
    out = normalizeLists(out);
    out = normalizeTables(out);
    if (options.urls !== false) out = autolinkUrls(out);
    if (options.timestamps !== false) out = normalizeTimestamps(out);
  }
  // Generate the TOC from the MASKED text so headings inside code fences are never listed.
  const wantToc = options.toc !== false && (options.toc || style === 'report' || style === 'kb');
  const tocBlock = wantToc ? generateToc(out) : '';
  out = restoreContent(out, tokens);
  out = out.split('\n').filter(line => !META_RE.test(line)).join('\n').replace(/^\n+/, '');

  if (style === 'kb') out = enrichKnowledgeBase(out);

  const meta = { ...detected, ...(options.metadata || {}) };
  const wantHeader = options.metadataHeader !== false && (style === 'report' || style === 'kb' || options.metadataHeader);
  const header = wantHeader ? formatMetadataHeader(meta) : '';
  const front = [header.trim(), tocBlock.trim()].filter(Boolean).join('\n\n');
  if (front) out = insertAfterHeading(out, front);
  return normalizeWhitespace(out);
}

export function beautifyConversation(conv, options = {}) {
  const original = renderMarkdown(conv);
  const meta = {
    source: conv.source,
    exported: conv.exportedAt,
    messages: conv.messages?.length,
    platform: conv.metadata?.platform,
    extraction: conv.metadata?.extractionMethod
  };
  const clean = beautifyMarkdown(original, { ...options, style: 'clean', metadata: meta });
  const report = beautifyMarkdown(original, { ...options, style: 'report', metadata: meta });
  const kb = beautifyMarkdown(original, { ...options, style: 'kb', metadata: meta });
  return {
    original,
    variants: { raw: original, clean, report, kb },
    intelligenceReport: buildIntelligenceReport(conv),
    editorialPrompt: buildEditorialPrompt(conv)
  };
}


const PROPOSED_RE = /\b(propose|proposed|suggest|suggested|could|might|maybe|consider|option|idea|would be nice|possibly)\b/i;
const CONSTRAINT_RE = /\b(must|must not|never|only|requires?|requirement|constraint|keep|preserve|avoid|do not|don't|cannot|can't)\b/i;
const STATUS_RE = /\b(already|currently|implemented|working|completed|done|built|deployed|verified|tested|existing|supports?)\b/i;
const QUESTION_RE = /\?|\b(unknown|unclear|not sure|needs? confirmation|open question|pending|blocked|TODO|TBD|not decided|not yet)\b/i;

function extractHandoffLines(text) {
  let section = 'Conversation';
  let inCodeFence = false;
  const buckets = { context: [], decisions: [], proposed: [], constraints: [], status: [], open: [], actions: [] };
  const seen = new Set();
  const add = (key, value, source) => {
    const clean = stripMd(value).replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '').replace(/\s+/g, ' ').trim();
    if (clean.length < 8 || clean.length > 420) return;
    const id = key + ':' + clean.toLowerCase();
    if (seen.has(id)) return;
    seen.add(id);
    buckets[key].push({ value: clean, source });
  };
  for (const [index, raw] of String(text).split('\n').entries()) {
    const heading = raw.match(/^#{1,3}\s+(.+)$/);
    if (heading) { section = stripMd(heading[1]); continue; }
    if (!raw.trim()) continue;
    const trimmed = raw.trim();
    if (trimmed.startsWith(String.fromCharCode(96).repeat(3)) || trimmed.startsWith('~~~')) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence || /^\s*>\s?/.test(raw)) continue;
    const line = raw.trim();
    const source = section === 'Conversation' ? 'line ' + (index + 1) : section;
    if (buckets.context.length < 3 && line.length > 15) add('context', line, source);
    if (DECISION_RE.test(line) && !PROPOSED_RE.test(line)) add('decisions', line, source);
    if (PROPOSED_RE.test(line)) add('proposed', line, source);
    if (CONSTRAINT_RE.test(line)) add('constraints', line, source);
    if (STATUS_RE.test(line)) add('status', line, source);
    if (QUESTION_RE.test(line) || /\b(waiting for|depends on|if we|unless)\b/i.test(line)) add('open', line, source);
    if (/^(?:next(?: step)?s?:|todo:|then\b|implement\b|add\b|fix\b|update\b|build\b|create\b|test\b|verify\b|wire\b|remove\b|replace\b)/i.test(line) || /\b(next step|action item|follow[- ]?up)\b/i.test(line)) add('actions', line, source);
  }
  return buckets;
}

export function buildAgentHandoff(input, titleHint = '') {
  const text = typeof input === 'string' ? input : renderMarkdown(input);
  const title = titleHint || (typeof input === 'string'
    ? (text.match(/^#\s+(.+)$/m)?.[1] || 'Conversation handoff')
    : (input.title || 'Conversation handoff'));
  const buckets = extractHandoffLines(text);
  const render = (heading, items) => {
    const lines = items.slice(0, 10).map(item => '- ' + item.value + ' _(source: ' + item.source + ')_');
    return '## ' + heading + '\n\n' + (lines.length ? lines.join('\n') : '_No explicit items detected. Check the source transcript before assuming none exist._') + '\n';
  };
  const files = [...new Set(text.match(FILE_RE) || [])];
  const repos = [...new Set(text.match(REPO_RE) || [])];
  return [
    '# Agent Handoff — ' + stripMd(title),
    '',
    '> Generated locally by ChatVault using extractive rules. This is a briefing aid, not an authoritative interpretation.',
    '> Verify every item against the source transcript. The generator does not infer implementation status or resolve contradictions.',
    '',
    '## Objective & context',
    '',
    buckets.context.length ? buckets.context.map(item => '- ' + item.value + ' _(source: ' + item.source + ')_').join('\\n') : 'No concise objective could be extracted automatically. Read the source conversation to establish the actual task and scope.',
    '',
    render('Confirmed decisions (explicit language)', buckets.decisions),
    render('Requirements & constraints (detected wording)', buckets.constraints),
    render('Current state / progress (detected wording)', buckets.status),
    render('Proposals & ideas (not automatically approved)', buckets.proposed),
    render('Open questions, dependencies & blockers', buckets.open),
    render('Potential next actions (extracted, not prioritised)', buckets.actions),
    '## Relevant files & repositories',
    '',
    files.length || repos.length
      ? [...files.map(file => '- ' + file), ...repos.map(repo => '- ' + repo)].join('\n')
      : '_No file paths or repository URLs detected._',
    '',
    '## Agent instructions',
    '',
    '- Read the relevant source conversation sections before making changes; use the full cleaned transcript when context or exact wording matters.',
    '- Inspect the current repository state and existing documentation before editing. Do not assume this handoff describes the latest code.',
    '- Preserve existing user changes. Do not reset, clean, overwrite, or discard unrelated work.',
    '- Treat proposals as unapproved unless the conversation explicitly confirms them.',
    '- Do not invent missing requirements, file paths, implementation status, or acceptance criteria. Ask only when a consequential ambiguity blocks safe progress.',
    '- Make the smallest coherent change, run focused tests, then report what changed, what was actually verified, and what remains unverified.',
    '',
    '## Acceptance criteria',
    '',
    '_Not inferred. Derive these from explicit requirements in the source conversation and confirm any missing or conflicting criteria before declaring the task complete._',
    '',
    '## Source of truth',
    '',
    'Attach or provide the matching clean.md (or original transcript) alongside this handoff when the agent needs full chronology, exact examples, code snippets, or disputed context.',
    ''
  ].join('\n');
}

// ---------- extractive intelligence report (no invention, no network) ----------

const DECISION_RE = /\b(decided|decision|agreed|chose|approved|rejected|dropped|we will|going with|final choice)\b/i;
const OPEN_RE = /\b(todo|next steps?|pending|remaining|not built|blocked|unfinished|open question|deferred|needs? (?:a |to )?)\b/i;
const NEXT_RE = /\b(next steps?|action item|follow[- ]?up|we should|you should|must|implement)\b/i;
const FILE_RE = /\b(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:m?js|jsx|ts|tsx|py|md|json|ya?ml|rs|go|sh|sql|html|css)\b/g;
const REPO_RE = /github\.com\/[\w.-]+\/[\w.-]+/gi;

function bucketLine(line) {
  const clean = stripMd(line);
  return clean.length > 4 && clean.length < 320 ? clean : '';
}

export function buildIntelligenceReport(input, titleHint = '') {
  const text = typeof input === 'string' ? input : renderMarkdown(input);
  const title = titleHint || (typeof input === 'string'
    ? (text.match(/^#\s+(.+)$/m)?.[1] || 'Conversation')
    : (input.title || 'Conversation'));
  const buckets = { decisions: [], open: [], next: [], files: new Set(), repos: new Set(), code: [] };
  let context = 'Message';
  let fence = null;
  const seen = new Set();

  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(\d+)\.\s+(.+)$/);
    if (heading) context = `${heading[1]}. ${stripMd(heading[2])}`;
    const fenceOpen = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fenceOpen && !fence) {
      fence = { char: fenceOpen[1][0], length: fenceOpen[1].length, lines: [line], lang: fenceOpen[2].trim() };
      continue;
    }
    if (fence) {
      fence.lines.push(line);
      if (isFenceLine(line, fence.char, fence.length)) {
        buckets.code.push({ lang: fence.lang || 'text', count: fence.lines.length - 2, context, first: stripMd(fence.lines[1] || '') });
        fence = null;
      }
      continue;
    }
    const clean = bucketLine(line);
    if (!clean) continue;
    const add = (key, value = clean) => {
      const id = key + ':' + value;
      if (seen.has(id)) return;
      seen.add(id);
      buckets[key].push({ value, context });
    };
    if (DECISION_RE.test(clean)) add('decisions');
    if (OPEN_RE.test(clean)) add('open');
    if (NEXT_RE.test(clean)) add('next');
    for (const match of clean.matchAll(FILE_RE)) buckets.files.add(match[0]);
    for (const match of clean.matchAll(REPO_RE)) buckets.repos.add(match[0]);
  }

  const section = (name, items) => {
    if (!items.length) return `## ${name}\n\n_None detected._\n`;
    return `## ${name}\n\n` + items.slice(0, 15).map(i => `- ${i.value} _(from ${i.context})_`).join('\n') + '\n';
  };
  const parts = [
    `# Intelligence Report — ${stripMd(title)}`,
    '',
    '> Extracted from the conversation by keyword and structure heuristics. No facts were added.',
    '> Verify each item against the original conversation before acting on it.',
    '',
    section('Decisions & conclusions', buckets.decisions),
    section('Unfinished / blocked', buckets.open),
    section('Next steps & actions', buckets.next),
    '## Files & repositories mentioned\n',
    buckets.files.size || buckets.repos.size
      ? [...buckets.files].slice(0, 30).map(f => '- `' + f + '`').join('\n') +
        (buckets.repos.size ? '\n\n' + [...buckets.repos].slice(0, 15).map(r => '- ' + r).join('\n') : '') + '\n'
      : '_None detected._\n',
    '## Preserved code references\n',
    buckets.code.length
      ? buckets.code.slice(0, 15).map(c => `- \`${c.lang}\`, ${c.count} lines (${c.context})${c.first ? ': ' + c.first.slice(0, 100) : ''}`).join('\n') + '\n'
      : '_None detected._\n'
  ];
  return parts.join('\n');
}

export function buildEditorialPrompt(input) {
  const text = typeof input === 'string' ? input : renderMarkdown(input);
  return [
    '# ChatVault editorial enhancement prompt',
    '',
    'Paste this whole document into an AI assistant. It is a formatting request, not a rewriting request.',
    '',
    '## Instructions',
    '',
    '- Produce an **Intelligence Report** from the conversation below.',
    '- Do NOT invent facts, decisions, files, dates or code. Every claim must be traceable to the original text.',
    '- Keep the original message order and all technical content intact in the archive section.',
    '- Use sections: Overview, Decisions, Implemented, Unfinished/Blocked, Files & repositories, Next steps for the next agent, Code worth preserving.',
    '- Quote or cite the message number for each extracted item.',
    '- If information is missing, write “Not stated” instead of guessing.',
    '- Keep the original export verbatim under a section titled “Original conversation”.',
    '',
    '## Conversation',
    '',
    '~~~~markdown',
    text.trim(),
    '~~~~'
  ].join('\n');
}
