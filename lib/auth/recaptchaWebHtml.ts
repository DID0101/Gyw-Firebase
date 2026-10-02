/**
 * WebView reCAPTCHA for server phone OTP fallback.
 * Uses Google reCAPTCHA v2 directly (site key from Identity Toolkit) — Firebase JS SDK
 * RecaptchaVerifier returns auth/invalid-api-key inside React Native WebView.
 */

export const RECAPTCHA_BASE_URL = 'https://gyw1-146d7.firebaseapp.com/';

/** From identitytoolkit getRecaptchaParam for gyw1-146d7. Override: EXPO_PUBLIC_FIREBASE_RECAPTCHA_SITE_KEY */
export const FIREBASE_RECAPTCHA_SITE_KEY =
  process.env.EXPO_PUBLIC_FIREBASE_RECAPTCHA_SITE_KEY ??
  '6LcMZR0UAAAAALgPMcgHwga7gY5p8QMg1Hj-bmUv';

function recaptchaShell(body: string): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
</head>
<body style="margin:0;padding:8px;background:#fff;">
<div id="recaptcha-container"></div>
<script>
  var SITE_KEY = ${JSON.stringify(FIREBASE_RECAPTCHA_SITE_KEY)};
  function post(obj) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    }
  }
  ${body}
</script>
<script src="https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit" async defer></script>
</body></html>`;
}

/** Visible checkbox — primary Android path (user taps checkbox). */
export function buildVisibleRecaptchaHtml(): string {
  return recaptchaShell(`
    window.onRecaptchaLoad = function() {
      try {
        grecaptcha.render('recaptcha-container', {
          sitekey: SITE_KEY,
          size: 'normal',
          callback: function(token) {
            post({ ok: true, token: token });
          },
          'expired-callback': function() {
            post({ ok: false, error: 'recaptcha_expired' });
          }
        });
        post({ ok: true, ready: true });
      } catch (e) {
        post({ ok: false, error: 'render_failed:' + String(e.message || e) });
      }
    };
  `);
}

/** Invisible widget — optional background preloader. */
export function buildInvisibleRecaptchaHtml(): string {
  return recaptchaShell(`
    var widgetId = null;
    window.onRecaptchaLoad = function() {
      try {
        widgetId = grecaptcha.render('recaptcha-container', {
          sitekey: SITE_KEY,
          size: 'invisible',
          callback: function(token) {
            post({ ok: true, token: token });
          },
          'expired-callback': function() {
            post({ ok: false, error: 'recaptcha_expired' });
          }
        });
        post({ ok: true, ready: true });
      } catch (e) {
        post({ ok: false, error: 'render_failed:' + String(e.message || e) });
      }
    };
    window.runVerify = function() {
      if (widgetId == null) {
        post({ ok: false, error: 'verifier_not_ready' });
        return;
      }
      try {
        grecaptcha.execute(widgetId);
      } catch (e) {
        post({ ok: false, error: String(e.message || e) });
      }
    };
  `);
}
