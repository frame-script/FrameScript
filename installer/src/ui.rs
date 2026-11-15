//! Questions, and what is said. A question is answered by `--yes` or `--no` when one is given, by
//! the person at the terminal otherwise, and without a terminal it isn't asked: that it would have
//! been is said, with what answers it, and remembered for the exit code.

use std::cell::Cell;
use std::io::{BufRead, IsTerminal, Write};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Answers {
    Ask,
    Yes,
    No,
}

pub struct Ui {
    answers: Answers,
    terminal: bool,
    /// A question went unanswered for want of a terminal.
    unanswered: Cell<bool>,
}

impl Ui {
    pub fn new(answers: Answers) -> Self {
        Self {
            answers,
            terminal: std::io::stdin().is_terminal(),
            unanswered: Cell::new(false),
        }
    }

    /// Whether a person can answer, and type a password for `sudo`.
    pub fn interactive(&self) -> bool {
        self.terminal
    }

    /// Whether a question went unanswered.
    pub fn unanswered(&self) -> bool {
        self.unanswered.get()
    }

    /// A question whose answer is yes unless it is said otherwise.
    pub fn confirm(&self, question: &str) -> bool {
        match self.answers {
            Answers::Yes => {
                println!("{question} [Y/n] yes (--yes)");
                true
            }
            Answers::No => {
                println!("{question} [Y/n] no (--no)");
                false
            }
            Answers::Ask if !self.terminal => {
                println!("{question}\n  not asked without a terminal: --yes answers yes");
                self.unanswered.set(true);
                false
            }
            Answers::Ask => {
                let answer = self.read(&format!("{question} [Y/n] "));
                let answer = answer.trim().to_ascii_lowercase();
                answer.is_empty() || answer == "y" || answer == "yes"
            }
        }
    }

    /// Something typed, or `None` without a terminal or when nothing is.
    pub fn text(&self, question: &str) -> Option<String> {
        if !self.terminal {
            return None;
        }
        let answer = self.read(&format!("{question} "));
        let answer = answer.trim();
        (!answer.is_empty()).then(|| answer.to_owned())
    }

    fn read(&self, prompt: &str) -> String {
        print!("{prompt}");
        let _ = std::io::stdout().flush();
        let mut line = String::new();
        let _ = std::io::stdin().lock().read_line(&mut line);
        line
    }
}

/// The start of a part of what is done.
pub fn heading(text: &str) {
    println!("\n== {text}");
}

/// Something that can go on, but isn't as it should be.
pub fn warn(text: &str) {
    println!("warning: {text}");
}
