// Canvas descriptions are teacher-authored HTML. They are rebuilt from an allowlist into fresh
// elements, so no script, style, handler or embedded frame can reach a page that talks to the host.
// Canvas images need the browser session's cookies, so they would only ever render broken: dropped.

const KEEP = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'A', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR', 'SUB', 'SUP', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
// Layout containers become plain blocks: many descriptions put each paragraph in a div, and
// unwrapping those ran the paragraphs together.
const BLOCKS = new Set(['DIV', 'SECTION', 'ARTICLE', 'CENTER', 'MAIN', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION']);
const UNWRAP = new Set(['SPAN', 'FONT', 'LABEL', 'SMALL', 'BIG', 'MARK', 'ABBR', 'CITE', 'DEL', 'INS', 'S']);
const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
// Blocks that are only a spacer (&nbsp;) in the editor's markup would read as holes here.
const SPACERS = new Set(['P', 'DIV', 'H4']);

function copy(source: Node, target: Node, doc: Document): void {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(doc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName;
    if (KEEP.has(tag) || BLOCKS.has(tag)) {
      const clean = doc.createElement(HEADINGS.has(tag) ? 'h4' : BLOCKS.has(tag) ? 'div' : tag.toLowerCase());
      // Web pages and email addresses stay links; anything else reads as plain text.
      if (tag === 'A') {
        const href = el.getAttribute('href') ?? '';
        if (/^(https:\/\/|mailto:)/i.test(href)) clean.setAttribute('href', href);
      }
      copy(el, clean, doc);
      if (SPACERS.has(clean.tagName) && !clean.textContent?.trim() && !clean.querySelector('hr, table')) continue;
      target.appendChild(clean);
    } else if (UNWRAP.has(tag)) {
      copy(el, target, doc);
    }
  }
}

export function sanitize(html: string): DocumentFragment {
  const source = new DOMParser().parseFromString(html, 'text/html');
  const fragment = document.createDocumentFragment();
  copy(source.body, fragment, document);
  return fragment;
}

/** True when the description has any readable text once cleaned. */
export function hasText(html: string | null): boolean {
  if (!html) return false;
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').trim().length > 0;
}
