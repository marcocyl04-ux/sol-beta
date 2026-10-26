// The notch's one scene (#254): every black shape of the half moon in one
// list, drawn by one fragment shader on one canvas. It replaces the SVG goo filter (a blur and a threshold over a DOM
// layer), which was slow, left WebKit's sawtooth as 1 px grey lines at every edge while it ran, and carried an on/off
// state that leaked twice.
//
// The springs write plain numbers here (Notch.tsx put: the moon; Moon.tsx boxAt/neckTo: a name's bud and its neck, a
// card's body and its neck); the scene marks itself dirty and draws once on the springs' own frame (motion.ts onFrame),
// never on a timer of its own. Shapes that melt join through a polynomial smooth-min (k 12 px), which is the goo; the
// rest join by a plain min. Coordinates are page px from the window's top-left, like the DOM.
import { onFrame, requestFrame, reducedMotion } from "../motion";

export type Kind = "moon" | "rrect" | "circle" | "capsule";
/** moon: a rectangle (x, y, w, h) whose bottom corners are elliptical (r across, ry down: CSS `0 0 r r / 0 0 ry ry`);
 *  rrect: a box (x, y, w, h) with corner radius r; circle: centre (x, y), radius r; capsule: a neck from (x, y) to
 *  (x + w, y + h), r thick */
export type Shape = { id: string; kind: Kind; x: number; y: number; w: number; h: number; r: number; ry?: number; melt: boolean; on: boolean };

const MAX = 32;          // the shader's uniform array
const K = 12;            // the smooth-min's reach, CSS px
const shapes = new Map<string, Shape>();
export const scene = {
  dirty: false,
  /** create or update a shape; a new one needs its kind */
  set(id: string, p: Partial<Omit<Shape, "id">>) {
    let s = shapes.get(id), changed = false;
    if (!s) { s = { id, kind: "rrect", x: 0, y: 0, w: 0, h: 0, r: 0, melt: false, on: false }; shapes.set(id, s); changed = true; }
    const was = s.on, o = s as Record<string, unknown>;
    for (const [k, v] of Object.entries(p)) if (o[k] !== v) { o[k] = v; changed = true; }
    // a shape that stays off draws nothing new (a card at rest writes "off" on every frame of its drag)
    if (changed && (s.on || was)) touch();
  },
  remove(id: string) { const s = shapes.get(id); if (shapes.delete(id) && s?.on) touch(); },
  read(): readonly Shape[] { return [...shapes.values()]; },
};
function touch() { scene.dirty = true; requestFrame(); }   // a frame already asked for is not asked again (motion.ts wake)

/** the shapes as drawn: those on, the moon melting only while another melting shape is on, nothing melting (and no
 *  neck) under reduced motion */
function drawn(): Shape[] {
  const rm = reducedMotion();
  const on = [...shapes.values()].filter((s) => s.on && !(rm && s.kind === "capsule"));
  const others = !rm && on.some((s) => s.kind !== "moon" && s.melt);
  return on.slice(0, MAX).map((s) => (s.kind === "moon" ? { ...s, melt: others } : rm ? { ...s, melt: false } : s));
}

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
// every length in device px: the anti-aliased edge is one device px whatever the scale
const FS = `#version 300 es
precision highp float;
uniform vec4 uA[${MAX}];   // x, y, w, h
uniform vec4 uB[${MAX}];   // r, ry, kind (0 moon, 1 rrect, 2 circle, 3 capsule), melt
uniform int uN;
uniform float uH, uK;
out vec4 o;
float sdBox(vec2 q, vec2 b) { vec2 d = q - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
// an ellipse's signed distance, first order (exact on the rim, close near it: all the edge needs)
float sdEllipse(vec2 q, vec2 r) {
  float k0 = length(q / r), k1 = length(q / (r * r));
  return k1 > 1e-6 ? k0 * (k0 - 1.0) / k1 : -min(r.x, r.y);
}
float sd(int i, vec2 p) {
  vec4 a = uA[i], b = uB[i];
  int kind = int(b.z + 0.5);
  if (kind == 3) {   // capsule
    vec2 d = a.zw, q = p - a.xy;
    float t = clamp(dot(q, d) / max(dot(d, d), 1e-6), 0.0, 1.0);
    return length(q - d * t) - b.x * 0.5;
  }
  if (kind == 2) return length(p - a.xy) - b.x;   // circle
  vec2 hb = a.zw * 0.5, c = a.xy + hb, q = abs(p - c);
  if (kind == 1) { float r = min(b.x, min(hb.x, hb.y)); return sdBox(q, hb - r) - r; }
  // the moon: its top runs on above the window (no edge, no fringe on the menu bar), its bottom corners elliptical
  float top = a.y - 64.0, bot = a.y + a.w;   // a.w is the height
  float rx = min(b.x, hb.x), ry = min(b.y, a.w);
  float cx = hb.x - rx, cy = bot - ry;
  if (q.x > cx && p.y > cy && rx > 0.0 && ry > 0.0) return sdEllipse(vec2(q.x - cx, p.y - cy), vec2(rx, ry));
  float dx = q.x - hb.x, dy = max(top - p.y, p.y - bot);
  return length(max(vec2(dx, dy), 0.0)) + min(max(dx, dy), 0.0);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uH - gl_FragCoord.y);
  float dm = 1e9, dp = 1e9;
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uN) break;
    float d = sd(i, p);
    if (uB[i].w > 0.5) { float h = max(uK - abs(dm - d), 0.0) / uK; dm = min(dm, d) - h * h * uK * 0.25; }
    else dp = min(dp, d);
  }
  // in a melt's crease the smooth-min's slope falls under 1 and its edge would spread into a grey smear (seen in a
  // render, a name at rest beside the rim): the distance is divided by its own slope, so the edge is one px everywhere.
  // The edge is a pixel's coverage, a 1 px linear ramp, as WebKit draws a CSS box: the first pass named
  // 1 - smoothstep(-0.75, 0.75, d), which left a 7 % row under every straight edge (the closed slab differed from the
  // CSS one in 1248 device px, alpha up to 19); the ramp differs in 103, only round the two corners (rubric S4)
  float d = min(dm, dp), g = length(vec2(dFdx(d), dFdy(d)));
  float a = clamp(0.5 - d / clamp(g, 0.25, 4.0), 0.0, 1.0);
  o = vec4(0.0, 0.0, 0.0, a);
}`;

type Log = (m: string) => void;
/** One canvas that draws the scene. Mounted by Notch.tsx on its `<canvas class="goo">`. */
export class SceneRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private c2: CanvasRenderingContext2D | null = null;
  private uA: WebGLUniformLocation | null = null; private uB: WebGLUniformLocation | null = null;
  private uN: WebGLUniformLocation | null = null; private uH: WebGLUniformLocation | null = null; private uK: WebGLUniformLocation | null = null;
  private a = new Float32Array(MAX * 4); private b = new Float32Array(MAX * 4);
  private frames = 0; private spent = 0;
  private onResize = () => touch();
  // a lost GPU context (a display change, the GPU switching) would leave no moon at all: it is set up again when restored
  private onLost = (e: Event) => { e.preventDefault(); this.log("scene: WebGL context lost"); };
  private onRestored = () => { if (this.gl && this.setup(this.gl)) { this.log("scene: WebGL context restored"); touch(); } };
  constructor(private canvas: HTMLCanvasElement, private log: Log) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false });
    if (gl && this.setup(gl)) this.gl = gl;
    else {
      this.c2 = canvas.getContext("2d");
      log("scene: no WebGL2, plain union");
    }
    onFrame(() => this.frame());
    window.addEventListener("resize", this.onResize);
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    touch();
  }
  dispose() {
    onFrame(null);
    window.removeEventListener("resize", this.onResize);
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
  }
  private setup(gl: WebGL2RenderingContext): boolean {
    const sh = (t: number, src: string) => {
      const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { this.log(`scene: shader: ${gl.getShaderInfoLog(s)}`); return null; }
      return s;
    };
    const v = sh(gl.VERTEX_SHADER, VS), f = sh(gl.FRAGMENT_SHADER, FS);
    if (!v || !f) return false;
    const pr = gl.createProgram()!; gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { this.log(`scene: link: ${gl.getProgramInfoLog(pr)}`); return false; }
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   // one triangle over the screen
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uA = gl.getUniformLocation(pr, "uA"); this.uB = gl.getUniformLocation(pr, "uB"); this.uN = gl.getUniformLocation(pr, "uN");
    this.uH = gl.getUniformLocation(pr, "uH"); this.uK = gl.getUniformLocation(pr, "uK");
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0);
    return true;
  }
  private frame() {
    if (!scene.dirty) return;
    scene.dirty = false;
    const t0 = performance.now();
    this.draw();
    this.spent += performance.now() - t0;
    if (++this.frames === 100) this.log(`scene: draw ${(this.spent / 100).toFixed(2)} ms`);
  }
  private draw() {
    const dpr = window.devicePixelRatio || 1, cv = this.canvas;
    const W = Math.round(window.innerWidth * dpr), H = Math.round(window.innerHeight * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const list = drawn();
    if (this.gl) {
      const gl = this.gl;
      gl.viewport(0, 0, W, H);
      gl.disable(gl.SCISSOR_TEST); gl.clear(gl.COLOR_BUFFER_BIT);
      if (!list.length) return;
      // only the shapes' bounds (and the melt's reach) are shaded
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      list.forEach((s, i) => {
        const kind = s.kind === "moon" ? 0 : s.kind === "rrect" ? 1 : s.kind === "circle" ? 2 : 3;
        this.a.set([s.x * dpr, s.y * dpr, s.w * dpr, s.h * dpr], i * 4);
        this.b.set([s.r * dpr, (s.ry ?? s.r) * dpr, kind, s.melt ? 1 : 0], i * 4);
        const [bx0, by0, bx1, by1] = bounds(s);
        x0 = Math.min(x0, bx0); y0 = Math.min(y0, by0); x1 = Math.max(x1, bx1); y1 = Math.max(y1, by1);
      });
      const m = K + 2;
      const sx = Math.max(0, Math.floor((x0 - m) * dpr)), sy = Math.max(0, Math.floor((y0 - m) * dpr));
      const ex = Math.min(W, Math.ceil((x1 + m) * dpr)), ey = Math.min(H, Math.ceil((y1 + m) * dpr));
      if (ex <= sx || ey <= sy) return;
      gl.enable(gl.SCISSOR_TEST); gl.scissor(sx, H - ey, ex - sx, ey - sy);
      gl.uniform4fv(this.uA, this.a); gl.uniform4fv(this.uB, this.b);
      gl.uniform1i(this.uN, list.length); gl.uniform1f(this.uH, H); gl.uniform1f(this.uK, K * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    const c = this.c2;
    if (!c) return;
    // the fallback: the same shapes filled plain, no necks, no melt
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#000";
    for (const s of list) {
      c.beginPath();
      if (s.kind === "capsule") continue;
      if (s.kind === "circle") c.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
      else if (s.kind === "rrect") c.roundRect(s.x, s.y, s.w, s.h, Math.min(s.r, s.w / 2, s.h / 2));
      else {
        const rx = Math.min(s.r, s.w / 2), ry = Math.min(s.ry ?? s.r, s.h), b = s.y + s.h;
        c.moveTo(s.x, s.y - 64); c.lineTo(s.x + s.w, s.y - 64); c.lineTo(s.x + s.w, b - ry);
        c.ellipse(s.x + s.w - rx, b - ry, rx, ry, 0, 0, Math.PI / 2);
        c.lineTo(s.x + rx, b);
        c.ellipse(s.x + rx, b - ry, rx, ry, 0, Math.PI / 2, Math.PI);
        c.closePath();
      }
      c.fill();
    }
  }
}
/** a shape's box in page px */
function bounds(s: Shape): [number, number, number, number] {
  if (s.kind === "circle") return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
  if (s.kind === "capsule") {
    const t = s.r / 2;
    return [Math.min(s.x, s.x + s.w) - t, Math.min(s.y, s.y + s.h) - t, Math.max(s.x, s.x + s.w) + t, Math.max(s.y, s.y + s.h) + t];
  }
  return [s.x, s.kind === "moon" ? s.y - 64 : s.y, s.x + s.w, s.y + s.h];
}
