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
uniform float uSquash;  // squash (+) and stretch (-) for hops and pokes; volume is roughly kept
uniform vec4 uEyeA;     // radius, aspect (1 round, >1 tall ovals), gap, height
uniform vec4 uEyeB;     // sparkle (0..1), lids at rest (0 open .. 1 shut), happy at rest, a wink (his left eye an arc)
uniform float uAcc;     // his hat (spec.ts HATS): 0 none
uniform vec3 uAccCol, uAccCol2;   // its colour, and its second colour (a band, a pompom, a bead)
uniform float uAccTilt; // worn at a slant, radians
uniform vec2 uAccFit;   // how it fits his shape (spec.ts hatFit): the outline his head's top is taken at, and the hat's size
uniform float uSpecs;   // his glasses (spec.ts GLASSES): 0 none
uniform vec3 uSpecsCol, uSpecsCol2, uLensCol;   // the frame, a strap (goggles), the lens's tint
uniform float uLensDark;                        // how much of his eyes the lens hides: 0 clear, ~0.9 sunglasses
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

vec2 accSDF(vec2 q){
  int id = int(uAcc + 0.5);
  if (id == 1) {        // a top hat, its band in the second colour
    vec2 h = pick(vec2(sdBox(q - vec2(0.0, -0.03), vec2(0.50, 0.05), 0.05), 0.0), vec2(sdBox(q - vec2(0.0, -0.33), vec2(0.30, 0.28), 0.07), 0.0));
    float band = max(sdBox(q - vec2(0.0, -0.33), vec2(0.30, 0.28), 0.07), abs(q.y + 0.13) - 0.045);
    return band < 0.0 ? vec2(band, 1.0) : h;
  }
  if (id == 2) {        // a beanie: the dome, the turned-up cuff, a pompom
    float dome = max(sdEll(q - vec2(0.0, 0.10), vec2(0.56, 0.52)), q.y - 0.06);
    vec2 h = pick(vec2(dome, 0.0), vec2(sdBox(q - vec2(0.0, 0.05), vec2(0.58, 0.075), 0.07), 1.0));
    return pick(h, vec2(length(q - vec2(0.0, -0.44)) - 0.13 - 0.012*sin(atan(q.y + 0.44, q.x)*9.0), 1.0));
  }
  if (id == 3) {        // a party hat, striped, a pompom on its tip
    vec2 a = vec2(-0.32, 0.06), b = vec2(0.34, 0.06), c = vec2(0.05, -0.92);
    float cone = sdTri(q, a, b, c) - 0.02;
    float stripe = step(0.5, fract((q.y - q.x*0.35)*5.0));
    return pick(vec2(cone, stripe), vec2(length(q - c) - 0.09, 1.0));
  }
  if (id == 4) {        // an antenna: a steel stalk and a bead of his own light
    float stalk = sdCap(vec2(q.x - 0.12*q.y*q.y, q.y), vec2(0.0, 0.08), vec2(0.0, -0.52), 0.028);
    return pick(vec2(stalk, 0.0), vec2(length(q - vec2(0.03, -0.60)) - 0.11, 2.0));
  }
  if (id == 5) {        // a sprout: a stem and two leaves
    // the leaves grow from the top of the stem (they floated free of it until 10-01: three pieces)
    float stem = sdCap(q, vec2(0.0, 0.08), vec2(0.0, -0.44), 0.026);
    float l1 = sdEll(rot(q - vec2(-0.15, -0.38), 0.55), vec2(0.17, 0.08));
    float l2 = sdEll(rot(q - vec2(0.16, -0.42), -0.6), vec2(0.19, 0.085));
    return pick(vec2(stem, 1.0), vec2(min(l1, l2), 0.0));
  }
  if (id == 6) {        // a bow, worn to one side
    vec2 b = q - vec2(0.30, 0.06);
    float loops = min(sdEll(rot(b - vec2(-0.17, 0.0), 0.30), vec2(0.17, 0.11)), sdEll(rot(b - vec2(0.17, 0.0), -0.30), vec2(0.17, 0.11)));
    return pick(vec2(loops, 0.0), vec2(length(b) - 0.065, 1.0));
  }
  if (id == 7) {        // a crown: a band, five points, a gem in the middle
    float base = sdBox(q - vec2(0.0, -0.05), vec2(0.38, 0.07), 0.03);
    float pts = 1e5;
    for (int i = 0; i < 5; i++) {
      float x = -0.32 + 0.16*float(i);
      pts = min(pts, sdTri(q, vec2(x - 0.09, -0.08), vec2(x + 0.09, -0.08), vec2(x, -0.34 - 0.06*float(i == 2))));
    }
    vec2 h = vec2(min(base, pts - 0.015), 0.0);
    return pick(h, vec2(length(q - vec2(0.0, -0.05)) - 0.05, 1.0));
  }
  if (id == 9) {        // a cap: the crown, its peak out to one side
    float crown = max(sdEll(q - vec2(-0.04, 0.10), vec2(0.50, 0.42)), q.y - 0.06);
    float peak = max(sdEll(q - vec2(0.42, 0.04), vec2(0.36, 0.08)), -(q.x - 0.10));
    return pick(vec2(crown, 0.0), vec2(peak, 1.0));
  }
  if (id == 10) {       // a wizard's hat: a tall bent cone, a wide brim, a star on it
    vec2 b = vec2(q.x + 0.18*q.y*q.y, q.y);
    float cone = sdTri(b, vec2(-0.30, 0.02), vec2(0.30, 0.02), vec2(0.0, -1.05)) - 0.02;
    float brim = sdEll(q - vec2(0.0, 0.02), vec2(0.62, 0.075));
    vec2 sq = q - vec2(0.02, -0.42);
    float ang = atan(sq.y, sq.x) + 1.5707963, rr = length(sq);
    float star = rr - 0.10*(0.62 + 0.38*cos(5.0*ang));
    return pick(pick(vec2(cone, 0.0), vec2(brim, 0.0)), vec2(star, 1.0));
  }
  if (id == 11) {       // a halo: a ring of his own light, floating
    float ring = abs(sdEll(q - vec2(0.0, -0.22), vec2(0.42, 0.11))) - 0.035;
    return vec2(ring, 2.0);
  }
  if (id == 12) {       // a flower, tucked to one side
    vec2 b = q - vec2(0.30, 0.04);
    float ang = atan(b.y, b.x), rr = length(b);
    float petals = rr - 0.21*(0.70 + 0.30*cos(5.0*ang));
    return pick(vec2(petals, 0.0), vec2(rr - 0.075, 1.0));
  }
  if (id == 13) {       // horns, small and round-tipped
    float h1 = sdTri(vec2(q.x + 0.26 + 0.20*q.y, q.y), vec2(-0.10, 0.06), vec2(0.10, 0.06), vec2(-0.02, -0.30)) - 0.03;
    float h2 = sdTri(vec2(q.x - 0.26 - 0.20*q.y, q.y), vec2(-0.10, 0.06), vec2(0.10, 0.06), vec2(0.02, -0.30)) - 0.03;
    return vec2(min(h1, h2), 0.0);
  }
  if (id == 14) {       // bunny ears on a band: each ear's foot set into the band (their points only touched it, so they hovered)
    float e1 = sdEll(rot(q - vec2(-0.20, -0.38), -0.20), vec2(0.11, 0.42));
    float e2 = sdEll(rot(q - vec2(0.20, -0.38), 0.20), vec2(0.11, 0.42));
    float i1 = sdEll(rot(q - vec2(-0.20, -0.36), -0.20), vec2(0.05, 0.30));
    float i2 = sdEll(rot(q - vec2(0.20, -0.36), 0.20), vec2(0.05, 0.30));
    float band = max(abs(length(q - vec2(0.0, 0.70)) - 0.72) - 0.03, q.y - 0.05);
    vec2 h = pick(vec2(min(e1, e2), 0.0), vec2(band, 0.0));
    return min(i1, i2) < 0.0 ? vec2(min(i1, i2), 1.0) : h;
  }
  if (id == 15) {       // a chef's hat: three puffs over a band
    float puff = min(min(length(q - vec2(-0.20, -0.30)) - 0.22, length(q - vec2(0.20, -0.30)) - 0.22), length(q - vec2(0.0, -0.44)) - 0.25);
    float band = sdBox(q - vec2(0.0, -0.04), vec2(0.30, 0.10), 0.04);
    return pick(vec2(min(puff, sdBox(q - vec2(0.0, -0.20), vec2(0.30, 0.16), 0.04)), 0.0), vec2(band, 0.0));
  }
  if (id == 16) {       // a graduation cap: the board, the cap, the tassel
    vec2 b = q - vec2(0.0, -0.20);
    float board = max(abs(b.x*0.70) + abs(b.y*2.6) - 0.42, -1e5);
    float cap = max(sdEll(q - vec2(0.0, 0.06), vec2(0.34, 0.22)), q.y - 0.06);
    float tassel = min(sdCap(q, vec2(0.0, -0.21), vec2(0.42, -0.10), 0.018), sdCap(q, vec2(0.42, -0.10), vec2(0.44, 0.16), 0.03));
    return pick(pick(vec2(board, 0.0), vec2(cap, 0.0)), vec2(tassel, 1.0));
  }
  if (id == 17) {       // a cowboy hat: the brim turned up at the sides, the creased crown, a band
    float brim = sdEll(vec2(q.x, q.y + 0.18*q.x*q.x) - vec2(0.0, 0.0), vec2(0.70, 0.07));
    float crown = sdBox(q - vec2(0.0, -0.22), vec2(0.30, 0.20), 0.12) + 0.04*exp(-sq(q.x/0.07))*step(q.y, -0.30);
    float band = max(crown, abs(q.y + 0.08) - 0.04);
    vec2 h = pick(vec2(brim, 0.0), vec2(crown, 0.0));
    return band < 0.0 ? vec2(band, 1.0) : h;
  }
  if (id == 18) {       // a propeller cap: a little dome, a stalk, two blades
    float dome = max(sdEll(q - vec2(0.0, 0.08), vec2(0.42, 0.34)), q.y - 0.06);
    float stalk = sdCap(q, vec2(0.0, -0.24), vec2(0.0, -0.38), 0.025);
    float blades = min(sdEll(q - vec2(-0.20, -0.40), vec2(0.20, 0.045)), sdEll(q - vec2(0.20, -0.40), vec2(0.20, 0.045)));
    return pick(pick(vec2(dome, 0.0), vec2(stalk, 1.0)), vec2(blades, 1.0));
  }
  if (id == 19) {       // a star clip, worn to one side
    vec2 b = q - vec2(0.30, 0.02);
    float ang = atan(b.y, b.x) + 1.5707963, rr = length(b);
    return vec2(rr - 0.21*(0.58 + 0.42*cos(5.0*ang)), 0.0);
  }
  if (id == 20) {       // a beret: a soft flat disc worn to one side, its little stalk on top
    float disc = sdEll(q - vec2(0.10, -0.08), vec2(0.56, 0.16));
    float band = sdBox(q - vec2(0.0, 0.04), vec2(0.40, 0.05), 0.045);
    return pick(vec2(min(disc, band), 0.0), vec2(sdCap(q, vec2(0.12, -0.22), vec2(0.16, -0.32), 0.026), 1.0));
  }
  if (id == 21) {       // a hard hat: the dome, a brim all round, a ridge down the middle
    float dome = max(sdEll(q - vec2(0.0, 0.06), vec2(0.52, 0.50)), q.y - 0.04);
    float brim = sdBox(q - vec2(0.0, 0.04), vec2(0.64, 0.045), 0.04);
    float ridge = max(dome + 0.03, abs(q.x) - 0.07);
    return ridge < 0.0 ? vec2(ridge, 1.0) : vec2(min(dome, brim), 0.0);
  }
  if (id == 22) {       // a bucket hat: a soft round crown, a band, and a brim that slopes down and out
    float crown = sdBox(q - vec2(0.0, -0.14), vec2(0.30, 0.17), 0.16);
    float wide = 0.32 + 0.30*clamp((q.y + 0.02)/0.16, 0.0, 1.0);   // the brim widens as it falls
    float brim = sdBox(vec2(q.x*0.32/wide, q.y - 0.06), vec2(0.32, 0.08), 0.03);
    float band = max(crown, abs(q.y + 0.03) - 0.045);
    return band < 0.0 ? vec2(band, 1.0) : vec2(min(crown, brim), 0.0);
  }
  if (id == 23) {       // an accountant's eyeshade: a green visor over his brow, on a dark band
    float w = 0.50 + 0.12*clamp((q.y - 0.06)/0.26, 0.0, 1.0);    // it widens as it comes down
    float shade = sdBox(vec2(q.x*0.50/w, q.y - 0.20), vec2(0.50, 0.13), 0.05);
    float band = sdBox(q - vec2(0.0, 0.07), vec2(0.52, 0.035), 0.03);
    return band < 0.0 ? vec2(band, 1.0) : vec2(min(shade, band), 0.0);
  }
  if (id == 24) {       // a headset: the band, one cup, and a little mic on its arm
    float band = max(abs(length(q - vec2(0.0, 0.70)) - 0.73) - 0.03, q.y - 0.62);
    float cup = sdBox(q - vec2(-0.66, 0.66), vec2(0.09, 0.16), 0.08);
    float arm = sdCap(q, vec2(-0.63, 0.80), vec2(-0.34, 1.00), 0.022);
    float mic = length(q - vec2(-0.30, 1.01)) - 0.05;
    return pick(pick(vec2(band, 1.0), vec2(min(cup, arm), 0.0)), vec2(mic, 1.0));
  }
  if (id == 25) {       // a sweatband round his forehead, a stripe through it
    float band = max(abs(q.y - 0.17) - 0.065, length(q - vec2(0.0, 0.70)) - 0.72);
    float stripe = max(band, abs(q.y - 0.17) - 0.018);
    return stripe < 0.0 ? vec2(stripe, 1.0) : vec2(band, 0.0);
  }
  if (id == 26) {       // an apple on his head: two round halves, a stem, a leaf
    float apple = min(length(q - vec2(-0.08, -0.15)) - 0.17, length(q - vec2(0.08, -0.15)) - 0.17);
    apple = max(apple, -(length(q - vec2(0.0, -0.36)) - 0.05));   // the dimple at the top
    float stem = sdCap(q, vec2(0.0, -0.28), vec2(0.04, -0.42), 0.022);
    float leaf = sdEll(rot(q - vec2(0.13, -0.38), -0.5), vec2(0.10, 0.045));
    return pick(vec2(apple, 0.0), vec2(min(stem, leaf), 1.0));
  }
  if (id == 27) {       // a straw hat: a wide brim, a low crown, a band
    float brim = sdEll(q - vec2(0.0, 0.03), vec2(0.80, 0.085));
    float crown = sdBox(q - vec2(0.0, -0.13), vec2(0.34, 0.15), 0.11);
    float band = max(crown, abs(q.y + 0.02) - 0.045);
    return band < 0.0 ? vec2(band, 1.0) : vec2(min(brim, crown), 0.0);
  }
  if (id == 28) {       // a fedora: a brim turned down a touch, a pinched crown, a band
    float brim = sdEll(vec2(q.x, q.y - 0.10*q.x*q.x) - vec2(0.0, 0.03), vec2(0.62, 0.06));
    float crown = sdBox(q - vec2(0.0, -0.19), vec2(0.31, 0.18), 0.11) + 0.05*exp(-sq(q.x/0.08))*step(q.y, -0.28);
    float band = max(crown, abs(q.y + 0.04) - 0.045);
    return band < 0.0 ? vec2(band, 1.0) : vec2(min(brim, crown), 0.0);
  }
  if (id == 29) {       // a deerstalker: a checked cap, its flaps down at the sides, a bow on top
    float cap = max(sdEll(q - vec2(0.0, 0.08), vec2(0.54, 0.46)), q.y - 0.10);
    float flaps = min(sdEll(q - vec2(-0.53, 0.16), vec2(0.10, 0.17)), sdEll(q - vec2(0.53, 0.16), vec2(0.10, 0.17)));
    float bow = min(sdEll(q - vec2(-0.07, -0.40), vec2(0.07, 0.04)), sdEll(q - vec2(0.07, -0.40), vec2(0.07, 0.04)));
    float body = min(cap, flaps);
    float check = min(abs(fract(q.x*5.0) - 0.5), abs(fract(q.y*5.0) - 0.5));   // the check's lines
    return bow < 0.0 ? vec2(bow, 1.0) : body < 0.0 && check < 0.07 ? vec2(body, 1.0) : vec2(min(body, bow), 0.0);
  }
  if (id == 30) {       // a sun visor: a band round his head and a wide brim, no crown
    float band = max(abs(q.y - 0.12) - 0.05, length(q - vec2(0.0, 0.70)) - 0.72);
    float brim = sdEll(q - vec2(0.12, 0.03), vec2(0.70, 0.11));
    return band < 0.0 ? vec2(band, 1.0) : vec2(min(band, brim), 0.0);
  }
  if (id == 31) {       // a crown of flowers along the top of his head
    float petals = 1e5, middles = 1e5;
    for (int i = 0; i < 5; i++) {
      float a = -2.45 + 0.4*float(i);                             // round the top of his head
      vec2 c = vec2(0.0, 0.70) + 0.71*vec2(cos(a), sin(a));   // sat on him, every flower touching his head
      vec2 b = q - c;
      float ang = atan(b.y, b.x) + 0.6*float(i), rr = length(b);
      petals = min(petals, rr - 0.135*(0.70 + 0.30*cos(5.0*ang)));
      middles = min(middles, rr - 0.05);
    }
    return middles < 0.0 ? vec2(middles, 1.0) : vec2(petals, 0.0);
  }
  if (id == 32) {       // a viking's helmet: a steel dome, a band, two horns
    float dome = max(sdEll(q - vec2(0.0, 0.08), vec2(0.52, 0.48)), q.y - 0.10);
    float band = max(dome, abs(q.y - 0.04) - 0.05);
    float h1 = sdTri(q, vec2(-0.50, 0.02), vec2(-0.36, -0.14), vec2(-0.80, -0.46)) - 0.025;
    float h2 = sdTri(q, vec2(0.50, 0.02), vec2(0.36, -0.14), vec2(0.80, -0.46)) - 0.025;
    float horns = min(h1, h2);
    return horns < 0.0 || band < 0.0 ? vec2(min(horns, band), 1.0) : vec2(min(dome, horns), 0.0);
  }
  // more (owner, 10-03: "Can we add more accessories in every section?")
  if (id == 33) {       // a bowler: a round crown on a short curled brim, a band
    float crown = max(sdEll(q - vec2(0.0, -0.12), vec2(0.36, 0.34)), q.y + 0.02);
    float brim = sdEll(q - vec2(0.0, 0.0), vec2(0.54, 0.065));
    float band = max(crown, abs(q.y + 0.08) - 0.04);
    return band < 0.0 ? vec2(band, 1.0) : vec2(min(crown, brim), 0.0);
  }
  if (id == 34) {       // a fez: a short tapered crown, flat on top, and a tassel hanging off it
    float tt = clamp((0.04 - q.y)/0.48, 0.0, 1.0);
    float crown = max(abs(q.x) - mix(0.31, 0.22, tt), max(q.y - 0.04, -0.44 - q.y)) - 0.01;
    float cord = sdCap(q, vec2(0.0, -0.44), vec2(0.26, -0.30), 0.018);
    float tassel = sdEll(q - vec2(0.28, -0.20), vec2(0.045, 0.10));
    return pick(vec2(crown, 0.0), vec2(min(cord, tassel), 1.0));
  }
  if (id == 35) {       // a tricorn, a pirate's: seen from the front a boat, low where it sits on him, its brim
                        // turned up into a point at each side, gold along that edge, the crown inside
    float cut = sdEll(q - vec2(0.0, -0.46), vec2(0.48, 0.30));
    float boat = max(sdEll(q - vec2(0.0, -0.12), vec2(0.72, 0.30)), -cut);
    float crown = max(sdEll(q - vec2(0.0, -0.16), vec2(0.30, 0.28)), q.y + 0.02);
    float trim = max(boat, abs(cut) - 0.035);
    return trim < 0.0 ? vec2(trim, 1.0) : vec2(min(boat, crown), 0.0);
  }
  if (id == 36) {       // a Santa hat: a soft cone flopping to one side, a fur trim, a pompom
    float cone = sdTri(q, vec2(-0.40, 0.02), vec2(0.40, 0.02), vec2(0.34, -0.72)) - 0.04;
    float trim = sdBox(q - vec2(0.0, 0.04), vec2(0.47, 0.085), 0.08);
    float pom = length(q - vec2(0.38, -0.76)) - 0.11;
    return pick(vec2(cone, 0.0), vec2(min(trim, pom), 1.0));
  }
  if (id == 37) {       // a sombrero: a tall round crown, a very wide brim, a band
    float crown = max(sdEll(q - vec2(0.0, -0.16), vec2(0.30, 0.36)), q.y + 0.0);
    float brim = sdEll(q - vec2(0.0, 0.02), vec2(0.82, 0.08));   // as wide as its picture's frame allows
    float band = max(crown, abs(q.y + 0.06) - 0.045);
    return band < 0.0 ? vec2(band, 1.0) : vec2(min(crown, brim), 0.0);
  }
  if (id == 38) {       // a tiara: a fine band over his head, three points, a stone in the middle
    float band = max(max(abs(length(q - vec2(0.0, 0.70)) - 0.72) - 0.028, q.y - 0.16), abs(q.x) - 0.46);
    float pts = min(sdTri(q, vec2(-0.09, 0.0), vec2(0.09, 0.0), vec2(0.0, -0.26)),
                    min(sdTri(q, vec2(-0.30, 0.04), vec2(-0.16, 0.0), vec2(-0.25, -0.16)), sdTri(q, vec2(0.16, 0.0), vec2(0.30, 0.04), vec2(0.25, -0.16)))) - 0.012;
    float stone = length(q - vec2(0.0, -0.08)) - 0.055;
    return stone < 0.0 ? vec2(stone, 1.0) : vec2(min(band, pts), 0.0);
  }
  if (id == 39) {       // antlers on a band that rests on his head: a beam on each side and the tines off it
    // the top of the ring only: a ring crosses that strip twice, and its far side hung under him
    float band = max(max(abs(length(q - vec2(0.0, 0.76)) - 0.72) - 0.03, abs(q.x) - 0.20), q.y - 0.2);
    float a = band;
    for (int i = 0; i < 2; i++) {
      float sd = i == 0 ? -1.0 : 1.0;
      vec2 m = vec2(sd*q.x, q.y);
      a = min(a, sdCap(m, vec2(0.15, 0.06), vec2(0.36, -0.42), 0.032));
      a = min(a, sdCap(m, vec2(0.25, -0.17), vec2(0.46, -0.22), 0.026));
      a = min(a, sdCap(m, vec2(0.31, -0.33), vec2(0.25, -0.54), 0.024));
    }
    return vec2(a, 0.0);
  }
  if (id == 40) {       // a unicorn's horn: a slim cone with a spiral stripe
    float horn = sdTri(q, vec2(-0.11, 0.04), vec2(0.11, 0.04), vec2(0.0, -0.66)) - 0.016;
    float stripe = step(0.55, fract((q.y + 0.55*q.x)*7.0));
    return vec2(horn, stripe);
  }
  if (id == 8) {        // headphones: the band over his head, a cup on each side
    // the band rests on his head and the cups on his sides (both hovered a hair off him until 10-01)
    float band = max(abs(length(q - vec2(0.0, 0.70)) - 0.73) - 0.035, q.y - 0.62);
    float cups = min(sdBox(q - vec2(-0.66, 0.66), vec2(0.09, 0.17), 0.08), sdBox(q - vec2(0.66, 0.66), vec2(0.09, 0.17), 0.08));
    return pick(vec2(band, 1.0), vec2(cups, 0.0));
  }
  return vec2(1e5, 0.0);
}

// ---- his glasses (PLAN 2.2; owner, 2026-10-01: "different glasses ... can also be sunglasses") ----
// In his face's own space (the face block's f: y down, his eyes at (+-gap, height)), so they turn
// and tilt with his face. Returns (frame, lens, strap, temples): distances, negative inside. The
// strap and the temples are clipped to his body where they are drawn.
float sdHeart(vec2 p){   // y up, its point at the origin, about 1.1 tall
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.35355339;
  vec2 a = p - vec2(0.0, 1.0), b = p - 0.5*max(p.x + p.y, 0.0);
  return sqrt(min(dot(a, a), dot(b, b)))*sign(p.x - p.y);
}
float sdStar5(vec2 p, float r, float rf){   // y up, a point at the top
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0*max(dot(k1, p), 0.0)*k1;
  p -= 2.0*max(dot(k2, p), 0.0)*k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf*vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba)/dot(ba, ba), 0.0, r);
  return length(p - ba*h)*sign(p.y*ba.x - p.x*ba.y);
}
vec4 specsSDF(vec2 f){
  int id = int(uSpecs + 0.5);
  float ey = uEyeA.w;
  float L = clamp(uEyeA.x*1.5, 0.15, 0.25);              // a lens a little bigger than his eye
  float Ly = L*clamp(uEyeA.y*0.85, 1.0, 1.35);           // taller for tall eyes
  float cx = max(uEyeA.z, L + 0.035);                    // far enough apart for a bridge
  float t = id == 4 || id == 10 ? 0.03 : id == 12 ? 0.042 : id == 20 ? 0.046 : 0.02;   // the frame's half-thickness
  if (id == 6) {        // a monocle: one round lens on his left eye, and its chain
    float d = length(f - vec2(cx, ey)) - L*1.05;
    float chain = sdCap(f, vec2(cx + L*0.74, ey + L*0.74), vec2(cx + L*1.0, ey + 0.50), 0.011);
    return vec4(abs(d) - t, d, 1e5, chain);
  }
  if (id == 13) {       // a visor: one band of tinted glass across both eyes
    float d = sdBox(f - vec2(0.0, ey), vec2(cx + L*1.05, Ly*0.68), 0.12);
    float arms = min(sdCap(f, vec2(-(cx + L), ey - 0.02), vec2(-(cx + L + 0.16), ey - 0.06), 0.016), sdCap(f, vec2(cx + L, ey - 0.02), vec2(cx + L + 0.16, ey - 0.06), 0.016));
    return vec4(abs(d) - 0.016, d, 1e5, arms);
  }
  float lens = 1e5, temples = 1e5;
  for (int i = 0; i < 2; i++) {
    float sd = i == 0 ? -1.0 : 1.0;
    vec2 v = f - vec2(sd*cx, ey);
    vec2 m = vec2(sd*v.x, v.y);                          // mirrored: +x is out, toward his side
    float d;
    if (id == 2) d = sdBox(v, vec2(L*1.08, Ly*0.82), 0.05);                         // square
    else if (id == 3) d = min(sdBox(rot(m, -0.20) - vec2(0.0, 0.02), vec2(L*1.08, Ly*0.70), 0.09),   // cat-eye: swept up at the outer corner
                              sdTri(m, vec2(L*0.50, -Ly*0.50), vec2(L*1.22, -Ly*0.98), vec2(L*1.10, -Ly*0.12)) - 0.02);
    else if (id == 4) d = sdEll(v, vec2(L, Ly)*1.2);                               // big round
    else if (id == 5) { vec2 w = v - vec2(0.0, 0.06); d = max(sdEll(w, vec2(L*1.05, Ly*0.85)), -w.y); }   // reading: the lower half
    else if (id == 7) d = sdHeart(vec2(v.x, -v.y)/(L*1.9) + vec2(0.0, 0.55))*L*1.9 - 0.01;   // hearts
    else if (id == 8) d = sdStar5(vec2(v.x, -v.y), L*1.3, 0.5) - 0.025;            // stars
    else if (id == 9) d = max(sdEll(rot(m - vec2(0.05, 0.10), -0.50), vec2(L*1.28, Ly*0.98)), -Ly*0.62 - v.y);   // aviators: a teardrop, flat on top, drooping outward
    else if (id == 10) d = sdBox(vec2(v.x*(1.0 + 0.30*v.y/Ly), v.y), vec2(L*1.12, Ly*0.74), 0.07);   // shades: wider at the top
    else if (id == 12) d = sdEll(v, vec2(L, Ly)*1.22);                              // goggles
    else if (id == 14) d = sdBox(v, vec2(L*1.12, Ly*0.62), 0.03);                   // rectangle
    else if (id == 15) d = sdBox(v, vec2(L*1.08, Ly*0.78), 0.06);                   // half-rims (the brow drawn thick below)
    else if (id == 16) d = sdBox(rot(m - vec2(0.03, 0.0), 0.16), vec2(L*1.4, Ly*0.74), 0.15);   // sport: wrapped round, swept out and down
    else if (id == 18) d = sdEll(v, vec2(L*1.2, Ly*0.72));                          // oval: wide and low
    else if (id == 19) d = max(abs(v.x)*0.866 + abs(v.y)*0.5, abs(v.y)) - L*1.02;     // hexagon
    else if (id == 20) d = sdEll(v, vec2(L, Ly)*1.1);                               // bold round: the frame thick
    else if (id == 21) d = sdEll(rot(m - vec2(0.04, -0.03), 0.34), vec2(L*1.34, Ly*0.86));   // butterfly: swept up and out
    else d = sdEll(v, vec2(L, Ly));                                                 // round, round shades
    lens = min(lens, d);
    // the temples: a short arm from each lens's outer edge back toward his side
    temples = min(temples, sdCap(f, vec2(sd*(cx + L*1.02), ey - Ly*0.30), vec2(sd*(cx + L*1.02 + 0.16), ey - Ly*0.46), 0.016));
  }
  float frame = abs(lens) - (id == 15 ? mix(0.010, 0.036, step(f.y, ey - Ly*0.30)) : t);   // half-rims: a heavy brow, a fine rim
  // the bridge between the lenses, never across them (aviators have a second bar, on top)
  float bridge = sdCap(f, vec2(-cx, ey - Ly*0.18), vec2(cx, ey - Ly*0.18), 0.018);
  if (id == 9) bridge = min(bridge, sdCap(f, vec2(-cx, ey - Ly*0.64), vec2(cx, ey - Ly*0.64), 0.014));
  frame = min(frame, max(bridge, -lens));
  // goggles: a strap right round his head instead of temples
  float strap = id == 12 ? max(abs(f.y - ey) - 0.055, -lens - t) : 1e5;
  return vec4(frame, lens, strap, id == 12 ? 1e5 : temples);
}

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
      for (int i = 0; i < 2; i++) {
        float sx = i == 0 ? -1.0 : 1.0;
        vec2 v = f - vec2(sx*uEyeA.z, uEyeA.w);
        float open = smoothstep(er, er - 0.016, length(v*vec2(1.0, 1.0/uEyeA.y))) * smoothstep(lidY*uEyeA.y - 0.012, lidY*uEyeA.y + 0.012, v.y);
        // mad: the upper lid comes down at the INNER corner (toward his middle), so the eyes narrow
        // into a frown, and a short brow sits above each on the same slant
        float inner = -sx*v.x;
        float cut = -er*0.30 + 0.75*inner;
        open *= mix(1.0, smoothstep(cut - 0.012, cut + 0.012, v.y), uMad);
        float brow = smoothstep(0.024, 0.011, abs(v.y - (-er*1.30 + 0.55*inner))) * step(abs(v.x), er*0.95);
        eyes  = max(eyes, brow*uMad);
        eyes  = max(eyes, open);
        // the sparkle: one big catchlight up-left and a small one down-right, the same on both eyes
        shine = max(shine, uEyeB.x*open*max(smoothstep(0.052*k, 0.036*k, length(v - vec2(-0.046, -0.050*uEyeA.y)*k)),
                                    smoothstep(0.024*k, 0.012*k, length(v - vec2( 0.044,  0.044*uEyeA.y)*k))));
        // happy: the eye closes into an arc, ^ ^
        float a = abs(length(v - vec2(0.0, er*0.60)) - er*0.82);
        arcs  = max(arcs, smoothstep(0.036, 0.020, a) * step(v.y, er*0.25));
        // shut (asleep, deep in a doze, mid-blink): the lid's edge is a soft closed curve, not nothing
        float cx = clamp(v.x/(er*0.95), -1.0, 1.0);
        float lash = smoothstep(0.022, 0.010, abs(v.y - (er*0.10 + 0.32*er*(1.0 - cx*cx))))
                   * step(abs(v.x), er*0.95);
        shut  = max(shut, lash);
      }
      eyes = max(eyes, shut*smoothstep(0.80, 0.97, lid));
      // a wink: the second eye stays open, the first is an arc
      float winkArc = 0.0, winkOpen = 0.0;
      if (uEyeB.w > 0.5) {
        vec2 v0 = f - vec2(-uEyeA.z, uEyeA.w), v1 = f - vec2(uEyeA.z, uEyeA.w);
        winkArc = smoothstep(0.036, 0.020, abs(length(v0 - vec2(0.0, er*0.60)) - er*0.82)) * step(v0.y, er*0.25);
        winkOpen = smoothstep(er, er - 0.016, length(v1*vec2(1.0, 1.0/uEyeA.y)));
        eyes = max(winkOpen, max(winkArc, eyes*step(0.0, f.x)));
        shine *= step(0.0, f.x);
      }
      float eyeA = mix(eyes, arcs, max(uHappy, uEyeB.z));
      shine *= 1.0 - max(uHappy, uEyeB.z);
      // NO MOUTH (owner, 2026-09-24: "dont give the orb a mouth. dark doesnt show it and its cool asf").
      // His eyes carry every mood: the sparkle, ^ ^ when happy, lids for sleepy, wide for surprise,
      // brows for mad. A yawn is his lids and a deep breath now, not an open mouth.
      // No cheeks either (owner, 2026-09-24: "take out the rosy cheeks").
      // on dark glass (a black orb) his eyes turn light, or they would vanish into him
      vec3 eyeC = mix(vec3(0.86, 0.90, 0.95), DARK*0.9, smoothstep(0.45, 0.8, uVal));
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
    float fres = pow(max(0.0, 1.0 - z), 2.3);
    body += mix(LITE, hueRim*1.15, vcw*0.9) * fres * (0.30 + 0.35*vcw);
    vec2  away = -normalize(Ld.xy);
    float cres = smoothstep(0.10, 0.0, abs(nd - 0.80)) * pow(max(0.0, dot(normalize(pb + 1e-4), away)), 3.0);
    body += mix(PALE, hue*1.2, vcw) * cres * (0.22 + 0.25*vcw);

    float mensc = smoothstep(0.90, 1.0, nd) * smoothstep(1.0, 0.975, nd);
    body += PALE * mensc * (0.30 + 0.10*max(0.0,br));
    body += LITE * mensc * crest * 0.16;

    float edge = smoothstep(1.0, 1.0 - 2.6/Rg, nd);
    col += body * edge;
    // thin glass lets what is behind it through; the edge and the fluid do not
    A = max(A, edge * clamp(0.80 + 0.20*max(fres*1.6, core*0.75) + hot, 0.0, 1.0));
  }

  // ---- outer glow ---------------------------------------------------------
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
  A = max(A, g * gp * 0.78);

  // cast glow beneath, offset down: gives it somewhere to sit
  vec2 sp = vec2(p.x, p.y + Rg*0.62) * vec2(1.0, 1.9);
  float sh = exp(-max(0.0, length(sp)-Rg*0.52) / (Rg*0.34));
  col += DEEP * sh * 0.16;
  A = max(A, sh * 0.13);

  // ---- waking -------------------------------------------------------------
  // Was a hard ring expanding outward - a shockwave, and the most mechanical thing on him.
  // Now he simply blooms: the light he already gives off swells past the body and fades back,
  // carrying whatever colour the state is in rather than a white pulse.
  if (uWake > 0.001) {
    float b = exp(-max(0.0, db - Rg) / (Rg*0.55)) * uWake;
    col += mix(PALE, hueGlow, cwGlow*0.85) * b * 0.55;
    A = max(A, b*0.45);
    // and the body itself lifts, so the bloom reads as him brightening, not a light behind him
    col += mix(PALE, hueGlow, cwGlow*0.7) * exp(-db/(Rg*0.9)) * uWake * 0.10;
  }

  // ---- his glasses, on his face ------------------------------------------------------------------
  if (uSpecs > 0.5) {
    vec2 f = (pb/Rg)/0.94 - uGaze*0.16;                         // the face block's own space
    float cs = cos(uTilt), sn = sin(uTilt);
    f = vec2(cs*f.x - sn*f.y, sn*f.x + cs*f.y);
    vec4 g = specsSDF(f);
    float px = 1.3/(Rg*0.94);                                   // a pixel and a bit, in face units
    float onBody = smoothstep(0.55, 0.95, A);                   // the strap and the arms stop at his edge
    float lensA = smoothstep(px, -px, g.y);
    // the lens: clear glass with a faint sheen, or tinted (sunglasses: nearly hides his eyes), and a
    // streak of light across it, brighter the darker the glass
    float streak = smoothstep(0.05, 0.0, abs(fract((f.x - 0.8*f.y)*2.6 + 0.15) - 0.5) - 0.12);
    col = mix(col, uLensCol*0.85, lensA*uLensDark);
    col += PALE*lensA*(0.05 + streak*(0.05 + 0.28*uLensDark));
    float fa = max(smoothstep(px, -px, g.x), smoothstep(px, -px, g.w)*onBody);
    float lit = 0.82 + 0.30*clamp(-(f.y - uEyeA.w)/0.25, -0.6, 1.0);   // lit from above
    col = mix(col, uSpecsCol*lit + PALE*0.06, fa);
    float sa = smoothstep(px, -px, g.z)*onBody;
    col = mix(col, uSpecsCol2*(0.85 + 0.2*clamp(-(f.y - uEyeA.w)/0.06, -1.0, 1.0)), sa*(1.0 - fa));
    A = max(A, max(fa, max(sa, lensA*uLensDark)));
  }

  // ---- his hat, over him ------------------------------------------------------------------------
  // The same light as his glass: lit from up-left, a rim where it turns away, one hard highlight.
  if (uAcc > 0.5) {
    // the top of his head, as his outline has it now (his shape, his drift, a squash), the hat sunk onto it
    // (where on his head it sits and how big it is are measured per shape: uAccFit)
    float Rtop = uShapeD.y*Rg*(1.0 - 0.045*uMorph - 0.030*speak + uAccFit.x)*(1.0 - 0.5*uSquash) - 0.03*Rg;
    float Rhat = Rg*1.35*uAccFit.y;
    vec2 q = rot((p - vec2(0.0, -Rtop))/Rhat, uAccTilt);         // hats sized to his head, not to his glow
    vec2 h = accSDF(q);
    float e = 1.4/Rhat;                                          // a pixel and a half, in the hat's units
    float aa = smoothstep(e, -e, h.x);
    if (aa > 0.001) {
      float bevel = 0.07;
      float hgt = sqrt(clamp(-h.x/bevel, 0.0, 1.0));
      vec2 gq = vec2(accSDF(q + vec2(e, 0.0)).x - accSDF(q - vec2(e, 0.0)).x, accSDF(q + vec2(0.0, e)).x - accSDF(q - vec2(0.0, e)).x) / (2.0*e);
      vec3 N = normalize(vec3(gq*(1.0 - hgt)*1.6, 0.55 + hgt));
      vec3 Ld = normalize(vec3(-0.34, -0.62, 0.71));
      vec3 base = h.y > 1.5 ? uAccCol2 : h.y > 0.5 ? uAccCol2 : uAccCol;
      float lit = 0.50 + 0.55*max(0.0, dot(N, Ld));
      vec3 c = base*lit;
      c += PALE*pow(max(0.0, 1.0 - N.z), 2.2)*0.35;                          // the rim
      c += vec3(1.0)*pow(max(0.0, dot(N, normalize(Ld + vec3(0.0, 0.0, 1.0)))), 60.0)*0.75;   // the highlight
      if (h.y > 1.5) c += uAccCol2*(0.55 + 0.25*sin(t*2.2));        // a light of his own: it glows, gently
      col = aa >= 1.0 ? c : mix(col, c, aa);                        // in front of all of him, his ears too (owner, 10-03); solid,
                                                                    // it replaces what is under it (NaN x 0 is NaN: owner, 10-04)
      A = max(A, aa);
    }
    if (h.y > 1.5) {                                               // and the bead's glow reaches past it
      float gl = exp(-max(0.0, h.x)/0.10)*0.55;
      col += uAccCol2*gl*0.6; A = max(A, gl*0.5);
    }
  }

  col = col/(1.0+col*0.13);
  // THE WINDOW EDGE IS NEVER A LINE (orbgeom.js). The window is cut close to him, so the last
  // faint pixels of a listening glow reach it: fade them out over the final EDGE_FADE radii
  // instead of letting the window clip them square.
  vec2 edg = min(gl_FragCoord.xy, uRes - gl_FragCoord.xy);
  A *= smoothstep(0.0, R*uEdge, min(edg.x, edg.y));
  O = vec4(pow(max(col,0.0), vec3(0.95)), clamp(A,0.0,1.0));
}`;
