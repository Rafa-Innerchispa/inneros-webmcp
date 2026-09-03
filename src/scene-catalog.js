export const BUILTIN_SCENE_LABELS = Object.freeze({
  rainbow: 'Rainbow',
  frenzy: 'Frenzy',
  police: 'Police',
  fire: 'Fire',
  chill_lounge: 'Chill Lounge',
  morado_uv: 'Morado UV',
  rojo_sangre: 'Rojo Sangre',
  blackout: 'Blackout',
  flash_all_demo: 'Flash All Demo'
});

export function formatSceneLabel(name = '') {
  return String(name).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function inferSceneTags(name = '', meta = {}) {
  const value = String(name || '').toLowerCase();
  const tags = [];
  if (meta.dynamic) tags.push('custom');
  else tags.push('builtin');
  if (/pulse|flash|strobe|frenzy|police|demo/.test(value)) tags.push('pulse');
  if (/chill|lounge|slow|suave|ambient/.test(value)) tags.push('ambient');
  if (/rainbow|aurora|color/.test(value)) tags.push('colorful');
  if (/morado|rojo|azul|verde|cyan|uv/.test(value)) tags.push('color');
  if (value === 'blackout') tags.push('safety');
  return [...new Set(tags)];
}

export function buildSceneCatalog(supportedScenes = [], dynamicScenes = {}) {
  return supportedScenes
    .filter((name) => name && name !== 'blackout')
    .map((name) => {
      const dynamic = dynamicScenes[name] || {};
      return {
        name,
        label: dynamic.label || BUILTIN_SCENE_LABELS[name] || formatSceneLabel(name),
        dynamic: Boolean(dynamic.dynamic),
        tags: inferSceneTags(name, dynamic)
      };
    });
}
