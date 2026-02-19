type MuxThemePresetColor =
  | string
  | {
      readonly dark: string;
      readonly light: string;
    };

interface MuxThemePresetDocument {
  readonly $schema?: string;
  readonly defs?: Readonly<Record<string, MuxThemePresetColor>>;
  readonly theme: Readonly<Record<string, MuxThemePresetColor>>;
}

export const BUILTIN_MUX_THEME_PRESETS_COMPAT: Readonly<Record<string, MuxThemePresetDocument>> = {
  'github-light': {
    $schema: 'https://opencode.ai/theme.json',
    theme: {
      primary: '#0550ae',
      success: '#1a7f37',
      error: '#cf222e',
      warning: '#9a6700',
      info: '#bc4c00',
      text: '#24292f',
      textMuted: '#57606a',
      conceal: '#8c959f',
      background: '#ffffff',
      backgroundPanel: '#f6f8fa',
      backgroundElement: '#d0d7de',
      syntaxFunction: '#8250df',
    },
  },
};
