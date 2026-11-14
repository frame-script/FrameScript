//! The preview worker: it renders what it is asked for, and loads the project again when a file
//! of it changes.

use framescript_engine::worker::{Event, PreviewWorker};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

fn copy_of_example() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("framescript-worker-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let example = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/hello"));
    for file in ["framescript.json", "main.tsx"] {
        std::fs::copy(example.join(file), dir.join(file)).unwrap();
    }
    dir
}

fn next(rx: &mpsc::Receiver<Event>) -> Event {
    rx.recv_timeout(Duration::from_secs(20)).expect("the worker answers")
}

#[test]
fn renders_wishes_and_reloads_changed_files() {
    let dir = copy_of_example();
    let (tx, rx) = mpsc::channel();
    let worker = PreviewWorker::spawn(dir.clone(), move |e| {
        let _ = tx.send(e);
    });

    let Event::Loaded { info, .. } = next(&rx) else {
        panic!("it loads first");
    };
    assert_eq!(info.clips.len(), 4);
    let Event::Frame(f) = next(&rx) else {
        panic!("then it renders the first frame");
    };
    assert_eq!(f.frame, 0);

    worker.seek(120);
    let Event::Frame(f) = next(&rx) else {
        panic!("a frame");
    };
    assert_eq!(f.frame, 120);
    let first_generation = f.generation;

    // The outro is made a second longer.
    std::thread::sleep(Duration::from_millis(50));
    let main = dir.join("main.tsx");
    let source = std::fs::read_to_string(&main).unwrap();
    std::fs::write(&main, source.replace("duration={seconds(2)}", "duration={seconds(3)}")).unwrap();

    let Event::Loaded { info: again, .. } = next(&rx) else {
        panic!("it loads again");
    };
    assert_eq!(again.duration_frames, info.duration_frames + 60);
    let Event::Frame(f) = next(&rx) else {
        panic!("and shows the same frame again");
    };
    assert_eq!(f.frame, 120);
    assert!(f.generation > first_generation);

    drop(worker);
    let _ = std::fs::remove_dir_all(dir);
}
