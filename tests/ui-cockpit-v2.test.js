import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('cockpit v2 keeps primary coding chat above the live trace workspace', () => {
  assert.ok(html.indexOf('id="agents"') < html.indexOf('class="recording-grid cockpit-grid"'));
  assert.ok(html.indexOf('Coding Chat · InnerOS Copilot') < html.indexOf('Global Live Trace'));
  assert.ok(html.indexOf('DMX quick control') < html.indexOf('class="recording-grid cockpit-grid"'));
});

test('architecture rail is explicitly telemetry, not fake buttons', () => {
  assert.match(html, /LIVE FLOW TELEMETRY/);
  assert.match(html, /not clickable controls/);
  for (const id of ['archHuman','archWebmcp','archBridge','archMcp','archExecutor','archEvidence']) {
    assert.match(html, new RegExp(`class="arch-node[^\"]*" id="${id}"`));
    assert.doesNotMatch(html, new RegExp(`<button[^>]+id="${id}"`));
  }
});

test('explicit auto and lane selection UI is wired without replacing execution contracts', () => {
  assert.match(html, /id="autoLaneBtn"/);
  assert.match(html, /id="selectedExecutorLabel"/);
  assert.match(app, /AUTO · local-first/);
  assert.match(app, /CODEX · headless/);
  assert.match(app, /CURSOR · remote inbox/);
  assert.match(app, /ANTIGRAVITY · remote inbox/);
  assert.match(css, /Cockpit V2/);
});

test('InnerChispa visual identity is present in the cockpit header', () => {
  assert.match(html, /INNERCHISPA/);
  assert.match(html, /class="brand-mark"/);
  assert.match(css, /brandOrbit/);
  assert.match(css, /cockpitAurora/);
});

test('approval-first flow prevents conversation from auto-registering native DMX actions', () => {
  assert.match(app, /nativeAutoObserver\.disconnect\(\)/);
  assert.match(app, /Approve & Execute Plan/);
  assert.match(app, /PLAN READY · continue chatting to refine it/);
  assert.match(app, /approvedExecutePlan/);
});

test('execution validates an existing bound project before any lane dispatch', () => {
  assert.match(app, /verifyBoundProjectForApproval/);
  assert.match(app, /get_project_status/);
  assert.match(app, /Typing a new name here does not create a project/);
  assert.match(app, /status\?\.exists && status\?\.repo/);
});

test('AUTO native DMX registration happens only inside approved execution handler', () => {
  const approvedStart = app.indexOf('async function approvedExecutePlan');
  const dmxCall = app.indexOf("invoke('dmx_create_scene'", approvedStart);
  assert.ok(approvedStart >= 0 && dmxCall > approvedStart);
  assert.match(app.slice(approvedStart, dmxCall + 250), /target === 'auto'/);
});

test('explicit provider lanes remain explicit after approval-first change', () => {
  const approvedStart = app.indexOf('async function approvedExecutePlan');
  const approvedBody = app.slice(approvedStart);
  assert.match(approvedBody, /dispatch_agent_action/);
  assert.match(approvedBody, /agent: target/);
  assert.match(approvedBody, /target === 'auto'/);
});


test('development workspace exposes explicit project creation without implicit GitHub creation', () => {
  assert.match(app, /Create Project/);
  assert.match(app, /create_project_workspace/);
  assert.match(app, /No GitHub\/cloud repository was created/);
  assert.match(app, /verifyDevelopmentProject/);
});

test('project files become read-only Copilot context and follow the refined plan', () => {
  assert.match(app, /Attach PDF \/ code/);
  assert.match(app, /\/api\/context\/upload/);
  assert.match(app, /conversationHistoryForModel/);
  assert.match(app, /contextText\(/);
  assert.match(app, /READ-ONLY ATTACHED PROJECT CONTEXT/);
});

test('voice control is dictation only and does not bypass approval', () => {
  assert.match(app, /SpeechRecognition/);
  assert.match(app, /webkitSpeechRecognition/);
  assert.match(app, /Dictation only; it never executes a plan/);
  assert.match(app, /Approve & Execute Plan/);
});


const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('voice is local-first through on-prem Whisper with explicit browser fallback', () => {
  assert.match(app, /Local voice/);
  assert.match(app, /MediaRecorder/);
  assert.match(app, /\/api\/voice\/transcribe/);
  assert.match(app, /Browser fallback/);
  assert.match(serverSource, /127\.0\.0\.1:9001\/asr/);
  assert.match(serverSource, /provider: 'Local Whisper'/);
  assert.match(serverSource, /executionClaimed: false/);
});


test('composer exposes familiar send, voice, playback and stop controls', () => {
  assert.match(app, /installChatComposerPolish/);
  assert.match(app, /playResponseBtn/);
  assert.match(app, /stopResponseBtn/);
  assert.match(app, /Send to local model/);
  assert.match(app, /Enter to send · Shift\+Enter for a new line/);
  assert.match(app, /speechSynthesis/);
  assert.match(app, /SpeechSynthesisUtterance/);
});

test('approval remains visually and semantically separate from sending chat', () => {
  assert.match(app, /approval-button/);
  assert.match(app, /Approve & Execute Plan/);
  assert.match(app, /composer-secondary-row/);
});

test('cockpit uses a subtle embedded InnerOS neural background image', () => {
  assert.match(css, /data:image\/svg\+xml/);
  assert.match(css, /body::before/);
  assert.match(css, /opacity:\.22/);
});

test('visible WebMCP count is normalized to the current 13-tool surface', () => {
  assert.match(app, /'13 WebMCP'/);
});


test('public browser bundle remains syntactically valid after composer polish', () => {
  const parseable = app.replace(/^import\s+[^;]+;\s*/gm, '');
  assert.doesNotThrow(() => new Function(parseable));
});
