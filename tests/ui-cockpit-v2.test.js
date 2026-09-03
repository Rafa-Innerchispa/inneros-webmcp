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
  assert.match(app, /id|data-agent/);
  assert.match(css, /Cockpit V2/);
});

test('InnerChispa visual identity is present in the cockpit header', () => {
  assert.match(html, /INNERCHISPA/);
  assert.match(html, /class="brand-mark"/);
  assert.match(css, /brandOrbit/);
  assert.match(css, /cockpitAurora/);
});


test('AUTO continues bounded native DMX creation without requiring a second execute click', () => {
  assert.match(app, /AUTO native action detected · dmx_create_scene/);
  assert.match(app, /autoRegisterDmxSceneIfEligible/);
  assert.match(app, /dmx_create_scene/);
  assert.match(app, /Physical execution remains manual/);
  assert.match(app, /Scene registered · use Apply scene/);
  assert.match(css, /native-action-hint/);
});

test('explicit provider lanes are not hijacked by AUTO native DMX interception', () => {
  assert.match(app, /target === 'auto'/);
  assert.match(app, /originalPrompt = lastCopilotPrompt/);
  assert.match(app, /regular execution handler then dispatches that lane/);
});
