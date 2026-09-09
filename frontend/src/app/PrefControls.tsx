import { usePrefs, type Layout, type Theme } from './prefs';

const THEME_ORDER: Theme[] = ['light', 'dark', 'system'];

/**
 * The layout and theme switches that ride in the shell chrome (rail footer /
 * bar right end). Settings has the same preferences as labelled segmented
 * controls; these are the one-click versions.
 */
export function PrefControls({ className = '' }: { className?: string }) {
  const { layout, theme, setLayout, setTheme } = usePrefs();

  const nextLayout: Layout = layout === 'rail' ? 'bar' : 'rail';
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];

  return (
    <div className={`rail__prefs ${className}`.trim()}>
      <button
        type="button"
        className="btn-outline"
        style={{ fontSize: 12, padding: '4px 10px' }}
        title={`Layout: ${layout} — switch to the ${nextLayout} layout`}
        onClick={() => setLayout(nextLayout)}
      >
        Layout: {layout}
      </button>
      <button
        type="button"
        className="btn-outline"
        style={{ fontSize: 12, padding: '4px 10px' }}
        title={`Theme: ${theme} — switch to ${nextTheme}`}
        onClick={() => setTheme(nextTheme)}
      >
        Theme: {theme}
      </button>
    </div>
  );
}
