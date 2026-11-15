//! A frame drawn at another size is laid out as at the project's: smaller in the preview, or
//! larger or smaller when exported at a scale.
//!
//! AntiWebUI rounds every length to whole pixels of what it paints, so laid out at a scale, 60
//! boxes 7.4 px high would come to 60 × 7 px at the project's size, 60 × 4 px at half of it
//! (3.7 rounded) and 60 × 2 px at a third (2.47), and a line of text would be a different height.

use framescript_engine::Composition;
use framescript_engine::render::OffscreenRenderer;

const MAIN: &str = r##"import { Timeline } from "framescript"
export default function Main() {
  return (
    <Timeline>
      <div style={{ display: "flex", flexDirection: "row", width: "100%", height: "100%", background: "#ffffff" }}>
        <div style={{ display: "flex", flexDirection: "column", width: 300 }}>
          {Array.from({ length: 60 }, () => <div style={{ height: 7.4, flexShrink: 0 }} />)}
          <div style={{ height: 40, background: "#ff0000", flexShrink: 0 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 233 }}>
          <div style={{ fontSize: 37, lineHeight: 1.27 }}>The quick brown fox jumps over the lazy dog again and again</div>
          <div style={{ height: 40, background: "#0000ff", flexShrink: 0 }} />
        </div>
      </div>
    </Timeline>
  )
}
"##;

#[test]
fn a_frame_is_laid_out_the_same_at_any_size() {
    let dir = std::env::temp_dir().join(format!("framescript-scale-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("framescript.json"),
        r#"{ "width": 1920, "height": 1080, "fps": 30, "entry": "main.tsx" }"#,
    )
    .unwrap();
    std::fs::write(dir.join("main.tsx"), MAIN).unwrap();
    let Ok(mut gpu) = OffscreenRenderer::new() else {
        eprintln!("no GPU to draw with; skipped");
        return;
    };
    let mut c = Composition::load(&dir).expect("it loads");
    assert_eq!(c.size(), (1920, 1080));
    let (scene, _) = c.render(0).expect("it renders");

    // Where the top of the box in column `x` of the project is, in pixels of the project: the
    // first row mostly of its color.
    let mut top_at = |size: Option<(u32, u32)>, x: f64, red: bool| {
        gpu.set_size(size);
        let (w, h) = gpu.size_of(&scene);
        let rgba = gpu.rgba(&scene);
        let ratio = 1920.0 / w as f64;
        let col = (x / ratio) as usize;
        let y = (0..h as usize)
            .find(|&y| {
                let p = &rgba[(y * w as usize + col) * 4..][..3];
                let (on, off) = if red { (p[0], p[2]) } else { (p[2], p[0]) };
                on > 200 && off < 100 && p[1] < 100
            })
            .expect("the box is drawn");
        (y as f64 * ratio, ratio)
    };
    let (red, _) = top_at(None, 150.0, true);
    let (blue, _) = top_at(None, 400.0, false);
    assert_eq!(red, 420.0, "60 boxes of 7 px");
    for size in [(1440, 810), (960, 540), (768, 432), (640, 360), (480, 270), (3840, 2160)] {
        for (x, red_box, at_full) in [(150.0, true, red), (400.0, false, blue)] {
            let (y, ratio) = top_at(Some(size), x, red_box);
            assert!(
                (y - at_full).abs() <= ratio + 1.0,
                "at {size:?}, the {} box is at {y}, not {at_full}",
                if red_box { "red" } else { "blue" }
            );
        }
    }
}
