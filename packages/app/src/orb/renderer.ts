// One WebGL2 context for every orb on the page (PLAN 2.1-2.3). Each orb is drawn here, at its own
// canvas's size, and copied into that canvas: a page of a dozen orbs is one GPU context, not a
// dozen (browsers stop at about sixteen). The context attributes and the blend are Ash's own
// (`index.1.js`: alpha on, premultipliedAlpha off, SRC_ALPHA over ONE_MINUS_SRC_ALPHA), so his
// glass composites onto a page exactly as it does onto the desktop.
import { ORB_FS, ORB_VS } from "./glsl.ts";

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
  accCol: [number, number, number];
  accCol2: [number, number, number];
  accTilt: number;
};

/** His proportions: Ash's window is 112 wide with his centre 58 down and 66 below him. An orb in
 * Orbs wears hats and hops, so his frame has 38 more above (measured: a top hat or a wizard's hat
 * came within 2 px of the frame's top at rest, and a hop would have cut it off); below him is as
 * it was, with no room for a name, which a page shows itself. */
export const DESIGN = { w: 112, h: 162, cy: 96 / 162, radius: 33, edge: 0.22 } as const;

/** Ash's page draws his shader at three times its size and lets the compositor smooth it (index.1.js
 * SS = 3): his liquid is fine detail that comes out blocky at the screen's own size. This draws at
 * 1.5 times and smooths it down: most of the smoothness at a quarter of his cost. */
const SUPERSAMPLE = 1.5;

const UNIFORMS = [
  "uRes", "uTime", "uLevel", "uState", "uWake", "uR", "uCy", "uEdge", "uBreath", "uBlink", "uMorph", "uGaze", "uSway",
  "uHappy", "uSleepy", "uYawn", "uSurprise", "uTilt", "uMad", "uJiggle", "uHue", "uSat", "uVal", "uHue2", "uGrad", "uTint",
  "uShapeA", "uShapeB", "uShapeC", "uShapeD", "uShapeE", "uShapeF", "uGoo", "uSquash", "uEyeA", "uEyeB", "uAcc", "uAccCol", "uAccCol2", "uAccTilt",
] as const;

type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;

export class OrbRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly #u: Uniforms;

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
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, ORB_VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, ORB_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`the orb's shader did not link: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);
    gl.bindVertexArray(gl.createVertexArray());
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.#u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(prog, n)])) as Uniforms;
  }

  /** Draws one orb into `target` (a 2D canvas), filling it the way his window holds him. */
  draw(target: HTMLCanvasElement, look: OrbLook, f: OrbFrame, time: number): void {
    const { gl } = this;
    const w = Math.round(target.width * SUPERSAMPLE);
    const h = Math.round(target.height * SUPERSAMPLE);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const scale = Math.min(w / DESIGN.w, h / DESIGN.h);
    const u = this.#u;
    gl.uniform2f(u.uRes, w, h);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uR, DESIGN.radius * scale);
    gl.uniform1f(u.uCy, DESIGN.cy);
    gl.uniform1f(u.uEdge, DESIGN.edge);
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
    gl.uniform4f(u.uEyeB, ...look.eyeB);
    gl.uniform1f(u.uAcc, look.acc);
    gl.uniform3f(u.uAccCol, ...look.accCol);
    gl.uniform3f(u.uAccCol2, ...look.accCol2);
    gl.uniform1f(u.uAccTilt, look.accTilt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const ctx = target.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(this.canvas, 0, 0, target.width, target.height);
  }
}

let shared: OrbRenderer | null = null;
export const renderer = (): OrbRenderer => (shared ??= new OrbRenderer());
