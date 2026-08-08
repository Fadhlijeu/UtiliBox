// Theme: stored in localStorage, default = system preference.
// Key kept stable for tests / docs.

const KEY = "utilibox:theme";

export type Theme = "light" | "dark";

export const getTheme = (): Theme => {
  const stored = localStorage.getItem(KEY) as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export const setTheme = (theme: Theme): void => {
  localStorage.setItem(KEY, theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
};

export const toggleTheme = (): Theme => {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
};

export const initTheme = (): void => setTheme(getTheme());