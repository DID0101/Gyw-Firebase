/**

 * reCAPTCHA bridge — visible checkbox WebView on native (reliable on physical Android).

 */

let visibleFallback: (() => Promise<string>) | null = null;

let invisibleFallback: (() => Promise<string>) | null = null;



export function registerVisibleRecaptchaFallback(fn: () => Promise<string>): void {

  visibleFallback = fn;

}



export function unregisterVisibleRecaptchaFallback(): void {

  visibleFallback = null;

}



export function isVisibleRecaptchaAvailable(): boolean {

  return visibleFallback != null;

}



/** Primary native path — user taps the checkbox in PhoneAuthRecaptchaModal. */

export function requestVisibleRecaptchaToken(): Promise<string> {

  if (!visibleFallback) {

    return Promise.reject(

      new Error('Security verification not ready — restart the app and wait a few seconds'),

    );

  }

  return visibleFallback();

}



export function registerInvisibleRecaptchaFallback(fn: () => Promise<string>): void {

  invisibleFallback = fn;

}



export function unregisterInvisibleRecaptchaFallback(): void {

  invisibleFallback = null;

}



export function isInvisibleRecaptchaAvailable(): boolean {

  return invisibleFallback != null;

}



/** Falls back to visible only when no invisible handler is registered. */
export function requestInvisibleRecaptchaToken(): Promise<string> {
  if (invisibleFallback) return invisibleFallback();
  if (visibleFallback) return visibleFallback();
  return Promise.reject(
    new Error('Security verification not ready — restart the app and wait a few seconds'),
  );
}


