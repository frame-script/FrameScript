use std::{env, error::Error, path::PathBuf};

pub fn resolve_path_to_string(input: &str) -> Result<String, Box<dyn Error>> {
    let env_expanded = shellexpand::env(input)?; // -> Cow<str>

    let tilde_expanded = shellexpand::tilde(&env_expanded);

    let mut path = PathBuf::from(tilde_expanded.as_ref());

    if !path.is_absolute() {
        path = env::current_dir()?.join(path);
    }

    path = match dunce::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => path,
    };

    Ok(path.to_string_lossy().into_owned())
}
