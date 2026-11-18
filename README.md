# SpectraLine

**Every picture holds a current and a spectrum.**
**SpectraLine draws them. Nothing added.**

**どんな絵にも、流れとスペクトルがある。**
**SpectraLine はそれを描く。何も足さない。**

SpectraLine turns a picture into line art. Open a picture and it is drawn in your browser: no upload, no account. You can export the result as a PNG, on black or on a transparent background, at up to 4096 px.

"Nothing added" is a rule, not a slogan. Every property of every line is measured from the picture: its direction, its colour, its brightness and its width. The seed decides only where lines start. The same picture, look and settings always give the same pixels.

## The four looks

| Look | What it draws |
|---|---|
| **CURRENT** | the flow of form. Lines follow the picture's edges and brushwork. |
| **RIPTIDE** | only the strongest pull. Fewer, longer, wider lines. |
| **TOPO** | light, mapped as terrain. Contours of luminance. |
| **PRISM** | light, split by wavelength. Lines in the colours of the picture's spectrum. |

## Controls

Look, Contrast (how strongly the picture's energy sets brightness and width; 0 draws every line alike), Bands (PRISM only), Seed with Random, Background (black or transparent), Export size and Export.

## About PRISM

PRISM's colours are CIE dominant wavelengths computed from the picture's RGB values: for each pixel, the dominant wavelength and the excitation purity of its colour (sRGB, D65 white point, CIE 1931 2-degree observer). The picture is split into wavelength bands and each band is drawn in its own hue at the purity measured at that point. Purple colours have no dominant wavelength, so they get their own band.

A photograph does not contain the physical spectrum of the light it shows; it holds three numbers per pixel. **SpectraLine does not claim to recover the real spectrum.** PRISM shows what the colours of the picture are, as wavelengths.

## Run it

```
npm install
npm run dev
```

`npm run build` makes the full version; `npm run build:demo` makes the free preview (exports capped at 1024 px, with a watermark).

## Notes

- The sample picture is credited to its author: Sample image by Miho Morita.
- Interface fonts (Archivo, IBM Plex Mono) are self-hosted under the SIL Open Font License; see `src/fonts/OFL.txt`. The page makes no request to any other host.

*Part of the Poetic Signal Toolkit*
