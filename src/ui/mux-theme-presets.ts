import { BUILTIN_MUX_THEME_PRESETS_PART_ONE } from './mux-theme-presets-part-1.ts';
import { BUILTIN_MUX_THEME_PRESETS_PART_TWO } from './mux-theme-presets-part-2.ts';
import { BUILTIN_MUX_THEME_PRESETS_COMPAT } from './mux-theme-presets-compat.ts';

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

export const BUILTIN_MUX_THEME_PRESETS: Readonly<Record<string, MuxThemePresetDocument>> = {
  ...BUILTIN_MUX_THEME_PRESETS_PART_ONE,
  ...BUILTIN_MUX_THEME_PRESETS_PART_TWO,
  ...BUILTIN_MUX_THEME_PRESETS_COMPAT,
};
