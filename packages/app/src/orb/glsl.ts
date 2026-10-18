// The orb, drawn (PLAN 2.1-2.3): Ash's own glass bean, ported from his desktop orb's shader
// (`~/ash/app/orb/shell/index.1.js`, ORB_FS, as of 2026-10-01), so every orb in Orbs is the
// figure the owner shaped: the egg terms and the one soft dent, the liquid that circulates inside
// his glass, the caustics, the rim and the one hard highlight, the soft glow he gives off, and his
// face: two big eyes set low and wide with a sparkle, no mouth, no cheeks (owner, 2026-09-24).
//
// What changed in the port: the instrument rings that were switched off (HOUSING 0) are gone, with
// the helpers only they used; the window geometry his page baked in (where his centre sits, how far
// the glow fades before the window's edge) is now two uniforms, so any canvas can hold him. Every
// comment in the body is his, with its date: they say why each term is there.
import { PITCH } from "./hats/geo.ts";

export const ORB_VS = `#version 300 es
void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position = vec4(p*2.0-1.0,0,1); }`;

export const ORB_FS = `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 uRes; uniform float uTime, uLevel, uState, uWake, uR;
uniform float uCy, uEdge;     // his centre (a fraction of the height, from the top) and the edge fade (in radii)
uniform float uBreath, uBlink, uMorph; uniform vec2 uGaze, uSway;
uniform float uHappy, uSleepy, uYawn, uSurprise, uTilt;   // his mood, from orblife.js: the face wears it
uniform float uMad;          // poked too much: brows down, eyes narrowed (cute, not cross)
uniform float uJiggle;       // settle wobble: a decaying squash-stretch he does as he stops talking
uniform float uHue;          // whole-palette hue rotation, in turns
// MORE COLOURS (owner, 2026-09-24: "add more colors, like black, grey, maybe some gradients"):
// uSat 1 = his colours, 0 = grey; uVal 1 = his glass, lower = darker glass (black is 0.4);
// uHue2/uGrad: a second hue blended in from top to bottom (a gradient orb).
uniform float uSat, uVal, uHue2, uGrad;
// BEAN (owner, 2026-09-24: "cuter … a little more bean shaped"). The egg, softened toward baby
// proportions: a chubbier waist, a rounder top (a big soft head), the weight sitting low, and one
// gentle dent in his side. Was 0.255 / 0.190 / 0.800 with no dent.
// ORBS (PLAN 2.2): the egg's terms are now the CHARACTER's, set per orb by spec.ts. Ash's bean is
// the default and keeps his numbers exactly: tall 0.200 (how much narrower the waist is than the
// poles), taper 0.110 (the top narrower than the bottom), grow 0.050 (a little height back),
// belly 0.950 (a fatter bottom), dent 0.030 (the one soft dent low on his right), scale 0.905.
// The other terms make the other shapes: wide (a pebble), point (a drop's tip), bumps (a cloud's
// puffs), ears (round or pointed, either side of the top), wave (a ghost's hem).
uniform vec4 uShapeA;   // tall, taper, grow, belly
uniform vec4 uShapeB;   // dent, wide, point, wave
uniform vec4 uShapeC;   // bump count, bump size, ear size, ear spread (radians from the top)
uniform vec4 uShapeD;   // ear width (radians), scale, hem frequency, a tip at the bottom (a heart)
uniform vec4 uShapeE;   // squircle (the corners filled out), a notch at the top (a heart), lopsided (a blob), -
uniform vec4 uShapeF;   // points (5 a star, 3 an onigiri), how far they reach, how sharp, -
uniform float uGoo;     // how soft he is: 0 is Ash's glass, 1 is jelly (owner, 2026-10-01: "more gooey")
uniform float uSolid;   // 1: his glass lets nothing behind it through (the floors; owner, 10-18: "they look a bit like ghosts")
uniform float uSquash;  // squash (+) and stretch (-) for hops and pokes; volume is roughly kept
uniform vec4 uEyeA;     // radius, aspect (1 round, >1 tall ovals), gap, height
uniform vec4 uEyeB;     // sparkle (0..1), lids at rest (0 open .. 1 shut), happy at rest, a wink (his left eye an arc)
uniform float uEyeX;    // 1: each eye an X (spec.ts EYES cross; owner, 10-10: "X X 's as eyes")
uniform float uAccTilt; // his hat (spec.ts HATS, drawn by HAT_VS and HAT_FS) is worn at a slant, radians
uniform vec2 uAccFit;   // how it fits his shape (spec.ts hatFit): the outline his head's top is taken at, and the hat's size
uniform vec4 uAccGlow;  // what on it gives off light (hats/models.ts glowOf): its centre, and a bead's radius or a ring's two
uniform float uAccGlowK;// 0 nothing, 1 a bead, 2 a ring
uniform vec3 uAccGlowCol;
uniform float uAccEdge[32]; // its lowest edge across it (x from -0.9 to 0.9, in the hat's units, +y down; -9 none there)
uniform float uAccShade;    // how dark the shadow it casts on him (0: no hat, or one that is only light)
// Waking: he SWELLS and LIGHTS UP (the instrument rings that once unfurled are gone).
const float AWAKE_GROW  = 0.13;   // how much bigger he is awake than idle
const float WAKE_POP    = 0.06;   // the extra swell on the moment of waking, which then settles
const float AWAKE_LIGHT = 0.30;   // how much brighter his glow runs when awake
uniform float uTint;         // colour preview: the orb is greyscale at idle, so picking a
                             // colour would show nothing. This borrows the listening weight
                             // for a couple of seconds so the choice is actually visible.

// Ash's palette. arc = brushed steel, rooted = the measured terminal greys.
// rooted's rule holds: the only channel is BRIGHTNESS. The reference gets its
// two-tone body from hue (blue above the fold, magenta below); with no hue to
// spend, the upper half runs COOLER AND DARKER and the lower half LIGHTER, so
// the fold still reads as a boundary between two different materials.
const vec3 PALE = vec3(0.760,0.768,0.784);   // #C2C2C4  rooted glyph core
const vec3 LITE = vec3(0.596,0.639,0.686);   // #98A3AF  steel highlight, pulled down
const vec3 MIDS = vec3(0.373,0.416,0.467);   // #5F6A77  steel mid
const vec3 DEEP = vec3(0.145,0.169,0.204);   // #252B34  steel shadow
const vec3 DARK = vec3(0.055,0.063,0.078);   // #0E1014  near rooted ground
const vec3 ASHG = vec3(0.494,0.494,0.506);   // #7E7E81  rooted ramp, NEUTRAL
const vec3 ASHD = vec3(0.373,0.373,0.380);   // #5F5F61  rooted ramp, neutral dark
const vec3 AMB  = vec3(0.749,0.545,0.286);

// Voice colour. Idle stays in the greys above. Listening, thinking and speaking
// light the body with soft "colourful greys": nine hues 40 degrees apart that
// divide the whole wheel evenly, three per state, so every set sits in harmony
// with the others. Speaking is the Siri side (blue, violet, magenta), thinking the
// cool half (green, teal, cyan), listening the warm third (rose, amber, gold).
// HLS lightness 0.66, saturation 0.55: tinted light, not paint.
const vec3 SPK0 = vec3(0.473,0.504,0.847);   // 235  #7880D7
const vec3 SPK1 = vec3(0.691,0.473,0.847);   // 275  #B078D7
const vec3 SPK2 = vec3(0.847,0.473,0.753);   // 315  #D778C0
const vec3 THK0 = vec3(0.504,0.847,0.473);   // 115  #80D778
const vec3 THK1 = vec3(0.473,0.847,0.691);   // 155  #78D7B0
const vec3 THK2 = vec3(0.473,0.754,0.847);   // 195  #78C0D7
const vec3 LST0 = vec3(0.847,0.473,0.504);   // 355  #D77880
const vec3 LST1 = vec3(0.847,0.691,0.473);   //  35  #D7B078
const vec3 LST2 = vec3(0.754,0.847,0.473);   //  75  #C0D778
// A rotation about the grey axis: hue moves, brightness and saturation do not,
// so the "tinted light, not paint" rule survives any setting. The palette is
// built on 40-degree spacing, so a 40-degree step lands each hue exactly on the
// next slot of the same harmony rather than inventing a new one.
vec3 hueRot(vec3 c, float turns){
  if (turns == 0.0) return c;
  float a = turns*6.2831853, ca = cos(a), sa = sin(a);
  vec3 k = vec3(0.5773503);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
float gGrad = 0.0;   // how far down the gradient this pixel is; set at the top of main()
vec3 pal3(vec3 a, vec3 b, vec3 c, float x){   // a closed loop a->b->c->a, so the flow never hits a seam
  x = fract(x)*3.0;
  vec3 r = x < 1.0 ? mix(a, b, smoothstep(0.0,1.0,x))
         : x < 2.0 ? mix(b, c, smoothstep(0.0,1.0,x-1.0))
         :           mix(c, a, smoothstep(0.0,1.0,x-2.0));
  // every palette lookup goes through here, so one call recolours the orb: the hue (blending to the
  // second hue down his body when he is a gradient), then how much colour there is at all
  vec3 o = hueRot(r, uHue + (uHue2 - uHue)*gGrad);
  return mix(vec3(dot(o, vec3(0.299, 0.587, 0.114))), o, uSat);
}

#define TAU 6.2831853

float h1(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vn(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h1(i),h1(i+vec2(1,0)),f.x), mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){ float s=0.,a=.5; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=.5; } return s; }
// Ridged noise: the ridges are where the noise crosses its own midline, so a high
// power leaves THIN bright filaments rather than blobs - that is what makes a
// plasma arc read as an arc. Used only for the weather inside him.
// NO POW OF A BASE THAT CAN DIP BELOW ZERO (owner, 10-04: a black line through every hat). GLSL
// leaves pow undefined there and a GPU makes it NaN, painted black; on his card |N.y| rounds a
// hair past 1 at the top of his head. A square is sq(), and every other base is clamped.
float sq(float x){ return x*x; }
float galRidge(vec2 p){ float n = fbm(p); return pow(max(0.0, 1.0 - abs(2.0*n - 1.0)), 6.0); }

// The character's silhouette: how far in or out of the circle he is at this angle (0 is the top's
// -PI/2: p.y is flipped so +y is down the screen). Ash's egg, then the other shapes' terms.
float shapeR(float a){
  float s = sin(a), c = cos(a);
  float top = -1.5707963;
  float upward = -s;                                           // +1 at the top
  float belly = 0.5 - 0.5*upward;                              // 0 at the top, 1 at the bottom
  float r = uShapeA.z + uShapeA.x*(1.0 - uShapeA.w*belly)*(s*s - 1.0) - uShapeA.y*(0.5 + 0.5*upward);
  r -= uShapeB.x*exp(-sq((a - 0.35)/0.55));               // Ash's dent
  r += uShapeB.y*(c*c - 0.5);                                  // wider than tall
  r += uShapeB.z*pow(max(0.0, upward), 9.0);                   // a drop's tip
  r += uShapeB.w*sin(uShapeD.z*a)*pow(max(0.0, s), 2.0);       // a ghost's hem (or a drip's), on the lower half only
  r += uShapeD.w*pow(max(0.0, s), 9.0);                        // a tip at the bottom
  r += uShapeE.x*0.5*(1.0 - cos(4.0*a));                       // squircle: the corners filled out
  r -= uShapeE.y*exp(-sq((a - top)/0.20));               // a notch at the top
  r += uShapeE.z*(0.6*sin(a + 0.8) + 0.4*sin(3.0*a + 2.1));    // lopsided, for good
  if (uShapeF.x > 0.5) r += uShapeF.y*pow(max(0.0, cos(uShapeF.x*(a - top))), uShapeF.z);   // points, one straight up
  r += uShapeC.y*(abs(sin(0.5*uShapeC.x*a + 0.3)) - 0.64);      // a cloud's puffs: round tops, a dip between each
  r += uShapeC.z*(exp(-sq((a - top - uShapeC.w)/uShapeD.x)) + exp(-sq((a - top + uShapeC.w)/uShapeD.x)));
  return r;
}
// ---- what he wears (PLAN 2.2) -----------------------------------------------------------------
// Shapes by distance (negative inside), in units of his radius, from the top of his head, +y down.
// Each returns (distance, part): part 0 is the hat, 1 its second colour, 2 a light of his own.
float sdBox(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
float sdCap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba)/dot(ba, ba), 0.0, 1.0); return length(pa - ba*h) - r; }
float sdEll(vec2 p, vec2 ab){ return (length(p/ab) - 1.0)*min(ab.x, ab.y); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c){
  vec2 e0 = b - a, e1 = c - b, e2 = a - c, v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0*clamp(dot(v0, e0)/dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1*clamp(dot(v1, e1)/dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2*clamp(dot(v2, e2)/dot(e2, e2), 0.0, 1.0);
  float sg = sign(e0.x*e2.y - e0.y*e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), sg*(v0.x*e0.y - v0.y*e0.x)), vec2(dot(pq1, pq1), sg*(v1.x*e1.y - v1.y*e1.x))),
               vec2(dot(pq2, pq2), sg*(v2.x*e2.y - v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);
}
vec2 pick(vec2 a, vec2 b){ return a.x < b.x ? a : b; }   // the nearer of two parts
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }

void main(){
  vec2 p = gl_FragCoord.xy - uRes*0.5; p.y = -p.y;
  p.y += uRes.y*(0.5 - uCy);   // his centre, as a fraction of the height from the top
  p -= uSway;                   // weight shift: the whole body settles
  float d = length(p); float R = uR;
  // top of him is the first hue, bottom the second, with a slow drift so the seam never sits still
  gGrad = uGrad * clamp(0.5 + 0.5*p.y/(uR*1.15) + 0.08*sin(uTime*0.3), 0.0, 1.0);

  float listen=clamp(1.0-abs(uState-1.0),0.,1.);
  float think =clamp(1.0-abs(uState-2.0),0.,1.);
  float speak =clamp(1.0-abs(uState-3.0),0.,1.);
  float awake =clamp(uState,0.,1.);
  float t = uTime;

  // how hard the liquid moves. dormant still drifts - a still orb looks dead
  float rate = 0.85 + 1.05*awake + 1.40*think + 1.0*uLevel*speak;

  float br    = uBreath;                               // irregular, from JS
  float ph    = t * 0.6;
  float depth = 0.055 - 0.020*think + 0.030*uLevel*speak;
  float breath = 1.0 + br * depth;
  // He grows as he wakes and swells a little further on the moment itself, then settles.
  float wakeEase = clamp(uState, 0.0, 1.0); wakeEase = wakeEase*wakeEase*(3.0 - 2.0*wakeEase);
  float Rg = R * breath * (1.0 + AWAKE_GROW*wakeEase + WAKE_POP*uWake);
  float amp  = 1.00 + 0.35*think + 0.45*uLevel*speak;

  vec3 col = vec3(0.0); float A = 0.0;

  // ---- the body's shape ----------------------------------------------------
  // A rigid circle that only scales reads as a drawing of breath. A body
  // changes SHAPE when it breathes. So the silhouette is a circle plus a few low
  // harmonics whose phases wander on noise (the lobes never repeat), and uMorph
  // (from JS) decides how much of that shows: it drifts on its own, sometimes
  // all the way back to a clean sphere, which is what keeps the sphere reading
  // as HIS shape rather than the only one he has. The housing rings stay rigid.
  float ang0 = atan(p.y, p.x);
  float mt = t*(0.55 + 0.45*think);
  float lobes = sin(2.0*ang0 + mt*0.31 + vn(vec2(mt*0.05, 1.3))*TAU) * (0.030 + 0.014*vn(vec2(mt*0.09, 2.0)))
              + sin(3.0*ang0 - mt*0.23 + vn(vec2(mt*0.04, 7.9))*TAU) * (0.020 + 0.012*vn(vec2(mt*0.08, 5.0)))
              + sin(5.0*ang0 + mt*0.47 + vn(vec2(mt*0.07, 3.1))*TAU) * 0.008*(0.5 + think);
  // an inhale fills one side first and the exhale lets it round off, instead of
  // the whole thing scaling evenly; the side it fills from drifts
  float lung = sin(ang0 - 0.6 + 0.9*sin(mt*0.11)) * br*depth*0.55*(0.30 + 0.70*uMorph);
  // SPEECH WARPS HIM. uLevel is his real voice envelope (ashd sends it with each
  // phrase), so the body moves on his syllables: the lobes are driven far past
  // their resting size, two ripple trains run round the rim in opposite
  // directions, and every syllable squeezes the whole body in a little.
  float talk = speak*uLevel;
  // Speech reads as a WAVE, not a warp (user, 2026-09-14: "the way he warps when
  // he talks, it's too much, it should be like a wave"). The lobe bulging and the
  // whole-body squash-stretch are the dramatic part and are pulled WAY down; the
  // travelling ripple trains round the rim - which are the actual wave - are kept
  // and the leading one lifted, so what's left is an undulation running over him
  // rather than the body ballooning and squeezing.
  float lobeAmt = uMorph*(1.0 + 2.2*uGoo) + speak*(0.55 + 1.15*uLevel);   // softer, the more he wobbles
  // ORGANIC TALK (owner, 2026-09-25: "we love the organic movements he makes in idle, can we
  // incorporate that to his speaking animations so it looks more realistic?"). The ripples ran
  // at fixed rates (5.5, 3.7, 8.0) and the squash below at 6.3 and 4.1, so whatever his voice
  // did, the body under it kept a metronome's time. Their phases now wander on the same noise
  // his idle lobes drift on, and how strongly he ripples drifts from phrase to phrase, so no
  // two sentences move alike.
  float wv1 = 5.0*vn(vec2(t*0.21, 17.0)), wv2 = 5.0*vn(vec2(t*0.17, 23.0)), wv3 = 4.0*vn(vec2(t*0.29, 31.0));
  float rAmt = 0.70 + 0.55*vn(vec2(t*0.13, 41.0));
  float ripple = (sin(7.0*ang0 - t*5.5 + wv1)*0.044 + sin(4.0*ang0 + t*3.7 + 1.1 + wv2)*0.030
                + sin(11.0*ang0 - t*8.0 + 2.3 + wv3)*0.012) * talk * rAmt;
  float def = lobeAmt*lobes + ripple - 0.022*talk*(1.0 + sin(3.0*ang0 + t*2.1));
  // a gentle squash on both axes, kept small so it supports the wave instead of
  // becoming the motion: cos(2a) trades width for height, sin(2a) the diagonals.
  def += talk*(0.030*sin(t*6.3 + 4.0*vn(vec2(t*0.23, 53.0)))*cos(2.0*ang0)
             + 0.018*sin(t*4.1 + 1.0 + 4.0*vn(vec2(t*0.19, 59.0)))*sin(2.0*ang0));
  // SETTLE JIGGLE (user, 2026-09-14: "make him jiggly going back into idle"). When
  // he stops talking, uJiggle is a decaying oscillation from JS; it drives a
  // squash-stretch (2-lobe traded with a 4-lobe) so the whole body wobbles like
  // jelly and rings down over ~1.5 s. Self-driven, so it runs while speak is 0.
  def += uJiggle * (0.060*cos(2.0*ang0) + 0.028*cos(4.0*ang0 + 0.6)) * (1.0 + 1.2*uGoo);
  // GOO (owner, 2026-10-01): a slow, syrupy wave that runs round him whatever he is doing
  def += uGoo*(0.030*sin(2.0*ang0 + t*0.85 + 2.5*vn(vec2(t*0.11, 61.0))) + 0.016*sin(3.0*ang0 - t*0.6 + 2.0*vn(vec2(t*0.09, 67.0))));
  // outward is soft-capped so a bulge can never reach the gauge ring; inward is
  // free, so the big movement reads as the body squeezing, not spilling
  float cap = 0.06*(1.0 + 0.8*uGoo);
  def = def > 0.0 ? cap*tanh(def/cap) : def;
  // EGG. He is a little taller than wide, and a touch narrower at the top than the
  // bottom - the shape of an egg standing up. Both terms only ever pull the outline
  // IN: the poles stay at Rg at most, because the gauge ring sits at 1.09R and a
  // bulge that reaches it reads as a collision rather than a shape. p.y was flipped
  // at the top of main(), so the top of the screen is where sin(ang0) is -1.
  float upward = -sin(ang0);                                  // +1 at the top
  // The waist is pulled in far less low down than high up, so the widest point sits BELOW
  // the middle and the base carries the weight - the difference between an oval and an egg.
  float belly = 0.5 - 0.5*upward;                              // 0 at the top, 1 at the bottom
  float egg = shapeR(ang0);                                     // the character's shape (Ash's egg by default)
  float Rs = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + def + lung + egg);
  Rs *= 1.0 + 0.5*uSquash*cos(2.0*ang0);                        // squash: wider and shorter; stretch: the reverse
  // warp space so the deformed outline maps back onto the unit disk: the fluid,
  // rim light and eye all bend WITH the body instead of being cut by it
  vec2  pb = p*(Rg/Rs);
  float db = length(pb);
  float nd = db/Rg;

  if (nd < 1.04) {
    float z = sqrt(max(0.0, 1.0 - min(nd,1.0)*min(nd,1.0)));
    vec3  N = vec3(pb/Rg, z);

    // ---- internal flow -----------------------------------------------------
    // y compressed so the noise organises into HORIZONTAL strata, which is what
    // makes it read as liquid settling under gravity rather than fog.
    vec2 fp = vec2(N.x*1.05 + N.z*0.30, N.y*2.70);
    // he leans toward what he is looking at: the fluid shifts, the glass does
    // not, so it reads as something moving INSIDE a fixed shell
    vec2 lean = uGaze * 0.30;

    // A slow differential swirl (user, 2026-09-14: "almost mesmerizing"). The
    // currents circulate rather than drift, and the inner body turns a touch
    // slower than the rim, so the layers shear past one another - the hypnotic
    // part of real fluid. Low amplitude and radius-eased, so it never becomes a
    // pinwheel: it is a bias on the domain-warp coordinate, not a hard rotation.
    float rr0 = clamp(length(N.xy), 0.0, 1.0);
    float ang = t*0.028*rate + rr0*0.9;
    vec2  sw  = vec2(-fp.y, fp.x) * (0.07 + 0.05*rr0) * sin(ang);
    fp += sw;

    // domain warp: the field advects itself. This is the whole trick - it is
    // what turns noise into something that looks like it is FLOWING.
    vec2 w1 = vec2(fbm(fp*1.25 + vec2(t*0.085*rate, 0.0)),
                   fbm(fp*1.25 + vec2(4.7, -t*0.062*rate)));
    vec2 w2 = vec2(fbm(fp*2.60 + w1*1.30 + vec2(-t*0.048*rate, t*0.031*rate)),
                   fbm(fp*2.60 + w1*1.30 + vec2(9.1, t*0.044*rate)));
    float flow = fbm(fp*1.85 + w1*1.45 + w2*0.55 + vec2(t*0.075*rate, 0.0));
    flow = clamp((flow-0.5)*amp + 0.5, 0.0, 1.0);

    // ---- wave trains -------------------------------------------------------
    // Each train is a sine in a direction, phase-advanced by time and
    // displaced by the flow field, so the crests bend around the currents
    // rather than sliding over them.
    vec2 wq = fp + (w1 - 0.5)*1.15 + (w2 - 0.5)*0.55;
    float wv = 0.0;
    wv += sin(dot(wq, vec2( 1.70, 0.76)) - t*1.00*rate) * 0.52;
    wv += sin(dot(wq, vec2(-1.12, 1.55)) + t*0.74*rate + 1.7) * 0.34;
    wv += sin(dot(wq, vec2( 2.85,-0.42)) - t*1.34*rate + 3.1) * 0.20;
    wv /= 1.06;

    // crest lines: thin bright where the wave peaks, and a broader swell
    float cw = fwidth(wv)*1.6 + 0.012;
    float crest = pow(smoothstep(0.52-cw, 0.52+cw*2.6, wv), 1.8);
    float swell = wv*0.5 + 0.5;

    // waves modulate the body slightly so the volume itself undulates
    flow = clamp(flow + (swell-0.5)*0.26, 0.0, 1.0);

    // ---- the equatorial fold ----------------------------------------------
    // The reference's defining feature: a soft seam across the middle, warped
    // by the flow, with a thin bright caustic riding its crest.
    float seam = N.y + (flow-0.5)*0.42 + 0.06*sin(N.x*2.6 + t*0.5*rate);
    float fold = exp(-abs(seam)*7.5);
    float caustic = pow(exp(-abs(seam)*26.0), 1.4);
    // secondary caustic threads through the body
    float ridge = 1.0 - abs(flow*2.0 - 1.0);
    float threads = pow(smoothstep(0.80, 1.0, ridge), 2.2);

    // ---- caustic veins (ref 2) --------------------------------------------
    // Light lines drawn along ISO-CONTOURS of the warped field. Because the
    // domain is warped, the contours bend into lens/cell shapes and drift with
    // the flow - which is what refraction through moving glass actually looks
    // like. Width is kept in field-space so they stay hairline at any radius.
    float fw = fwidth(flow) * 3.0 + 1e-4;
    float veins = 0.0;
    for (int k = 0; k < 2; k++) {
      float n = 1.8 + float(k)*2.0;                  // two contour densities
      float band = abs(fract(flow*n + float(k)*0.37) - 0.5) / (fw*n);
      veins += (1.0 - smoothstep(0.30, 1.40, band)) * (1.0 - float(k)*0.30);
    }
    veins = clamp(veins, 0.0, 1.6);
    // veins are brightest where the body is saturated, not on the pale poles
    float veinMask = pow(max(0.0, 1.0 - abs(N.y)), 1.1) * (0.55 + 0.45*z);
    // (scaled by core below so veins stay inside the fluid)

    // ---- pearlescent structure --------------------------------------------
    float belt  = pow(max(0.0, 1.0 - abs(N.y)), 1.35);          // chroma lives at the equator
    float upper = smoothstep(-0.05, 0.55, seam);      // above the fold
    float lower = 1.0 - upper;

    // two materials, differentiated by brightness not hue
    vec3 above = mix(MIDS, DARK, 0.30 + 0.66*flow);
    vec3 below = mix(LITE, DEEP, 0.22 + 0.72*(1.0-flow));
    vec3 fluid = mix(below, above, upper);

    // ---- voice colour ----------------------------------------------------------
    // which hue sits where rides the flow and turns slowly round the body, so the
    // colours move like light through the fluid instead of sitting in bands
    float hsel = flow*1.35 + ang0/TAU*0.60 + t*0.040*rate;
    float ws = clamp(speak*(0.50 + 0.80*uLevel), 0.0, 1.0);         // brightens with his voice
    float wt = clamp(think*(0.62 + 0.22*sin(t*1.25)), 0.0, 1.0);    // breathes while he thinks
    float wl = clamp(listen*(0.48 + 0.40*uLevel), 0.0, 1.0);        // warms as it hears
    // uTint fills in ONLY the colour the states are not already providing, so a
    // held colour never muddies speaking or thinking - it just stops him going
    // grey when nothing is lighting him.
    wl = max(wl, uTint * (1.0 - clamp(ws + wt + wl, 0.0, 1.0)));
    float vcw = clamp(ws + wt + wl, 0.0, 1.0);
    vec3 hue = (pal3(SPK0,SPK1,SPK2, hsel)*ws + pal3(THK0,THK1,THK2, hsel)*wt + pal3(LST0,LST1,LST2, hsel)*wl)
             / max(ws + wt + wl, 1e-3);
    vec3 hueRim = (pal3(SPK0,SPK1,SPK2, ang0/TAU + t*0.06)*ws + pal3(THK0,THK1,THK2, ang0/TAU - t*0.05)*wt
                 + pal3(LST0,LST1,LST2, ang0/TAU + t*0.035)*wl) / max(ws + wt + wl, 1e-3);
    vec3 LIGHT = mix(PALE, hue*1.25, vcw);                   // what the highlights are made of
    // the greys pick up the tint without losing their brightness structure
    fluid = mix(fluid, fluid*(0.45 + hue*1.10), vcw*0.80);
    // neutral sediment: a stratum that drifts at its own rate and does not
    // share the steel's blue cast
    float sed = smoothstep(0.34, 0.86, fbm(fp*1.15 + vec2(t*0.031*rate, -t*0.019*rate) + 21.7));
    sed *= smoothstep(0.95, 0.30, abs(N.y + (flow-0.5)*0.55));
    fluid = mix(fluid, mix(ASHD, ASHG, flow), sed*0.52);

    // ---- the glass shell (ref 3) ------------------------------------------
    // Frosted, near-white, very slightly cool. The fluid is CONFINED to a soft
    // blob in the middle - its edge wobbles with the flow so it never reads as
    // a circle pasted on top.
    vec3 glass = mix(mix(LITE, MIDS, 0.42), DEEP, 0.30 + 0.34*flow);
    glass = mix(glass, ASHG, 0.18 + 0.20*flow);
    glass = mix(glass, glass*(0.50 + hue*0.95), vcw*0.55);        // the shell carries the colour too
    vec2  gp   = pb/Rg - lean;                   // core displaced toward the gaze
    float gd   = length(gp);
    float core = smoothstep(0.86, 0.10, gd + (flow-0.5)*0.30 - 0.10*z);
    // the blink: a slow contraction, not a shutter
    core *= 1.0 - uBlink*0.55;
    core *= 0.92 + 0.08*sin(t*0.7);
    core *= 1.0 + 0.10*sin(ph - 0.55);       // fluid lags the shell
    vec3 body = mix(glass, fluid, clamp(core,0.0,1.0));
    body *= uVal;   // darker glass for a black orb; the light added below is scaled to it before the face
    vec3 litBase = body;

    // poles and edge wash further toward white: subsurface, lit from behind
    float wash = pow(max(0.0, 1.0 - belt), 1.45);
    body = mix(body, mix(MIDS, LIGHT, 0.55), clamp(wash*0.50, 0.0, 1.0));

    // rim light - a bright halo just inside the silhouette
    float rim = pow(max(0.0, 1.0 - z), 3.4);
    body = mix(body, mix(LITE, LIGHT, 0.60), clamp(rim*0.80, 0.0, 1.0));

    // caustics on top
    body += LITE * fold * core * (0.12 + 0.16*awake);
    body += LIGHT * caustic * (0.14 + 0.34*core) * (0.22 + 0.24*awake + 0.42*uLevel*speak + 0.20*wt);
    body += LIGHT * threads * belt * core * (0.10 + 0.14*awake + 0.18*vcw);

    // ---- weather inside him -------------------------------------------------
    // Electric cloud in a shell: a slow nebula, a scatter of stars turning with it,
    // and filaments that spark across the cloud and die. All three are multiplied by
    // core, so they stay inside the fluid and never touch the glass. Kept quiet on
    // purpose - at rest it should read as depth, and only really show when he talks.
    {
      vec2  gq   = pb/Rg;
      float spin = t*0.035*rate;
      vec2  gsw  = vec2(cos(spin), sin(spin));                  // the whole field turns slowly
      vec2  gr   = vec2(gq.x*gsw.x - gq.y*gsw.y, gq.x*gsw.y + gq.y*gsw.x);
      // nebula: two scales differenced, so it has wisps and voids instead of even fog
      // one fbm plus one cheap octave, not two fbms: this runs per pixel per sample on an
      // RX 580 that has dropped off the bus under sustained load before.
      float neb  = fbm(gr*2.6 + vec2(t*0.021, -t*0.014))
                 - vn(gr*5.1 - vec2(t*0.013,  t*0.017))*0.55;
      neb = smoothstep(0.10, 0.62, neb) * (0.45 + 0.55*z);       // fades toward the silhouette
      // stars: a sparse scatter, each twinkling at its own rate
      vec2  cell = floor(gr*26.0);
      float star = step(0.955, h1(cell)) * smoothstep(0.42, 0.98, 1.0 - length(fract(gr*26.0) - 0.5)*2.0);
      star *= 0.55 + 0.45*sin(t*(1.6 + 3.2*h1(cell + 4.1)) + h1(cell)*TAU);
      // arcs: filaments that crawl, with a flicker envelope so they spark rather than glow
      float arc  = galRidge(gr*3.4 + vec2(t*0.10, -t*0.07));
      arc *= 0.35 + 0.65*max(0.0, sin(t*2.3 + vn(gr*1.7)*TAU));
      float amt = core * (0.55 + 0.45*vcw);
      body += mix(LIGHT, hue, 0.55) * neb  * amt * (0.10 + 0.05*awake + 0.16*uLevel*speak);
      body += PALE                  * star * amt * (0.22 + 0.30*uLevel*speak);
      body += mix(PALE, LIGHT, 0.4) * arc  * amt * (0.05 + 0.04*awake + 0.22*uLevel*speak);
    }
    // ---- what hangs in him (owner, 10-04: "add a little more detail into the actual orbs material, jst a
    // bit more. on the inside as well") ---------------------------------------------------------------
    // Tiny bubbles caught in the fluid, rising slowly and wandering as they go, at two depths (the far
    // ones smaller, fainter, bent less by the glass): each a thin skin lit on its upper-left with a pin
    // of light, which is how a thick liquid shows it is one. The fluid's own surface catches the light
    // where it faces it, a soft line inside the glass, and the glass itself has a faint grain, as blown
    // glass does. All of it quiet; at a small size the bubbles fade out rather than fizz.
    {
      vec2 bq = pb/Rg - lean*0.5;
      vec2 up = normalize(vec2(-0.48, -0.88));                 // toward the light (+y is down)
      float bub = 0.0, pin = 0.0;
      for (int k = 0; k < 2; k++) {
        float fk = float(k);
        float sc = mix(3.6, 6.0, fk);                          // near, then far
        vec2 bp = bq*(1.0 + 0.16*fk*(1.0 - z))*sc + vec2(fk*3.7, t*(0.10 - 0.035*fk)*rate);   // rising
        vec2 id = floor(bp);
        float hs = h1(id + 17.0*fk);
        if (hs > 0.78) {
          vec2 c = vec2(h1(id + 3.1), h1(id + 8.7))*0.3 + 0.35;
          c.x += 0.06*sin(t*0.6*rate + hs*TAU);
          float r = mix(0.11, 0.24, h1(id + 5.3))*(1.0 - 0.30*fk);
          vec2 v = fract(bp) - c;
          float d = length(v);
          float aa = fwidth(d)*1.2 + 1e-3;
          float skin = smoothstep(aa, 0.0, abs(d - r) - r*0.20);
          float lit = clamp(0.30 + 0.70*dot(v/max(d, 1e-4), up), 0.0, 1.0);
          float w = 1.0 - 0.45*fk;
          bub += (skin*lit + smoothstep(r, r*0.7, d)*0.30)*w;     // its skin, and the light it holds
          pin += smoothstep(r*0.34, r*0.10, length(v - up*r*0.52))*w;
        }
      }
      float big = smoothstep(26.0, 60.0, Rg);                  // too small to see, they would only fizz
      body += mix(PALE, LIGHT, 0.5) * (bub*0.40 + pin*0.70) * core * big * (1.0 - uBlink*0.6);
      // the fluid's surface, lit where it faces the light
      float cb = abs(core - 0.32)/(fwidth(core) + 1e-4);
      float face = pow(clamp(dot(normalize(gp + 1e-4), up), 0.0, 1.0), 1.6);
      body += mix(LITE, LIGHT, 0.5) * (1.0 - smoothstep(1.5, 5.0, cb)) * face * 0.07;
      // and, lower down and away from the light, the fluid is deeper, so a touch darker
      body *= 1.0 - 0.07*core*clamp(-dot(normalize(gp + 1e-4), up), 0.0, 1.0)*smoothstep(0.15, 0.6, gd);
      // the grain of the glass, held to his body so it moves with him; mostly on the shell
      body *= 1.0 + (vn(pb/Rg*46.0) - 0.5)*0.06*(1.0 - 0.7*clamp(core, 0.0, 1.0));
    }
    // the veins, and a soft halo under them so they read as light in a volume
    // ---- the face (owner, 2026-09-24: "cuter … almost like a pet, tamagotchi like") --------
    // It replaces the faint pupil that came and went. What reads as cute is well measured
    // (Lorenz's Kindchenschema; Glocker et al. 2009): big eyes set LOW and WIDE on a round face,
    // big eyes. So: two round eyes with a two-point sparkle, and nothing else — the cheeks and the
    // mouth came off on 2026-09-24 — all inside the fluid, bending with the body, looking where he looks. His mood
    // comes from orblife.js: happy closes the eyes into arcs, drowsy lowers the lids, surprise
    // widens them, a yawn lowers his lids, and the head tilt turns the face.
    body += LIGHT * veins * veinMask * core * (0.26 + 0.30*awake + 0.48*uLevel*speak + 0.25*wt) * (1.0-uBlink*0.7);
    // wave crests: hairline highlights, brightest mid-body where the glass is
    // thickest, so they look like light caught on a surface inside the volume
    body += LIGHT * crest * core * veinMask * (0.20 + 0.26*awake + 0.40*uLevel*speak + 0.20*wt) * (1.0-uBlink*0.7);
    body += LITE * pow(max(0.0, crest), 0.5) * core * 0.07;
    // and the swell shades the fluid so it has depth between the crests
    body *= 0.90 + 0.20*mix(0.5, swell, core);
    body += LITE * pow(max(0.0, veins), 0.55) * veinMask * core * 0.12;
    // DARK GLASS STAYS DARK WHEN HE TALKS (owner, 2026-09-25: "dark mode, he becomes too light when
    // speaking, cant rly see his face"). body *= uVal darkened only the glass; every light added
    // after it — the wash, the rim, the caustics, the veins and crests that swell with his voice —
    // came in at full strength, so a Black orb speaking measured a median of 236 of 255, near white,
    // and his light eyes sat on light glass. On dark glass only part of that light gets through.
    // Only while he is awake: at rest the Black orb keeps exactly the look the owner chose.
    body = litBase + (body - litBase) * mix(1.0, mix(0.28, 1.0, smoothstep(0.40, 1.0, uVal)), awake);
    // THE FACE IS DRAWN LAST, over all of it: the veins and crests used to be added after the eyes,
    // so the brighter he spoke, the more light was painted over his face.
    {
      vec2 f = (pb/Rg)/0.94 - uGaze*0.16;
      float cs = cos(uTilt), sn = sin(uTilt);
      f = vec2(cs*f.x - sn*f.y, sn*f.x + cs*f.y);
      float faceA = smoothstep(1.0, 0.78, nd);             // fades at the rim, never cut by it
      float er  = uEyeA.x*(1.0 + 0.20*uSurprise);          // eye radius (Ash's 0.138; 0.125 until 'a tad more cute')
      float k   = er/0.138;                                 // the sparkle scales with the eye
      float lid = clamp(max(uBlink, max(uSleepy, uEyeB.y) + 0.18*uYawn*uSleepy), 0.0, 1.0);
      float lidY = mix(-er*1.08, er*1.08, lid);            // the lid's lower edge (y grows DOWN)
      float eyes = 0.0, shine = 0.0, arcs = 0.0, shut = 0.0;
      // EYES WITH DEPTH (owner, 10-09: "can we do the same thing we did to the hats to the eyes"). Each eye is a glossy
      // dome set into his glass, not a flat disc: dark, with a soft glow of his own colour low in it where the light that
      // went in at its top comes out, a wet sheen and a fine bright rim along its top edge, and a faint shade round it where
      // it is set in. The ^ ^ arcs, the brows and a shut lid's edge are rounded strokes, lit along their upper side. Every
      // style, its sparkle and every mood are as they were.
      float lightEyes = 1.0 - smoothstep(0.45, 0.8, uVal);            // on dark glass his eyes turn light
      vec3 eyeDeep = mix(DARK*0.9, vec3(0.86, 0.90, 0.95), lightEyes);
      vec3 glowC = mix(PALE, hue*1.15, 0.55 + 0.45*vcw);                // his own colour, held even at rest
      vec3 Lf = normalize(vec3(-0.34, -0.62, 0.71));                    // the light his highlight comes from (+y down)
      vec3 domeLit = vec3(0.0);
      float dome = 0.0, socket = 0.0, strokeW = 0.0, strokeS = 0.0;
      for (int i = 0; i < 2; i++) {
        float sx = i == 0 ? -1.0 : 1.0;
        vec2 v = f - vec2(sx*uEyeA.z, uEyeA.w);
        float open = smoothstep(er, er - 0.016, length(v*vec2(1.0, 1.0/uEyeA.y))) * smoothstep(lidY*uEyeA.y - 0.012, lidY*uEyeA.y + 0.012, v.y);
        // mad: the upper lid comes down at the INNER corner (toward his middle), so the eyes narrow
        // into a frown, and a short brow sits above each on the same slant
        float inner = -sx*v.x;
        float cut = -er*0.30 + 0.75*inner;
        open *= mix(1.0, smoothstep(cut - 0.012, cut + 0.012, v.y), uMad);
        float browD = v.y - (-er*1.30 + 0.55*inner);
        float brow = smoothstep(0.024, 0.011, abs(browD)) * step(abs(v.x), er*0.95);
        // X X: where the eye would be open, two rounded strokes crossed (the lids, a blink and mad cut them as they cut
        // an eye), drawn as a stroke is, lit along its upper side; no dome, no sparkle
        if (uEyeX > 0.5) {
          float L = er*0.86;
          vec2 u1 = vec2(0.7071, 0.7071), u2 = vec2(0.7071, -0.7071);
          vec2 p1 = v - clamp(dot(v, u1), -L, L)*u1, p2 = v - clamp(dot(v, u2), -L, L)*u2;
          float d1 = length(p1), d2 = length(p2);
          float cross = smoothstep(0.050, 0.030, min(d1, d2));
          open = cross * smoothstep(lidY - 0.012, lidY + 0.012, v.y) * mix(1.0, smoothstep(cut - 0.012, cut + 0.012, v.y), uMad);
          float xs = d1 < d2 ? dot(p1, vec2(0.7071, -0.7071)) : dot(p2, vec2(-0.7071, -0.7071));
          if (open > strokeW) { strokeW = open; strokeS = clamp(xs/0.022, -1.0, 1.0); }
        }
        eyes  = max(eyes, brow*uMad);
        eyes  = max(eyes, open);
        // the dome: the eye as a unit disc, a cap of a ball lit from his highlight's side
        vec2 e = v*vec2(1.0, 1.0/uEyeA.y)/er;
        float rr = length(e) + 2.0*uEyeX;   // an X has no dome and is not set in
        if (rr < 1.0) {
          vec3 n = normalize(vec3(e*0.9, sqrt(max(0.0, 1.0 - rr*rr*0.81))));
          float low = smoothstep(-0.15, 0.85, dot(e, vec2(0.32, 0.95)))*smoothstep(1.0, 0.4, rr);    // low in it, away from the light
          float sheen = pow(max(0.0, dot(n, normalize(Lf + vec3(0.0, 0.0, 1.0)))), 16.0);
          float rim = smoothstep(0.8, 0.98, rr)*smoothstep(0.15, -0.45, e.y);                         // along its top edge
          vec3 lit = (glowC*low*0.34 + vec3(0.9)*sheen*0.12 + PALE*rim*0.18)*(1.0 - lightEyes)
                   - vec3(0.30)*low*lightEyes + vec3(0.06)*sheen*lightEyes;                            // light eyes: deeper below
          domeLit = mix(domeLit, lit, open);
          dome = max(dome, open);
        }
        socket = max(socket, smoothstep(1.5, 1.02, rr)*step(1.0, rr));
        if (brow*uMad > strokeW) { strokeW = brow*uMad; strokeS = clamp(-browD/0.016, -1.0, 1.0); }
        // the sparkle: one big catchlight up-left and a small one down-right, the same on both eyes
        shine = max(shine, uEyeB.x*open*max(smoothstep(0.052*k, 0.036*k, length(v - vec2(-0.046, -0.050*uEyeA.y)*k)),
                                    smoothstep(0.024*k, 0.012*k, length(v - vec2( 0.044,  0.044*uEyeA.y)*k))));
        // happy: the eye closes into an arc, ^ ^
        float ad = length(v - vec2(0.0, er*0.60)) - er*0.82;
        float arc = smoothstep(0.036, 0.020, abs(ad)) * step(v.y, er*0.25);
        if (arc > arcs) strokeS = mix(strokeS, clamp(ad/0.026, -1.0, 1.0), max(uHappy, uEyeB.z));
        arcs  = max(arcs, arc);
        // shut (asleep, deep in a doze, mid-blink): the lid's edge is a soft closed curve, not nothing
        float cx = clamp(v.x/(er*0.95), -1.0, 1.0);
        float lashD = v.y - (er*0.10 + 0.32*er*(1.0 - cx*cx));
        float lash = smoothstep(0.022, 0.010, abs(lashD)) * step(abs(v.x), er*0.95);
        if (lash > shut) { shut = lash; if (lid > 0.8) strokeS = clamp(-lashD/0.016, -1.0, 1.0); }
      }
      float closed = smoothstep(0.80, 0.97, lid);
      eyes = max(eyes, shut*closed);
      // a wink: the second eye stays open, the first is an arc
      float winkArc = 0.0, winkOpen = 0.0;
      if (uEyeB.w > 0.5) {
        vec2 v0 = f - vec2(-uEyeA.z, uEyeA.w), v1 = f - vec2(uEyeA.z, uEyeA.w);
        float wd = length(v0 - vec2(0.0, er*0.60)) - er*0.82;
        winkArc = smoothstep(0.036, 0.020, abs(wd)) * step(v0.y, er*0.25);
        winkOpen = smoothstep(er, er - 0.016, length(v1*vec2(1.0, 1.0/uEyeA.y))) * (1.0 - uEyeX);   // an X stays an X
        eyes = max(winkOpen, max(winkArc, eyes*step(0.0, f.x)));
        shine *= step(0.0, f.x);
        if (f.x < 0.0) { strokeW = max(strokeW, winkArc); strokeS = clamp(wd/0.026, -1.0, 1.0); }
      }
      float happy = max(uHappy, uEyeB.z);
      float eyeA = mix(eyes, arcs, happy);
      shine *= 1.0 - happy;
      // which is drawn here: the open dome, or a stroke (an arc, a brow, a shut lid's edge)
      float strokes = max(max(strokeW, arcs*happy), shut*closed);
      float asStroke = clamp(strokes/max(dome*(1.0 - happy) + strokes, 1e-3), 0.0, 1.0);
      vec3 strokeLit = (PALE*0.22*max(0.0, strokeS) - vec3(0.02)*max(0.0, -strokeS))*(1.0 - lightEyes) - vec3(0.18)*max(0.0, -strokeS)*lightEyes;
      vec3 eyeC = eyeDeep + mix(domeLit, strokeLit, asStroke);
      // NO MOUTH (owner, 2026-09-24: "dont give the orb a mouth. dark doesnt show it and its cool asf").
      // His eyes carry every mood: the sparkle, ^ ^ when happy, lids for sleepy, wide for surprise,
      // brows for mad. A yawn is his lids and a deep breath now, not an open mouth.
      // No cheeks either (owner, 2026-09-24: "take out the rosy cheeks").
      // where each eye is set into him, his glass a shade deeper (not round the arcs or a shut lid)
      body *= 1.0 - 0.10*socket*(1.0 - happy)*(1.0 - closed)*faceA*(1.0 - lightEyes);
      body = mix(body, eyeC, eyeA*0.92*faceA);
      body = mix(body, vec3(1.0), shine*0.88*faceA);
    }


    // broad specular, upper-left, very soft - glass not metal
    vec3  Ld   = normalize(vec3(-0.34,-0.62,0.71));   // +y is DOWN on screen: this is upper-left
    float spec = pow(max(0.0, dot(N, Ld)), 3.0);
    body += PALE * spec * 0.15;

    // gentle limb darkening so it stays a sphere
    body *= 0.62 + 0.38*z;

    // ---- glass -------------------------------------------------------------------
    // What makes a sphere read as GLASS rather than a lit ball: a hard, tiny
    // highlight (a polished surface mirrors the light source), a Fresnel edge that
    // brightens toward grazing angles, and the light that went through the sphere
    // focusing into a crescent on the far side. The rim picks up the voice colour
    // the way thick glass splits light at its edge.
    float hot = pow(max(0.0, dot(N, Ld)), 90.0);
    body += vec3(1.0) * hot * 0.95;
    body += PALE * pow(max(0.0, dot(N, normalize(vec3(-0.20,-0.48,0.85)))), 22.0) * 0.18;   // soft halo round it
    // a second, smaller glint low on the right: the light that went through him, caught on the way out
    // (owner, 10-04: "a little more detail into the actual orbs material")
    body += PALE * pow(max(0.0, dot(N, normalize(vec3(0.46, 0.58, 0.67)))), 40.0) * 0.42;
    float fres = pow(max(0.0, 1.0 - z), 2.3);
    body += mix(LITE, hueRim*1.15, vcw*0.9) * fres * (0.30 + 0.35*vcw);
    vec2  away = -normalize(Ld.xy);
    float cres = smoothstep(0.10, 0.0, abs(nd - 0.80)) * pow(max(0.0, dot(normalize(pb + 1e-4), away)), 3.0);
    body += mix(PALE, hue*1.2, vcw) * cres * (0.22 + 0.25*vcw);

    float mensc = smoothstep(0.90, 1.0, nd) * smoothstep(1.0, 0.975, nd);
    body += PALE * mensc * (0.30 + 0.10*max(0.0,br));
    body += LITE * mensc * crest * 0.16;

    float edge = smoothstep(1.0, 1.0 - 2.6/Rg, nd);
    // HIS HAT SITS ON HIM (owner, 10-09: hats "to industry standards"). A model on his head, drawn over him by the
    // second pass, casts a soft shadow on his glass just under its lowest edge, so it rests on him rather than being
    // laid over him. uAccEdge is that edge, across the hat (hats/models.ts), in the hat's own units.
    if (uAccShade > 0.0) {
      float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + uAccFit.x)*(1.0 - 0.5*uSquash) - 0.03*Rg;
      float Rhat = Rg*1.35*uAccFit.y;
      vec2 qf = rot((p - vec2(0.0, -Rtop))/Rhat, uAccTilt);
      float fx = clamp((qf.x + 0.9)/1.8*31.0, 0.0, 31.0);
      int i0 = int(floor(fx));
      float lowest = mix(uAccEdge[i0], uAccEdge[min(i0 + 1, 31)], fx - float(i0));
      float below = qf.y - lowest;
      body *= 1.0 - uAccShade*(below > 0.0 ? exp(-below/0.05) : 0.0)*step(-5.0, lowest);
    }
    col += body * edge;
    // thin glass lets what is behind it through; the edge and the fluid do not. On a floor nothing does: a busy room
    // through him read as a ghost walking past (owner, 10-18)
    A = max(A, edge * mix(clamp(0.80 + 0.20*max(fres*1.6, core*0.75) + hot, 0.0, 1.0), 1.0, uSolid));
  }

  // ---- outer glow ---------------------------------------------------------
  // HIS WINDOW IS NEVER SEEN (owner, 10-04: "its shadow kind of gives away the container its in, you
  // see the dark square ... especially when an animation passes through"). What he gives off (this
  // glow, the shadow under him, a waking bloom) reached the window's edge at 10-15% when he listened,
  // talked or hopped, and the edge fade below cut it square. Now it fades to nothing on an oval inside
  // the window, held by the window, not by him, so a hop carries none of it to an edge.
  vec2 qw = gl_FragCoord.xy - uRes*0.5; qw.y = -qw.y; qw.y += uRes.y*(0.5 - uCy);
  vec2 qh = vec2(uRes.x*0.5, qw.y > 0.0 ? uRes.y*(1.0 - uCy) : uRes.y*uCy);
  float room = 1.0 - smoothstep(0.58, 0.96, length(qw/qh));
  float g = exp(-max(0.0, db-Rg) / (Rg*0.30));   // the glow follows the body's shape
  float wsG = clamp(speak*(0.50 + 0.80*uLevel), 0.0, 1.0);
  float wtG = clamp(think*(0.62 + 0.22*sin(t*1.25)), 0.0, 1.0);
  float wlG = clamp(listen*(0.48 + 0.40*uLevel), 0.0, 1.0);
  wlG = max(wlG, uTint * (1.0 - clamp(wsG + wtG + wlG, 0.0, 1.0)));
  float cwGlow = clamp(wsG + wtG + wlG, 0.0, 1.0);
  vec3 hueGlow = (pal3(SPK0,SPK1,SPK2, ang0/TAU + t*0.06)*wsG + pal3(THK0,THK1,THK2, ang0/TAU - t*0.05)*wtG
                + pal3(LST0,LST1,LST2, ang0/TAU + t*0.035)*wlG) / max(wsG + wtG + wlG, 1e-3);
  // his light breathes at rest (owner, 2026-09-23: "a bit more life into the orb") — a slow swell
  // with each breath, gone once he is awake and the state colours take over
  float gp = 0.09 + 0.055*max(0.0, uBreath)*(1.0 - awake) + AWAKE_LIGHT*awake + 0.24*uLevel*(speak+listen) + 0.45*uWake;
  // g is 1 everywhere INSIDE him, so this glow was also laid over his whole body, face included —
  // the main reason a Black orb went near-white when he spoke. Dark glass keeps its glow around
  // him and lets only a little of it over him; his own colours are unchanged.
  float glowIn = mix(mix(0.12, 1.0, smoothstep(0.40, 1.0, uVal)), 1.0, smoothstep(Rg*0.92, Rg*1.04, db));
  // (only the light that comes on with him — awake, hearing, talking — so the resting look is his)
  float gpRest = 0.09 + 0.055*max(0.0, uBreath)*(1.0 - awake);
  col += mix(MIDS, hueGlow, cwGlow) * g * (gpRest + (gp - gpRest + 0.12*cwGlow) * glowIn);
  // (its cover outside him is about half what it was: on a light page it read as a dark cloud, owner 10-04)
  A = max(A, g * gp * 0.40 * room);

  // cast glow beneath, offset down: gives it somewhere to sit
  vec2 sp = vec2(p.x, p.y + Rg*0.62) * vec2(1.0, 1.9);
  float sh = exp(-max(0.0, length(sp)-Rg*0.52) / (Rg*0.34));
  col += DEEP * sh * 0.16;
  A = max(A, sh * 0.09 * room);

  // ---- waking -------------------------------------------------------------
  // Was a hard ring expanding outward - a shockwave, and the most mechanical thing on him.
  // Now he simply blooms: the light he already gives off swells past the body and fades back,
  // carrying whatever colour the state is in rather than a white pulse.
  if (uWake > 0.001) {
    float b = exp(-max(0.0, db - Rg) / (Rg*0.55)) * uWake;
    col += mix(PALE, hueGlow, cwGlow*0.85) * b * 0.55;
    A = max(A, b*0.45*room);
    // and the body itself lifts, so the bloom reads as him brightening, not a light behind him
    col += mix(PALE, hueGlow, cwGlow*0.7) * exp(-db/(Rg*0.9)) * uWake * 0.10;
  }

  // ---- his glasses are models (owner, 10-09: "the same thing we did to the hats to the eyes and the glasses"), drawn
  // over his face by the renderer's second pass (hats/glasses.ts), in the face block's own space
  // ---- his hat's own light -------------------------------------------------------------------------
  // A hat is a model now, drawn over all of him (his ears too, owner 10-03) by the renderer's second pass (HAT_VS,
  // HAT_FS; owner, 10-09: "make them nice, to industry standards"). What on it gives off light, an antenna's bead or a
  // halo, glows past it here, where it sits: the top of his head as his outline has it now (his shape, his drift, a
  // squash), the hat sunk onto it (where it sits and how big it is, per shape: uAccFit).
  if (uAccGlowK > 0.5) {
    float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + uAccFit.x)*(1.0 - 0.5*uSquash) - 0.03*Rg;
    float Rhat = Rg*1.35*uAccFit.y;
    vec2 q = rot((p - vec2(0.0, -Rtop))/Rhat, uAccTilt);         // hats sized to his head, not to his glow
    vec2 g = q - uAccGlow.xy;
    float gd = uAccGlowK < 1.5 ? length(g) - uAccGlow.z : abs(length(g/uAccGlow.zw) - 1.0)*min(uAccGlow.z, uAccGlow.w) - 0.024;
    float gl = exp(-max(0.0, gd)/0.10)*0.55;
    col += uAccGlowCol*gl*0.6; A = max(A, gl*0.5*room);
  }

  col = col/(1.0+col*0.13);
  // THE WINDOW EDGE IS NEVER A LINE (orbgeom.js). The window is cut close to him, so the last
  // faint pixels of a listening glow reach it: fade them out over the final EDGE_FADE radii
  // instead of letting the window clip them square.
  vec2 edg = min(gl_FragCoord.xy, uRes - gl_FragCoord.xy);
  A *= smoothstep(0.0, R*uEdge, min(edg.x, edg.y));
  O = vec4(pow(max(col,0.0), vec3(0.95)), clamp(A,0.0,1.0));
}`;

// ---- the hats, as models (owner, 10-09: "dont cheap out on them. make them nice, to industry standards") ----------
// A hat is a real 3D model now (hats/models.ts), drawn over him after his glass by the renderer's second pass: his head
// first into depth alone (a ball, so what goes round behind him hides), then the hat. It sits where his flat hat sat:
// the vertex shader does the orb shader's own sums for the top of his head (its "his hat, over him"), seen a little
// from above (PITCH), at the hat's slant.
export const HAT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aMat;
uniform vec2 uRes, uSway, uAccFit, uGaze;
uniform float uTime, uLevel, uState, uWake, uR, uCy, uBreath, uMorph, uSquash, uAccTilt, uTilt;
uniform float uFace;   // 1: glasses, in his face's own space (the orb shader's face block); 0: a hat, on his head
uniform vec4 uShapeD;
out vec3 vN, vS, vP;
out vec2 vUV;
out vec4 vMat;
const float AWAKE_GROW = 0.13, WAKE_POP = 0.06, PITCH = ${PITCH};
void main(){
  float think = clamp(1.0 - abs(uState - 2.0), 0.0, 1.0);
  float speak = clamp(1.0 - abs(uState - 3.0), 0.0, 1.0);
  float depth = 0.055 - 0.020*think + 0.030*uLevel*speak;
  float breath = 1.0 + uBreath * depth;
  float wakeEase = clamp(uState, 0.0, 1.0); wakeEase = wakeEase*wakeEase*(3.0 - 2.0*wakeEase);
  float R = uR;
  float Rg = R * breath * (1.0 + AWAKE_GROW*wakeEase + WAKE_POP*uWake);
  float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + uAccFit.x)*(1.0 - 0.5*uSquash) - 0.03*Rg;
  float Rhat = Rg*1.35*uAccFit.y;
  vec3 P = aPos, N = aNrm;
  if (aMat.w > 99.5) {   // it spins about the hat's axis (a propeller): lazily at rest, fast while he thinks
    float a = uTime*(2.2 + 14.0*clamp(1.0 - abs(uState - 2.0), 0.0, 1.0));
    mat2 S = mat2(cos(a), -sin(a), sin(a), cos(a));
    P.xz = S*P.xz; N.xz = S*N.xz;
  }
  float pitch = uFace > 0.5 ? 0.0 : PITCH;                        // glasses are seen face on, a hat a little from above
  float cp = cos(pitch), sp = sin(pitch);
  vec3 C = vec3(P.x, P.y*cp - P.z*sp, P.y*sp + P.z*cp);
  vec3 Cn = vec3(N.x, N.y*cp - N.z*sp, N.y*sp + N.z*cp);
  float turn = uFace > 0.5 ? uTilt : uAccTilt;
  mat2 roll = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
  vec2 Sxy = roll*C.xy;
  vS = vec3(Sxy, C.z);
  vN = vec3(roll*Cn.xy, Cn.z);
  vP = aPos; vUV = aUV; vMat = aMat;
  // his space (+y down, from his centre): a hat on the top of his head, glasses where the orb shader puts his face
  // (its block: (p/Rg)/0.94 less his gaze, turned with his head), so they look where his eyes look
  vec2 pp = uFace > 0.5 ? 0.94*Rg*(vec2(Sxy.x, -Sxy.y) + uGaze*0.16) : vec2(0.0, -Rtop) + Rhat*vec2(Sxy.x, -Sxy.y);
  vec2 fc = vec2(pp.x + uSway.x + uRes.x*0.5, uRes.y*(1.0 - uCy) - uSway.y - pp.y);
  gl_Position = vec4(fc/uRes*2.0 - 1.0, -C.z*0.25, 1.0);
}`;

// What a hat is made of, lit in one small studio: a soft sky, one big softbox up to his left where his glass's own
// highlight comes from, a strip behind to his right for a rim, the floor dark but for his own light coming up from
// under the brim. Physically based (GGX, Fresnel, a clear coat, a fabric's sheen), in linear light, filmic at the end.
// Each material's weave (knit, straw, twill, grosgrain, a party hat's print) is drawn here, from the model's own
// coordinates, and fades before it is finer than a pixel.
export const HAT_FS = `#version 300 es
precision highp float;
in vec3 vN, vS, vP;
in vec2 vUV;
in vec4 vMat;
out vec4 O;
uniform vec3 uCol, uCol2, uOrb;   // the hat's colour (or a frame's), its second, his own light
uniform vec3 uCol3;                // a lens's tint (spec.ts GLASSES lens)
uniform vec3 uPal[10];             // the fixed ones (geo.ts SLOT): gold, steel, cream, ink, leaf, wood, white, fur
uniform float uTime, uState;
const float PI = 3.14159265;
const int FELT = 0, KNIT = 1, FUR = 2, COTTON = 3, STRAW = 4, PLASTIC = 5, METAL = 6, GEM = 7, LEAF = 8, PETAL = 9, SATIN = 10,
  LEATHER = 11, GLOW = 12, HORN = 13, PEARL = 14, FEATHER = 15, TWEED = 16, PAPER = 17, RUBBER = 18, FRUIT = 19, WOOD = 20, GLASS = 21;
float sq(float x){ return x*x; }
vec3 lin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7)))*43758.5453); }
float vn3(vec3 p){
  vec3 i = floor(p), f = fract(p), u = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), u.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), u.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), u.x), u.y), u.z);
}
vec2 gFW;      // how much of the model's coordinates one pixel spans
float gUS;     // the hat's units across one unit of u (round the hat), here

// how much of a pattern of this period (in u, or in the hat's units along v) can be drawn without shimmering
float keepU(float n){ return 1.0 - smoothstep(0.22, 0.5, gFW.x*n); }
float keepV(float period){ return 1.0 - smoothstep(0.22, 0.5, gFW.y/period); }

// ---- the weaves: a height (0 low, 1 high) at a point of the model's coordinates --------------------------------------
float knitH(vec2 uv, float cols){        // stocking stitch: a V of two legs in every column, row on row
  vec2 f = fract(vec2(uv.x*cols, uv.y/0.026)) - 0.5;
  vec2 d = vec2(abs(f.x) - 0.2, f.y + 0.04);
  vec2 a = vec2(0.92*d.x - 0.38*d.y, 0.38*d.x + 0.92*d.y);   // each leg leans out at its top
  return 1.0 - smoothstep(0.5, 1.0, length(a/vec2(0.21, 0.5)));
}
float ribH(vec2 uv, float ribs){         // a ribbed cuff: knit columns standing out of purl ones
  float x = fract(uv.x*ribs), y = fract(uv.y/0.022);
  return smoothstep(0.0, 0.42, x)*smoothstep(1.0, 0.58, x)*(0.8 + 0.2*smoothstep(0.0, 0.5, y)*smoothstep(1.0, 0.5, y));
}
float strawH(vec2 uv, float n){          // plaited straw: rows of chevrons, a groove between rows
  float row = uv.y/0.024, fr = fract(row);
  float c = fract(uv.x*n + 0.5*floor(row) + abs(fr - 0.5)*1.3);
  return smoothstep(0.0, 0.22, c)*smoothstep(1.0, 0.78, c)*smoothstep(0.0, 0.14, fr)*smoothstep(1.0, 0.86, fr);
}
float stitches(float across, float along, float at){   // a row of stitches at a distance from a seam, its dashes along it
  float line = 1.0 - smoothstep(0.0011, 0.0024, abs(abs(across) - at));
  return line*smoothstep(0.08, 0.2, fract(along/0.011))*smoothstep(0.72, 0.6, fract(along/0.011));
}
float heightOf(int kind, vec2 uv, float extra){
  if (kind == KNIT) return extra > 0.0 ? knitH(uv, extra)*keepU(extra) : ribH(uv, -extra)*keepU(-extra);
  if (kind == STRAW) return strawH(uv, extra)*keepU(extra)*keepV(0.024);
  if (kind == SATIN) return (0.5 + 0.5*sin(uv.x*6.2832*360.0))*keepU(360.0)*0.6;   // grosgrain's ribs
  if (kind == COTTON) {
    if (extra > 6.5) return (0.5 + 0.5*cos(uv.x*6.2832*44.0))*keepU(44.0);       // a tassel's threads
    if (abs(extra - 3.0) < 0.5) return vn3(vP*240.0)*0.8 + vn3(vP*90.0)*0.4;      // terry's loops
    float h = 0.5 + 0.5*sin((uv.x*gUS + uv.y)*6.2832/0.0045)*keepV(0.0045)*0.4;   // twill, on the diagonal
    float panels = abs(extra);
    if (abs(extra - 5.0) < 0.5) {   // a brim's rows of stitching, round and round it
      float r = fract(uv.y/0.026) - 0.5;
      h += (1.0 - smoothstep(0.03, 0.09, abs(r)))*smoothstep(0.1, 0.25, fract(uv.x*240.0))*smoothstep(0.75, 0.6, fract(uv.x*240.0))*keepU(240.0)*1.2;
    } else if (panels > 2.5) {      // a cap's panels: a seam between each, a row of stitching either side
      float k = fract(uv.x*panels + 0.5) - 0.5;
      float across = k/panels*gUS;
      h -= (1.0 - smoothstep(0.0, 0.0055, abs(across)))*1.4*keepU(panels*8.0);
      h += stitches(across, uv.y, 0.013)*keepU(panels*30.0)*1.2;
    } else if (extra > 1.5) {       // a peak's rows of stitching, round its edge
      float r = fract(uv.y*8.0 + 0.5) - 0.5;
      float rows = (1.0 - smoothstep(0.012, 0.03, abs(r)))*step(uv.y, 0.6);
      h += rows*smoothstep(0.1, 0.25, fract(uv.x*190.0))*smoothstep(0.75, 0.6, fract(uv.x*190.0))*keepU(190.0)*1.2;
    }
    return h;
  }
  if (kind == FUR) return extra > 0.5 ? vn3(vP*260.0)*0.7 : vn3(vP*170.0)*0.7 + vn3(vP*60.0)*0.3;
  if (kind == FELT) return vn3(vP*230.0)*0.5;
  if (kind == METAL) return vn3(vP*28.0)*0.25;      // hand-beaten, a little
  if (kind == LEAF && extra > 0.5) {                // a leaf's veins: its midrib, and the veins off it
    float mid = 1.0 - smoothstep(0.0, 0.07, abs(uv.x));
    float vein = 1.0 - smoothstep(0.0, 0.06, abs(fract(uv.y*7.0 - abs(uv.x)*1.4) - 0.5) - 0.44);
    return mid*0.9 - vein*0.5*smoothstep(0.08, 0.2, abs(uv.x))*keepV(0.14);
  }
  if (kind == FEATHER) {                            // its barbs, combed out from the shaft
    return (0.5 + 0.5*sin((uv.y*90.0 - abs(uv.x)*7.0)*6.2832))*keepV(0.011)*0.8 + (1.0 - smoothstep(0.0, 0.05, abs(uv.x)))*0.6;
  }
  if (kind == HORN && extra < 0.5) {                // a horn's rings, close at its foot
    return (0.5 + 0.5*cos(uv.y*6.2832/0.022))*(1.0 - smoothstep(0.08, 0.15, uv.y))*keepV(0.022);
  }
  if (kind == TWEED) return vn3(vP*220.0)*0.6 + 0.4*(0.5 + 0.5*sin((uv.x*gUS - uv.y)*6.2832/0.006))*keepV(0.006);
  if (kind == LEATHER || kind == RUBBER) return vn3(vP*300.0)*0.6;
  if (kind == WOOD) return 0.5 + 0.5*sin(uv.y*260.0 + vn3(vP*40.0)*6.0);
  if (kind == FRUIT) return vn3(vP*120.0)*0.3;
  return 0.0;
}
float bumpOf(int kind, float extra){         // how deep each weave is, in the hat's units
  if (kind == KNIT) return 0.0045;
  if (kind == STRAW) return 0.0028;
  if (kind == COTTON) return abs(extra - 3.0) < 0.5 ? 0.0022 : extra > 6.5 ? 0.0015 : 0.0016;
  if (kind == SATIN) return 0.0005;
  if (kind == FUR) return extra > 0.5 ? 0.0018 : 0.004;
  if (kind == FELT) return extra > 0.5 ? 0.0002 : 0.0006;
  if (kind == METAL) return 0.002;
  if (kind == LEAF) return 0.0018;
  if (kind == FEATHER) return 0.0012;
  if (kind == HORN) return 0.0035;
  if (kind == TWEED) return 0.0014;
  if (kind == LEATHER || kind == RUBBER) return 0.0005;
  if (kind == WOOD) return 0.0008;
  if (kind == FRUIT) return 0.0004;
  return 0.0;
}

// ---- the studio ---------------------------------------------------------------------------------------------------
vec3 env(vec3 R, float rough){
  float s = clamp(rough, 0.02, 1.0);
  vec3 sky = mix(vec3(0.46, 0.47, 0.5), vec3(1.0, 1.01, 1.05), smoothstep(-0.05, 0.9, R.y));
  vec3 ground = mix(vec3(0.15, 0.15, 0.16), vec3(0.07, 0.07, 0.08) + lin(uOrb)*0.3, smoothstep(-0.05, -0.85, R.y));
  vec3 c = mix(ground, sky, smoothstep(-0.1 - 0.3*s, 0.06 + 0.3*s, R.y));
  vec3 kb = normalize(vec3(-0.52, 0.62, 0.58));
  c += vec3(5.2)*(1.0 - 0.78*s)*smoothstep(0.93 - 0.55*s, 0.985 - 0.33*s, dot(R, kb));   // the softbox
  vec3 fb = normalize(vec3(0.7, 0.15, 0.7));
  c += vec3(1.3)*(1.0 - 0.6*s)*smoothstep(0.86 - 0.5*s, 0.96 - 0.3*s, dot(R, fb));      // a fill, to his right
  vec3 rb = normalize(vec3(0.82, 0.28, -0.5));
  c += vec3(1.7)*(1.0 - 0.6*s)*smoothstep(0.9 - 0.5*s, 0.97 - 0.3*s, dot(R, rb));       // the rim strip
  return c;
}

void main(){
  int kind = int(vMat.x + 0.5);
  int slot = int(vMat.y + 0.5);
  float ao = vMat.z;
  float extra = vMat.w > 99.5 ? vMat.w - 100.0 : vMat.w;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  gFW = fwidth(vUV);
  // the surface's own directions (its u and v across the screen), for the weaves' bumps
  vec3 dp1 = dFdx(vS), dp2 = dFdy(vS);
  vec2 du1 = dFdx(vUV), du2 = dFdy(vUV);
  vec3 r1 = cross(dp2, N), r2 = cross(N, dp1);
  float det = dot(dp1, r1);
  bool framed = abs(det) > 1e-14 && max(abs(du1.x), abs(du2.x)) < 0.2;
  vec3 gu = framed ? (r1*du1.x + r2*du2.x)/det : vec3(0.0);
  vec3 gv = framed ? (r1*du1.y + r2*du2.y)/det : vec3(0.0);
  gUS = 1.0/max(length(gu), 1e-4);
  vec3 base = slot == 0 ? uCol : slot == 1 ? uCol2 : slot == 10 ? uCol3 : uPal[slot];
  vec3 alb = lin(base);
  float h0 = heightOf(kind, vUV, extra);
  float amp = bumpOf(kind, extra);
  if (framed && amp > 0.0) {
    float e1 = 0.0004, e2 = 0.0006;
    vec3 g = (heightOf(kind, vUV + vec2(e1, 0.0), extra) - h0)/e1*gu + (heightOf(kind, vUV + vec2(0.0, e2), extra) - h0)/e2*gv;
    N = normalize(N - amp*g);
  }
  // what it is made of
  float rough = 0.6, metal = 0.0, coat = 0.0, sheen = 0.0, wrap = 0.0;
  vec3 emit = vec3(0.0);
  float alpha = 1.0;
  if (kind == FELT) {
    rough = abs(extra - 1.0) < 0.5 ? 0.36 : abs(extra - 2.0) < 0.5 ? 0.62 : 0.78;      // felt, silk plush, velvet
    sheen = abs(extra - 2.0) < 0.5 ? 0.95 : abs(extra - 1.0) < 0.5 ? 0.45 : 0.55;
    wrap = 0.2;
    if (extra > 9.5) {        // a wizard's: printed with gold stars, big and small
      vec2 g = vec2(vUV.x*11.0, vUV.y/0.085);
      vec2 cell = floor(g), f = fract(g) - 0.5;
      float on = step(0.45, h31(vec3(cell, 5.0)));
      vec2 j = (vec2(h31(vec3(cell, 1.0)), h31(vec3(cell, 2.0))) - 0.5)*0.4;
      vec2 sp = (f - j)*vec2(1.0, 0.85);
      float ang = atan(sp.y, sp.x + 1e-6) + 1.5708, rr = length(sp);
      float sz = mix(0.16, 0.3, h31(vec3(cell, 3.0)));
      float st = rr - sz*(0.55 + 0.45*cos(5.0*ang));
      float aa = max(fwidth(st), 1e-4);
      float print = on*(1.0 - smoothstep(-aa, aa, st))*keepU(11.0*3.0);
      alb = mix(alb, lin(uCol2), print);
      rough = mix(rough, 0.3, print);
      metal = 0.8*print;
    }
  }
  else if (kind == KNIT) { rough = 0.92; sheen = 0.55; wrap = 0.45; alb *= mix(0.62, 1.0, h0); }
  else if (kind == FUR) { rough = 0.95; sheen = 0.85; wrap = 0.6; alb *= mix(0.72, 1.0, h0); }
  else if (kind == COTTON) {
    rough = 0.82; sheen = 0.3; wrap = 0.25;
    if (extra < -0.5 && mod(floor(vUV.x*(-extra) + 0.5), 2.0) > 0.5) alb = lin(uPal[4]);   // panels in two colours
    alb *= mix(0.8, 1.0, clamp(h0, 0.0, 1.0));
  }
  else if (kind == STRAW) {
    rough = 0.5; sheen = 0.18; wrap = 0.3;
    float row = floor(vUV.y/0.024), strand = floor(vUV.x*extra + 0.5*row + 0.5);
    alb *= mix(0.55, 1.0, h0)*(0.86 + 0.28*h31(vec3(row, strand, 3.0)));
  }
  else if (kind == PLASTIC) { rough = 0.3; coat = 1.0; }
  else if (kind == METAL) { rough = 0.2; metal = 1.0; }
  else if (kind == SATIN) {
    rough = 0.32; sheen = 0.6;
    if (extra > 1.5) {        // embroidered: a zigzag in his colour round the band
      float z = abs(fract(vUV.x*48.0) - 0.5)*4.0 - 1.0;
      float d = abs(vUV.y - (0.038 + 0.016*z));
      alb = mix(alb, lin(uCol), (1.0 - smoothstep(0.003, 0.006, d))*keepU(48.0*4.0));
    }
  }
  else if (kind == PAPER) {
    rough = 0.42; coat = 0.75;
    float s = vUV.x*extra + vUV.y*2.6;
    float aa = max(fwidth(s), 1e-4);
    float stripe = smoothstep(0.25 - aa, 0.25 + aa, abs(fract(s) - 0.5));
    alb = mix(alb, lin(uCol2), stripe);
  }
  else if (kind == GLOW) { emit = lin(base)*(1.7 + 0.35*sin(uTime*2.2)); rough = 0.1; coat = 1.0; alb *= 0.4; }
  else if (kind == GEM) { rough = 0.04; }
  else if (kind == RUBBER) { rough = 0.62; }
  else if (kind == LEATHER) { rough = 0.5; coat = 0.2; }
  else if (kind == HORN) { rough = extra > 0.5 ? 0.55 : 0.3; coat = extra > 0.5 ? 0.15 : 0.7; wrap = 0.2; alb *= mix(1.0, 0.82, smoothstep(0.0, 0.3, vUV.y)); }
  else if (kind == PEARL) {
    rough = 0.26; coat = 0.9; wrap = 0.2;
    if (extra > 0.5) {        // a unicorn's: its groove winding up it in his second colour
      float s = vUV.x + 0.5 - vUV.y*(3.2/0.36);
      alb = mix(alb, lin(uCol2), smoothstep(0.55, 0.85, cos(s*6.2832))*0.85);
    }
  }
  else if (kind == LEAF) { rough = 0.38; coat = 0.5; wrap = 0.5; alb *= extra > 0.5 ? mix(0.82, 1.08, abs(vUV.x))*mix(1.0, 1.1, vUV.y) : 1.0; }
  else if (kind == FRUIT) {
    rough = 0.32; coat = 0.75; wrap = 0.35;
    float streak = vn3(vec3(vUV.x*34.0, vUV.y*4.0, 1.0));
    alb *= 0.8 + 0.32*streak;
    alb = mix(alb, alb*vec3(1.25, 1.15, 0.6), smoothstep(0.18, 0.3, vUV.y)*0.35);       // a blush toward its shoulder
    alb = mix(alb, vec3(0.9, 0.82, 0.55), step(0.86, vn3(vP*110.0))*0.5*keepV(0.01));   // its pale specks
  }
  else if (kind == PETAL) { rough = 0.62; sheen = 0.6; wrap = 0.65; alb *= mix(0.7, 1.12, smoothstep(0.0, 0.8, vUV.y)); }
  else if (kind == FEATHER) { rough = 0.66; sheen = 0.6; wrap = 0.55; alb *= mix(0.86, 1.04, h0); }
  else if (kind == TWEED) {
    rough = 0.9; sheen = 0.3; wrap = 0.3;
    // its check: broad bands both ways in his second colour, darker where they cross, a fine line through each
    float bu = 1.0 - smoothstep(0.17, 0.21, abs(fract(vUV.x*20.0) - 0.5));
    float bv = 1.0 - smoothstep(0.17, 0.21, abs(fract(vUV.y/0.085) - 0.5));
    float fu = 1.0 - smoothstep(0.02, 0.05, abs(fract(vUV.x*20.0 + 0.5) - 0.5));
    float fv = 1.0 - smoothstep(0.02, 0.05, abs(fract(vUV.y/0.085 + 0.5) - 0.5));
    float k = keepU(20.0*4.0);
    alb = mix(alb, mix(alb, lin(uCol2), 0.5), (bu + bv)*0.5*k);
    alb = mix(alb, lin(uCol2)*0.8, max(fu, fv)*0.7*k);
    alb *= mix(0.85, 1.0, h0);
  }
  else if (kind == WOOD) { rough = 0.7; alb *= mix(0.8, 1.05, h0); }
  else if (kind == GLASS) {
    // glass: as see-through as its tint is light (a lens's darkness, spec.ts GLASSES dark): clear glass hardly there but
    // for what it reflects, sunglasses nearly hiding his eyes, celluloid between
    rough = 0.05; coat = 1.0;
    alpha = mix(0.05, 0.93, clamp(extra, 0.0, 1.0));
    if (extra < 0.04) alb = vec3(0.9);
  }

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.50, 0.66, 0.56));
  vec3 H = normalize(L + V);
  float NoV = clamp(dot(N, V), 1e-3, 1.0);
  float NoL = dot(N, L);
  float nl = clamp(NoL, 0.0, 1.0);
  float NoH = clamp(dot(N, H), 0.0, 1.0);
  float VoH = clamp(dot(V, H), 0.0, 1.0);
  vec3 R = reflect(-V, N);
  vec3 col;
  if (kind == GEM) {
    // a cut stone: the light it bends back out of its facets, coloured, and the sparkle off them
    vec3 inner = env(vec3(-R.x, abs(R.y), R.z), 0.03);
    float lum = dot(inner, vec3(0.3, 0.5, 0.2));
    vec3 fire = 0.5 + 0.5*cos(6.2832*(dot(N, vec3(1.7, 2.3, 0.9)) + vec3(0.0, 0.33, 0.67)));
    col = alb*(0.12 + 0.9*lum) + env(R, 0.03)*0.12 + fire*0.06*smoothstep(1.5, 4.0, lum);
  } else {
    vec3 F0 = mix(vec3(0.04), alb, metal);
    float a2 = sq(max(rough*rough, 0.003));
    float D = a2/(PI*sq(NoH*NoH*(a2 - 1.0) + 1.0));
    float k = sq(rough + 1.0)/8.0;
    float G = (NoV/(NoV*(1.0 - k) + k))*(nl/(nl*(1.0 - k) + k));
    vec3 F = F0 + (1.0 - F0)*pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
    vec3 spec = D*G*F/max(4.0*NoV*nl, 1e-3)*nl;
    float wl = clamp((NoL + wrap)/(1.0 + wrap), 0.0, 1.0);
    vec3 KEY = vec3(3.0);
    col = ((1.0 - metal)*(vec3(1.0) - F)*alb/PI*wl + spec)*KEY*mix(1.0, ao, 0.5);
    vec3 irr = mix(vec3(0.05, 0.05, 0.06) + lin(uOrb)*0.28, vec3(0.56, 0.57, 0.61), 0.5 + 0.5*N.y);
    vec3 Fr = F0 + (max(vec3(1.0 - rough), F0) - F0)*pow(clamp(1.0 - NoV, 0.0, 1.0), 5.0);
    col += (1.0 - metal)*alb*irr*ao;
    col += env(R, rough)*Fr*ao*mix(0.6, 1.0, ao);
    if (coat > 0.0) {
      float Fc = 0.04 + 0.96*pow(clamp(1.0 - NoV, 0.0, 1.0), 5.0);
      float ac = sq(0.07*0.07);
      float Dc = ac/(PI*sq(NoH*NoH*(ac - 1.0) + 1.0));
      col = col*(1.0 - coat*Fc) + coat*(env(R, 0.06)*Fc*ao + Dc*0.04*nl*KEY*0.25);
    }
    col += sheen*mix(alb, vec3(1.0), 0.35)*pow(clamp(1.0 - NoV, 0.0, 1.0), 2.0)*(0.3 + 0.7*wl)*0.7*ao;
    col += lin(uOrb)*0.16*pow(clamp(1.0 - NoV, 0.0, 1.0), 3.0)*(1.0 - 0.6*rough)*ao;   // his light, at its edges
    col += emit;
  }
  col = clamp((col*(2.51*col + 0.03))/(col*(2.43*col + 0.59) + 0.14), 0.0, 1.0);
  // celluloid is see-through: less so where it turns away and mirrors more
  if (alpha < 1.0) alpha = clamp(alpha + 0.4*pow(clamp(1.0 - NoV, 0.0, 1.0), 3.0), 0.0, 1.0);
  O = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0/2.2)), alpha);
}`;
