/*
  Tutorial recorder — one scenario in, four artifacts out.

  Usage:
    node docs/tutorials/record.mjs forgot-password

  Writes to docs/tutorials/out/<flow>/:
    video.mp4        silent screen capture of the real app, annotated
    video.webm       the raw Playwright capture (kept: it converts faster than it records)
    captions.srt     cue sheet, timed from the recording itself
    captions.vtt     same, for an HTML player
    narration.md     the script per cue, with timecodes — feed this to your TTS
    interactive.html the same steps as a click-through walkthrough
    stills/NN-*.png  annotated full-frame stills, one per step
    manifest.json    cues, timings and boxes, for any other consumer

  Why the cues are trustworthy: every cue is stamped from the same clock the
  video starts on (`t0`, taken immediately after the context is created), so the
  caption times are measured from the run rather than written by hand.

  Why captions are NOT burned into the video: you are generating the voice
  separately. Burned text plus a voiceover is two narrators. Play the mp4 with
  the .vtt beside it, or burn them with:
    ffmpeg -i video.mp4 -vf "subtitles=captions.srt" video-captioned.mp4
*/
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { overlaySource } from "./lib/overlay.mjs";

const BASE = process.env.TUTORIAL_BASE_URL ?? "http://localhost:3100";
const MAILPIT = process.env.TUTORIAL_MAILPIT_URL ?? "http://localhost:8025";
const VW = 1600;
const VH = 900;
const ROOT = path.resolve("docs/tutorials");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmt(t, sep = ",") {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}${sep}${String(ms).padStart(3, "0")}`;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

/*
  Find the sync flash by its COLOUR, not by scene change.

  Scene detection was the obvious tool and the wrong one: it reports the largest
  visual change in the window, and the app's first paint is a far bigger change
  than a flash of flat colour, so it returned the page render and the trim cut
  the wrong point — which left the magenta marker sitting in the published video.

  Decoding the whole clip to 1x1 pixels and reading the raw RGB is both exact and
  nearly free: three bytes per frame, so a 30s clip is under 3KB to scan. The
  fps filter forces a constant frame rate first, so a frame index is a real time.
*/
function detectFlash(webm, fps = 30) {
  const r = spawnSync("ffmpeg", [
    "-v", "error", "-i", webm,
    "-vf", `scale=1:1,fps=${fps}`,
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: 64 * 1024 * 1024 });
  const buf = r.stdout;
  if (!buf || !buf.length) return null;
  let first = -1;
  let last = -1;
  for (let i = 0; i * 3 + 2 < buf.length; i++) {
    const R = buf[i * 3], G = buf[i * 3 + 1], B = buf[i * 3 + 2];
    if (R > 180 && G < 90 && B > 180) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  return { first: first / fps, last: last / fps };
}

async function main() {
  const flowName = process.argv[2];
  if (!flowName) {
    console.error("usage: node docs/tutorials/record.mjs <flow>");
    process.exit(1);
  }
  const flow = (await import(`./flows/${flowName}.mjs`)).default;

  const outDir = path.join(ROOT, "out", flowName);
  const stillDir = path.join(outDir, "stills");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(stillDir, { recursive: true });

  /* A stale inbox is how a tutorial silently records the WRONG link. */
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" }).catch(() => {});

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-"));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    recordVideo: { dir: tmp, size: { width: VW, height: VH } },
  });
  await context.addInitScript({ content: overlaySource() });

  /*
    Force the LIGHT appearance for every recording.

    Dark is the product's own default, not the operating system's: the boot
    script in `apps/web/app/layout.tsx` treats anything except an explicit
    'light' in localStorage as dark, deliberately, because the design is
    dark-first. So a recording has to say 'light' out loud or every frame comes
    out dark — correct for the app, and unreadable as a tutorial on a projector
    or a phone.

    It is the MODE that is pinned, not the theme: whatever theme the account has
    chosen still applies, in its light variant.
  */
  await context.addInitScript(() => {
    try { localStorage.setItem("sti-theme", "light"); } catch { /* storage disabled */ }
  });

  const page = await context.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  let markerAt = 0;

  const cues = [];
  const stills = [];
  let stepNo = 0;

  const overlayReady = async () => {
    for (let i = 0; i < 60; i++) {
      const ok = await page.evaluate(() => !!window.__tt).catch(() => false);
      if (ok) return true;
      await sleep(100);
    }
    return false;
  };

  const boxOf = async (selector) => {
    if (!selector) return null;
    return page.evaluate((s) => {
      const b = window.__tt && window.__tt.boxOf(s);
      return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) } : null;
    }, selector);
  };

  /*
    Resolve what to point at.

    Accepts either a CSS selector or a Playwright Locator. The Locator path
    exists because most controls in this app have no stable selector — "New
    tool" is a button, not `#new-tool` — and the overlay can only box what
    `document.querySelector` can reach. A Locator knows the element; we measure
    it in Playwright and hand the overlay a plain box instead.
  */
  const resolveTarget = async (target) => {
    if (!target) return { selector: null, box: null };
    if (typeof target === "string") {
      await page.waitForSelector(target, { state: "visible", timeout: 15000 }).catch(() => {});
      await overlayReady();
      return { selector: target, box: await boxOf(target) };
    }
    await target.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await overlayReady();
    const bb = await target.first().boundingBox().catch(() => null);
    return {
      selector: null,
      box: bb ? { x: Math.round(bb.x), y: Math.round(bb.y), w: Math.round(bb.width), h: Math.round(bb.height) } : null,
    };
  };

  const activate = async (target) => {
    if (typeof target === "string") await page.click(target);
    else await target.first().click();
  };

  const still = async (name) => {
    const file = path.join(stillDir, name + ".png");
    await page.screenshot({ path: file });
    return path.relative(outDir, file);
  };

  /* ---- the API the flow scripts use ---- */
  const t = {
    page,
    context,
    base: BASE,
    mailpit: MAILPIT,

    pause: (ms) => page.waitForTimeout(ms),

    async goto(p) {
      await page.goto(p.startsWith("http") ? p : BASE + p, { waitUntil: "domcontentloaded" });
      await overlayReady();
      /* The app's screens rise in over ~0.5s. Annotating before that lands the
         arrow on a half-faded element, which looks like a bug in the video. */
      await page.waitForTimeout(450);
    },

    async waitFor(selector, timeout = 15000) {
      await page.waitForSelector(selector, { state: "visible", timeout });
      await overlayReady();
    },

    /* Annotate + narrate + capture, in one call, because a tutorial step that
       does only two of the three is how captions drift away from the picture. */
    async step({ selector, target, text, arrow, arrowLen, badge, hold = 1500, shot = true, pad }) {
      stepNo += 1;
      const { selector: sel, box } = await resolveTarget(target ?? selector);
      const b = box ?? (sel ? await boxOf(sel) : null);
      const label = badge ?? `Step ${stepNo}`;
      await page.evaluate(
        (o) => window.__tt && window.__tt.show(o),
        {
          selector: sel,
          /* A Locator has no selector the page can re-query, so its measured box
             goes instead — and a box does not follow a scroll the way a selector
             does. Fine for a dialog; worth knowing before using it on a long page. */
          box: sel ? null : b,
          text,
          badge: label,
          arrow: arrow ?? null,
          arrowLen: arrowLen ?? null,
          pad: pad ?? null,
        },
      );
      const tsec = now();
      let stillPath = null;
      if (shot) {
        await page.waitForTimeout(600); // let the draw-in finish before the frame
        stillPath = await still(String(stepNo).padStart(2, "0") + "-" + slug(text));
          stills.push({ n: stepNo, text, still: stillPath, bbox: b });
      }
      cues.push({ t: tsec, text, badge: label, bbox: b, still: stillPath });
      await page.waitForTimeout(hold);
      return b;
    },

    /* A step with nothing to point at — a confirmation screen, a result. */
    async cue(text, { hold = 1600, badge, shot = true } = {}) {
      return t.step({ text, hold, badge, shot });
    },

    async click(target, { hold = 0, ripple = true } = {}) {
      const { selector: sel, box } = await resolveTarget(target);
      const b = box ?? (sel ? await boxOf(sel) : null);
      if (b && ripple) {
        await page.evaluate((p) => window.__tt && window.__tt.ripple(p.x, p.y), { x: b.x + b.w / 2, y: b.y + b.h / 2 });
        await page.waitForTimeout(260);
      }
      await activate(target);
      if (hold) await page.waitForTimeout(hold);
      await overlayReady();
    },

    /*
      Type, but only once React is listening.

      Filling a controlled input before hydration is quietly catastrophic: the
      DOM value and React's state disagree, so `required` passes, the submit
      handler runs with an EMPTY field, and a native form post goes back to the
      same URL. Nothing throws, no request is logged, and the screen just sits
      there looking like the click did nothing — which is exactly how the sign-in
      page behaves here.

      `_valueTracker` is React's own marker that it owns an input, so it is a
      direct test of the condition rather than a sleep, which only ever works
      until the machine is busy.
    */
    async type(target, value, { delay = 28, hold = 260 } = {}) {
      const loc = typeof target === "string" ? page.locator(target) : target.first();
      await loc.click();
      const handle = await loc.elementHandle().catch(() => null);
      if (handle) {
        await page.waitForFunction(
          (el) => !!el && !!el._valueTracker,
          handle,
          { timeout: 8000 },
        ).catch(() => {});
      }
      await loc.fill("");
      await loc.pressSequentially(value, { delay });
      if (hold) await page.waitForTimeout(hold);
    },

    /* Mailpit: the real inbox the app just delivered to. */
    async mail() {
      const list = await (await fetch(`${MAILPIT}/api/v1/messages`)).json();
      if (!list.messages?.length) return null;
      const id = list.messages[0].ID;
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
      const body = `${msg.Text ?? ""}\n${msg.HTML ?? ""}`;
      const m = body.match(new RegExp(`${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/reset/[A-Za-z0-9_-]+`));
      return { id, subject: msg.Subject, to: msg.To?.[0]?.Address, resetUrl: m ? m[0] : null, viewUrl: `${MAILPIT}/view/${id}` };
    },
  };

  let failure = null;
  try {
    await t.goto("/");

    /*
      Sync marker, ON the first real screen rather than on about:blank.

      Playwright's video clock starts when the CONTEXT is created — before this
      script does anything — so "when the step happened" and "when the frame is"
      are two different clocks. A 200ms flash of pure magenta is the cheapest
      thing that can be found again afterwards: ffmpeg's scene detection reports
      its timestamp, which turns the unknown offset into a measured number.

      It goes here, after the app has painted, so the head-trim that removes the
      flash also removes the page load — the published video opens on the app
      instead of on a white frame.
    */
    await page.waitForTimeout(500);
    markerAt = now();
    const FLASH = () => {
      const d = document.createElement("div");
      d.id = "__sync";
      d.style.cssText = "position:fixed;inset:0;background:#FF00FF;z-index:2147483647";
      document.body.appendChild(d);
    };
    await page.evaluate(FLASH);
    await page.waitForTimeout(200);
    await page.evaluate(() => { const d = document.getElementById("__sync"); if (d) d.remove(); });

    await flow.run(t);
    await page.waitForTimeout(900); // hold the last frame
  } catch (e) {
    failure = e;
  }

  /* Measured HERE, not after the browser closes: tearing a browser down takes
     the better part of a second and the video has already stopped by then, so
     reading the clock afterwards reported a duration ~0.8s longer than the
     recording and made a phantom offset look real. */
  const duration = now();

  await page.close();
  await context.close();
  await browser.close();

  const videoPath = await (async () => {
    const f = fs.readdirSync(tmp).find((x) => x.endsWith(".webm"));
    return f ? path.join(tmp, f) : null;
  })();

  /* --- put the cues onto the video's clock ---------------------------------
     The flash recorded at the top is the only fixed point between the two
     clocks: it is the one thing whose script time and frame time are both
     known. Everything below is derived from it, not assumed. */
  let trim = 0;
  let shift = 0;
  let mp4 = null;
  let videoDuration = duration;
  if (videoPath) {
    const webm = path.join(outDir, "video.webm");
    fs.copyFileSync(videoPath, webm);

    const flash = detectFlash(webm);
    if (flash) {
      trim = Math.max(0, flash.last + 0.15);   // past the end of the marker
      shift = (flash.first - markerAt) - trim; // script clock -> trimmed-video clock
      console.log(`[record] sync   flash ${flash.first.toFixed(2)}-${flash.last.toFixed(2)}s | ` +
                  `marker ${markerAt.toFixed(2)}s | trim ${trim.toFixed(2)}s | ` +
                  `cue shift ${shift >= 0 ? "+" : ""}${shift.toFixed(2)}s`);
    } else {
      console.warn("[record] sync   marker not found — cue times left on the script clock");
    }

    videoDuration = Math.max(0, duration - trim);

    mp4 = path.join(outDir, "video.mp4");
    try {
      execFileSync("ffmpeg", ["-y", "-i", webm, "-ss", trim.toFixed(3),
        "-t", (videoDuration + 0.6).toFixed(3),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30", mp4], { stdio: "pipe" });
    } catch (e) {
      mp4 = null;
      console.error("[record] ffmpeg failed:", e.message);
    }

    /*
      The marker must not survive into the published cut.

      It did once. Scene detection picked the app's first paint — a far bigger
      visual change than a flat flash — so the trim cut the wrong second and
      every published video opened on a magenta frame. Nobody would read that as
      a calibration artefact; they would read it as a broken video, which is
      exactly what was reported.

      So the one thing that must be true of the output is checked rather than
      trusted.
    */
    if (mp4) {
      const leftover = detectFlash(mp4);
      if (leftover) {
        console.error(`[record] FAIL   sync marker still in video.mp4 at ${leftover.first.toFixed(2)}s — do not publish this cut`);
        process.exitCode = 1;
      } else {
        console.log("[record] check  published cut is marker-free");
      }
    }
  }

  /* Cue windows: each caption runs until the next cue, last one holds 3s. */
  const shifted = cues.map((c) => ({ ...c, t: Math.max(0, c.t + shift) }));
  const windows = shifted.map((c, i) => {
    const next = shifted[i + 1] ? shifted[i + 1].t : Math.min(videoDuration, c.t + 3);
    return { ...c, end: Math.max(c.t + 0.9, next) };
  });

  const srt = windows.map((c, i) =>
    `${i + 1}\n${fmt(c.t)} --> ${fmt(Math.max(c.t + 0.8, c.end))}\n${c.text}\n`).join("\n");
  const vtt = "WEBVTT\n\n" + windows.map((c, i) =>
    `${i + 1}\n${fmt(c.t, ".")} --> ${fmt(Math.max(c.t + 0.8, c.end), ".")}\n${c.text}\n`).join("\n");

  const narration = [
    `# ${flow.title}`,
    "",
    flow.intro ?? "",
    "",
    "| # | in | out | line |",
    "|---|---|---|---|",
    ...windows.map((c, i) => `| ${i + 1} | ${fmt(c.t)} | ${fmt(Math.max(c.t + 0.8, c.end))} | ${c.text} |`),
    "",
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "captions.srt"), srt);
  fs.writeFileSync(path.join(outDir, "captions.vtt"), vtt);
  fs.writeFileSync(path.join(outDir, "narration.md"), narration);
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(
    {
      flow: flowName,
      title: flow.title,
      startBase: BASE,
      duration: Number(videoDuration.toFixed(2)),
      videoTrim: Number(trim.toFixed(3)),
      cueShift: Number(shift.toFixed(3)),
      cues: windows,
    },
    null, 2));

  fs.writeFileSync(path.join(outDir, "interactive.html"), interactiveHtml(flow, windows, VW, VH));

  console.log(`\n[record] ${flow.title}`);
  console.log(`  steps       ${windows.length}`);
  console.log(`  duration    ${videoDuration.toFixed(1)}s`);
  console.log(`  video       ${mp4 ? path.relative(ROOT, mp4) : "(ffmpeg unavailable — use video.webm)"}`);
  console.log(`  captions    ${path.relative(ROOT, path.join(outDir, "captions.srt"))}`);
  console.log(`  narration   ${path.relative(ROOT, path.join(outDir, "narration.md"))}`);
  console.log(`  interactive ${path.relative(ROOT, path.join(outDir, "interactive.html"))}`);
  if (failure) {
    console.error("\n[record] flow FAILED:", failure.message);
    process.exitCode = 1;
  }
}

/*
  The same cues as a click-through, so somebody can be shown the flow rather
  than watch it. The hotspot is the element box the recorder measured on the
  live page, scaled onto the still — the ring lands where the click went.
*/
function interactiveHtml(flow, windows, vw, vh) {
  const steps = windows.map((c) => ({
    text: c.text,
    still: c.still,
    box: c.bbox,
  }));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${flow.title} — walkthrough</title>
<style>
  :root{--amber:#F59E0B;--navy:#0F172A;--ink:#1E293B;--muted:#64748B;--line:#E2E8F0}
  *{box-sizing:border-box}
  body{margin:0;height:100dvh;display:grid;grid-template-columns:1fr 400px;background:#EEF2F7;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--ink)}
  .stage{position:relative;display:flex;align-items:center;justify-content:center;padding:22px;min-width:0}
  .frame{position:relative;width:100%;max-width:1180px;aspect-ratio:${vw}/${vh};
         background:#0F172A;border-radius:12px;overflow:hidden;border:1px solid #CBD5E1;
         box-shadow:0 18px 50px rgba(15,23,42,.28)}
  .frame img{width:100%;display:block}
  /* Ring only — deliberately no dimming shadow.
     The giant box-shadow this used to carry (0 0 0 9999px) darkened the whole
     frame, but the still is a RECORDING of the annotated screen and already has
     the spotlight burned into it. Dimming it twice made an already-dark app
     read as a black rectangle. The ring marks the target; the still does the
     rest. */
  .hot{position:absolute;border:3px solid var(--amber);border-radius:10px;
       box-shadow:0 0 0 4px rgba(245,158,11,.35),0 0 20px rgba(245,158,11,.5);
       animation:pulse 1.7s ease-in-out infinite}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 4px rgba(245,158,11,.35),0 0 20px rgba(245,158,11,.5)}
                   50%{box-shadow:0 0 0 9px rgba(245,158,11,.18),0 0 30px rgba(245,158,11,.75)}}
  aside{background:#fff;border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
  aside header{padding:22px 24px 12px}
  .eyebrow{margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:var(--amber)}
  h1{margin:0;font-size:20px;letter-spacing:-.01em}
  .body{flex:1;overflow:auto;padding:8px 24px 24px}
  .body p{font-size:16px;line-height:1.5;margin:0 0 14px}
  .dots{display:flex;gap:6px;padding:0 24px 12px;flex-wrap:wrap}
  .dot{width:9px;height:9px;border-radius:50%;background:#CBD5E1;cursor:pointer;border:0;padding:0}
  .dot.on{background:var(--amber)}
  footer{display:flex;gap:8px;align-items:center;padding:14px 24px;border-top:1px solid var(--line)}
  footer button{font:inherit;font-size:14px;padding:8px 14px;border-radius:9px;cursor:pointer;
                border:1px solid var(--line);background:#F8FAFC}
  footer button.primary{background:var(--navy);color:#fff;border-color:var(--navy)}
  footer button:disabled{opacity:.4;cursor:not-allowed}
  .count{margin-left:auto;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
</style></head>
<body>
<div class="stage"><div class="frame" id="frame"><img id="img" alt="" /><div class="hot" id="hot" hidden></div></div></div>
<aside>
  <header>
    <p class="eyebrow">Walkthrough</p>
    <h1>${flow.title}</h1>
  </header>
  <div class="body"><p id="text"></p></div>
  <div class="dots" id="dots"></div>
  <footer>
    <button id="prev">Back</button>
    <button id="next" class="primary">Next</button>
    <span class="count" id="count"></span>
  </footer>
</aside>
<script>
const STEPS = ${JSON.stringify(steps)};
const VW = ${vw}, VH = ${vh};
let i = 0;
const img = document.getElementById('img');
const hot = document.getElementById('hot');
const text = document.getElementById('text');
const dots = document.getElementById('dots');
const count = document.getElementById('count');
STEPS.forEach((_, n) => {
  const b = document.createElement('button');
  b.className = 'dot'; b.title = 'Step ' + (n + 1);
  b.onclick = () => { i = n; render(); };
  dots.appendChild(b);
});
function render(){
  const s = STEPS[i];
  img.src = s.still || '';
  img.alt = s.text;
  text.textContent = s.text;
  if (s.box){
    const w = document.getElementById('frame').clientWidth;
    const k = w / VW;
    hot.hidden = false;
    hot.style.left = (s.box.x * k) + 'px';
    hot.style.top = (s.box.y * k) + 'px';
    hot.style.width = (s.box.w * k) + 'px';
    hot.style.height = (s.box.h * k) + 'px';
  } else hot.hidden = true;
  document.getElementById('prev').disabled = i === 0;
  document.getElementById('next').disabled = i === STEPS.length - 1;
  count.textContent = (i + 1) + ' / ' + STEPS.length;
  [...dots.children].forEach((d, n) => d.classList.toggle('on', n === i));
}
document.getElementById('prev').onclick = () => { if (i) { i--; render(); } };
document.getElementById('next').onclick = () => { if (i < STEPS.length - 1) { i++; render(); } };
addEventListener('keydown', e => {
  if (e.key === 'ArrowRight' && i < STEPS.length - 1) { i++; render(); }
  if (e.key === 'ArrowLeft' && i) { i--; render(); }
});
render();
</script>
</body></html>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
