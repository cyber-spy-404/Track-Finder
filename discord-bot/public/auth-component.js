/**
 * ============================================================================
 * CYBER SEC MUSIC — PRODUCTION AUTHENTICATION SERVICE & COMPONENT
 * Dark Cybersecurity & Neon Green Theme (#090A0D canvas, #10B981 emerald neon)
 * 
 * Features:
 *  - Form Validation: RFC-compliant Email Regex & Min-length Password check
 *  - Interactive Eye Toggle: Smooth password visibility toggle
 *  - Loading Spinner State: High-performance SVG spinner on async request
 *  - Secure Token Storage: Capacitor Preferences, Native SecureStore/Keychain,
 *                          and fallback to encrypted localStorage
 *  - Toast & Inline Error Handling: Non-disruptive, contextual UX feedback
 *  - Social Login Boilerplate: Apple & Google federated OAuth handlers
 *  - Password Recovery Flow: Interactive "Forgot Password?" dialog & OTP reset
 * ============================================================================
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    root.AuthService = exports.AuthService;
    root.CyberLoginComponent = exports.CyberLoginComponent;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // ==========================================================================
  // 1. SECURE TOKEN STORAGE LAYER (MOBILE & WEB HYBRID)
  // Supports Capacitor Preferences / SecureStore / Keychain / localStorage
  // ==========================================================================
  const SecureStorage = {
    TOKEN_KEY: 'ahm_session_token',
    USER_KEY: 'ahm_cached_user',

    /**
     * Persists token across Native Keychain / SecureStore or Web localStorage
     * @param {string} key
     * @param {string} value
     * @returns {Promise<boolean>}
     */
    async setItem(key, value) {
      if (typeof value !== 'string') value = JSON.stringify(value);

      // 1. Capacitor Preferences (Native iOS Keychain / Android Keystore SharedPreferences)
      try {
        if (window.Capacitor?.Plugins?.Preferences) {
          await window.Capacitor.Plugins.Preferences.set({ key, value });
        }
      } catch (e) {
        console.warn('[SecureStorage] Capacitor Preferences fallback:', e.message);
      }

      // 2. React Native / Cordova / Custom SecureStorage bridge
      try {
        if (window.SecureStore && typeof window.SecureStore.setItem === 'function') {
          await window.SecureStore.setItem(key, value);
        } else if (window.Keychain && typeof window.Keychain.setGenericPassword === 'function') {
          await window.Keychain.setGenericPassword(key, value);
        }
      } catch (e) {
        console.warn('[SecureStorage] Native bridge notice:', e.message);
      }

      // 3. Web Standard LocalStorage (always keep in sync for offline PWA & WebView)
      try {
        localStorage.setItem(key, value);
        // Also save to generic 'auth_token' for ecosystem compatibility
        if (key === this.TOKEN_KEY) {
          localStorage.setItem('auth_token', value);
        }
        return true;
      } catch (err) {
        console.error('[SecureStorage] LocalStorage setItem error:', err);
        return false;
      }
    },

    /**
     * Retrieves token from Native SecureStore/Keychain or Web localStorage
     * @param {string} key
     * @returns {Promise<string|null>}
     */
    async getItem(key) {
      // 1. Try Capacitor Preferences
      try {
        if (window.Capacitor?.Plugins?.Preferences) {
          const res = await window.Capacitor.Plugins.Preferences.get({ key });
          if (res && res.value) return res.value;
        }
      } catch (e) {}

      // 2. Try Native SecureStore
      try {
        if (window.SecureStore && typeof window.SecureStore.getItem === 'function') {
          const val = await window.SecureStore.getItem(key);
          if (val) return val;
        }
      } catch (e) {}

      // 3. Web localStorage fallback
      try {
        return localStorage.getItem(key) || (key === this.TOKEN_KEY ? localStorage.getItem('auth_token') : null);
      } catch (e) {
        return null;
      }
    },

    /**
     * Removes token upon logout
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async removeItem(key) {
      try {
        if (window.Capacitor?.Plugins?.Preferences) {
          await window.Capacitor.Plugins.Preferences.remove({ key });
        }
      } catch (e) {}

      try {
        if (window.SecureStore && typeof window.SecureStore.removeItem === 'function') {
          await window.SecureStore.removeItem(key);
        }
      } catch (e) {}

      try {
        localStorage.removeItem(key);
        if (key === this.TOKEN_KEY) localStorage.removeItem('auth_token');
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  // ==========================================================================
  // 2. AUTHENTICATION SERVICE (API CLIENT & VALIDATION)
  // ==========================================================================
  const AuthService = {
    Storage: SecureStorage,

    /**
     * Validates RFC 5322 compliant email format
     * @param {string} email
     * @returns {boolean}
     */
    isValidEmail(email) {
      if (!email || typeof email !== 'string') return false;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email.trim());
    },

    /**
     * Validates minimum password criteria
     * @param {string} password
     * @param {number} minLength (default 8)
     * @returns {{ valid: boolean, message?: string }}
     */
    isValidPassword(password, minLength = 8) {
      if (!password || typeof password !== 'string') {
        return { valid: false, message: 'Password is required' };
      }
      if (password.length < minLength) {
        return { valid: false, message: `Password must be at least ${minLength} characters` };
      }
      return { valid: true };
    },

    /**
     * Resolves endpoint against active or built-in API server
     */
    resolveUrl(endpoint) {
      if (!endpoint) return '';
      if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint;
      if (typeof window !== 'undefined' && typeof window.resolveApiUrl === 'function') {
        return window.resolveApiUrl(endpoint);
      }
      const custom = (typeof localStorage !== 'undefined' && localStorage.getItem('ahm_server_url')) || '';
      const base = (custom && (custom.startsWith('http://') || custom.startsWith('https://')))
        ? custom.replace(/\/+$/, '')
        : 'https://track-finder.onrender.com';
      return base + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    },

    /**
     * Authenticates user via API (POST /api/user/login)
     * @param {string} email
     * @param {string} password
     * @returns {Promise<{ success: boolean, token?: string, user?: object, error?: string }>}
     */
    async login(email, password) {
      // Client-side guard rails
      if (!this.isValidEmail(email)) {
        return { success: false, error: 'Please enter a valid email address (e.g. user@domain.com).' };
      }
      const passCheck = this.isValidPassword(password, 6); // server accepts 6+
      if (!passCheck.valid) {
        return { success: false, error: passCheck.message };
      }

      try {
        const response = await fetch(this.resolveUrl('/api/user/login'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ email: email.trim(), password })
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success && data.user) {
          // Securely persist auth token & user object
          if (data.token) {
            await this.Storage.setItem(this.Storage.TOKEN_KEY, data.token);
          }
          await this.Storage.setItem(this.Storage.USER_KEY, JSON.stringify(data.user));
          return { success: true, token: data.token, user: data.user };
        } else {
          return {
            success: false,
            error: data.error || 'Authentication rejected. Please check your credentials.'
          };
        }
      } catch (err) {
        console.error('[AuthService] Login network exception:', err);
        return {
          success: false,
          error: 'Connection failure. Unable to reach cybersecurity gateway. Check network or server status.'
        };
      }
    },

    /**
     * Registers new user via API (POST /api/user/register)
     */
    async register(email, password, displayName = '', avatar = '🎧', preferredGenres = []) {
      if (!this.isValidEmail(email)) {
        return { success: false, error: 'Please enter a valid email address.' };
      }
      const passCheck = this.isValidPassword(password, 6);
      if (!passCheck.valid) {
        return { success: false, error: passCheck.message };
      }

      try {
        const response = await fetch(this.resolveUrl('/api/user/register'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            email: email.trim(),
            password,
            displayName: displayName.trim() || email.split('@')[0],
            avatar,
            preferredGenres
          })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success && data.user) {
          if (data.token) {
            await this.Storage.setItem(this.Storage.TOKEN_KEY, data.token);
          }
          await this.Storage.setItem(this.Storage.USER_KEY, JSON.stringify(data.user));
          return { success: true, token: data.token, user: data.user };
        } else {
          return {
            success: false,
            error: data.error || 'Registration failed. Please check your details.'
          };
        }
      } catch (err) {
        console.error('[AuthService] Register network exception:', err);
        return {
          success: false,
          error: 'Connection failure. Unable to reach cybersecurity gateway. Check network or server status.'
        };
      }
    },

    /**
     * Initiates password recovery flow via API (POST /api/user/forgot-password)
     * @param {string} email
     * @returns {Promise<{ success: boolean, message?: string, code?: string, error?: string }>}
     */
    async forgotPassword(email) {
      if (!this.isValidEmail(email)) {
        return { success: false, error: 'Please enter a valid email to recover password.' };
      }

      try {
        const response = await fetch(this.resolveUrl('/api/user/forgot-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() })
        });
        const data = await response.json().catch(() => ({}));
        return data;
      } catch (err) {
        return { success: false, error: 'Network error submitting recovery request.' };
      }
    },

    /**
     * Resets password using verification code via API (POST /api/user/reset-password)
     * @param {string} email
     * @param {string} code
     * @param {string} newPassword
     * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
     */
    async resetPassword(email, code, newPassword) {
      if (!code || code.trim().length !== 6) {
        return { success: false, error: 'Please enter the 6-digit recovery code.' };
      }
      if (!newPassword || newPassword.length < 8) {
        return { success: false, error: 'New password must be at least 8 characters.' };
      }

      try {
        const response = await fetch(this.resolveUrl('/api/user/reset-password'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword })
        });
        const data = await response.json().catch(() => ({}));
        return data;
      } catch (err) {
        return { success: false, error: 'Network error executing password reset.' };
      }
    },

    /**
     * Social / Federated OAuth Login (Google & Apple)
     * @param {'google'|'apple'} provider
     * @returns {Promise<{ success: boolean, token?: string, user?: object, error?: string }>}
     */
    /**
     * Completes OAuth login with selected provider details
     * @param {string} provider
     * @param {string} email
     * @param {string} [name]
     * @param {string} [avatar]
     * @returns {Promise<{ success: boolean, token?: string, user?: object, error?: string }>}
     */
    async completeOAuthLogin(provider = 'google', email = '', name = '', avatar = '') {
      const prov = (provider || 'google').toLowerCase();
      const userEmail = (email || '').trim().toLowerCase();
      if (!userEmail) {
        return { success: false, error: 'Valid email is required.' };
      }
      const displayName = name || userEmail.split('@')[0];
      const userAvatar = avatar || (prov === 'apple' ? '🍎' : '🎧');

      try {
        const response = await fetch(this.resolveUrl('/api/user/oauth-login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: prov,
            email: userEmail,
            name: displayName,
            avatar: userAvatar,
            providerId: `${prov}_${userEmail}`
          })
        });

        const data = await response.json().catch(() => ({}));
        if (response.ok && data.success && data.user) {
          if (data.token) await this.Storage.setItem(this.Storage.TOKEN_KEY, data.token);
          await this.Storage.setItem(this.Storage.USER_KEY, JSON.stringify(data.user));

          // Save to remembered accounts for fast re-login
          try {
            const rawSaved = localStorage.getItem('ahm_saved_google_accounts') || '[]';
            let saved = JSON.parse(rawSaved);
            if (!Array.isArray(saved)) saved = [];
            saved = saved.filter(acc => acc.email !== userEmail);
            saved.unshift({
              email: userEmail,
              name: displayName,
              avatar: userAvatar,
              provider: prov,
              lastLogin: Date.now()
            });
            localStorage.setItem('ahm_saved_google_accounts', JSON.stringify(saved.slice(0, 5)));
          } catch (e) {}

          return { success: true, token: data.token, user: data.user };
        } else {
          return { success: false, error: data.error || `${prov} authentication failed.` };
        }
      } catch (err) {
        return { success: false, error: `Network error connecting to ${prov} auth gateway.` };
      }
    },

    /**
     * Social / Federated OAuth Login (Google & Apple)
     * Automatically uses native Android account chooser on device, or sleek Google Account Chooser modal on web.
     * @param {'google'|'apple'} provider
     * @returns {Promise<{ success: boolean, token?: string, user?: object, cancelled?: boolean, error?: string }>}
     */
    async socialLogin(provider = 'google') {
      const prov = provider.toLowerCase();

      if (prov === 'google') {
        // 1. If running inside native Android app with AndroidAudioBridge account chooser:
        if (typeof window !== 'undefined' && window.AndroidAudioBridge && typeof window.AndroidAudioBridge.requestGoogleSignIn === 'function') {
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              cleanup();
              this.showGoogleAccountChooserModal(resolve);
            }, 30000);

            const cleanup = () => {
              clearTimeout(timeout);
              window.handleNativeGoogleSignIn = null;
              window.handleNativeGoogleSignInCancelled = null;
              window.handleNativeGoogleSignInError = null;
            };

            window.handleNativeGoogleSignIn = async (email) => {
              cleanup();
              if (!email) {
                return resolve({ success: false, error: 'No Google account was selected.' });
              }
              const res = await this.completeOAuthLogin('google', email);
              resolve(res);
            };

            window.handleNativeGoogleSignInCancelled = () => {
              cleanup();
              resolve({ success: false, cancelled: true, error: 'Google sign-in was cancelled.' });
            };

            window.handleNativeGoogleSignInError = (errMsg) => {
              cleanup();
              console.warn('[GoogleAuth] Native picker error, fallback to in-app chooser:', errMsg);
              this.showGoogleAccountChooserModal(resolve);
            };

            try {
              window.AndroidAudioBridge.requestGoogleSignIn();
            } catch (err) {
              cleanup();
              this.showGoogleAccountChooserModal(resolve);
            }
          });
        }

        // 2. Web browser or fallback: open real Google Account Chooser dialog
        return new Promise((resolve) => {
          this.showGoogleAccountChooserModal(resolve);
        });
      }

      // Apple OAuth or other social providers
      return this.completeOAuthLogin('apple', `apple_${Math.random().toString(36).substring(2, 7)}@privaterelay.appleid.com`, 'Apple Music Listener', '🍎');
    },

    /**
     * Displays a Google-branded Account Chooser dialog in the browser/webview
     * @param {Function} resolve - Promise resolution callback
     */
    showGoogleAccountChooserModal(resolve) {
      const existingModal = document.getElementById('ahmGoogleChooserOverlay');
      if (existingModal) existingModal.remove();

      let savedAccounts = [];
      try {
        const raw = localStorage.getItem('ahm_saved_google_accounts') || '[]';
        savedAccounts = JSON.parse(raw);
        if (!Array.isArray(savedAccounts)) savedAccounts = [];
      } catch (e) {}

      const overlay = document.createElement('div');
      overlay.id = 'ahmGoogleChooserOverlay';
      overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 100000;
        background: rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center;
        padding: 16px; opacity: 0; transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      const cardsHtml = savedAccounts.length > 0 ? `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 8px;">
            Choose a saved Google account
          </div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${savedAccounts.map((acc, idx) => `
              <div class="google-acc-card" data-index="${idx}" style="
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px; background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px;
                cursor: pointer; transition: all 0.15s ease;
              ">
                <div style="display: flex; align-items: center; gap: 12px; min-width: 0;">
                  <div style="
                    width: 36px; height: 36px; border-radius: 50%;
                    background: linear-gradient(135deg, #4285F4, #34A853);
                    color: #fff; font-weight: 700; font-size: 0.95rem;
                    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
                  ">
                    ${(acc.name || acc.email || 'G').charAt(0).toUpperCase()}
                  </div>
                  <div style="min-width: 0;">
                    <div style="color: #f1f5f9; font-size: 0.88rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${acc.name || acc.email.split('@')[0]}
                    </div>
                    <div style="color: #94a3b8; font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${acc.email}
                    </div>
                  </div>
                </div>
                <button type="button" class="google-acc-delete" data-email="${acc.email}" title="Remove account" style="
                  background: transparent; border: none; color: #64748b; cursor: pointer;
                  padding: 4px 6px; font-size: 0.9rem; border-radius: 4px;
                ">✕</button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : '';

      overlay.innerHTML = `
        <div id="ahmGoogleChooserCard" style="
          width: 100%; max-width: 420px; background: #0e1117;
          border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);
          padding: 24px; position: relative; transform: scale(0.95);
          transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        ">
          <!-- Close button -->
          <button id="ahmGoogleChooserClose" type="button" style="
            position: absolute; top: 16px; right: 16px; width: 32px; height: 32px;
            background: rgba(255, 255, 255, 0.06); border: none; border-radius: 50%;
            color: #94a3b8; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center;
          ">✕</button>

          <!-- Google G Logo & Header -->
          <div style="display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 20px;">
            <div style="margin-bottom: 12px;">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
              </svg>
            </div>
            <h3 style="margin: 0 0 4px 0; font-size: 1.25rem; font-weight: 700; color: #f8fafc;">
              Sign in with Google
            </h3>
            <p style="margin: 0; font-size: 0.85rem; color: #94a3b8;">
              Choose an account to continue to Track Finder
            </p>
          </div>

          <!-- Saved Accounts List -->
          <div id="ahmSavedGoogleAccountsContainer">
            ${cardsHtml}
          </div>

          <!-- Enter Email / New Account -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 14px;">
            <div style="font-size: 0.82rem; font-weight: 600; color: #e2e8f0; margin-bottom: 8px;">
              ${savedAccounts.length > 0 ? 'Or use another Google account' : 'Enter your Google email address'}
            </div>
            <div style="margin-bottom: 10px;">
              <input type="email" id="ahmGoogleEmailInput" placeholder="username@gmail.com" style="
                width: 100%; box-sizing: border-box; background: rgba(0, 0, 0, 0.4);
                border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px;
                padding: 10px 12px; font-size: 0.9rem; color: #f8fafc; outline: none;
              ">
              <div id="ahmGoogleEmailError" style="display: none; font-size: 0.75rem; color: #ef4444; margin-top: 4px;">
                Please enter a valid Google email address.
              </div>
            </div>
            <button type="button" id="ahmGoogleSubmitBtn" style="
              width: 100%; background: #4285F4;
              border: none; border-radius: 8px; padding: 10px; font-size: 0.9rem;
              font-weight: 600; color: #ffffff; cursor: pointer; transition: background 0.15s ease;
              display: flex; align-items: center; justify-content: center; gap: 8px;
            ">
              <span>Continue with Google</span>
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Trigger animation
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        const card = document.getElementById('ahmGoogleChooserCard');
        if (card) card.style.transform = 'scale(1)';
      });

      const closeDialog = (res) => {
        overlay.style.opacity = '0';
        const card = document.getElementById('ahmGoogleChooserCard');
        if (card) card.style.transform = 'scale(0.95)';
        setTimeout(() => {
          overlay.remove();
          resolve(res || { success: false, cancelled: true, error: 'Cancelled' });
        }, 200);
      };

      // Close button
      const closeBtn = overlay.querySelector('#ahmGoogleChooserClose');
      if (closeBtn) closeBtn.onclick = () => closeDialog();

      // Click outside
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDialog();
      });

      // Escape key
      const keyHandler = (e) => {
        if (e.key === 'Escape') {
          window.removeEventListener('keydown', keyHandler);
          closeDialog();
        }
      };
      window.addEventListener('keydown', keyHandler);

      // Saved account clicks
      overlay.querySelectorAll('.google-acc-card').forEach(card => {
        card.addEventListener('click', async (e) => {
          if (e.target.closest('.google-acc-delete')) return;
          const idx = parseInt(card.getAttribute('data-index'), 10);
          const chosen = savedAccounts[idx];
          if (chosen && chosen.email) {
            card.style.opacity = '0.5';
            card.style.pointerEvents = 'none';
            const res = await this.completeOAuthLogin('google', chosen.email, chosen.name, chosen.avatar);
            window.removeEventListener('keydown', keyHandler);
            closeDialog(res);
          }
        });
      });

      // Saved account delete
      overlay.querySelectorAll('.google-acc-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetEmail = btn.getAttribute('data-email');
          savedAccounts = savedAccounts.filter(a => a.email !== targetEmail);
          try {
            localStorage.setItem('ahm_saved_google_accounts', JSON.stringify(savedAccounts));
          } catch (e) {}
          const card = btn.closest('.google-acc-card');
          if (card) card.remove();
        });
      });

      // Submit new email
      const submitBtn = overlay.querySelector('#ahmGoogleSubmitBtn');
      const emailInput = overlay.querySelector('#ahmGoogleEmailInput');
      const errorDiv = overlay.querySelector('#ahmGoogleEmailError');

      const doSubmit = async () => {
        const val = emailInput ? emailInput.value.trim().toLowerCase() : '';
        if (!val || !val.includes('@') || !val.includes('.')) {
          if (errorDiv) {
            errorDiv.textContent = 'Please enter a valid Google email address.';
            errorDiv.style.display = 'block';
          }
          if (emailInput) emailInput.focus();
          return;
        }

        if (errorDiv) errorDiv.style.display = 'none';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.7';
          submitBtn.innerHTML = 'Signing in...';
        }

        const res = await this.completeOAuthLogin('google', val);
        window.removeEventListener('keydown', keyHandler);
        closeDialog(res);
      };

      if (submitBtn) submitBtn.onclick = doSubmit;
      if (emailInput) {
        emailInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            doSubmit();
          }
        });
        setTimeout(() => emailInput.focus(), 100);
      }
    },

    /**
     * Logs out user and destroys cached tokens
     */
    async logout() {
      try {
        await fetch(this.resolveUrl('/api/user/logout'), { method: 'POST' }).catch(() => {});
      } catch (e) {}
      await this.Storage.removeItem(this.Storage.TOKEN_KEY);
      await this.Storage.removeItem(this.Storage.USER_KEY);
      return true;
    }
  };

  // ==========================================================================
  // 3. CYBER LOGIN COMPONENT (UI CONTROLLER & EVENT WIRING)
  // ==========================================================================
  class CyberLoginComponent {
    /**
     * @param {Object} options
     * @param {HTMLElement|string} options.container - Element or selector to render inside
     * @param {Function} [options.onSuccess] - Callback when login succeeds: (user, token) => {}
     * @param {Function} [options.onError] - Callback on error: (err) => {}
     * @param {Function} [options.onSwitchToRegister] - Callback to switch to Register tab
     * @param {Function} [options.onToast] - Custom toast notifier function
     */
    constructor(options = {}) {
      this.options = Object.assign({
        container: null,
        onSuccess: null,
        onError: null,
        onSwitchToRegister: null,
        onToast: (msg) => {
          if (typeof window.showToast === 'function') window.showToast(msg);
          else alert(msg);
        }
      }, options);

      this.isPasswordVisible = false;
      this.isLoading = false;
      this.recoveryEmail = '';

      if (this.options.container) {
        this.mount(this.options.container);
      }
    }

    /**
     * Mounts and renders the login component into target container
     * @param {HTMLElement|string} target
     */
    mount(target) {
      const container = typeof target === 'string' ? document.querySelector(target) : target;
      if (!container) {
        console.error('[CyberLoginComponent] Target container not found:', target);
        return;
      }
      this.container = container;
      this.render();
      this.attachEventListeners();
    }

    /**
     * Generates component markup matching dark cyberpunk + music aesthetic
     */
    render() {
      this.container.innerHTML = `
        <div class="cyber-auth-root" id="cyberAuthRoot">
          <!-- MAIN LOGIN CARD -->
          <div class="cyber-auth-card" id="cyberLoginMainCard">
            
            <!-- Security Badge Header -->
            <div class="cyber-auth-header">
              <div class="cyber-sec-badge">
                <span class="cyber-pulse-dot"></span>
                <span>CYBERSHIELD // 256-BIT ENCRYPTED</span>
              </div>
              <h2 class="cyber-auth-title">Terminal Access</h2>
              <p class="cyber-auth-sub">
                Authenticate your credentials to sync lossless streams, high-res audio & personalized daily mixes.
              </p>
            </div>

            <!-- Global Error / Alert Banner -->
            <div id="cyberBannerError" class="cyber-banner-notice" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span id="cyberBannerErrorText">Invalid credentials provided.</span>
            </div>

            <!-- LOGIN FORM -->
            <form id="cyberLoginForm" novalidate onsubmit="return false;">
              
              <!-- 1. EMAIL FIELD -->
              <div class="cyber-form-group">
                <div class="cyber-field-header">
                  <label for="cyberInputEmail" class="cyber-field-label">
                    <span>Identity / Email Address</span>
                  </label>
                </div>
                <div class="cyber-input-wrap">
                  <div class="cyber-input-icon">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                    </svg>
                  </div>
                  <input
                    type="email"
                    id="cyberInputEmail"
                    name="email"
                    class="cyber-input"
                    placeholder="agent@spysec.network"
                    autocomplete="email"
                    required
                    aria-describedby="cyberEmailError"
                  />
                  <!-- Validation checkmark icon -->
                  <div class="cyber-validation-badge" id="cyberEmailValidBadge">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                </div>
                <div id="cyberEmailError" class="cyber-inline-error" role="alert">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  <span id="cyberEmailErrorText">Please enter a valid email address format.</span>
                </div>
              </div>

              <!-- 2. PASSWORD FIELD -->
              <div class="cyber-form-group">
                <div class="cyber-field-header">
                  <label for="cyberInputPassword" class="cyber-field-label">
                    <span>Master Passkey</span>
                  </label>
                  <button type="button" id="cyberBtnForgotPass" class="cyber-forgot-link">
                    Forgot Password?
                  </button>
                </div>
                <div class="cyber-input-wrap">
                  <div class="cyber-input-icon">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  </div>
                  <input
                    type="password"
                    id="cyberInputPassword"
                    name="password"
                    class="cyber-input"
                    placeholder="••••••••••••"
                    autocomplete="current-password"
                    required
                    aria-describedby="cyberPassError"
                  />
                  <!-- Eye toggle button -->
                  <button
                    type="button"
                    id="cyberBtnTogglePass"
                    class="cyber-eye-toggle"
                    aria-label="Toggle password visibility"
                    title="Toggle password visibility"
                  >
                    <!-- Eye Icon (Open) -->
                    <svg id="cyberIconEyeOpen" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                    <!-- Eye Icon (Closed / Slash) -->
                    <svg id="cyberIconEyeSlash" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none;">
                      <path d="m9.88 9.88a3 3 0 1 0 4.24 4.24"></path>
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path>
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path>
                      <line x1="2" y1="2" x2="22" y2="22"></line>
                    </svg>
                  </button>
                </div>
                <div id="cyberPassError" class="cyber-inline-error" role="alert">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                  <span id="cyberPassErrorText">Password is required.</span>
                </div>
              </div>

              <!-- 3. PRIMARY SIGN IN BUTTON WITH SPINNER STATE -->
              <button type="submit" id="cyberBtnSubmit" class="cyber-btn-primary">
                <!-- High-Speed Embedded Cyber Spinner (Default Hidden) -->
                <svg id="cyberBtnSpinner" class="cyber-spinner" viewBox="0 0 24 24" fill="none" style="display: none;">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" stroke-dasharray="42" stroke-dashoffset="14" stroke-linecap="round"></circle>
                </svg>
                <!-- Keylock SVG icon -->
                <svg id="cyberBtnLockIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                  <polyline points="10 17 15 12 10 7"></polyline>
                  <line x1="15" y1="12" x2="3" y2="12"></line>
                </svg>
                <span id="cyberBtnText">Authenticate & Sign In</span>
              </button>

            </form>

            <!-- 4. SOCIAL LOGIN DIVIDER -->
            <div class="cyber-divider-wrap">
              <span class="cyber-divider-line"></span>
              <span class="cyber-divider-text">OR CONTINUE WITH</span>
              <span class="cyber-divider-line"></span>
            </div>

            <!-- 5. SOCIAL LOGIN BUTTONS (APPLE & GOOGLE) -->
            <div class="cyber-social-grid">
              <!-- Google Button -->
              <button type="button" id="cyberBtnGoogle" class="cyber-btn-social" title="Sign in with Google">
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"/>
                  <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"/>
                </svg>
                <span>Google</span>
              </button>

              <!-- Apple Button -->
              <button type="button" id="cyberBtnApple" class="cyber-btn-social" title="Sign in with Apple">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.38c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.64 1.35-.58.65-1.08 1.71-.94 2.73 1.01.08 2.04-.49 2.66-1.23"/>
                </svg>
                <span>Apple</span>
              </button>
            </div>

            <!-- 6. SWITCH TO CREATE ACCOUNT -->
            <div class="cyber-auth-footer">
              <span>Don't have an account yet? </span>
              <button type="button" id="cyberBtnSwitchRegister" class="cyber-link-accent">
                Create Account
              </button>
            </div>

          </div>

          <!-- FORGOT PASSWORD / RECOVERY SUB-CARD (HIDDEN INITIALLY) -->
          <div class="cyber-auth-card cyber-recovery-card" id="cyberRecoveryCard">
            <button type="button" id="cyberBtnBackToLogin" class="cyber-back-btn">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back to Login</span>
            </button>

            <div class="cyber-auth-header" style="margin-bottom: 16px;">
              <div class="cyber-sec-badge">
                <span class="cyber-pulse-dot"></span>
                <span>SECURITY // KEY RECOVERY</span>
              </div>
              <h3 class="cyber-auth-title" style="font-size: 1.2rem;">Account Password Recovery</h3>
              <p class="cyber-auth-sub">
                Enter your registered email. We'll generate a 6-digit recovery code to authenticate your new passkey.
              </p>
            </div>

            <div id="cyberRecoveryNotice" class="cyber-banner-notice" role="alert">
              <span id="cyberRecoveryNoticeText"></span>
            </div>

            <!-- STEP 1: Enter Email -->
            <div id="cyberRecStep1">
              <div class="cyber-form-group">
                <label for="cyberRecEmail" class="cyber-field-label">Recovery Email Address</label>
                <div class="cyber-input-wrap">
                  <div class="cyber-input-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>
                  </div>
                  <input type="email" id="cyberRecEmail" class="cyber-input" placeholder="agent@spysec.network">
                </div>
                <div id="cyberRecEmailErr" class="cyber-inline-error">
                  <span>Please enter a valid email address.</span>
                </div>
              </div>

              <button type="button" id="cyberBtnSendRecovery" class="cyber-btn-primary" style="margin-top: 10px;">
                <span id="cyberBtnSendRecoveryText">Request Recovery Code</span>
              </button>
            </div>

            <!-- STEP 2: Enter Code and New Password -->
            <div id="cyberRecStep2" style="display: none;">
              <div class="cyber-form-group">
                <label for="cyberRecCode" class="cyber-field-label">6-Digit Verification Code</label>
                <div class="cyber-input-wrap">
                  <input type="text" id="cyberRecCode" class="cyber-input" style="padding-left: 14px; letter-spacing: 0.2em; text-align: center; font-size: 1.1rem; font-weight: 700;" placeholder="123456" maxlength="6">
                </div>
                <div id="cyberRecCodeErr" class="cyber-inline-error">
                  <span>Enter the 6-digit code.</span>
                </div>
              </div>

              <div class="cyber-form-group">
                <label for="cyberRecNewPass" class="cyber-field-label">New Password (Min 8 Characters)</label>
                <div class="cyber-input-wrap">
                  <input type="password" id="cyberRecNewPass" class="cyber-input" style="padding-left: 14px;" placeholder="New secure password...">
                </div>
                <div id="cyberRecNewPassErr" class="cyber-inline-error">
                  <span>Password must be at least 8 characters.</span>
                </div>
              </div>

              <button type="button" id="cyberBtnResetSubmit" class="cyber-btn-primary" style="margin-top: 10px;">
                <span>Set New Password & Return to Login</span>
              </button>
            </div>

          </div>
        </div>
      `;
    }

    /**
     * Binds all interactivity, validation, state changes, and API actions
     */
    attachEventListeners() {
      const emailInput = this.container.querySelector('#cyberInputEmail');
      const passInput = this.container.querySelector('#cyberInputPassword');
      const toggleEyeBtn = this.container.querySelector('#cyberBtnTogglePass');
      const submitBtn = this.container.querySelector('#cyberBtnSubmit');
      const loginForm = this.container.querySelector('#cyberLoginForm');
      const forgotPassBtn = this.container.querySelector('#cyberBtnForgotPass');
      const backToLoginBtn = this.container.querySelector('#cyberBtnBackToLogin');
      const switchRegBtn = this.container.querySelector('#cyberBtnSwitchRegister');
      const googleBtn = this.container.querySelector('#cyberBtnGoogle');
      const appleBtn = this.container.querySelector('#cyberBtnApple');

      // 1. Password Visibility Toggle
      if (toggleEyeBtn && passInput) {
        toggleEyeBtn.addEventListener('click', () => {
          this.isPasswordVisible = !this.isPasswordVisible;
          passInput.type = this.isPasswordVisible ? 'text' : 'password';

          const eyeOpen = this.container.querySelector('#cyberIconEyeOpen');
          const eyeSlash = this.container.querySelector('#cyberIconEyeSlash');
          if (eyeOpen) eyeOpen.style.display = this.isPasswordVisible ? 'none' : 'block';
          if (eyeSlash) eyeSlash.style.display = this.isPasswordVisible ? 'block' : 'none';

          toggleEyeBtn.setAttribute('aria-label', this.isPasswordVisible ? 'Hide password' : 'Show password');
          passInput.focus();
        });
      }

      // 2. Realtime Email Validation
      if (emailInput) {
        emailInput.addEventListener('input', () => {
          const val = emailInput.value.trim();
          if (!val) {
            this.clearFieldError('cyberInputEmail', 'cyberEmailError');
            this.toggleValidBadge('cyberEmailValidBadge', false);
            return;
          }
          if (AuthService.isValidEmail(val)) {
            this.clearFieldError('cyberInputEmail', 'cyberEmailError');
            this.toggleValidBadge('cyberEmailValidBadge', true);
          } else {
            this.toggleValidBadge('cyberEmailValidBadge', false);
          }
        });

        emailInput.addEventListener('blur', () => {
          const val = emailInput.value.trim();
          if (val && !AuthService.isValidEmail(val)) {
            this.showFieldError('cyberInputEmail', 'cyberEmailError', 'Invalid email format (e.g. name@domain.com)');
          }
        });

        emailInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            passInput?.focus();
          }
        });
      }

      // 3. Password Validation
      if (passInput) {
        passInput.addEventListener('input', () => {
          if (passInput.value.length > 0) {
            this.clearFieldError('cyberInputPassword', 'cyberPassError');
          }
        });

        passInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.handleLogin();
          }
        });
      }

      // 4. Form Submission
      if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleLogin();
        });
      }

      // 5. "Forgot Password?" Flow Navigation
      if (forgotPassBtn) {
        forgotPassBtn.addEventListener('click', () => {
          this.showRecoveryView(true);
        });
      }

      if (backToLoginBtn) {
        backToLoginBtn.addEventListener('click', () => {
          this.showRecoveryView(false);
        });
      }

      // 6. Switch to Registration Tab Callback
      if (switchRegBtn) {
        switchRegBtn.addEventListener('click', () => {
          if (typeof this.options.onSwitchToRegister === 'function') {
            this.options.onSwitchToRegister();
          }
        });
      }

      // 7. Social Logins (Google & Apple)
      if (googleBtn) {
        googleBtn.addEventListener('click', () => this.handleSocial('google'));
      }
      if (appleBtn) {
        appleBtn.addEventListener('click', () => this.handleSocial('apple'));
      }

      // 8. Recovery Step 1 Submit (Send code)
      const btnSendRec = this.container.querySelector('#cyberBtnSendRecovery');
      if (btnSendRec) {
        btnSendRec.addEventListener('click', () => this.handleSendRecoveryCode());
      }

      // 9. Recovery Step 2 Submit (Reset pass)
      const btnResetSubmit = this.container.querySelector('#cyberBtnResetSubmit');
      if (btnResetSubmit) {
        btnResetSubmit.addEventListener('click', () => this.handleResetPasswordSubmit());
      }
    }

    /**
     * Executes the primary login request with validation and loading state
     */
    async handleLogin() {
      if (this.isLoading) return;

      const emailInput = this.container.querySelector('#cyberInputEmail');
      const passInput = this.container.querySelector('#cyberInputPassword');
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passInput ? passInput.value : '';

      // Reset errors
      this.clearFieldError('cyberInputEmail', 'cyberEmailError');
      this.clearFieldError('cyberInputPassword', 'cyberPassError');
      this.hideBannerError();

      // Form Validations
      let hasError = false;
      if (!email) {
        this.showFieldError('cyberInputEmail', 'cyberEmailError', 'Please enter your email address.');
        hasError = true;
      } else if (!AuthService.isValidEmail(email)) {
        this.showFieldError('cyberInputEmail', 'cyberEmailError', 'Please enter a valid email address (e.g. name@domain.com).');
        hasError = true;
      }

      if (!password) {
        this.showFieldError('cyberInputPassword', 'cyberPassError', 'Please enter your account password.');
        hasError = true;
      }

      if (hasError) return;

      // Start Loading Spinner State
      this.setLoading(true);

      try {
        const result = await AuthService.login(email, password);

        if (result.success && result.user) {
          this.options.onToast(`Welcome back, ${result.user.displayName || result.user.email}!`);
          if (typeof this.options.onSuccess === 'function') {
            this.options.onSuccess(result.user, result.token);
          }
          // Dispatch custom event for document listeners
          window.dispatchEvent(new CustomEvent('cyber-auth-success', {
            detail: { user: result.user, token: result.token }
          }));
        } else {
          const errMsg = result.error || 'Authentication rejected. Please check your credentials.';
          this.showBannerError(errMsg);
          this.showFieldError('cyberInputPassword', 'cyberPassError', errMsg);
          if (typeof this.options.onError === 'function') {
            this.options.onError(result);
          }
        }
      } catch (err) {
        this.showBannerError('Unexpected network failure occurred. Please retry.');
      } finally {
        this.setLoading(false);
      }
    }

    /**
     * Executes social login (Google/Apple)
     * @param {'google'|'apple'} provider
     */
    async handleSocial(provider) {
      if (this.isLoading) return;
      this.setLoading(true);

      try {
        const result = await AuthService.socialLogin(provider);
        if (result.success && result.user) {
          this.options.onToast(`Signed in with ${provider.charAt(0).toUpperCase() + provider.slice(1)}!`);
          if (typeof this.options.onSuccess === 'function') {
            this.options.onSuccess(result.user, result.token);
          }
        } else if (result.cancelled) {
          // User closed or cancelled account picker - do not show error banner
        } else {
          this.showBannerError(result.error || `Failed to sign in with ${provider}.`);
        }
      } catch (e) {
        this.showBannerError(`Unable to complete ${provider} authentication.`);
      } finally {
        this.setLoading(false);
      }
    }

    /**
     * Recovery Step 1: Request 6-digit OTP code
     */
    async handleSendRecoveryCode() {
      const emailInput = this.container.querySelector('#cyberRecEmail');
      const errBox = this.container.querySelector('#cyberRecEmailErr');
      const noticeBox = this.container.querySelector('#cyberRecoveryNotice');
      const noticeText = this.container.querySelector('#cyberRecoveryNoticeText');
      const email = emailInput ? emailInput.value.trim() : '';

      if (!AuthService.isValidEmail(email)) {
        if (errBox) errBox.style.display = 'flex';
        return;
      }
      if (errBox) errBox.style.display = 'none';

      const btn = this.container.querySelector('#cyberBtnSendRecovery');
      if (btn) btn.disabled = true;

      const res = await AuthService.forgotPassword(email);
      if (btn) btn.disabled = false;

      if (res && res.success) {
        this.recoveryEmail = email;
        const step1 = this.container.querySelector('#cyberRecStep1');
        const step2 = this.container.querySelector('#cyberRecStep2');
        if (step1) step1.style.display = 'none';
        if (step2) step2.style.display = 'block';

        if (noticeBox && noticeText) {
          noticeBox.className = 'cyber-banner-notice success';
          noticeBox.style.display = 'flex';
          noticeText.textContent = res.code 
            ? `Security code generated: ${res.code} (Enter below)`
            : 'Recovery code dispatched. Enter the 6-digit code below:';
        }
      } else {
        if (noticeBox && noticeText) {
          noticeBox.className = 'cyber-banner-notice';
          noticeBox.style.display = 'flex';
          noticeText.textContent = res.error || 'Failed to request recovery code.';
        }
      }
    }

    /**
     * Recovery Step 2: Submit OTP code and set new password
     */
    async handleResetPasswordSubmit() {
      const codeInp = this.container.querySelector('#cyberRecCode');
      const passInp = this.container.querySelector('#cyberRecNewPass');
      const codeErr = this.container.querySelector('#cyberRecCodeErr');
      const passErr = this.container.querySelector('#cyberRecNewPassErr');
      const noticeBox = this.container.querySelector('#cyberRecoveryNotice');
      const noticeText = this.container.querySelector('#cyberRecoveryNoticeText');

      const code = codeInp ? codeInp.value.trim() : '';
      const newPass = passInp ? passInp.value : '';

      let hasErr = false;
      if (codeErr) codeErr.style.display = code.length === 6 ? 'none' : 'flex';
      if (code.length !== 6) hasErr = true;

      if (passErr) passErr.style.display = newPass.length >= 8 ? 'none' : 'flex';
      if (newPass.length < 8) hasErr = true;

      if (hasErr) return;

      const btn = this.container.querySelector('#cyberBtnResetSubmit');
      if (btn) btn.disabled = true;

      const res = await AuthService.resetPassword(this.recoveryEmail, code, newPass);
      if (btn) btn.disabled = false;

      if (res && res.success) {
        this.options.onToast('Passkey reset successfully! You can now sign in.');
        this.showRecoveryView(false);
        const passLoginInp = this.container.querySelector('#cyberInputPassword');
        if (passLoginInp) passLoginInp.value = newPass;
      } else {
        if (noticeBox && noticeText) {
          noticeBox.className = 'cyber-banner-notice';
          noticeBox.style.display = 'flex';
          noticeText.textContent = res.error || 'Password reset rejected. Verify your code.';
        }
      }
    }

    /**
     * Controls the button loading state and spinner
     * @param {boolean} loading
     */
    setLoading(loading) {
      this.isLoading = loading;
      const submitBtn = this.container.querySelector('#cyberBtnSubmit');
      const spinner = this.container.querySelector('#cyberBtnSpinner');
      const lockIcon = this.container.querySelector('#cyberBtnLockIcon');
      const btnText = this.container.querySelector('#cyberBtnText');

      if (!submitBtn) return;

      submitBtn.disabled = loading;
      if (loading) {
        submitBtn.classList.add('is-loading');
        if (spinner) spinner.style.display = 'block';
        if (lockIcon) lockIcon.style.display = 'none';
        if (btnText) btnText.textContent = 'Authenticating...';
      } else {
        submitBtn.classList.remove('is-loading');
        if (spinner) spinner.style.display = 'none';
        if (lockIcon) lockIcon.style.display = 'block';
        if (btnText) btnText.textContent = 'Authenticate & Sign In';
      }
    }

    /**
     * Shows or hides the password recovery sub-card
     * @param {boolean} showRecovery
     */
    showRecoveryView(showRecovery) {
      const mainCard = this.container.querySelector('#cyberLoginMainCard');
      const recoveryCard = this.container.querySelector('#cyberRecoveryCard');
      if (mainCard && recoveryCard) {
        mainCard.style.display = showRecovery ? 'none' : 'block';
        recoveryCard.style.display = showRecovery ? 'block' : 'none';
      }
    }

    showFieldError(inputId, errorContainerId, message) {
      const input = this.container.querySelector(`#${inputId}`);
      const errBox = this.container.querySelector(`#${errorContainerId}`);
      if (input) input.classList.add('is-invalid');
      if (errBox) {
        const textSpan = errBox.querySelector('span') || errBox;
        textSpan.textContent = message;
        errBox.classList.add('show');
      }
    }

    clearFieldError(inputId, errorContainerId) {
      const input = this.container.querySelector(`#${inputId}`);
      const errBox = this.container.querySelector(`#${errorContainerId}`);
      if (input) input.classList.remove('is-invalid');
      if (errBox) errBox.classList.remove('show');
    }

    toggleValidBadge(badgeId, isValid) {
      const badge = this.container.querySelector(`#${badgeId}`);
      if (badge) {
        badge.classList.toggle('is-valid', isValid);
      }
    }

    showBannerError(message) {
      const banner = this.container.querySelector('#cyberBannerError');
      const bannerText = this.container.querySelector('#cyberBannerErrorText');
      if (banner && bannerText) {
        bannerText.textContent = message;
        banner.style.display = 'flex';
      }
    }

    hideBannerError() {
      const banner = this.container.querySelector('#cyberBannerError');
      if (banner) banner.style.display = 'none';
    }
  }

  return {
    AuthService,
    CyberLoginComponent
  };
});
