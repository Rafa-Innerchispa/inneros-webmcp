const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.textContent = '';
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const submit = document.getElementById('loginSubmit');
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (response.ok && data.ok) {
      window.location.replace('/');
      return;
    }
    errorEl.textContent = data.error === 'too_many_attempts'
      ? 'Too many failed attempts. Try again later.'
      : 'Invalid credentials or auth not configured.';
  } catch {
    errorEl.textContent = 'Login request failed.';
  } finally {
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }
});
