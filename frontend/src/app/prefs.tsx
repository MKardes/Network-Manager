import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Layout = 'rail' | 'bar';
export type Theme = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'comfortable';

const LAYOUT_KEY = 'nm.layout';
const THEME_KEY = 'nm.theme';
const DENSITY_KEY = 'nm.density';

/** Below this width the rail has nowhere to go, so the bar shell takes over. */
const RAIL_MIN_WIDTH = 900;

interface Prefs {
  /** The stored preference — what Settings shows and what we persist. */
  layout: Layout;
  /** The layout actually rendered: `bar` on narrow viewports whatever the preference. */
  effectiveLayout: Layout;
  theme: Theme;
  density: Density;
  setLayout: (l: Layout) => void;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / storage disabled — the preference just doesn't persist */
  }
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [layout, setLayoutState] = useState<Layout>(() =>
    read(LAYOUT_KEY, ['rail', 'bar'] as const, 'rail'),
  );
  const [theme, setThemeState] = useState<Theme>(() =>
    read(THEME_KEY, ['light', 'dark', 'system'] as const, 'system'),
  );
  const [density, setDensityState] = useState<Density>(() =>
    read(DENSITY_KEY, ['compact', 'comfortable'] as const, 'compact'),
  );

  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const narrow = useMediaQuery(`(max-width: ${RAIL_MIN_WIDTH - 1}px)`);

  // The resolved theme is an attribute on <html> so the token sheet can swap
  // every value at once, including for portalled surfaces like the dialog.
  useEffect(() => {
    const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
    document.documentElement.setAttribute('data-theme', resolved);
  }, [theme, prefersDark]);

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  const setLayout = useCallback((l: Layout) => {
    setLayoutState(l);
    write(LAYOUT_KEY, l);
  }, []);
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    write(THEME_KEY, t);
  }, []);
  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    write(DENSITY_KEY, d);
  }, []);

  const value = useMemo<Prefs>(
    () => ({
      layout,
      effectiveLayout: narrow ? 'bar' : layout,
      theme,
      density,
      setLayout,
      setTheme,
      setDensity,
    }),
    [layout, narrow, theme, density, setLayout, setTheme, setDensity],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider');
  return ctx;
}
