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
