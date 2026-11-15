//! The frame is all a picture depends on: the example project gives the same scene for a frame
//! whatever was shown before it.

use framescript_engine::Composition;
use framescript_engine::render::OffscreenRenderer;
use std::path::Path;

fn project() -> &'static Path {
    Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/hello"))
}

/// Compared as pixels: the scenes of two documents are the same but for the numbers of their
/// nodes.
#[test]
fn a_frame_is_the_same_whatever_came_before() {
    let Ok(mut gpu) = OffscreenRenderer::new() else {
        eprintln!("no GPU to draw with; skipped");
        return;
    };
    gpu.set_size(Some((480, 270)));
    let mut composition = Composition::load(project()).expect("the example loads");
    let total = composition.info().duration_frames;
    assert!(total > 100, "the example lasts a while ({total} frames)");
    let frames: Vec<u32> = (0..total).step_by(13).chain([total - 1]).collect();

    // Played forwards, one after another.
    let forwards: Vec<Vec<u8>> = frames
        .iter()
        .map(|&f| gpu.rgba(&composition.render(f).expect("renders").0))
        .collect();
    drop(composition);

    // Jumped to backwards, in a new composition.
    let mut composition = Composition::load(project()).expect("the example loads");
    for (i, &f) in frames.iter().enumerate().rev() {
        let pixels = gpu.rgba(&composition.render(f).expect("renders").0);
        assert!(pixels == forwards[i], "frame {f} differs when it is reached backwards");
    }
    // Something moves: the frames aren't all alike.
    assert!(forwards.windows(2).any(|w| w[0] != w[1]));
}

#[test]
fn clips_are_laid_out_one_after_another_in_a_sequence() {
    let composition = Composition::load(project()).expect("the example loads");
    let info = composition.info();
    let by_label = |label: &str| {
        info.clips
            .iter()
            .find(|c| c.label.as_deref() == Some(label))
            .unwrap_or_else(|| panic!("there is a clip {label}"))
    };
    let (intro, cards, outro) = (by_label("intro"), by_label("cards"), by_label("outro"));
    assert_eq!(intro.start, 0);
    assert_eq!(cards.start, intro.end);
    assert_eq!(outro.start, cards.end);
    assert_eq!(outro.end - outro.start, 120, "two seconds at 60 fps");
    assert_eq!(info.duration_frames, outro.end);
    // The overlay has no duration: it lasts as long as the project.
    assert_eq!(by_label("overlay").end, info.duration_frames);
}
