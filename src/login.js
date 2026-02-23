// login.js — Login window renderer logic
const DAEMON_URL = 'http://127.0.0.1:7777';

let phoneCodeHash = null;
let phoneNumber = null;
let loginPollTimer = null;

// ── Elements ──
const phoneInput = document.getElementById('phone-input');
const codeInput = document.getElementById('code-input');
const passwordInput = document.getElementById('password-input');
const sendCodeBtn = document.getElementById('send-code-btn');
const verifyCodeBtn = document.getElementById('verify-code-btn');
const verify2faBtn = document.getElementById('verify-2fa-btn');
const phoneError = document.getElementById('phone-error');
const codeError = document.getElementById('code-error');
const twoFaError = document.getElementById('2fa-error');
const phoneStatus = document.getElementById('phone-status');
const qrError = document.getElementById('qr-error');
const qrDisplay = document.getElementById('qr-display');
const qrLoading = document.getElementById('qr-loading');
const closeBtn = document.getElementById('close-btn');

// ── Tabs ──
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');

    const which = tab.dataset.tab;
    document.getElementById('phone-section').style.display = which === 'phone' ? '' : 'none';
    document.getElementById('qr-section').style.display = which === 'qr' ? '' : 'none';

    if (which === 'qr') {
      loadQR();
    }
  });
});

// ── Steps ──
function showStep(stepId) {
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  document.getElementById(stepId).classList.add('active');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.add('visible');
}
function hideError(el) {
  el.classList.remove('visible');
}
function showStatus(el, msg) {
  el.textContent = msg;
  el.classList.add('visible');
}

// ── HTTP ──
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(DAEMON_URL + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Phone Login ──
sendCodeBtn.addEventListener('click', async () => {
  hideError(phoneError);
  const phone = phoneInput.value.trim();
  if (!phone) return showError(phoneError, 'Enter your phone number');

  sendCodeBtn.disabled = true;
  sendCodeBtn.textContent = 'Sending...';

  try {
    const result = await api('POST', '/login/phone', { phone });
    phoneNumber = phone;
    phoneCodeHash = result.phoneCodeHash;
    showStep('step-code');
    codeInput.focus();
  } catch (err) {
    showError(phoneError, err.message);
  } finally {
    sendCodeBtn.disabled = false;
    sendCodeBtn.textContent = 'Send Code';
  }
});

verifyCodeBtn.addEventListener('click', async () => {
  hideError(codeError);
  const code = codeInput.value.trim();
  if (!code) return showError(codeError, 'Enter the verification code');

  verifyCodeBtn.disabled = true;
  verifyCodeBtn.textContent = 'Verifying...';

  try {
    const result = await api('POST', '/login/code', {
      phone: phoneNumber,
      code,
      phoneCodeHash,
    });

    if (result.need2FA) {
      showStep('step-2fa');
      passwordInput.focus();
    } else if (result.ok) {
      onLoginSuccess();
    }
  } catch (err) {
    showError(codeError, err.message);
  } finally {
    verifyCodeBtn.disabled = false;
    verifyCodeBtn.textContent = 'Verify';
  }
});

verify2faBtn.addEventListener('click', async () => {
  hideError(twoFaError);
  const password = passwordInput.value;
  if (!password) return showError(twoFaError, 'Enter your 2FA password');

  verify2faBtn.disabled = true;
  verify2faBtn.textContent = 'Verifying...';

  try {
    await api('POST', '/login/2fa', { password });
    onLoginSuccess();
  } catch (err) {
    showError(twoFaError, err.message);
  } finally {
    verify2faBtn.disabled = false;
    verify2faBtn.textContent = 'Submit';
  }
});

// Enter key handlers
phoneInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCodeBtn.click(); });
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyCodeBtn.click(); });
passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify2faBtn.click(); });

// ── QR Login ──
// The daemon doesn't currently expose a /login/qr endpoint.
// Show the daemon's web-based login page as a fallback.
async function loadQR() {
  if (qrDisplay) qrDisplay.style.display = 'none';
  qrLoading.style.display = '';
  hideError(qrError);

  try {
    // Check if daemon is connected (already logged in)
    const res = await fetch(DAEMON_URL + '/health');
    const health = await res.json();

    if (health.connected) {
      onLoginSuccess();
      return;
    }

    qrLoading.style.display = 'none';

    // No /login/qr endpoint — show helpful fallback
    if (qrDisplay) {
      qrDisplay.style.display = '';
      qrDisplay.innerHTML = `
        <div style="text-align: center; padding: 8px;">
          <p style="color: #888; font-size: 13px; margin-bottom: 12px;">
            QR login is not yet available.
          </p>
          <p style="color: #666; font-size: 12px;">
            Use the <strong style="color: #c084fc;">Phone</strong> tab to sign in,<br>
            or visit the daemon web UI:
          </p>
          <div class="qr-fallback">
            <a href="#" onclick="return false;" style="color: #c084fc; text-decoration: none;">
              http://127.0.0.1:7777/login
            </a>
          </div>
        </div>
      `;
    }
  } catch (err) {
    qrLoading.style.display = 'none';
    showError(qrError, 'Cannot reach daemon: ' + err.message);
  }
}

// ── Poll for login success ──
// After a successful login (via phone flow, 2FA, or external browser),
// the daemon's /me endpoint will start responding.
function startLoginPoll() {
  if (loginPollTimer) return;
  loginPollTimer = setInterval(async () => {
    try {
      const res = await fetch(DAEMON_URL + '/me');
      if (res.ok) {
        const me = await res.json();
        if (me && me.id) {
          onLoginSuccess();
        }
      }
    } catch {
      // daemon not ready yet
    }
  }, 2000);
}

// Start polling immediately — handles case where user logs in via daemon web UI
startLoginPoll();

// ── Success ──
function onLoginSuccess() {
  // Stop polling
  if (loginPollTimer) {
    clearInterval(loginPollTimer);
    loginPollTimer = null;
  }

  // Notify main process via the preload bridge
  if (window.oceangram && window.oceangram.loginSuccess) {
    window.oceangram.loginSuccess();
  } else {
    // Fallback: show success and close
    document.querySelector('.content').innerHTML =
      '<div class="success-view"><div class="logo">✅</div><p>Login successful!</p><p class="subtitle">Starting Oceangram...</p></div>';
    setTimeout(() => window.close(), 1500);
  }
}

// ── Close ──
closeBtn.addEventListener('click', () => {
  if (window.oceangram && window.oceangram.closeLogin) {
    window.oceangram.closeLogin();
  } else {
    window.close();
  }
});
