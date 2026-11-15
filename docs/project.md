# Projects, commands and the studio

## A project

A project is a directory:

| | |
|---|---|
| `framescript.json` | its settings |
| `main.tsx` | the entry module (its name is in the settings): its default export is the video |
| `tsconfig.json` | for editors: where `framescript` is (`create-framescript` writes it) |
| `assets/`, … | pictures, videos, sounds, models: a path in the code is from the project's directory |
| `out/` | where `framescript export` writes, unless it is told otherwise |

`create-framescript new <dir>` makes one (see [installing](installing.md)); `examples/` has more.

### framescript.json

```json
{ "name": "hello", "width": 1920, "height": 1080, "fps": 60, "entry": "main.tsx", "background": "#0b1020" }
```

| | without it | |
|---|---|---|
| `name` | `"untitled"` | the name, which an export is called by |
| `width`, `height` | `1920`, `1080` | the size of a frame, in pixels |
| `fps` | `60` | frames per second |
| `entry` | `"main.tsx"` | the module whose default export is the root component |
| `background` | `"#000000"` | a CSS color behind everything |
| `duration` | | in seconds; without it, the project lasts as long as its clips |

The entry module can import other `.ts` / `.tsx` files of the project, `.wgsl` files (as their
code), and `framescript` and `framescript/3d`.

## Commands

```sh
framescript [studio] <project>
framescript render <project> [--frame N]... [--out FILE] [--width W]
framescript export <project> [--out FILE] [--codec h264|h265|av1|prores] [--quality CRF]
                   [--speed fast|medium|slow] [--scale S] [--from F] [--to F]
                   [--workers N] [--audio KBPS | --no-audio]
```

- `render` writes frames as PNGs: `FILE` is `frame-N.png` unless it is said, and with several
  frames, `{}` in it is the number. `--width` draws them smaller or larger (see below).
- `export` writes the video with its sound, `<project>/out/<name>.mp4` unless it is said; the
  frames are `--from` up to (not with) `--to`. See [exporting](export.md).
- From a checkout of this repository, `cargo run --release --` stands for `framescript`.

## The studio

`framescript <project>` opens it. Space plays and pauses, ← / → step a frame (a second with
Shift), Home / End go to the ends, and pressing or dragging on the timeline seeks. The film button
at the right of the transport opens the export window. Saving a file of the project loads it again.

A frame is always laid out and painted at the project's size: AntiWebUI rounds every length to
whole pixels of what it paints, so at another scale things would be somewhere else. The preview
shows that picture made smaller to fit (each pixel the average of what it covers), and an export
at another size, or `render --width`, is made from it too, so what is seen is where it is exported.

Sound goes out through ALSA on Linux (PipeWire and PulseAudio take that in), WASAPI on Windows and
Audio Queue Services on macOS; `ANTIWEBUI_AUDIO_DEVICE=none` turns it off.
