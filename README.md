# Photoshop Lite 🎨

A lightweight, Photoshop-inspired image editor that runs entirely in the browser.
No build step, no dependencies, no server — just open it and edit.

## ✨ Features

**Layers**
- Add, duplicate, delete, reorder (drag & drop), rename (double-click)
- Opacity slider + 16 blend modes (Multiply, Screen, Overlay, Difference…)
- Visibility toggles, Merge down, Flatten image

**Tools**
| Tool | Shortcut | What it does |
|---|---|---|
| Move | `V` | Drag the active layer or selected pixels |
| Rect select | `M` | Marching-ants selection for copy / cut / fill / filters |
| Brush | `B` | Soft/hard round brush with size, opacity, hardness |
| Eraser | `E` | Soft/hard eraser |
| Paint bucket | `G` | Flood fill with adjustable tolerance |
| Gradient | `Shift+G` | Foreground → background linear gradient |
| Eyedropper | `I` | Pick foreground color (Alt = background) |
| Text | `T` | Click anywhere and type, custom font + size |
| Shapes | `U` | Rectangle / ellipse / line, fill + stroke options |
| Crop | `C` | Drag a region, press `Enter` to apply |
| Hand | `H` / `Space` | Pan around the canvas |
| Zoom | `Z` | Click to zoom in, `Alt+click` to zoom out |

**Adjustments & Filters**
- Live-preview sliders: Brightness, Contrast, Saturation, Hue, Exposure, Blur → Apply bakes into the layer
- One-click filters: Grayscale, Invert, Sepia, Threshold, Gaussian blur, Sharpen, Emboss, Vignette
- Auto-contrast + Canvas rotate / flip + Layer flip / rotate + Canvas resize

**Workflow**
- 40-step undo/redo with a clickable History panel
- Open images (file picker or drag & drop), place images as new layers
- Export to PNG / JPG / WebP, save & reload full projects as `.json`
- `Ctrl+scroll` to zoom, `X` to swap colors, `[` `]` for brush size

## 🚀 Run it

No installation. Either:

1. Double-click `index.html`, or
2. Serve it locally (avoids any `file://` quirks):
   ```bash
   cd "Photoshop Lite"
   python3 -m http.server 8000
   # → http://localhost:8000
   ```

## ⌨️ Key shortcuts

`Ctrl+N` new · `Ctrl+O` open · `Ctrl+S` export PNG · `Ctrl+Z/Y` undo/redo ·
`Ctrl+E` merge down · `Ctrl+A/D` select all / deselect · `Ctrl+X/C/V` cut / copy / paste ·
`Del` clear · `Ctrl+0` fit · `Ctrl+1` 100% · `'` grid · arrows nudge layer (`Shift` = ×10)

## 📁 Structure

```
Photoshop Lite/
├── index.html   # UI shell (menus, toolbar, panels, canvas, modals)
├── styles.css   # dark Photoshop-like theme
├── app.js       # engine: layers, tools, filters, history, file I/O
└── README.md
```

## 🛠️ Built with

Vanilla HTML + CSS + JavaScript and the Canvas 2D API. Everything (layers, compositing,
flood fill, convolutions, history snapshots) is hand-rolled — view-source friendly.

## 🗺️ Ideas for later

- Free-transform handles, magnetic lasso, layers thumbnails drag preview
- More brushes (chalk, airbrush), layer masks, guides & snapping
- `.psd` import, cloud save
