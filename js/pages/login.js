// ============================================================================
// login.html controller: toggles between sign-in / create-account panes,
// submits to the auth module, and redirects into the app on success.
// ============================================================================

import { login, register, isAuthenticated } from '../auth.js';
import { ApiError, NetworkError } from '../api.js';

// If already logged in, skip straight to the dashboard.
if (await isAuthenticated()) {
  window.location.href = 'dashboard.html';
}

const loginPane = document.getElementById('loginPane');
const registerPane = document.getElementById('registerPane');

document.getElementById('showRegister').addEventListener('click', () => {
  loginPane.style.display = 'none';
  registerPane.style.display = 'block';
});
document.getElementById('showLogin').addEventListener('click', () => {
  registerPane.style.display = 'none';
  loginPane.style.display = 'block';
});

function showError(el, message) {
  el.textContent = message;
  el.classList.add('visible');
}
function clearError(el) {
  el.textContent = '';
  el.classList.remove('visible');
}
function setSubmitting(button, isSubmitting, idleLabel) {
  button.disabled = isSubmitting;
  button.innerHTML = isSubmitting ? '<span class="spinner"></span>' : idleLabel;
}

function friendlyError(err) {
  if (err instanceof NetworkError) return "Can't reach the server. Check your connection and try again.";
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');
  clearError(errorEl);

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  setSubmitting(submitBtn, true, 'Sign in');
  try {
    await login(email, password);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(errorEl, friendlyError(err));
    setSubmitting(submitBtn, false, 'Sign in');
  }
});

document.getElementById('registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById('registerError');
  const submitBtn = document.getElementById('registerSubmit');
  clearError(errorEl);

  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;

  if (password.length < 8) {
    showError(errorEl, 'Password must be at least 8 characters.');
    return;
  }

  setSubmitting(submitBtn, true, 'Create account');
  try {
    await register(email, password, name);
    window.location.href = 'dashboard.html';
  } catch (err) {
    showError(errorEl, friendlyError(err));
    setSubmitting(submitBtn, false, 'Create account');
  }
});
