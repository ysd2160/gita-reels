import React from 'react';
import { Composition } from 'remotion';
import { DEFAULT_LAYOUT, Reel, ReelProps } from './Reel';

const FPS = 30;

const demoWords = 'Overthinking se thak gaye ho Raat bhar dimaag chalta rehta hai'.split(' ').map((text, i) => ({
  text, emph: i === 0, start: 0.4 + i * 0.35, end: 0.75 + i * 0.35,
}));

export const demoProps = (format: 'short' | 'long'): ReelProps => ({
  format,
  durationSec: 8,
  style: { artStyle: 'epic-painting', templateId: 'gold-cosmic', captionStyle: 'box', shlokStyle: 'card', hookStyle: 'big', transition: 'zoom' },
  accent: '', textColor: '',
  layout: DEFAULT_LAYOUT[format],
  hook: 'Overthinking se thak gaye ho?',
  lines: [{ start: 0.4, end: 4.2, words: demoWords }],
  audio: [],
  scenes: [],
  shloks: [{ sanskrit: 'असंशयं महाबाहो मनो दुर्निग्रहं चलम् ।\nअभ्यासेन तु कौन्तेय वैराग्येण च गृह्यते ॥', reference: 'Bhagavad Gita 6.35', from: 1.5, to: 5 }],
  chapters: format === 'long' ? [{ at: 0.5, title: 'The restless mind' }] : [],
  cta: 'Follow for daily Gita wisdom',
  musicUrl: null, musicVolume: 0.2, musicOn: true, channel: '', seed: 7,
});

const meta = ({ props }: { props: ReelProps }) => ({ durationInFrames: Math.max(FPS, Math.ceil(props.durationSec * FPS)) });

export const Root: React.FC = () => (
  <>
    <Composition id="Reel" component={Reel} durationInFrames={FPS * 8} fps={FPS} width={1080} height={1920} defaultProps={demoProps('short')} calculateMetadata={meta} />
    <Composition id="Long" component={Reel} durationInFrames={FPS * 8} fps={FPS} width={1920} height={1080} defaultProps={demoProps('long')} calculateMetadata={meta} />
  </>
);
