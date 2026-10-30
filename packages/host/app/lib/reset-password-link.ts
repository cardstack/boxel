export type ResetPasswordParams = {
  sid: string;
  clientSecret: string;
  // The email address the reset link was sent to, which names the account
  // whose secure sessions end once the new password is set. A link that
  // carries none still resets the password.
  email?: string;
};

// The reset parameters a page landed with from a reset email, if any, from its
// query parameters and its URL fragment. The email address is in the link's
// fragment, and the Matrix server appends the validation session's id to the
// end of the link, so the id lands in the fragment too (a link without a
// fragment has it in the query string). `inFragment` says whether the
// fragment carried any, so the caller can take it out of the address bar and
// the history once read.
export function resetPasswordParamsFrom(
  query: Record<string, unknown>,
  hash: string,
): { params: ResetPasswordParams | undefined; inFragment: boolean } {
  let fragment = new URLSearchParams(hash.replace(/^#/, ''));
  let text = (value: unknown) =>
    typeof value === 'string' && value ? value : undefined;
  let sid = text(query.sid) ?? text(fragment.get('sid'));
  let clientSecret = text(query.clientSecret);
  return {
    params:
      sid && clientSecret
        ? { sid, clientSecret, email: text(fragment.get('email')) }
        : undefined,
    inFragment: fragment.has('sid') || fragment.has('email'),
  };
}
