// Show/hide toggles (sections, publication groups, abstracts). A toggle is a
// <button aria-expanded aria-controls="<id>"> and the element it controls uses
// the `hidden` attribute. Opening and closing slide with the Web Animations API.
//
// Only the part of the element that is on screen is animated: a list of a
// hundred publications opens and closes as smoothly as a short one, and the
// part below the fold appears (or goes) at once, where nobody sees it.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const animations = new WeakMap();

const OPEN = 'cubic-bezier(0.2, 0, 0, 1)'; // decelerate: fast start, gentle stop
const CLOSE = 'cubic-bezier(0.3, 0, 0.8, 0.15)'; // accelerate: gentle start, fast end

function finish(body, opening) {
  animations.delete(body);
  body.style.overflow = '';
  body.style.height = '';
  body.hidden = !opening;
}

export function setExpanded(toggle, opening, { animate = true } = {}) {
  const body = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!body) return;
  toggle.setAttribute('aria-expanded', String(opening));

  // The current height, read before cancelling a running animation, so a click
  // mid-way reverses from where it is instead of jumping.
  const from = body.hidden ? 0 : body.getBoundingClientRect().height;
  animations.get(body)?.cancel();

  body.hidden = false;
  const full = body.scrollHeight;
  // Room between the top of the element and the bottom of the window.
  const room = Math.max(0, innerHeight - body.getBoundingClientRect().top);
  const start = Math.min(from, room);
  const end = opening ? Math.min(full, room) : 0;

  if (!animate || reduceMotion.matches || Math.abs(end - start) < 2) {
    finish(body, opening);
    return;
  }

  // At most about a screen of travel, so the duration stays short and even.
  const distance = Math.abs(end - start);
  const duration = Math.round((opening ? 200 : 160) + Math.min(1, distance / innerHeight) * (opening ? 150 : 110));
  // Page height without this element, to follow the scroll when closing.
  const rest = document.documentElement.scrollHeight - full;
  body.style.overflow = 'hidden';
  const animation = body.animate(
    {
      height: [`${start}px`, `${end}px`],
      opacity: opening ? [start ? 1 : 0, 1] : [1, 0],
    },
    { duration, easing: opening ? OPEN : CLOSE },
  );
  animations.set(body, animation);
  animation.onfinish = () => finish(body, opening);
  if (!opening) followScroll(body, animation, start, Math.max(0, rest - innerHeight));
}

// Closing something near the end of the page (e.g. the last section of a
// profile) leaves too little page to stay scrolled where we are, and the
// browser would jump up once it is gone. Instead, scroll up along with it, in
// step with the closing, so what is above glides down into place.
function followScroll(body, animation, start, endY) {
  const startY = scrollY;
  if (startY <= endY || start <= 0) return;
  const step = () => {
    if (animations.get(body) !== animation) return;
    const progress = 1 - body.getBoundingClientRect().height / start;
    scrollTo(scrollX, startY - (startY - endY) * progress);
    if (animation.playState === 'running') requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function setupToggles(selector) {
  for (const toggle of document.querySelectorAll(selector)) {
    toggle.addEventListener('click', () => setExpanded(toggle, toggle.getAttribute('aria-expanded') !== 'true'));
  }
}
