import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

const Ctx = createContext<{ mode: ThemeMode; toggle: () => void }>({
  mode: 'dark',
  toggle: () => {},
});

export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem('am-theme') as ThemeMode) || 'dark'
  );

  useEffect(() => {
    document.body.dataset.theme = mode;
    localStorage.setItem('am-theme', mode);
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return <Ctx.Provider value={{ mode, toggle }}>{children}</Ctx.Provider>;
}
