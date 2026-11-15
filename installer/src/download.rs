//! Downloads, over HTTPS, and archives unpacked.

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, BufWriter, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::Agent::config_builder()
            .user_agent(concat!("create-framescript/", env!("CARGO_PKG_VERSION")))
            .build()
            .into()
    })
}

fn get(url: &str) -> Result<ureq::http::Response<ureq::Body>, String> {
    agent()
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("{url}: {e}"))
}

/// What a URL says, as JSON.
pub fn json(url: &str) -> Result<serde_json::Value, String> {
    let text = text(url)?;
    serde_json::from_str(&text).map_err(|e| format!("{url}: {e}"))
}

pub fn text(url: &str) -> Result<String, String> {
    get(url)?
        .body_mut()
        .read_to_string()
        .map_err(|e| format!("{url}: {e}"))
}

/// Writes what a URL has to `to`, and returns its SHA-256, in hexadecimal. What is there is
/// replaced only once all of it has come.
pub fn file(url: &str, to: &Path) -> Result<String, String> {
    let response = get(url)?;
    let total: Option<u64> = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok());
    if let Some(dir) = to.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let partial = with_suffix(to, "part");
    let mut out =
        BufWriter::new(File::create(&partial).map_err(|e| format!("{}: {e}", partial.display()))?);
    let mut body = response.into_body().into_reader();
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1 << 16];
    let (mut done, mut shown) = (0u64, 0u64);
    let terminal = std::io::stderr().is_terminal();
    loop {
        let n = body.read(&mut buffer).map_err(|e| format!("{url}: {e}"))?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
        out.write_all(&buffer[..n])
            .map_err(|e| format!("{}: {e}", partial.display()))?;
        done += n as u64;
        // Every 4 MB, in place, where someone looks at it.
        if terminal && done - shown >= 4 << 20 {
            shown = done;
            match total {
                Some(total) => eprint!("\r  {} / {} MB", done >> 20, total >> 20),
                None => eprint!("\r  {} MB", done >> 20),
            }
        }
    }
    out.flush()
        .map_err(|e| format!("{}: {e}", partial.display()))?;
    drop(out);
    if terminal && shown > 0 {
        eprintln!();
    }
    std::fs::rename(&partial, to).map_err(|e| format!("{}: {e}", to.display()))?;
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_owned();
    name.push(format!(".{suffix}"));
    path.with_file_name(name)
}

/// Unpacks an archive (`.tar.gz`, `.tar.xz` or `.zip`, by its name) whose contents are in one
/// directory, so that `dest` is that directory. What was at `dest` goes.
pub fn unpack(archive: &Path, dest: &Path) -> Result<(), String> {
    let staging = with_suffix(dest, "unpacking");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| format!("{}: {e}", staging.display()))?;
    let name = archive.to_string_lossy();
    let open = || File::open(archive).map_err(|e| format!("{}: {e}", archive.display()));
    let failed = |e: &dyn std::fmt::Display| format!("{}: {e}", archive.display());
    if name.ends_with(".tar.gz") {
        tar::Archive::new(flate2::read::GzDecoder::new(BufReader::new(open()?)))
            .unpack(&staging)
            .map_err(|e| failed(&e))?;
    } else if name.ends_with(".tar.xz") {
        // Unpacked through a file: the decoder writes rather than reads.
        let tar_file = with_suffix(archive, "tar");
        {
            let mut out = BufWriter::new(File::create(&tar_file).map_err(|e| failed(&e))?);
            lzma_rs::xz_decompress(&mut BufReader::new(open()?), &mut out)
                .map_err(|e| failed(&e))?;
            out.flush().map_err(|e| failed(&e))?;
        }
        let unpacked = File::open(&tar_file).map_err(|e| failed(&e)).and_then(|f| {
            tar::Archive::new(BufReader::new(f))
                .unpack(&staging)
                .map_err(|e| failed(&e))
        });
        let _ = std::fs::remove_file(&tar_file);
        unpacked?;
    } else if name.ends_with(".zip") {
        zip::ZipArchive::new(BufReader::new(open()?))
            .and_then(|mut z| z.extract(&staging))
            .map_err(|e| failed(&e))?;
    } else {
        return Err(format!("{}: not an archive this knows", archive.display()));
    }
    // GitHub's archives have a file of their own next to the directory.
    let dirs: Vec<PathBuf> = std::fs::read_dir(&staging)
        .map_err(|e| format!("{}: {e}", staging.display()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    let [inner] = dirs.as_slice() else {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!("{}: not one directory inside", archive.display()));
    };
    if dest.exists() {
        std::fs::remove_dir_all(dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    }
    std::fs::rename(inner, dest).map_err(|e| format!("{}: {e}", dest.display()))?;
    let _ = std::fs::remove_dir_all(&staging);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tar.gz with a directory inside, and a file beside it as GitHub has, becomes the directory.
    #[test]
    fn the_directory_inside_is_what_is_unpacked() {
        let dir =
            std::env::temp_dir().join(format!("create-framescript-unpack-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("a.tar.gz");
        {
            let gz = flate2::write::GzEncoder::new(
                File::create(&archive).unwrap(),
                flate2::Compression::fast(),
            );
            let mut tar = tar::Builder::new(gz);
            let mut add = |path: &str, data: &[u8]| {
                let mut header = tar::Header::new_gnu();
                header.set_size(data.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                tar.append_data(&mut header, path, data).unwrap();
            };
            add("pax_global_header", b"52 comment=0000\n");
            add("FrameScript-2.0.1/README.md", b"hello");
            add(
                "FrameScript-2.0.1/packages/framescript/index.ts",
                b"export {}",
            );
            tar.into_inner().unwrap().finish().unwrap();
        }
        let dest = dir.join("2.0.1");
        unpack(&archive, &dest).unwrap();
        assert_eq!(
            std::fs::read_to_string(dest.join("README.md")).unwrap(),
            "hello"
        );
        assert!(dest.join("packages/framescript/index.ts").exists());
        assert!(
            !with_suffix(&dest, "unpacking").exists(),
            "nothing is left beside it"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
