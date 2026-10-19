// One cached local sprite supplies every icon. Keep the host element so IDs,
// tooltips, category-check classes and references held by the UI remain valid.
const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLES = new Set(['icon-solid', 'icon-regular', 'icon-brands']);
const sprite = new URL('../assets/icons/sprite.svg?v=1.31', import.meta.url).href;

function updateIcon(host) {
  if (!(host instanceof Element) || host.tagName !== 'I') return;
  const token = [...host.classList].find(name => name.startsWith('icon-') && !STYLES.has(name));
  if (!token) return;
  const name = token === 'icon-star' && host.classList.contains('icon-regular')
    ? 'star-outline' : token.slice(5);
  const href = `${sprite}#${name}`;
  let svg = host.firstElementChild;
  if (svg?.localName === 'svg' && svg.firstElementChild?.getAttribute('href') === href) return;
  svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  use.setAttribute('width', '100%');
  use.setAttribute('height', '100%');
  svg.append(use);
  host.replaceChildren(svg);
}

function hydrate(root) {
  updateIcon(root);
  root.querySelectorAll?.('i[class*="icon-"]').forEach(updateIcon);
}

export function initializeIcons() {
  hydrate(document);
  const observer = new MutationObserver(changes => {
    for (const change of changes) {
      if (change.type === 'attributes') updateIcon(change.target);
      else for (const node of change.addedNodes) hydrate(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}
