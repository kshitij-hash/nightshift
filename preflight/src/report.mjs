// Text rendering. Bare ANSI, switched off whenever stdout is not a terminal.

const ESC = String.fromCharCode(27);
const SYMBOL = { pass: "✓", info: "·", warn: "⚠", fail: "✗" };
const ANSI = { pass: `${ESC}[32m`, info: `${ESC}[2m`, warn: `${ESC}[33m`, fail: `${ESC}[31m` };
const RESET = `${ESC}[0m`;
const WIDTH = 92;

export function useColor(stream = process.stdout, env = process.env) {
  return Boolean(stream && stream.isTTY) && !env.NO_COLOR;
}

function paint(level, text, color) {
  return color && ANSI[level] ? `${ANSI[level]}${text}${RESET}` : text;
}

/** Split on explicit newlines first, then soft-wrap each line at WIDTH. */
export function wrapText(text, width = WIDTH) {
  const out = [];
  for (const hard of String(text).split("\n")) {
    if (hard.length <= width) {
      out.push(hard);
      continue;
    }
    const indent = hard.match(/^\s*/)[0];
    let line = "";
    for (const word of hard.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : `${indent}${word}`;
      if (candidate.length > width && line) {
        out.push(line);
        line = `${indent}${word}`;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function block(level, head, rest, color) {
  const lines = [`  ${paint(level, SYMBOL[level] ?? "-", color)} ${head}`];
  for (const line of rest) lines.push(`    ${line}`);
  return lines.join("\n");
}

export function renderCheck(check, color) {
  const [first, ...rest] = wrapText(`${check.id}: ${check.message}`);
  return block(check.level, first, rest, color);
}

export function renderTransaction(result, color) {
  const level = result.pass ? "pass" : "fail";
  const head = `${paint(level, result.pass ? "PASS" : "FAIL", color)} ${result.hash}`;
  const rest = result.pass ? [] : wrapText(result.reason ?? "failed");
  return block(level, head, rest, color);
}

/**
 * Full report for a finished run.
 *
 * @param {object} result  the same object that --json prints
 * @param {{color?: boolean, version?: string}} options
 */
export function renderReport(result, { color = false, version = "" } = {}) {
  const out = [];
  out.push(`strk20-preflight${version ? ` ${version}` : ""}`);
  out.push(`manifest: ${result.path}`);
  out.push("");
  out.push("offline checks");
  for (const c of result.checks) out.push(renderCheck(c, color));

  if (result.mode === "rpc") {
    out.push("");
    out.push(`rpc checks via ${result.rpc.host}`);
    if (result.transactions.length === 0) out.push(`  ${SYMBOL.info} no readable transactions to check`);
    for (const t of result.transactions) out.push(renderTransaction(t, color));
  } else if (result.rpc && result.rpc.skipped) {
    out.push("");
    out.push(`rpc checks skipped: ${result.rpc.skipped}`);
  }

  out.push("");
  out.push(renderSummary(result, color));
  return out.join("\n");
}

export function renderSummary(result, color) {
  const failures = result.checks.filter((c) => c.level === "fail").length;
  const warnings = result.checks.filter((c) => c.level === "warn").length;
  const txFailures = result.transactions.filter((t) => !t.pass).length;
  const parts = [`${result.checks.length} offline checks`, `${failures} failed`, `${warnings} warned`];
  if (result.mode === "rpc") {
    parts.push(
      `${result.transactions.length - txFailures}/${result.transactions.length} transactions verified on chain`,
    );
  }
  const verdict = result.ok
    ? paint("pass", "OK: the indexer reads this entry the way you intended.", color)
    : paint("fail", "NOT OK: fix the failures above before the deadline.", color);
  return `result: ${parts.join(", ")}\n${verdict}`;
}
