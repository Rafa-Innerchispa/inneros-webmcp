let invokeFn = null;
let bubbleFn = null;
let addTraceFn = null;
let sceneCatalog = [];
let lastDesignedScene = null;
let demoBlackoutTimer = null;

function $(id) {
  return document.getElementById(id);
}

function labelForScene(name) {
  const hit = sceneCatalog.find((entry) => entry.name === name);
  return hit?.label || String(name).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function demoAutoBlackoutEnabled() {
  return Boolean($('dmxDemoAutoBlackout')?.checked);
}

function demoBlackoutSeconds() {
  const value = Number($('dmxDemoBlackoutSeconds')?.value || 12);
  return Number.isFinite(value) ? Math.min(Math.max(value, 5), 120) : 12;
}

function clearDemoBlackoutTimer() {
  if (demoBlackoutTimer) {
    clearTimeout(demoBlackoutTimer);
    demoBlackoutTimer = null;
  }
}

function scheduleDemoBlackout() {
  clearDemoBlackoutTimer();
  if (!demoAutoBlackoutEnabled()) return;
  const seconds = demoBlackoutSeconds();
  demoBlackoutTimer = setTimeout(async () => {
    const data = await invokeFn('dmx_blackout', {});
    if (data.ok) {
      $('dmxState').textContent = `Demo blackout · after ${seconds}s`;
      bubbleFn('assistant', 'AG-59 DMX', `Demo safety blackout applied after ${seconds} seconds.`);
      addTraceFn?.({
        title: 'Demo auto-blackout',
        detail: `Scheduled demo blackout fired after ${seconds}s.`,
        state: 'ok',
        source: 'BACKEND',
        confirmed: true
      });
    }
  }, seconds * 1000);
}

export function renderScenePreview(scene = null) {
  const host = $('dmxScenePreview');
  if (!host) return;
  if (!scene || !Array.isArray(scene.steps) || !scene.steps.length) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  host.hidden = false;
  host.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = `${scene.label || labelForScene(scene.name || scene.scene)} · ${scene.loops || 1} loop(s)`;
  const list = document.createElement('ol');
  list.className = 'dmx-preview-steps';
  for (const step of scene.steps.slice(0, 8)) {
    const item = document.createElement('li');
    const color = step.color || '—';
    const target = step.target || 'all';
    const ms = step.duration_ms ?? step.durationMs ?? '?';
    const brightness = step.brightness ?? '—';
    item.textContent = `${target} · ${color} · ${brightness} · ${ms}ms`;
    list.append(item);
  }
  const note = document.createElement('p');
  note.className = 'dmx-preview-note';
  note.textContent = 'Preview only — registration does not run fixtures until Apply scene or Create + Apply.';
  host.append(title, list, note);
}

export function refreshDmxSceneSelector(supportedScenes = [], catalog = sceneCatalog) {
  const select = $('dmxScene');
  if (!select || !Array.isArray(supportedScenes) || !supportedScenes.length) return;
  const selectable = supportedScenes.filter((scene) => scene && scene !== 'blackout');
  if (!selectable.length) return;
  const current = select.value;
  select.replaceChildren(...selectable.map((scene) => {
    const option = document.createElement('option');
    option.value = scene;
    const meta = catalog.find((entry) => entry.name === scene);
    option.textContent = meta?.label || labelForScene(scene);
    return option;
  }));
  if (selectable.includes(current)) select.value = current;
}

export function renderDmxGallery(catalog = sceneCatalog) {
  const host = $('dmxSceneGallery');
  if (!host) return;
  host.replaceChildren();
  if (!catalog.length) {
    const empty = document.createElement('p');
    empty.className = 'dmx-gallery-empty';
    empty.textContent = 'No scenes reported yet.';
    host.append(empty);
    return;
  }
  for (const entry of catalog) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `dmx-gallery-card${entry.dynamic ? ' dynamic' : ''}`;
    card.dataset.scene = entry.name;
    card.innerHTML = `<strong>${entry.label}</strong><span>${entry.tags.join(' · ')}</span>`;
    card.addEventListener('click', () => {
      const select = $('dmxScene');
      if (select) select.value = entry.name;
      $('dmxState').textContent = `Selected · ${entry.label}`;
      renderScenePreview(lastDesignedScene?.name === entry.name ? lastDesignedScene : { name: entry.name, label: entry.label, loops: 1, steps: [] });
    });
    host.append(card);
  }
}

export function applyDmxRegistry(data = {}) {
  if (!data.ok) return;
  sceneCatalog = Array.isArray(data.sceneCatalog) ? data.sceneCatalog : sceneCatalog;
  refreshDmxSceneSelector(data.supportedScenes || [], sceneCatalog);
  renderDmxGallery(sceneCatalog);
}

export function onSceneRegistered(data = {}) {
  if (!data.ok) return;
  applyDmxRegistry(data);
  const select = $('dmxScene');
  if (select && data.scene && [...select.options].some((option) => option.value === data.scene)) {
    select.value = data.scene;
  }
  lastDesignedScene = {
    name: data.scene,
    label: data.label,
    loops: data.loops || data.designedScene?.loops || 1,
    steps: data.steps || data.designedScene?.steps || []
  };
  renderScenePreview(lastDesignedScene);
  const applyBtn = $('dmxCreateApplyBtn');
  if (applyBtn) {
    applyBtn.disabled = false;
    applyBtn.textContent = `Create + Apply · ${data.label || data.scene}`;
  }
}

export async function applySelectedScene() {
  const scene = $('dmxScene')?.value;
  if (!scene) return { ok: false, error: 'scene_required' };
  const data = await invokeFn('dmx_set_scene', { scene });
  if (data.ok) {
    $('dmxState').textContent = `AG-59 applied · ${data.label || labelForScene(scene)}`;
    bubbleFn(data.ok ? 'assistant' : 'error', 'AG-59 DMX', data.ok ? `Applied ${data.label || scene}.` : `Scene blocked: ${data.error || data.state}`);
    scheduleDemoBlackout();
    addTraceFn?.({
      title: `Physical DMX applied · ${scene}`,
      detail: demoAutoBlackoutEnabled() ? `Scene running. Demo blackout scheduled in ${demoBlackoutSeconds()}s.` : 'Scene applied on AG-59 fixtures.',
      state: 'ok',
      source: 'BACKEND',
      confirmed: true
    });
  } else {
    bubbleFn('error', 'AG-59 DMX', `Scene blocked: ${data.error || data.state}`);
  }
  return data;
}

export async function createAndApplyFromPrompt(description = '') {
  const prompt = String(description || $('copilotPrompt')?.value || '').trim();
  if (!prompt) {
    bubbleFn('error', 'AG-59 DMX', 'Describe the scene first in the chat composer.');
    return { ok: false, error: 'description_required' };
  }
  if (!window.confirm('Create the scene with Local Qwen + AG-59 and apply it to the physical lights now?')) {
    return { ok: false, state: 'cancelled' };
  }
  const btn = $('dmxCreateApplyBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Designing + applying…';
  }
  try {
    const created = await invokeFn('dmx_create_scene', { description: prompt });
    if (!created.ok) {
      bubbleFn('error', 'AG-59 DMX', `Create blocked: ${created.error || created.state}`);
      return created;
    }
    onSceneRegistered(created);
    bubbleFn('assistant', 'AUTO · AG-59', `Registered ${created.label || created.scene}. Applying to fixtures…`);
    const applied = await invokeFn('dmx_set_scene', { scene: created.scene });
    if (applied.ok) {
      $('dmxState').textContent = `Live · ${created.label || created.scene}`;
      bubbleFn('assistant', 'AG-59 DMX', `Create + Apply complete for ${created.label || created.scene}.`);
      scheduleDemoBlackout();
    } else {
      bubbleFn('error', 'AG-59 DMX', `Registered but apply failed: ${applied.error || applied.state}`);
    }
    return { ok: applied.ok, created, applied };
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Create + Apply';
    }
  }
}

function initSpeechInput() {
  const mic = $('voiceMicBtn');
  const prompt = $('copilotPrompt');
  if (!mic || !prompt) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    mic.title = 'Voice input unavailable in this browser';
    mic.disabled = true;
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'es-EC';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  let listening = false;
  mic.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    listening = true;
    mic.classList.add('active');
    mic.textContent = 'Listening…';
    recognition.start();
  });
  recognition.addEventListener('result', (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || '';
    if (transcript) {
      prompt.value = prompt.value ? `${prompt.value.trim()} ${transcript.trim()}` : transcript.trim();
      prompt.focus();
      bubbleFn('assistant', 'VOICE INPUT', transcript);
    }
  });
  recognition.addEventListener('end', () => {
    listening = false;
    mic.classList.remove('active');
    mic.textContent = '🎤 Voice';
  });
  recognition.addEventListener('error', () => {
    listening = false;
    mic.classList.remove('active');
    mic.textContent = '🎤 Voice';
    bubbleFn('error', 'VOICE INPUT', 'Could not capture speech in this browser session.');
  });
}

export function initDmxExperience(deps = {}) {
  invokeFn = deps.invoke;
  bubbleFn = deps.bubble;
  addTraceFn = deps.addTrace;
  initSpeechInput();

  $('dmxSceneBtn')?.addEventListener('click', () => applySelectedScene());
  $('dmxCreateApplyBtn')?.addEventListener('click', () => createAndApplyFromPrompt());
  $('dmxBlackoutBtn')?.addEventListener('click', async () => {
    clearDemoBlackoutTimer();
    const data = await invokeFn('dmx_blackout', {});
    bubbleFn(data.ok ? 'assistant' : 'error', 'AG-59 DMX', data.ok ? 'Blackout applied.' : `Blackout failed: ${data.error || data.state}`);
    if (data.ok) $('dmxState').textContent = 'AG-59 blackout applied';
  });
  $('dmxStatusBtn')?.addEventListener('click', async () => {
    const data = await invokeFn('dmx_status', {});
    $('dmxState').textContent = data.ok ? `AG-59 ready · ${data.fixtureCount || 9} fixtures · effect ${data.currentEffect || 'idle'}` : `DMX unavailable · ${data.error || 'unknown'}`;
    if (data.ok) applyDmxRegistry(data);
    bubbleFn('assistant', 'AG-59 DMX', data.ok ? `Registry: ${(data.supportedScenes || []).length} scenes.` : `DMX unavailable: ${data.error || 'engine offline'}`);
  });
}

export { lastDesignedScene, sceneCatalog };
