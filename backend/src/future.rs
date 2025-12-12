use std::{
    mem,
    sync::{Arc, Mutex},
};

use manual_future::{ManualFuture, ManualFutureCompleter};

#[derive(Debug)]
pub struct SharedManualFuture<T: Send> {
    value: Arc<Mutex<(Option<Arc<T>>, Vec<ManualFutureCompleter<Arc<T>>>)>>,
}

impl<T: Send> SharedManualFuture<T> {
    pub fn new() -> SharedManualFuture<T> {
        Self {
            value: Arc::new(Mutex::new((None, Vec::new()))),
        }
    }

    pub fn new_completed(value: T) -> Self {
        Self {
            value: Arc::new(Mutex::new((Some(Arc::new(value)), Vec::new()))),
        }
    }

    pub fn is_completed(&self) -> bool {
        self.value.lock().unwrap().0.is_some()
    }

    pub fn get_now(&self) -> Option<Arc<T>> {
        self.value.lock().unwrap().0.clone()
    }

    pub fn get(&self) -> ManualFuture<Arc<T>> {
        let mut value = self.value.lock().unwrap();

        match &value.0 {
            Some(value) => ManualFuture::new_completed(value.clone()),
            _ => {
                let (future, completer) = ManualFuture::new();
                value.1.push(completer);
                future
            }
        }
    }

    pub async fn complete(&self, complete_value: Arc<T>) {
        let (arc_complete_value, completers) = {
            let mut value = self.value.lock().unwrap();

            if value.0.is_some() {
                panic!("double complete!");
            }

            value.0 = Some(complete_value.clone());

            let mut completers = Vec::new();
            mem::swap(&mut completers, &mut value.1);

            (complete_value, completers)
        };

        for completer in completers {
            completer.complete(arc_complete_value.clone()).await;
        }
    }
}

impl<T: Send> Clone for SharedManualFuture<T> {
    fn clone(&self) -> Self {
        Self {
            value: self.value.clone(),
        }
    }
}
