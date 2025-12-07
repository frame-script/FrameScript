use std::{env, error::Error, path::PathBuf, sync::Mutex};

pub mod macros {
    macro_rules! once {
        ($expr:expr) => {{
            static INIT: std::sync::Once = std::sync::Once::new();

            INIT.call_once(|| {
                $expr;
            })
        }};
    }

    pub(crate) use once;
}

#[derive(Debug)]
pub struct AtomicCell<T: Copy> {
    pub value: Mutex<T>,
}

impl<T: Copy> AtomicCell<T> {
    pub fn new(value: T) -> Self {
        Self {
            value: Mutex::new(value),
        }
    }

    pub fn get(&self) -> T {
        *self.value.lock().unwrap()
    }

    pub fn set(&self, value: T) {
        *self.value.lock().unwrap() = value;
    }
}

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
