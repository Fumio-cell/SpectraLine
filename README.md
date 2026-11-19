# SpectraLine

**Every picture holds a current and a spectrum.**
**SpectraLine draws them. Nothing added.**

**どんな絵にも、流れとスペクトルがある。**
**SpectraLine はそれを描く。何も足さない。**

SpectraLine turns a picture into line art. Open a picture, or try one of the three samples, and it is drawn in your browser: no upload, no account. You can export the result as a PNG, on black or on a transparent background, at up to 4096 px.

"Nothing added" is a rule, not a slogan. Every property of every line is measured from the picture: its direction, its colour, its brightness and its width. The same picture, look and settings always give the same pixels.

## The four looks

| Look | What it draws |
|---|---|
| **CURRENT** | the flow of form. Lines follow the picture's edges and brushwork. |
| **RIPTIDE** | only the strongest pull. Fewer, longer, wider lines. |
| **TOPO** | light, mapped as terrain. Contours of luminance. |
| **PRISM** | light, split by wavelength. Lines in the colours of the picture's spectrum. |

## Controls

- **Look**: CURRENT, RIPTIDE, TOPO or PRISM.
- **Scale**: from fine to broad. It sets how coarsely the picture is read. Fine gives a nervous grain that follows every brushstroke; broad gives long sweeps across the whole picture. Line width, length and spacing follow it. Nothing is added at any scale: every line is still read from the picture.
- **Contrast**: how strongly the picture's energy sets the brightness and width of a line (0 draws every line alike).
- **Background**: black or transparent.
- **Spectrum of this picture** (PRISM only): the picture's own measured spectrum, one cell per wavelength band, as tall as the band's share of the picture's light and in the band's colour. Click a band to draw only it, click more to add, "All" to draw every band.
- **Motion**: STILL (the default), EMERGE, PULSE or EMERGE + PULSE, and a length from 3 to 15 s. EMERGE: from black, each line grows from its start along the flow, at staggered times, until the still is complete. PULSE: a comet of light travels along every line in its direction and loops without a seam; between comets a line rests at 15 % of the still, and a comet brings it back to the still, never above. EMERGE + PULSE draws the picture at a steady rate for 30 % of the clip, then eases the base down to the pulse floor (30 % of the length, 1.4 to 3 s) while the pulses show, and keeps flowing. Motion runs only along the lines the still draws; light travels faster where the picture's energy is stronger (120 to 420 px per second at 1024 px), and the colour of a line is the still's. Every frame is a pure function of the picture, the settings and the time. Scale, Contrast, the look, the PRISM band choice and the background all apply. Play and Pause are above the picture.
- **Export**: PNG at 1024, 2048 or 4096 px. With a motion chosen, also: **MP4** (H.264, 30 fps, no sound, on black) in HD (short side 1080 px) or 4K (short side 2160 px), the picture's aspect kept; and a **PNG sequence** (a zip of numbered frames, with real alpha when the background is Transparent, so it can be laid over other footage; at 4K up to 8 s). The free preview exports MP4 at 1024 px on the long side with a watermark.

## About PRISM

PRISM's colours are CIE dominant wavelengths computed from the picture's RGB values: for each pixel, the dominant wavelength and the excitation purity of its colour (sRGB, D65 white point, CIE 1931 2-degree observer). The picture is split into wavelength bands and each band is drawn in its own hue at the purity measured at that point. Purple colours have no dominant wavelength, so they get their own band. Pixels too dark or too grey for their colour to be measured (purity times luminance under 0.005, where one step of the 8-bit value moves the wavelength by more than half a band) are left out of the spectrum.

A photograph does not contain the physical spectrum of the light it shows; it holds three numbers per pixel. **SpectraLine does not claim to recover the real spectrum.** PRISM shows what the colours of the picture are, as wavelengths.

## Run it

```
npm install
npm run dev
```

`npm run build` makes the one build that serves everyone. It starts as the free preview (exports capped at 1024 px, with a watermark); a license key entered under **Unlock** in the header turns it into the full version, at run time. `npm run build:demo` produces the same bundle.

## Notes

- The sample picture is credited to its author: Sample image by Miho Morita.
- Interface fonts (Archivo, IBM Plex Mono) are self-hosted under the SIL Open Font License; see `src/fonts/OFL.txt`. The page makes no request to any other host, except to Lemon Squeezy, our payment provider, when a license key is activated, deactivated or re-checked (about once a week): that request carries the key, never a picture.

*Part of the Poetic Signal Toolkit*
