/*
  The on-screen annotation layer, injected into every page the recorder opens.

  Injected rather than post-processed on purpose: the arrow and the spotlight are
  positioned against the real element's box in the live DOM, so they stay correct
  when the layout moves and cannot drift out of sync with the UI the way an
  ffmpeg `drawbox` at hand-measured coordinates does.

  Written as a string factory (not a module the page imports) because it runs in
  the browser via `context.addInitScript({ content })` — it is page script, not
  Node script, and has to survive being re-injected on every full navigation.

  API exposed on `window.__tt`:
    show({ selector | box, text, badge, arrow, spotlight, pad, arrowLen })
    hide()
    ripple(x, y)      -- the click ping, at viewport coordinates

  `box` ({x,y,w,h} in viewport coordinates) is accepted alongside `selector` so
  the recorder can annotate a Playwright Locator — `getByRole`, `getByText` —
  which resolves to an element the page's own `querySelector` cannot reach.
*/
export function overlaySource() {
  return `(() => {
  if (window.__tt) return;
  var NS = "http://www.w3.org/2000/svg";
  var root, svg, cap, badge;
  var last = null;

  function build() {
    root = document.createElement("div");
    root.id = "__tt_root";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    var st = document.createElement("style");
    st.textContent = [
      "@keyframes tt-fade{from{opacity:0}to{opacity:1}}",
      "@keyframes tt-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}",
      "@keyframes tt-ripple{from{transform:scale(.15);opacity:.9}to{transform:scale(1);opacity:0}}",
      "#__tt_svg{position:absolute;inset:0;width:100%;height:100%}",
      "#__tt_cap{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);max-width:min(1180px,84vw);background:rgba(8,15,30,.95);color:#F8FAFC;padding:15px 24px;border-radius:14px;font-size:20px;line-height:1.4;font-weight:500;box-shadow:0 14px 40px rgba(0,0,0,.45);border:1px solid rgba(245,158,11,.6);opacity:0;animation:tt-fade .2s ease forwards}",
      "#__tt_badge{position:absolute;right:24px;top:20px;background:rgba(8,15,30,.94);color:#E2E8F0;border:1px solid #334155;border-radius:999px;padding:8px 15px;font-size:13.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;opacity:0;animation:tt-fade .2s ease forwards}",
      "#__tt_rip{position:absolute;width:70px;height:70px;margin:-35px 0 0 -35px;border-radius:50%;border:3px solid rgba(245,158,11,.95);animation:tt-ripple .55s ease-out forwards}"
    ].join("");
    root.appendChild(st);
    svg = document.createElementNS(NS, "svg");
    svg.id = "__tt_svg";
    root.appendChild(svg);
    badge = document.createElement("div"); badge.id = "__tt_badge"; root.appendChild(badge);
    cap = document.createElement("div"); cap.id = "__tt_cap"; root.appendChild(cap);
    (document.body || document.documentElement).appendChild(root);
  }

  function rr(x, y, w, h, r) {
    return "M" + (x+r) + "," + y + " H" + (x+w-r) + " A" + r + "," + r + " 0 0 1 " + (x+w) + "," + (y+r) +
           " V" + (y+h-r) + " A" + r + "," + r + " 0 0 1 " + (x+w-r) + "," + (y+h) +
           " H" + (x+r) + " A" + r + "," + r + " 0 0 1 " + x + "," + (y+h-r) +
           " V" + (y+r) + " A" + r + "," + r + " 0 0 1 " + (x+r) + "," + y + " Z";
  }

  function boxOf(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function drawArrow(tail, head, animate) {
    var ang = Math.atan2(head.y - tail.y, head.x - tail.x);
    var hs = 17;
    var bx = head.x - Math.cos(ang) * hs, by = head.y - Math.sin(ang) * hs;
    var line = document.createElementNS(NS, "path");
    line.setAttribute("d", "M" + tail.x + "," + tail.y + " L" + bx + "," + by);
    line.setAttribute("stroke", "#F59E0B");
    line.setAttribute("stroke-width", "5");
    line.setAttribute("stroke-linecap", "round");
    if (animate) {
      line.setAttribute("pathLength", "1");
      line.setAttribute("stroke-dasharray", "1");
      line.style.animation = "tt-draw .4s ease forwards";
    }
    svg.appendChild(line);
    var a1 = ang + Math.PI - 0.44, a2 = ang + Math.PI + 0.44;
    var tri = document.createElementNS(NS, "polygon");
    tri.setAttribute("points",
      head.x + "," + head.y + " " +
      (head.x + Math.cos(a1) * hs * 1.5) + "," + (head.y + Math.sin(a1) * hs * 1.5) + " " +
      (head.x + Math.cos(a2) * hs * 1.5) + "," + (head.y + Math.sin(a2) * hs * 1.5));
    tri.setAttribute("fill", "#F59E0B");
    svg.appendChild(tri);
  }

  function place(o, animate) {
    if (!root) build();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var W = window.innerWidth, H = window.innerHeight;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);

    var b = o.box ? o.box : (o.selector ? boxOf(o.selector) : null);
    if (b && o.spotlight !== false) {
      var pad = o.pad != null ? o.pad : 10;
      var hx = b.x - pad, hy = b.y - pad, hw = b.w + pad * 2, hh = b.h + pad * 2, rad = 12;
      var mask = document.createElementNS(NS, "path");
      mask.setAttribute("d", "M0,0 H" + W + " V" + H + " H0 Z " + rr(hx, hy, hw, hh, rad));
      mask.setAttribute("fill", "rgba(3,7,18,.55)");
      mask.setAttribute("fill-rule", "evenodd");
      svg.appendChild(mask);
      var ring = document.createElementNS(NS, "path");
      ring.setAttribute("d", rr(hx, hy, hw, hh, rad));
      ring.setAttribute("fill", "none");
      ring.setAttribute("stroke", "#F59E0B");
      ring.setAttribute("stroke-width", "3");
      if (animate) {
        ring.setAttribute("pathLength", "1");
        ring.setAttribute("stroke-dasharray", "1");
        ring.style.animation = "tt-draw .55s ease forwards";
      }
      svg.appendChild(ring);
    }

    if (b && o.arrow) {
      var gap = 16, len = o.arrowLen != null ? o.arrowLen : 170;
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2, head, tail;
      if (o.arrow === "left") { head = { x: b.x - gap, y: cy }; tail = { x: head.x - len, y: cy }; }
      else if (o.arrow === "right") { head = { x: b.x + b.w + gap, y: cy }; tail = { x: head.x + len, y: cy }; }
      else if (o.arrow === "top") { head = { x: cx, y: b.y - gap }; tail = { x: cx, y: head.y - len }; }
      else { head = { x: cx, y: b.y + b.h + gap }; tail = { x: cx, y: head.y + len }; }
      tail.x = Math.max(28, Math.min(W - 28, tail.x));
      tail.y = Math.max(28, Math.min(H - 130, tail.y));
      drawArrow(tail, head, animate);
    }
  }

  function show(o) {
    last = o;
    place(o, true);
    if (o.badge) { badge.textContent = o.badge; badge.style.animation = "none"; void badge.offsetWidth; badge.style.animation = "tt-fade .2s ease forwards"; }
    else badge.textContent = "";
    if (o.text) { cap.textContent = o.text; cap.style.animation = "none"; void cap.offsetWidth; cap.style.animation = "tt-fade .2s ease forwards"; }
    else cap.textContent = "";
  }

  window.__tt = {
    show: show,
    hide: function () { last = null; if (root) { while (svg.firstChild) svg.removeChild(svg.firstChild); } cap.textContent = ""; badge.textContent = ""; },
    ripple: function (x, y) {
      if (!root) build();
      var d = document.createElement("div");
      d.id = "__tt_rip";
      d.style.left = x + "px";
      d.style.top = y + "px";
      root.appendChild(d);
      setTimeout(function () { d.remove(); }, 620);
    },
    boxOf: boxOf
  };

  /* Keep the annotation glued to the element while the page scrolls. Redrawn
     WITHOUT animations, or a scroll would restart the draw-in on every pixel. */
  window.addEventListener("scroll", function () { if (last) place(last, false); }, true);
  window.addEventListener("resize", function () { if (last) place(last, false); });
})();`;
}
