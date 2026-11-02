// Show/hide toggles (sections, publication groups, abstracts). A toggle is a
// <button aria-expanded aria-controls="<id>"> and the element it controls uses
// the `hidden` attribute. Opening and closing slide with the Web Animations API.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const animations = new WeakMap();

export function setExpanded(toggle, opening, { animate = true } = {}) {
  const body = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!body) return;
  toggle.setAttribute('aria-expanded', String(opening));
  animations.get(body)?.cancel();
  if (!animate || reduceMotion.matches) {
    body.hidden = !opening;
    return;
  }
  // Start from the current height so a click mid-animation reverses smoothly.
  const from = body.hidden ? '0px' : `${body.getBoundingClientRect().height}px`;
  body.hidden = false;
  const to = opening ? `${body.scrollHeight}px` : '0px';
  // Long sections take a little longer, up to a limit.
  const duration = Math.min(450, 220 + Math.abs(parseFloat(to) - parseFloat(from)) / 40);
  body.style.overflow = 'hidden';
  const animation = body.animate(
    { height: [from, to], opacity: opening ? [0, 1] : [1, 0] },
    { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
  );
  animations.set(body, animation);
  animation.onfinish = () => {
    animations.delete(body);
    body.style.overflow = '';
    body.hidden = !opening;
  };
}

export function setupToggles(selector) {
  for (const toggle of document.querySelectorAll(selector)) {
    toggle.addEventListener('click', () => setExpanded(toggle, toggle.getAttribute('aria-expanded') !== 'true'));
  }
}
