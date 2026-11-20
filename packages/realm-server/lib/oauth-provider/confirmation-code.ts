// The confirmation code a pre-registered app on the user's computer sends
// with each flow. The app shows it where the user started signing in (the
// CLI prints it in the terminal), and consent shows it again, so the user can
// check the two match before allowing.
//
// It guards against one attack: someone starts a flow as the app, sends the
// user the link, and talks them into allowing it and pasting back the
// loopback address their browser lands on, code included. A user who never
// started signing in has no code to compare against. Whoever starts the flow
// picks the code, so it is no secret and proves nothing on its own: it only
// gives the user something concrete to check.
//
// The format is RFC 8628's suggested user code: eight letters from an
// alphabet of consonants, which spells no words and has no look-alikes, in
// two groups of four.

export const CONFIRMATION_CODE_PARAM = 'boxel_confirmation_code';

export const CONFIRMATION_CODE =
  /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
