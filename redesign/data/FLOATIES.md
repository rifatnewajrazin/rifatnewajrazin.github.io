# Hero floaties — art spec

The "floaties" are the little draggable objects scattered over the hero.
They're editable from the CMS (**Hero Floaties** collection → `data/floaties.json`)
or by hand in that file.

Three kinds of object:

| Type | What it is | Fields that matter |
|------|------------|--------------------|
| `doodle` | one of the 8 built-in inline-SVG line drawings | `preset`, `width`, `x`, `y` |
| `image` | your own artwork file | `src`, `width`, `x`, `y` |
| `kaomoji` | a text face like `\( ^_^ )/` | `text`, `size`, `x`, `y` |

`x` / `y` are **percentages of the hero box** — `x` 0 = left edge, 100 = right
edge; `y` 0 = top, 100 = bottom. (Values 0–1 also work.) The object is centred
on that point, then nudged inward so it never clips off-screen.

Floaties are **desktop only** — the whole layer is hidden on screens ≤ 820px,
on touch devices, and for visitors who ask for reduced motion. Don't put
anything load-bearing in them.

---

## Replacing a doodle with your own image

Set the object's **Type** to *Your image* and upload the file (it lands in
`redesign/uploads/` and is served from `/redesign/uploads/…`).

### Format — in order of preference

1. **SVG** — best. Crisp at any size, a few KB, no retina math. Export with:
   - shapes only, **no embedded raster images**
   - text converted to outlines / paths
   - a tight `viewBox` (see "Trim" below)
   - if you want it to follow the site's ink colour, use `stroke="currentColor"`
     / `fill="currentColor"` and no hard-coded colours; otherwise it just keeps
     whatever colours you drew.
2. **PNG** — fine for painterly / textured art. Must have a **transparent
   background**. Export at **3× the on-screen width** (table below) for retina.
3. **WebP** — same rules as PNG (transparency on, 3×). Slightly smaller files.
   Safe for all current browsers.

Not: JPEG (no transparency), GIF.

Keep each file **under ~150 KB** (ideally < 40 KB). They're decoration.

### Trim / canvas

Export the art **cropped tight to the ink** — no baked-in padding or
centred-on-a-big-square margins. The code sizes each object by width and
spins/bobs it around its own centre, so extra transparent space throws off
both the placement and the wobble pivot.

### On-screen sizes

`width` in the CMS is the **CSS pixel width** the object renders at. Height
follows the file's aspect ratio automatically. These are the defaults the 8
built-ins use — match the slot you're replacing, or pick your own:

| Slot | `width` (CSS px) | Export at 3× (PNG/WebP) | Rough aspect |
|------|-----------------|--------------------------|--------------|
| laptop   | 128 | 384 px wide | ~5:4 landscape |
| keyboard | 124 | 372 px wide | ~16:9 landscape |
| undo     | 96  | 288 px wide | ~5:2 wide |
| monitor  | 86  | 258 px wide | ~square |
| wallet   | 80  | 240 px wide | ~4:3 landscape |
| notebook | 58  | 174 px wide | ~3:4 portrait |
| mouse    | 56  | 168 px wide | ~3:4 portrait |
| cursor   | 44  | 132 px wide | ~7:8 portrait |

If you're adding new objects rather than swapping, anything in the
**40–140 px** width range sits well with the rest.

### Style, if you want them to match the built-ins

Monoline, hand-drawn feel: ~3 px round-cap / round-join strokes, no fill,
single colour (the site ink is a warm near-black, `#17161a`). A drop shadow is
added by CSS — don't bake one in.

---

## Kaomoji

Pure text, styled in the site's handwriting font. Just set `text` and `size`
(px, ~24–34 looks right). No file needed.

---

## Quick reference — one entry in `floaties.json`

```json
{ "type": "doodle",  "preset": "laptop",            "x": 13, "y": 30, "width": 128 }
{ "type": "image",   "src": "/redesign/uploads/plant.svg", "x": 50, "y": 20, "width": 90 }
{ "type": "kaomoji", "text": "\\( ^_^ )/",          "x": 50, "y": 12, "size": 30 }
```

A missing file, an empty list, or broken JSON just falls back to the 12
built-in objects — you can't break the hero from here. A single image that
fails to load quietly removes itself.
