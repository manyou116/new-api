export const theme = {
  colors: {
    background: {
      primary: '#ffffff', // Main bg
      secondary: '#f8fafc', // Alternate bg
      surface: '#ffffff', // Card bg
      surfaceHover: '#f1f5f9',
    },
    border: {
      default: '#e2e8f0',
      focus: '#cbd5e1',
      active: '#a5b4fc', // Indigo subtle
    },
    text: {
      title: '#0f172a',
      body: '#475569',
      muted: '#64748b',
    },
    primary: {
      main: '#4f46e5', // Indigo
      hover: '#4338ca',
      light: '#e0e7ff',
    },
    success: {
      main: '#059669',
      bg: '#ecfdf5',
    },
  },
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  },
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
  },
  layout: {
    maxWidth: 1100,
    sectionPadding: '80px 24px',
  },
  typography: {
    h1: {
      fontSize: 'clamp(2.5rem, 5vw, 4rem)',
      fontWeight: 800,
      lineHeight: 1.15,
      letterSpacing: '-0.02em',
      color: '#0f172a',
    },
    h2: {
      fontSize: 'clamp(1.8rem, 3vw, 2.5rem)',
      fontWeight: 800,
      lineHeight: 1.25,
      letterSpacing: '-0.025em',
      color: '#0f172a',
    },
    h3: { fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' },
    body: { fontSize: '1rem', lineHeight: 1.7, color: '#475569' },
    subtitle: { fontSize: '1.125rem', lineHeight: 1.6, color: '#64748b' },
    small: { fontSize: '0.875rem', color: '#64748b' },
  },
};
