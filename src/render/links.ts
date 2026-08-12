// Which link targets a renderer refuses, and what it shows instead. Shared,
// because a rule that lives inside one renderer is a rule the other one
// silently breaks: the same document must not be safe as a PDF and live as
// Markdown.

/**
 * Schemes a link may not carry.
 *
 * A link is not the same thing as an image source: nothing here is *loaded*
 * when the page renders, so `http:`, `https:`, `mailto:` and relative paths all
 * stay live — they are things a reader may choose to follow, and refusing them
 * would cost the reader information for no gain. What cannot stay live is a URL
 * that executes (`javascript:`, `vbscript:`) or that carries its own payload
 * (`data:`, the shape phishing takes in a PDF). The source document is
 * untrusted input; a rendered document is a thing people click.
 *
 * Matched after stripping whitespace and control characters, because
 * `java\tscript:` and a leading newline are both accepted by browsers as the
 * scheme they spell.
 */
const EXECUTABLE_SCHEME = /^(?:javascript|vbscript|data):/i;

/** Every character a browser skips over while reading a URL scheme. */
function stripControls(s: string): string {
  return [...s].filter((ch) => ch.charCodeAt(0) > 0x20 && ch.charCodeAt(0) !== 0x7f).join('');
}

export function schemeIsRefused(href: string): boolean {
  // Whitespace and C0 controls are ignored by browsers when they read a
  // scheme, so they are removed before the test rather than after it.
  return EXECUTABLE_SCHEME.test(stripControls(href));
}

/**
 * Where a refused link pointed, said in as few characters as a reader needs.
 * Nothing is silently lost: the link's own text still prints, and this follows
 * it, so the reader can see there was a link, see what it aimed at, and decide
 * for themselves.
 *
 * A `javascript:` or `data:` URL has no host, so the scheme is named instead —
 * "javascript:" is more informative to a reader than an empty box. Read from
 * the stripped href for the same reason the test above is: `java\tscript:` is
 * the `javascript:` scheme wearing a disguise, and naming it as one tells the
 * reader more than echoing the disguise back at them.
 */
export function refusedLinkTarget(href: string): string {
  const clean = stripControls(href);
  try {
    const u = new URL(clean);
    return u.host || u.protocol;
  } catch {
    return clean.split(':')[0] ?? '';
  }
}
