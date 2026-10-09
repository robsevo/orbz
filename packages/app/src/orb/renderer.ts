// One WebGL2 context for every orb on the page (PLAN 2.1-2.3). Each orb is drawn here, at its own
// canvas's size, and copied into that canvas: a page of a dozen orbs is one GPU context, not a
// dozen (browsers stop at about sixteen). The context attributes and the blend are Ash's own
// (`index.1.js`: alpha on, premultipliedAlpha off, SRC_ALPHA over ONE_MINUS_SRC_ALPHA), so his
// glass composites onto a page exactly as it does onto the desktop.
import { MATERIALS } from "../design/tokens.ts";
import { HAT_FS, HAT_VS, ORB_FS, ORB_VS } from "./glsl.ts";
import type { Built } from "./hats/geo.ts";
import { hatMesh, headMesh } from "./hats/models.ts";

export type OrbFrame = {
  /** Palette rotation, in turns (Ash's azure is 200/360), and how much of it shows at rest. */
  hue: number;
  tint: number;
  /** 0 idle, 1 listening, 2 thinking, 3 speaking (fractions blend between them). */
  state: number;
  level: number;
  wake: number;
  breath: number;
  blink: number;
  morph: number;
  gaze: [number, number];
  sway: [number, number];
  happy: number;
  sleepy: number;
  yawn: number;
  surprise: number;
  tilt: number;
  mad: number;
  jiggle: number;
  /** His finish: saturation, brightness (a black orb is 0.4), and a gradient's second hue. */
  sat: number;
  val: number;
  hue2: number;
  grad: number;
  /** How soft he is (0 glass .. 1 jelly), and a squash (+) or stretch (-) for hops and pokes. */
  goo: number;
  squash: number;
  /** One eye shut (a wink, life.ts): 1 while it is. */
  wink: number;
};

/** Who he is: the parts of a character the shader draws (spec.ts makes these from a spec). */
export type OrbLook = {
  shapeA: [number, number, number, number];
  shapeB: [number, number, number, number];
  shapeC: [number, number, number, number];
  shapeD: [number, number, number, number];
  shapeE: [number, number, number, number];
  shapeF: [number, number, number, number];
  eyeA: [number, number, number, number];
  eyeB: [number, number, number, number];
  acc: number;
  /** Where his hat sits and how big it is, for his shape (spec.ts hatFit). */
  accFit: [number, number];
  accCol: [number, number, number];
  accCol2: [number, number, number];
  accTilt: number;
  /** His own colour, for the light a hat catches from him (under its brim, at its edges). */
  orbCol: [number, number, number];
  /** What on his hat gives off light (hats/models.ts glowOf): where, how big, a bead (1) or a ring (2) or none (0), and
   * its colour. */
  accGlow: [number, number, number, number];
  accGlowKind: number;
  accGlowCol: [number, number, number];
  /** Glasses: the style (0 none), the frame, a strap, the lens's tint and how dark it is. */
  specs: number;
  specsCol: [number, number, number];
  specsCol2: [number, number, number];
  lensCol: [number, number, number];
  lensDark: number;
};

/** His proportions: Ash's window is 112 wide with his centre 58 down and 66 below him. An orb in
 * Orbs wears hats and hops, so his frame has 38 more above (measured: a top hat or a wizard's hat
 * came within 2 px of the frame's top at rest, and a hop would have cut it off); below him is as
 * it was, with no room for a name, which a page shows itself. */
export const DESIGN = { w: 112, h: 162, cy: 96 / 162, radius: 33, edge: 0.22 } as const;
export type Framing = { readonly w: number; readonly h: number; readonly cy: number; readonly radius: number; readonly edge: number };
/** A close-up of his face, for choosing eyes and glasses: he fills the frame, hats and all cut off. */
export const PORTRAIT: Framing = { w: 112, h: 104, cy: 0.5, radius: 50, edge: 0.16 };

/** Ash's page draws his shader at three times its size and lets the compositor smooth it (index.1.js
 * SS = 3): his liquid is fine detail that comes out blocky at the screen's own size. This draws at
 * 1.5 times and smooths it down: most of the smoothness at a quarter of his cost. */
const SUPERSAMPLE = 1.5;

const UNIFORMS = [
  "uRes", "uTime", "uLevel", "uState", "uWake", "uR", "uCy", "uEdge", "uBreath", "uBlink", "uMorph", "uGaze", "uSway",
  "uHappy", "uSleepy", "uYawn", "uSurprise", "uTilt", "uMad", "uJiggle", "uHue", "uSat", "uVal", "uHue2", "uGrad", "uTint",
  "uShapeA", "uShapeB", "uShapeC", "uShapeD", "uShapeE", "uShapeF", "uGoo", "uSquash", "uEyeA", "uEyeB", "uAccFit", "uAccTilt", "uAccGlow", "uAccGlowK", "uAccGlowCol", "uAccEdge", "uAccShade", "uSpecs", "uSpecsCol", "uSpecsCol2", "uLensCol", "uLensDark",
] as const;
const HAT_UNIFORMS = ["uRes", "uSway", "uAccFit", "uTime", "uLevel", "uState", "uWake", "uR", "uCy", "uBreath", "uMorph", "uSquash", "uAccTilt", "uShapeD", "uCol", "uCol2", "uOrb", "uPal"] as const;

type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
type HatUniforms = Record<(typeof HAT_UNIFORMS)[number], WebGLUniformLocation | null>;
type Drawn = { vao: WebGLVertexArrayObject; count: number; edge: Float32Array };

/** How dark the shadow a hat casts on his glass, just under it. */
const SHADE = 0.4;
const NO_EDGE = new Float32Array(32).fill(-9);
/** The hats' fixed colours, by their slot (hats/geo.ts SLOT): the first two are the hat's own and are not read. */
const PALETTE = (["ink", "ink", "gold", "steel", "cream", "ink", "leaf", "wood", "white", "fur"] as const).flatMap((k) => MATERIALS[k].map((v) => v / 255));

export class OrbRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly #u: Uniforms;
  readonly #prog: WebGLProgram;
  readonly #hat: WebGLProgram;
  readonly #hu: HatUniforms;
  readonly #empty: WebGLVertexArrayObject;
  readonly #drawn = new Map<number, Drawn | null>();
  #head: Drawn | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error("this browser has no WebGL2, so the orbs cannot be drawn");
    this.gl = gl;
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`the orb's shader did not compile: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const link = (vs: string, fs: string, what: string): WebGLProgram => {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`the ${what} shader did not link: ${gl.getProgramInfoLog(prog)}`);
      return prog;
    };
    this.#prog = link(ORB_VS, ORB_FS, "orb's");
    this.#hat = link(HAT_VS, HAT_FS, "hats'");
    this.#empty = gl.createVertexArray()!;
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.#u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(this.#prog, n)])) as Uniforms;
    this.#hu = Object.fromEntries(HAT_UNIFORMS.map((n) => [n, gl.getUniformLocation(this.#hat, n)])) as HatUniforms;
  }

  /** A model on the GPU: its vertices (place, normal, coordinates, what it is made of) and its triangles. */
  #upload(b: Built): Drawn {
    const { gl } = this;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    for (const [loc, data, size] of [[0, b.pos, 3], [1, b.nrm, 3], [2, b.uv, 2], [3, b.mat, 4]] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, b.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: b.count, edge: b.edge };
  }

  /** A hat's model, uploaded the first time it is worn (null: no hat). */
  #model(id: number): Drawn | null {
    if (!this.#drawn.has(id)) {
      const b = id > 0 ? hatMesh(id) : null;
      this.#drawn.set(id, b ? this.#upload(b) : null);
    }
    return this.#drawn.get(id)!;
  }

  /** Draws one orb into `target` (a 2D canvas), filling it the way his window holds him (or closer). */
  draw(target: HTMLCanvasElement, look: OrbLook, f: OrbFrame, time: number, framing: Framing = DESIGN): void {
    const { gl } = this;
    const w = Math.round(target.width * SUPERSAMPLE);
    const h = Math.round(target.height * SUPERSAMPLE);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.#prog);
    gl.bindVertexArray(this.#empty);
    gl.disable(gl.DEPTH_TEST);
    const hat = this.#model(look.acc);
    const scale = Math.min(w / framing.w, h / framing.h);
    const u = this.#u;
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uR, framing.radius * scale);
    gl.uniform1f(u.uCy, framing.cy);
    gl.uniform1f(u.uEdge, framing.edge);
    gl.uniform1f(u.uLevel, f.level);
    gl.uniform1f(u.uState, f.state);
    gl.uniform1f(u.uWake, f.wake);
    gl.uniform1f(u.uBreath, f.breath);
    gl.uniform1f(u.uBlink, f.blink);
    gl.uniform1f(u.uMorph, f.morph);
    gl.uniform2f(u.uGaze, f.gaze[0], f.gaze[1]);
    gl.uniform2f(u.uSway, f.sway[0] * scale, f.sway[1] * scale);
    gl.uniform1f(u.uHappy, f.happy);
    gl.uniform1f(u.uSleepy, f.sleepy);
    gl.uniform1f(u.uYawn, f.yawn);
    gl.uniform1f(u.uSurprise, f.surprise);
    gl.uniform1f(u.uTilt, f.tilt);
    gl.uniform1f(u.uMad, f.mad);
    gl.uniform1f(u.uJiggle, f.jiggle);
    gl.uniform1f(u.uHue, f.hue);
    gl.uniform1f(u.uSat, f.sat);
    gl.uniform1f(u.uVal, f.val);
    gl.uniform1f(u.uHue2, f.hue2);
    gl.uniform1f(u.uGrad, f.grad);
    gl.uniform1f(u.uTint, f.tint);
    gl.uniform1f(u.uGoo, f.goo);
    gl.uniform1f(u.uSquash, f.squash);
    gl.uniform4f(u.uShapeA, ...look.shapeA);
    gl.uniform4f(u.uShapeB, ...look.shapeB);
    gl.uniform4f(u.uShapeC, ...look.shapeC);
    gl.uniform4f(u.uShapeD, ...look.shapeD);
    gl.uniform4f(u.uShapeE, ...look.shapeE);
    gl.uniform4f(u.uShapeF, ...look.shapeF);
    gl.uniform4f(u.uEyeA, ...look.eyeA);
    // a wink is something he does (a gesture), so the frame can shut one eye on any eyes
    gl.uniform4f(u.uEyeB, look.eyeB[0], look.eyeB[1], look.eyeB[2], Math.max(look.eyeB[3], f.wink > 0.5 ? 1 : 0));
    gl.uniform2f(u.uAccFit, ...look.accFit);
    gl.uniform1f(u.uAccTilt, look.accTilt);
    gl.uniform4f(u.uAccGlow, ...look.accGlow);
    gl.uniform1f(u.uAccGlowK, hat ? look.accGlowKind : 0);
    gl.uniform3f(u.uAccGlowCol, ...look.accGlowCol);
    gl.uniform1fv(u.uAccEdge, hat ? hat.edge : NO_EDGE);
    gl.uniform1f(u.uAccShade, hat ? SHADE : 0);
    gl.uniform1f(u.uSpecs, look.specs);
    gl.uniform3f(u.uSpecsCol, ...look.specsCol);
    gl.uniform3f(u.uSpecsCol2, ...look.specsCol2);
    gl.uniform3f(u.uLensCol, ...look.lensCol);
    gl.uniform1f(u.uLensDark, look.lensDark);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (hat) this.#drawHat(hat, look, f, time, framing.radius * scale, framing.cy, w, h, [f.sway[0] * scale, f.sway[1] * scale]);
    const ctx = target.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(this.canvas, 0, 0, target.width, target.height);
  }

  /** The hat, over all of him (owner, 10-03: a hat is in front of his ears too): his head into depth alone, so what
   * goes round behind it hides, then the model, solid. */
  #drawHat(hat: Drawn, look: OrbLook, f: OrbFrame, time: number, R: number, cy: number, w: number, h: number, sway: [number, number]): void {
    const { gl } = this;
    const u = this.#hu;
    gl.useProgram(this.#hat);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform2f(u.uSway, sway[0], sway[1]);
    gl.uniform2f(u.uAccFit, ...look.accFit);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uLevel, f.level);
    gl.uniform1f(u.uState, f.state);
    gl.uniform1f(u.uWake, f.wake);
    gl.uniform1f(u.uR, R);
    gl.uniform1f(u.uCy, cy);
    gl.uniform1f(u.uBreath, f.breath);
    gl.uniform1f(u.uMorph, f.morph);
    gl.uniform1f(u.uSquash, f.squash);
    gl.uniform1f(u.uAccTilt, look.accTilt);
    gl.uniform4f(u.uShapeD, ...look.shapeD);
    gl.uniform3f(u.uCol, ...look.accCol);
    gl.uniform3f(u.uCol2, ...look.accCol2);
    gl.uniform3f(u.uOrb, ...look.orbCol);
    gl.uniform3fv(u.uPal, PALETTE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.colorMask(false, false, false, false);
    this.#head ??= this.#upload(headMesh());
    gl.bindVertexArray(this.#head.vao);
    gl.drawElements(gl.TRIANGLES, this.#head.count, gl.UNSIGNED_INT, 0);
    gl.colorMask(true, true, true, true);
    gl.bindVertexArray(hat.vao);
    gl.drawElements(gl.TRIANGLES, hat.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
}

let shared: OrbRenderer | null = null;
export const renderer = (): OrbRenderer => (shared ??= new OrbRenderer());
