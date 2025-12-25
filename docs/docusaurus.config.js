const config = {
  title: "FrameScript Docs",
  tagline: "Hello, world!",
  url: "https://frame-script.github.io",
  baseUrl: "/FrameScript/",
  organizationName: "frame-script",
  projectName: "FrameScript",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "ja"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: require.resolve("./sidebars.js"),
        },
        blog: false,
        theme: {
          customCss: require.resolve("./src/css/custom.css"),
        },
      },
    ],
  ],
  themeConfig: {
    colorMode: {
      defaultMode: "dark",
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: "FrameScript Docs",
      items: [
        {
          href: "https://github.com/frame-script/FrameScript",
          label: "GitHub",
          position: "right",
          className: "navbar__github",
          "aria-label": "GitHub repository",
        },
        { type: "localeDropdown", position: "right" },
      ],
    },
  },
};

module.exports = config;
