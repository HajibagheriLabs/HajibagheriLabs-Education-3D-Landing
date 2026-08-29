# HajibagheriLabs — 3D Particle Landing

A scroll-driven 3D particle landing page, built with plain HTML, hand-written CSS and
vanilla JavaScript. Three.js is the only library, loaded from a CDN through an import
map — there is no build step, no bundler and no backend. The whole site is three static
files plus fonts.

**Live:** https://hajibagherilabs.github.io/HajibagheriLabs-Education-3D-Landing/

## The constellation

One `THREE.Points` cloud morphs through three shapes as you scroll:

| Section | Shape | Built from |
| --- | --- | --- |
| 1 | Brain | two wrinkled ("gyri") sphere lobes + a parametric stem curve |
| 2 | Light bulb | `LatheGeometry` — dome, neck, screw base |
| 3 | Globe | a sphere whose samples survive only where a coarse ASCII continent map says "land" |

- Every particle is a **hollow, stroke-only triangle** — a canvas-generated texture,
  rotated per particle inside a custom `ShaderMaterial` fragment shader. Never filled dots.
- Positions are sampled with `MeshSurfaceSampler` into a **single buffer** holding three
  position attribute sets. Morphing happens in the vertex shader, blended by a
  scroll-driven `uProgress` with per-particle stagger and mid-flight bowing.
- Colour is chosen **per shape** from a fixed palette (yellow / violet / white / teal /
  magenta) with spatial weighting — amber crown on the bulb, yellow gyri crests on the
  brain, an even mix on the globe's land.
- Roughly 2% of particles are oversized accents; each triangle spins slowly. A second,
  sparse cloud drifts through the void around the shape. Additive blending, perspective
  size attenuation and a mild depth fade do the rest.

### Performance and accessibility

- One `BufferGeometry`, one `Points` object; the morph lerps the position buffer.
- `requestAnimationFrame` loop that pauses when the canvas is off-screen.
- `devicePixelRatio` is clamped; mobile renders far fewer particles and drops the mouse
  parallax.
- `prefers-reduced-motion` renders a single static shape with no scroll morph.

## Design

"Void & Voltage": a pure-black canvas, one saturated accent (`#8052ff`), white type that
glows, 1px hairline borders and generous empty space. No shadows, no gradients, no
elevation, no texture — depth comes only from colour contrast and negative space. Every
interactive surface is a 24px pill.

Persian (Farsi) throughout, RTL everywhere, set in self-hosted Vazirmatn across the full
weight range; the Latin wordmark uses Space Grotesk. Persian is a connected script, so
tracking stays at zero — the etched look at hero size comes from weight 200, not from
negative letter-spacing.

## Running it locally

No dependencies. Serve the folder over HTTP (the import map and font files need a real
origin — opening `index.html` from the filesystem will not work):

```bash
python -m http.server 8000
```

Then open http://127.0.0.1:8000/

## Layout

```
index.html                  the whole page
static/css/variables.css    design tokens (colors, type scale, spacing, radii)
static/css/main.css         fonts, reset, type scale, header, constellation
static/js/constellation.js  the Three.js particle system
static/js/main.js           back-to-top button
static/fonts/               Vazirmatn + Space Grotesk (woff2)
```

## Third-party assets

- [Three.js](https://threejs.org/) — MIT, loaded from jsDelivr at runtime.
- [Vazirmatn](https://github.com/rastikerdar/vazirmatn) by Saber Rastikerdar — SIL Open Font License 1.1.
- [Space Grotesk](https://github.com/floriankarsten/space-grotesk) by Florian Karsten — SIL Open Font License 1.1.

## License

[MIT](LICENSE) © Hadi Hajibagheri
