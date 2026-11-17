export type Palette = {
  bg: [string, string, string];
  accent: string;
  glow: string;
  text: string;
};

export const TEMPLATES: Record<string, Palette> = {
  'gold-cosmic': { bg: ['#05030f', '#140b33', '#02010a'], accent: '#f5c451', glow: 'rgba(245,196,81,0.28)', text: '#ffffff' },
  'saffron-dawn': { bg: ['#140400', '#4a1a05', '#080100'], accent: '#ff9933', glow: 'rgba(255,153,51,0.30)', text: '#fff7ee' },
  'midnight-lotus': { bg: ['#020b1a', '#0a2a4a', '#010610'], accent: '#8be9fd', glow: 'rgba(139,233,253,0.25)', text: '#f2fcff' },
};
