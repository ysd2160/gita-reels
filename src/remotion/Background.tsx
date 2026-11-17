import React, { useMemo } from 'react';
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion';
import { devanagari } from './fonts';
import type { Palette } from './templates';

export const Background: React.FC<{ palette: Palette; seed: number }> = ({ palette, seed }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const stars = useMemo(
    () =>
      Array.from({ length: 80 }, (_, i) => ({
        x: random(`x-${seed}-${i}`) * width,
        y: random(`y-${seed}-${i}`) * height,
        r: 1 + random(`r-${seed}-${i}`) * 2.6,
        speed: 6 + random(`s-${seed}-${i}`) * 22,
        phase: random(`p-${seed}-${i}`) * 100,
      })),
    [seed, width, height],
  );

  const t = frame / fps;
  const pulse = 1 + Math.sin(t * 0.9) * 0.06;

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, ${palette.bg[0]} 0%, ${palette.bg[1]} 55%, ${palette.bg[2]} 100%)` }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 38%, ${palette.glow} 0%, rgba(0,0,0,0) 55%)`,
          transform: `scale(${pulse})`,
        }}
      />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', top: -260 }}>
        <div
          style={{
            fontFamily: devanagari,
            fontSize: 760,
            color: palette.accent,
            opacity: 0.07,
            transform: `rotate(${Math.sin(t * 0.25) * 4}deg) scale(${pulse})`,
            lineHeight: 1,
          }}
        >
          ॐ
        </div>
      </AbsoluteFill>
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        {stars.map((s, i) => {
          const y = (((s.y - t * s.speed) % height) + height) % height;
          const tw = 0.25 + 0.75 * Math.abs(Math.sin(t * 1.4 + s.phase));
          return <circle key={i} cx={s.x} cy={y} r={s.r} fill={i % 7 === 0 ? palette.accent : '#ffffff'} opacity={tw * 0.8} />;
        })}
      </svg>
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.65) 100%)' }} />
    </AbsoluteFill>
  );
};
