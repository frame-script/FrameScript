//! Loads the modules of a project: files only, with TS and TSX transpiled.
//!
//! `"framescript"` and `"framescript/…"` resolve to the library. JSX is transpiled the classic
//! way, into `React.createElement`, which the library defines as a global (see
//! `packages/framescript/jsx.ts`): there is no pragma to write.

use deno_ast::{EmitOptions, MediaType, ParseParams, SourceMapOption, TranspileModuleOptions};
use deno_core::error::ModuleLoaderError;
use deno_core::{
    ModuleLoadOptions, ModuleLoadReferrer, ModuleLoadResponse, ModuleLoader, ModuleResolveResponse,
    ModuleSource, ModuleSourceCode, ModuleSpecifier, ModuleType, ResolutionKind,
};
use deno_error::JsErrorBox;
use std::path::{Path, PathBuf};

pub struct Loader {
    /// `packages/framescript`, as a file URL ending in `/`.
    library: ModuleSpecifier,
}

/// The name compositions import the library by.
const NAME: &str = "framescript";

impl Loader {
    pub fn new(library_dir: &Path) -> Self {
        let library = ModuleSpecifier::from_directory_path(library_dir)
            .unwrap_or_else(|_| panic!("{} is an absolute path", library_dir.display()));
        Self { library }
    }

    /// Where `framescript` and `framescript/<path>` are, if `specifier` is one of them.
    fn library(&self, specifier: &str) -> Option<ModuleSpecifier> {
        let rest = specifier.strip_prefix(NAME)?;
        let path = match rest.strip_prefix('/') {
            None if rest.is_empty() => "index.ts".to_string(),
            None => return None,
            Some("") => "index.ts".to_string(),
            Some(path) if Path::new(path).extension().is_some() => path.to_string(),
            Some(path) => format!("{path}.ts"),
        };
        self.library.join(&path).ok()
    }
}

impl ModuleLoader for Loader {
    fn resolve(&self, specifier: &str, referrer: &str, _kind: ResolutionKind) -> ModuleResolveResponse {
        if let Some(url) = self.library(specifier) {
            return Ok(url);
        }
        deno_core::resolve_import(specifier, referrer).map_err(JsErrorBox::from_err)
    }

    fn load(
        &self,
        specifier: &ModuleSpecifier,
        _referrer: Option<&ModuleLoadReferrer>,
        _options: ModuleLoadOptions,
    ) -> ModuleLoadResponse {
        ModuleLoadResponse::Sync(load(specifier))
    }
}

fn load(specifier: &ModuleSpecifier) -> Result<ModuleSource, ModuleLoaderError> {
    if specifier.scheme() != "file" {
        return Err(JsErrorBox::generic(format!(
            "{specifier}: only files can be imported"
        )));
    }
    let path = specifier
        .to_file_path()
        .map_err(|_| JsErrorBox::generic(format!("{specifier} is not a file path")))?;
    let code = std::fs::read_to_string(&path)
        .map_err(|e| JsErrorBox::generic(format!("{}: {e}", path.display())))?;
    let media_type = MediaType::from_specifier(specifier);
    let (module_type, code) = match media_type {
        MediaType::Json => (ModuleType::Json, code),
        MediaType::JavaScript | MediaType::Mjs => (ModuleType::JavaScript, code),
        MediaType::Jsx | MediaType::TypeScript | MediaType::Mts | MediaType::Tsx => {
            (ModuleType::JavaScript, transpile(specifier, code, media_type)?)
        }
        _ => {
            return Err(JsErrorBox::generic(format!(
                "{}: not a module FrameScript can load",
                path.display()
            )));
        }
    };
    Ok(ModuleSource::new(
        module_type,
        ModuleSourceCode::String(code.into()),
        specifier,
        None,
    ))
}

/// Types taken away and JSX made into calls, without checking anything. The source map goes inline,
/// where deno_core finds it for stack traces.
pub fn transpile(
    specifier: &ModuleSpecifier,
    code: String,
    media_type: MediaType,
) -> Result<String, ModuleLoaderError> {
    let parsed = deno_ast::parse_module(ParseParams {
        specifier: specifier.clone(),
        text: code.into(),
        media_type,
        capture_tokens: false,
        scope_analysis: false,
        maybe_syntax: None,
    })
    .map_err(JsErrorBox::from_err)?;
    let emitted = parsed
        .transpile(
            &Default::default(),
            &TranspileModuleOptions::default(),
            &EmitOptions {
                source_map: SourceMapOption::Inline,
                ..Default::default()
            },
        )
        .map_err(JsErrorBox::from_err)?
        .into_source();
    Ok(emitted.text)
}

/// The library that ships next to the sources; `FRAMESCRIPT_LIBRARY` overrides it.
pub fn default_library_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("FRAMESCRIPT_LIBRARY") {
        return PathBuf::from(dir);
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/framescript")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_library_is_found_by_its_name() {
        let loader = Loader::new(Path::new("/lib/framescript"));
        let resolve = |s| loader.resolve(s, "file:///project/main.tsx", ResolutionKind::Import);
        assert_eq!(resolve("framescript").unwrap().as_str(), "file:///lib/framescript/index.ts");
        assert_eq!(resolve("framescript/jsx").unwrap().as_str(), "file:///lib/framescript/jsx.ts");
        assert_eq!(
            resolve("framescript/internal/ops.ts").unwrap().as_str(),
            "file:///lib/framescript/internal/ops.ts"
        );
        assert_eq!(resolve("./scene.tsx").unwrap().as_str(), "file:///project/scene.tsx");
        assert!(resolve("framescript-extra").is_err(), "other bare names are not ours");
    }

    #[test]
    fn tsx_becomes_create_element() {
        let url = ModuleSpecifier::parse("file:///a.tsx").unwrap();
        let js = transpile(&url, "const a: number = <div>{1}</div>".into(), MediaType::Tsx).unwrap();
        assert!(js.contains("React.createElement(\"div\", null, 1)"), "{js}");
        assert!(!js.contains(": number"));
    }
}
