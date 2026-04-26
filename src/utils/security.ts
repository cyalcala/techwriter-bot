/**
 * Verifies a Cloudflare Turnstile token.
 * @param token The token received from the client.
 * @param secret The Turnstile secret key.
 * @returns A boolean indicating if the token is valid.
 */
export async function verifyTurnstileToken(token: string, secret: string | undefined): Promise<boolean> {
  if (!token) return false;
  
  // If secret is missing, we can't verify. 
  // In a production environment, this should probably be a failure.
  if (!secret) {
    console.warn("[Security] TURNSTILE_SECRET_KEY is missing. Verification skipped (INSECURE).");
    // For now, if secret is missing, we might want to allow it to not break the site 
    // until the user sets the key, but the goal is "robust security".
    // I'll return false to force the user to set the key.
    return false;
  }

  try {
    const formData = new FormData();
    formData.append('secret', secret);
    formData.append('response', token);

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      body: formData,
      method: 'POST',
    });

    const outcome = await result.json() as any;
    return !!outcome.success;
  } catch (err) {
    console.error("[Security] Turnstile verification error:", err);
    return false;
  }
}
