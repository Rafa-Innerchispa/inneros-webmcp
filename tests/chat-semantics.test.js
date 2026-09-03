import test from 'node:test';
import assert from 'node:assert/strict';

function isCasualPrompt(text = '') {
  const normalized = String(text).trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length > 80) return false;
  return /^(hola|hello|hi|hey|buenos dias|buenas tardes|buenas noches|good morning|good afternoon|thanks|thank you|gracias)[!.?\s]*$/.test(normalized);
}

test('casual greetings do not qualify for auto execution', () => {
  assert.equal(isCasualPrompt('hola'), true);
  assert.equal(isCasualPrompt('Hello!'), true);
  assert.equal(isCasualPrompt('Inspect the repo and add a regression test'), false);
  assert.equal(isCasualPrompt('hola, can you refactor the adapter?'), false);
});
