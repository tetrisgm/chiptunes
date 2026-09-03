import React from 'react';
import {Composition, Still} from 'remotion';
import {ChiptunesPromo} from './Video';
import {WebMcpDemo, Thumbnail, Logo, TOTAL_FRAMES} from './WebMcp';

export const Root: React.FC = () => (
  <>
    <Composition
      id="ChiptunesPromo"
      component={ChiptunesPromo}
      durationInFrames={360}
      fps={30}
      width={1280}
      height={720}
    />
    {/* The WebMCP Challenge submission video: title, the explainer, then a real
        recorded agent session. Silent on purpose — narration is recorded over
        it, and the rules require audio. */}
    <Composition
      id="WebMcpDemo"
      component={WebMcpDemo}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1280}
      height={720}
    />
    {/* Devpost asks for 3:2 */}
    <Still id="Thumbnail" component={Thumbnail} width={1200} height={800} />
    <Still id="Logo" component={Logo} width={512} height={512} />
  </>
);
