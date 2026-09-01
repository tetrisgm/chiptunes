import React from 'react';
import {Composition} from 'remotion';
import {ChiptunesPromo} from './Video';

export const Root: React.FC = () => (
  <Composition
    id="ChiptunesPromo"
    component={ChiptunesPromo}
    durationInFrames={360}
    fps={30}
    width={1280}
    height={720}
  />
);
