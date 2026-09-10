#!/usr/bin/env node
'use strict';

const { writeFileSync } = require('node:fs');
const { basename } = require('node:path');

const name = basename(process.argv[1]).replace(/\.(cmd|exe)$/i, '');
const args = process.argv.slice(2);
const logPath = process.env.MSW_PROBE_LOG;
const reply = process.env.MSW_PROBE_REPLY || '今天天气不错';

if (logPath) {
  try {
    writeFileSync(logPath, JSON.stringify({
      name,
      argv: args,
      cwd: process.cwd(),
      env: {
        ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL: process.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        CODEX_HOME: process.env.CODEX_HOME,
        CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
        GEMINI_CONFIG_DIR: process.env.GEMINI_CONFIG_DIR,
        GEMINI_MODEL: process.env.GEMINI_MODEL,
        OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
        OPENCODE_MODEL: process.env.OPENCODE_MODEL,
      },
    }));
  } catch {
    // ignore log write errors in tests
  }
}

if (process.env.MSW_PROBE_FAIL === 'auth') {
  console.error('Error: 401 invalid_api_key');
  process.exit(1);
}

if (process.env.MSW_PROBE_FAIL === 'crash') {
  console.error('fatal: agent exploded');
  process.exit(2);
}

function writeOutputFile() {
  const flag = args.indexOf('-o');
  const long = args.indexOf('--output-last-message');
  const index = flag >= 0 ? flag : long;
  if (index >= 0 && args[index + 1]) {
    writeFileSync(args[index + 1], reply);
  }
}

if (name === 'claude') {
  console.log(JSON.stringify({ type: 'result', is_error: false, result: reply }));
} else if (name === 'codex') {
  writeOutputFile();
} else if (name === 'gemini') {
  console.log(JSON.stringify({ response: reply }));
} else if (name === 'opencode') {
  console.log(JSON.stringify({ type: 'text', text: reply }));
} else {
  console.log(reply);
}
