//! The studio's settings: how it looks, kept in the user's config folder, and a window that
//! changes them and tells what the studio runs on.

use crate::system::{self, Section};
use anti_webui::prelude::*;
use anti_webui_md3e::components::{
    ButtonStyle, TabsStyle, connected_button_group, outlined_button, sized_icon, styled_button,
    styled_tabs, tab, tooltip,
};
use anti_webui_md3e::typography::TextStyle;
use anti_webui_md3e::{
    ColorScheme, SchemeOptions, SchemeVariant, color_scheme, icons, motion, set_color_scheme,
    set_color_scheme_animated,
};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;

/// The accent unless another is chosen: a light blue.
const SKY: u32 = 0x03a9f4;

/// The colors the accent can come from: hues apart, and a gray.
pub const ACCENTS: [(&str, u32); 11] = [
    ("Violet", 0x6750a4),
    ("Indigo", 0x4355b9),
    ("Blue", 0x0b62c4),
    ("Sky", SKY),
    ("Teal", 0x006a6a),
    ("Green", 0x3a7a28),
    ("Amber", 0x9a6a00),
    ("Orange", 0xc4521a),
    ("Red", 0xbb1b2a),
    ("Pink", 0xb02e6a),
    ("Slate", 0x5f6368),
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Dark,
    Light,
}

/// How much of the accent's color the scheme takes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Style {
    #[default]
    Tonal,
    Vibrant,
    Expressive,
    Neutral,
}

impl Style {
    const ALL: [Style; 4] = [
        Style::Tonal,
        Style::Vibrant,
        Style::Expressive,
        Style::Neutral,
    ];

    fn label(self) -> &'static str {
        match self {
            Style::Tonal => "Tonal",
            Style::Vibrant => "Vibrant",
            Style::Expressive => "Expressive",
            Style::Neutral => "Neutral",
        }
    }

    fn variant(self) -> SchemeVariant {
        match self {
            Style::Tonal => SchemeVariant::TonalSpot,
            Style::Vibrant => SchemeVariant::Vibrant,
            Style::Expressive => SchemeVariant::Expressive,
            Style::Neutral => SchemeVariant::Neutral,
        }
    }
}

/// What is kept between runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub mode: Mode,
    /// The color the scheme is made from, as `#rrggbb`.
    pub accent: String,
    pub style: Style,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            mode: Mode::Dark,
            accent: hex(SKY),
            style: Style::Tonal,
        }
    }
}

fn hex(rgb: u32) -> String {
    format!("#{rgb:06x}")
}

impl Settings {
    fn seed(&self) -> u32 {
        u32::from_str_radix(self.accent.trim_start_matches('#'), 16).unwrap_or(SKY)
    }

    fn scheme_with(&self, seed: u32) -> ColorScheme {
        ColorScheme::from_seed_with(
            Color::from_rgb(seed),
            SchemeOptions {
                variant: self.style.variant(),
                dark: self.mode == Mode::Dark,
                contrast: 0.0,
            },
        )
    }

    pub fn scheme(&self) -> ColorScheme {
        self.scheme_with(self.seed())
    }

    /// Makes the studio look like this: at once, or changing over a moment.
    pub fn apply(&self, animated: bool) {
        set_theme(match self.mode {
            Mode::Dark => Theme::dark(),
            Mode::Light => Theme::light(),
        });
        if animated {
            set_color_scheme_animated(self.scheme(), motion::slow_effects());
        } else {
            set_color_scheme(self.scheme());
        }
    }

    /// From the config folder, or the defaults.
    pub fn load() -> Self {
        let Some(path) = path() else {
            return Settings::default();
        };
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                eprintln!(
                    "framescript: {} is not settings ({e}); using the defaults",
                    path.display()
                );
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
    }

    fn save(&self) {
        let Some(path) = path() else {
            return;
        };
        let written = path
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| {
                let text = serde_json::to_string_pretty(self).expect("plain data");
                std::fs::write(&path, text + "\n")
            });
        if let Err(e) = written {
            eprintln!("framescript: can't write {}: {e}", path.display());
        }
    }
}

/// `$XDG_CONFIG_HOME/framescript/settings.json`, or the same under `~/.config`.
fn path() -> Option<PathBuf> {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(config.join("framescript").join("settings.json"))
}

pub struct SettingsWindow {
    settings: Signal<Settings>,
    tab: Signal<usize>,
    /// What takes a moment to find out, once it has been.
    slow: Signal<Option<Vec<Section>>>,
    asked: Cell<bool>,
    found: UiSender<Vec<Section>>,
    window: RefCell<Option<WindowHandle>>,
}

impl SettingsWindow {
    /// Made in the studio's window, with the settings it started with, which it has applied.
    pub fn new(settings: Settings) -> Rc<Self> {
        let slow = signal(None);
        Rc::new(SettingsWindow {
            settings: signal(settings),
            tab: signal(0),
            slow,
            asked: Cell::new(false),
            found: ui_channel(move |s| slow.set(Some(s))),
            window: RefCell::new(None),
        })
    }

    /// Opens the window, unless it is open.
    pub fn open(self: &Rc<Self>) {
        if self.window.borrow().as_ref().is_some_and(|w| w.is_open()) {
            return;
        }
        if !self.asked.replace(true) {
            let found = self.found.clone();
            std::thread::spawn(move || found.send(system::slowly()));
        }
        let this = self.clone();
        let window = open_window(
            WindowOptions::new()
                .title("Settings")
                .size(560, 540)
                .dialog(true)
                .background(color_scheme().surface_container_low),
            move || view(this),
        );
        *self.window.borrow_mut() = Some(window);
    }

    fn change(&self, f: impl FnOnce(&mut Settings)) {
        let mut s = self.settings.get_untracked();
        f(&mut s);
        if s != self.settings.get_untracked() {
            s.apply(true);
            s.save();
            self.settings.set(s);
        }
    }
}

fn view(this: Rc<SettingsWindow>) -> impl IntoView {
    let tab_index = this.tab;
    let body = {
        let this = this.clone();
        dyn_view(move || match tab_index.get() {
            0 => appearance(this.clone()).into_view(),
            _ => system_view(this.clone()).into_view(),
        })
    };
    div()
        .size_full()
        .flex()
        .flex_col()
        .dyn_style(|s| {
            let c = color_scheme();
            s.bg(c.surface_container_low).text_color(c.on_surface)
        })
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(8.0)
                .px(20.0)
                .pt(18.0)
                .pb(10.0)
                .child(
                    sized_icon(icons::SETTINGS, 18.0)
                        .dyn_style(|s| s.text_color(color_scheme().on_surface_variant)),
                )
                .child(TextStyle::TITLE_SMALL.apply(text("Settings"))),
        )
        .child(
            styled_tabs(
                vec![tab("Appearance"), tab("System")],
                tab_index,
                TabsStyle::secondary(),
            )
            .dyn_style(|s| s.bg(color_scheme().surface_container_low)),
        )
        .child(div().flex_1().min_h(0.0).flex().flex_col().child(body))
        .child(
            div()
                .flex()
                .flex_row()
                .justify_end()
                .px(20.0)
                .pb(16.0)
                .pt(8.0)
                .child(outlined_button("Close").on_click(|_| close_window())),
        )
}

/// A line of the form: what it is, and what sets it.
fn row(label: &str, content: impl IntoView) -> Div {
    div()
        .flex()
        .flex_row()
        .items_center()
        .gap(10.0)
        .min_h(44.0)
        .child(
            text(label.to_string())
                .w(96.0)
                .flex_none()
                .text_size(13.0)
                .dyn_style(|s| s.text_color(color_scheme().on_surface_variant)),
        )
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .flex_1()
                .min_w(0.0)
                .child(content),
        )
}

fn appearance(this: Rc<SettingsWindow>) -> Div {
    let settings = this.settings;
    let mode = {
        let this = this.clone();
        connected_button_group(
            ["Dark", "Light"],
            ButtonStyle::tonal(),
            move |i| settings.with(|s| s.mode) == [Mode::Dark, Mode::Light][i],
            move |i| this.change(|s| s.mode = [Mode::Dark, Mode::Light][i]),
        )
    };
    let style = {
        let this = this.clone();
        connected_button_group(
            Style::ALL.map(Style::label),
            ButtonStyle::tonal(),
            move |i| settings.with(|s| s.style) == Style::ALL[i],
            move |i| this.change(|s| s.style = Style::ALL[i]),
        )
    };
    let swatches = div()
        .flex()
        .flex_row()
        .flex_wrap()
        .gap(8.0)
        .children(ACCENTS.map(|(name, seed)| {
            let this = this.clone();
            let chosen = move || settings.with(|s| s.seed() == seed);
            let hovered = signal(false);
            let swatch = div()
                .w(28.0)
                .h(28.0)
                .rounded(14.0)
                .flex()
                .items_center()
                .justify_center()
                .cursor(CursorIcon::Pointer)
                .on_hover(move |on| hovered.set(on))
                .on_click(move |_| this.change(|s| s.accent = hex(seed)))
                // The color it gives the studio in the mode and style that are set.
                .dyn_style(move |s| {
                    let primary = settings.with(|st| st.scheme_with(seed)).primary;
                    let c = color_scheme();
                    let ring = if chosen() {
                        c.on_surface
                    } else if hovered.get() {
                        c.outline
                    } else {
                        Color::TRANSPARENT
                    };
                    s.bg(primary).border(2.0).border_color(ring)
                })
                .child(dyn_view(move || {
                    chosen().then(|| {
                        sized_icon(icons::CHECK, 16.0).dyn_style(move |s| {
                            s.text_color(settings.with(|st| st.scheme_with(seed)).on_primary)
                        })
                    })
                }));
            tooltip(swatch, name)
        }));
    let roles = div().flex().flex_row().gap(6.0).children(
        [
            ("Primary", 0usize),
            ("Secondary", 1),
            ("Tertiary", 2),
            ("Surface", 3),
        ]
        .map(|(name, i)| {
            TextStyle::LABEL_MEDIUM
                .apply(
                    div()
                        .px(10.0)
                        .h(26.0)
                        .flex()
                        .items_center()
                        .rounded(8.0)
                        .child(text(name)),
                )
                .dyn_style(move |s| {
                    let c = color_scheme();
                    let (bg, fg) = match i {
                        0 => (c.primary, c.on_primary),
                        1 => (c.secondary_container, c.on_secondary_container),
                        2 => (c.tertiary_container, c.on_tertiary_container),
                        _ => (c.surface_container_highest, c.on_surface),
                    };
                    s.bg(bg).text_color(fg)
                })
        }),
    );
    div()
        .flex()
        .flex_col()
        .gap(4.0)
        .px(20.0)
        .py(14.0)
        .child(row("Theme", mode))
        .child(row("Accent", swatches))
        .child(row("Style", style))
        .child(row("Colors", roles))
        .child(
            TextStyle::BODY_SMALL
                .apply(text(path().map_or_else(String::new, |p| {
                    format!("Kept in {}", p.display())
                })))
                .mt(10.0)
                .dyn_style(|s| s.text_color(color_scheme().on_surface_variant)),
        )
}

fn system_view(this: Rc<SettingsWindow>) -> Div {
    let at_once = system::at_once();
    let slow = this.slow;
    let section = |title: &'static str, lines: Vec<(&'static str, String)>| {
        div()
            .flex()
            .flex_col()
            .gap(2.0)
            .child(
                TextStyle::LABEL_LARGE
                    .apply(text(title))
                    .mb(4.0)
                    .dyn_style(|s| s.text_color(color_scheme().primary)),
            )
            .children(lines.into_iter().map(|(name, value)| {
                div()
                    .flex()
                    .flex_row()
                    .gap(10.0)
                    .min_h(20.0)
                    .child(
                        text(name)
                            .w(96.0)
                            .flex_none()
                            .text_size(12.0)
                            .dyn_style(|s| s.text_color(color_scheme().on_surface_variant)),
                    )
                    .child(text(value).flex_1().min_w(0.0).text_size(12.0))
            }))
    };
    let first = at_once.clone();
    let list = div()
        .flex()
        .flex_col()
        .gap(16.0)
        .children(first.into_iter().map(|(t, l)| section(t, l)))
        .child(dyn_view(move || match slow.get() {
            Some(sections) => div()
                .flex()
                .flex_col()
                .gap(16.0)
                .children(sections.into_iter().map(|(t, l)| section(t, l)))
                .into_view(),
            None => section("Export GPU and FFmpeg", vec![("", "Asking…".into())]).into_view(),
        }));
    let copy = styled_button(
        "Copy as text",
        ButtonStyle::outlined().icon(icons::CONTENT_COPY),
    )
    .on_click(move |_| {
        let mut all = at_once.clone();
        all.extend(slow.get_untracked().unwrap_or_default());
        set_clipboard(ClipboardKind::Clipboard, system::as_text(&all));
    });
    div()
        .flex_1()
        .min_h(0.0)
        .flex()
        .flex_col()
        .child(
            div()
                .flex_1()
                .min_h(0.0)
                .overflow_y_scroll()
                .px(20.0)
                .py(14.0)
                .child(list),
        )
        .child(div().flex().flex_row().px(20.0).pt(6.0).child(copy))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_missing_from_the_file_is_the_default() {
        let s: Settings = serde_json::from_str(r#"{ "mode": "light" }"#).unwrap();
        assert_eq!(s.mode, Mode::Light);
        assert_eq!(s.accent, Settings::default().accent);
        assert_eq!(s.style, Style::Tonal);
    }

    #[test]
    fn settings_come_back_as_they_were_written() {
        let s = Settings {
            mode: Mode::Light,
            accent: hex(ACCENTS[3].1),
            style: Style::Expressive,
        };
        let text = serde_json::to_string_pretty(&s).unwrap();
        assert!(text.contains(r#""style": "expressive""#), "{text}");
        assert_eq!(serde_json::from_str::<Settings>(&text).unwrap(), s);
    }

    #[test]
    fn an_accent_that_is_not_a_color_is_the_default() {
        let s = Settings {
            accent: "teal".into(),
            ..Settings::default()
        };
        assert_eq!(s.seed(), SKY);
    }
}
