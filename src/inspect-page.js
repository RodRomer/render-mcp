/**
 * The body of inspect_element that runs *inside the page*.
 *
 * It lives in its own file for the same reason protocol.js does: so it can be
 * tested. Puppeteer serialises this function and evaluates it in the browser, so
 * it must close over nothing — every value it uses is either a parameter or a
 * DOM global. That constraint is what makes it testable: any real DOM can run it,
 * including a headless browser loading a fixture page, with no Cloudflare and no
 * Worker involved.
 *
 * Returns plain JSON-serialisable data. All prose lives in index.js, so this
 * stays a pure observation of the page.
 */
export function inspectInPage(sel, limit) {
  // An invalid selector throws inside querySelectorAll; report it rather than
  // letting it surface as an opaque browser error.
  let nodes;
  try {
    nodes = Array.from(document.querySelectorAll(sel));
  } catch {
    return { badSelector: true };
  }

  const describe = (el) => {
    if (!el || !el.tagName) return "unknown";
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
    if (cls.length) s += `.${cls.slice(0, 3).join(".")}`;
    return s;
  };

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const report = nodes.slice(0, limit).map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    // The element's own computed display is not the whole story: an ancestor with
    // display:none hides it while the element itself still computes as "block".
    // Finding *which* ancestor is usually the actual answer to "why can't I see
    // this?", and it is the one thing reading the CSS cannot tell you, because it
    // depends on which rules won for every element on the path to the root.
    let hiddenBy = null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.display === "none") { hiddenBy = { el: describe(p), why: "display:none" }; break; }
      if (pcs.visibility === "hidden" && cs.visibility === "hidden") {
        hiddenBy = { el: describe(p), why: "visibility:hidden" }; break;
      }
      if (Number(pcs.opacity) === 0) { hiddenBy = { el: describe(p), why: "opacity:0" }; break; }
    }

    // Ground truth for "is the browser painting this at all". A closed <details>
    // hides its contents with content-visibility, not display:none, and the
    // descendant keeps a non-zero box — so neither the computed style nor the
    // rectangle reveals it. checkVisibility is the only thing that does.
    // checkOpacity stays off because opacity gets its own, more specific message.
    const paints = typeof el.checkVisibility === "function"
      ? el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true, contentVisibilityAuto: true })
      : cs.display !== "none" && cs.visibility !== "hidden";

    // Having established it is not painting, find the container responsible.
    let unrenderedBy = null;
    if (!hiddenBy && !paints && cs.display !== "none" && cs.visibility !== "hidden") {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (p.tagName === "DETAILS" && !p.open) { unrenderedBy = { el: describe(p), why: "a closed <details>" }; break; }
        if (p.hasAttribute && p.hasAttribute("hidden")) { unrenderedBy = { el: describe(p), why: "the hidden attribute" }; break; }
        const pcs = getComputedStyle(p);
        if (pcs.contentVisibility && pcs.contentVisibility !== "visible") {
          unrenderedBy = { el: describe(p), why: `content-visibility:${pcs.contentVisibility}` }; break;
        }
      }
    }

    const inViewport = r.width > 0 && r.height > 0 &&
      r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;

    // elementFromPoint only answers inside the viewport, and only about the
    // element's centre — enough for "is something on top of it?".
    let coveredBy = null;
    if (inViewport) {
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        coveredBy = describe(hit);
      }
    }

    let offscreen = null;
    if (r.width > 0 && r.height > 0 && !inViewport) {
      const dirs = [];
      if (r.bottom <= 0) dirs.push(`${Math.round(-r.bottom)}px above the viewport`);
      if (r.top >= vh) dirs.push(`${Math.round(r.top - vh)}px below the viewport`);
      if (r.right <= 0) dirs.push(`${Math.round(-r.right)}px left of the viewport`);
      if (r.left >= vw) dirs.push(`${Math.round(r.left - vw)}px right of the viewport`);
      offscreen = dirs.join(" and ");
    }

    return {
      tag: describe(el),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      position: cs.position,
      zIndex: cs.zIndex,
      overflow: cs.overflow,
      color: cs.color,
      background: cs.backgroundColor,
      font: `${cs.fontSize} / ${cs.lineHeight} ${cs.fontFamily}`.slice(0, 120),
      margin: cs.margin,
      padding: cs.padding,
      border: cs.border,
      transform: cs.transform === "none" ? null : cs.transform,
      hiddenBy,
      unrenderedBy,
      coveredBy,
      offscreen,
      inViewport,
      paints
    };
  });

  return { total: nodes.length, viewport: { w: vw, h: vh }, report };
}

/**
 * Turn one element's observations into the single sentence that answers the
 * question actually being asked. Pure, so it is tested directly.
 */
export function verdictFor(e) {
  if (e.display === "none") return "NOT RENDERED — this element has display:none.";
  if (e.hiddenBy) {
    return `HIDDEN BY AN ANCESTOR — ${e.hiddenBy.el} has ${e.hiddenBy.why}. The element itself is fine.`;
  }
  if (e.visibility === "hidden") return "INVISIBLE — visibility:hidden. It still occupies its space.";
  if (Number(e.opacity) === 0) return "INVISIBLE — opacity:0. It still occupies its space and stays clickable.";
  if (e.unrenderedBy) {
    return `NOT RENDERED — it sits inside ${e.unrenderedBy.el}, which is not displaying its contents ` +
      `because of ${e.unrenderedBy.why}.`;
  }
  // Painting can be suppressed in ways no single property reveals. Say so plainly
  // rather than reporting the box measurements as though they meant it was fine.
  if (e.paints === false) {
    return "NOT RENDERED — the browser reports this element as not visible, though no single property " +
      "on it explains why. Check its ancestors for content-visibility or a hidden popover or dialog.";
  }
  if (e.box.w === 0 || e.box.h === 0) return `ZERO SIZE — the box is ${e.box.w}x${e.box.h}, so nothing can paint.`;
  if (e.offscreen) return `OFF-SCREEN — ${e.offscreen}. It renders, but not where you are looking.`;
  if (e.coveredBy) {
    return `COVERED — ${e.coveredBy} sits on top of its centre point. It paints, but clicks land on that instead.`;
  }
  return "VISIBLE — rendered inside the viewport and not covered.";
}
