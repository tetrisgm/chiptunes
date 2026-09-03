// THE SUBMISSION VIDEO, and the Devpost thumbnail, from the same palette.
//
// The footage is a REAL agent session recorded by capture.mjs: a mock model
// context is installed exactly as an agent browser installs one, the tools are
// called through it, and the page reacts on camera. Nothing here is a mockup —
// the toasts, the visuals and the exports in the recording are the product
// working, which is the only kind of demo worth submitting.
//
// Captions are deliberately SPARSE and long-held. The app narrates each tool
// call itself in the recording ("🤖 agent: …"), so these say what it MEANS
// rather than repeating it, and they stay legible if the recording drifts a
// second either way between captures.
import React from 'react';
import {
  AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring,
  staticFile, useCurrentFrame,
} from 'remotion';
// Written by capture.mjs alongside the recording. Caption positions are read
// from it rather than eyeballed, because page-load time differs on every
// capture and a caption naming one tool while the app's own toast names another
// is worse than no caption at all.
import timeline from '../public/timeline.json';

const INK = '#f7f5ef';
const LIME = '#9bbc0f';
const MAGENTA = '#a51d5d';
const UI = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';
const PIXEL = 'PressStart';

export const Fonts: React.FC = () => (
  <style>{`@font-face{font-family:'${PIXEL}';src:url('${staticFile('press-start-2p.woff2')}') format('woff2');font-display:block}`}</style>
);

const fade = (frame: number, duration: number, hold = 12) =>
  interpolate(frame, [0, hold, duration - hold, duration], [0, 1, 1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

/* ------------------------------------------------------------------ cards */

const Title: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const pop = spring({frame, fps: 30, config: {damping: 17}});
  return (
    <AbsoluteFill style={{background: '#07060e', fontFamily: UI, color: INK,
      alignItems: 'center', justifyContent: 'center', opacity: fade(frame, duration)}}>
      <Img src={staticFile('landing.png')} style={{position: 'absolute', width: '100%', height: '100%',
        objectFit: 'cover', filter: 'blur(18px) brightness(.28) saturate(1.25)', transform: 'scale(1.1)'}} />
      <div style={{position: 'absolute', width: 780, height: 780, borderRadius: 780,
        background: `radial-gradient(circle,${MAGENTA}55,transparent 65%)`, filter: 'blur(14px)'}} />
      <div style={{position: 'relative', textAlign: 'center', opacity: pop,
        transform: `translateY(${(1 - pop) * 26}px)`}}>
        <div style={{fontFamily: PIXEL, fontSize: 40, color: LIME, letterSpacing: 2}}>CHIPTUNES.APP</div>
        <div style={{fontSize: 62, fontWeight: 900, letterSpacing: -2.6, marginTop: 30, lineHeight: 1.05}}>
          A Game Boy studio<br />your agent can drive.
        </div>
        <div style={{fontSize: 25, fontWeight: 600, color: '#cfc9dd', marginTop: 26}}>
          15 WebMCP tools · no server, no key, nothing metered
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Still: React.FC<{src: string; duration: number; eyebrow: string; head: string; sub?: string}> =
({src, duration, eyebrow, head, sub}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, duration], [1.02, 1.07], {extrapolateRight: 'clamp'});
  const rise = spring({frame: frame - 3, fps: 30, config: {damping: 18}});
  return (
    <AbsoluteFill style={{background: '#05040a', fontFamily: UI, opacity: fade(frame, duration), overflow: 'hidden'}}>
      <Img src={staticFile(src)} style={{width: '100%', height: '100%', objectFit: 'cover',
        objectPosition: 'top center', transform: `scale(${scale})`}} />
      <AbsoluteFill style={{background: 'linear-gradient(0deg,rgba(5,4,10,.95) 4%,rgba(5,4,10,.25) 42%,transparent)'}} />
      <div style={{position: 'absolute', left: 72, right: 72, bottom: 64, color: INK,
        opacity: rise, transform: `translateY(${(1 - rise) * 22}px)`, textShadow: '0 4px 22px #000'}}>
        <div style={{color: LIME, fontSize: 17, fontWeight: 800, letterSpacing: 2.4, textTransform: 'uppercase'}}>{eyebrow}</div>
        <div style={{fontSize: 46, fontWeight: 850, letterSpacing: -1.6, marginTop: 12}}>{head}</div>
        {sub ? <div style={{fontSize: 22, fontWeight: 600, color: '#d7d3e0', marginTop: 12, maxWidth: 900}}>{sub}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

// A caption band over the live recording. Bottom-left, clear of the agent bar
// (top-right) and of the app's own toast (bottom-centre) — both of which are
// evidence and must stay readable.
const Caption: React.FC<{duration: number; kicker: string; line: string}> = ({duration, kicker, line}) => {
  const frame = useCurrentFrame();
  const rise = spring({frame, fps: 30, config: {damping: 20}});
  return (
    <div style={{position: 'absolute', left: 54, bottom: 128, maxWidth: 640, fontFamily: UI,
      opacity: fade(frame, duration, 9), transform: `translateY(${(1 - rise) * 16}px)`}}>
      <div style={{display: 'inline-block', background: '#07060edd', border: '1px solid #302a43',
        borderLeft: `4px solid ${LIME}`, borderRadius: 12, padding: '14px 20px', backdropFilter: 'blur(6px)'}}>
        <div style={{color: LIME, fontSize: 15, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase'}}>{kicker}</div>
        <div style={{color: INK, fontSize: 30, fontWeight: 800, letterSpacing: -.6, marginTop: 7, lineHeight: 1.18}}>{line}</div>
      </div>
    </div>
  );
};

const End: React.FC<{duration: number}> = ({duration}) => {
  const frame = useCurrentFrame();
  const pop = spring({frame, fps: 30, config: {damping: 16}});
  return (
    <AbsoluteFill style={{background: '#07060e', fontFamily: UI, color: INK,
      alignItems: 'center', justifyContent: 'center', opacity: fade(frame, duration)}}>
      <Img src={staticFile('playing.png')} style={{position: 'absolute', width: '100%', height: '100%',
        objectFit: 'cover', filter: 'blur(16px) brightness(.22) saturate(1.2)', transform: 'scale(1.09)'}} />
      <div style={{position: 'absolute', width: 700, height: 700, borderRadius: 700,
        background: `radial-gradient(circle,${MAGENTA}55,transparent 66%)`, filter: 'blur(12px)'}} />
      <div style={{position: 'relative', textAlign: 'center', opacity: pop, transform: `scale(${.94 + .06 * pop})`}}>
        <div style={{fontFamily: PIXEL, fontSize: 34, color: LIME}}>CHIPTUNES.APP/WEBMCP</div>
        <div style={{fontSize: 44, fontWeight: 850, letterSpacing: -1.6, marginTop: 26}}>
          Open the tab. Ask for music.
        </div>
        <div style={{fontSize: 22, fontWeight: 600, color: '#cfc9dd', marginTop: 18, lineHeight: 1.5}}>
          Deterministic composer · register-level DMG emulation<br />
          MIT licensed · github.com/tetrisgm/chiptunes
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------- the video */
const FPS = 30;
// Playwright starts recording a beat before our first mark; the difference
// between the finished file and the last mark is that lead.
const LEAD = Math.max(0, timeline.videoSeconds * 1000 - timeline.lastMarkMs);
const at = (ms: number) => Math.round(((ms + LEAD) / 1000) * FPS);

const CAPTIONS: Record<string, {kicker: string; line: string}> = {
  what_can_i_do_here: {kicker: 'what_can_i_do_here', line: 'The page introduces itself to the agent.'},
  chiptunes_ask: {kicker: 'chiptunes_ask', line: '“A dungeon theme like Castlevania, 40 seconds, no drums.”'},
  chiptunes_analyse: {kicker: 'chiptunes_analyse', line: 'It can’t listen — so it measures what it made.'},
  chiptunes_variations: {kicker: 'chiptunes_variations', line: 'Twelve complete, different songs in 80 ms.'},
  chiptunes_variant: {kicker: 'chiptunes_variant', line: 'Recompose the exact song on air — “make it gloomier”.'},
  chiptunes_screen: {kicker: 'chiptunes_screen', line: 'It drives the display too. You watch it work.'},
  chiptunes_export: {kicker: 'chiptunes_export', line: 'A 32 KB cartridge that boots on real hardware.'},
};
// Each caption runs from its own call until the next one, less a breath.
const CUES = timeline.events.flatMap((e, i) => {
  const cap = CAPTIONS[e.name];
  if (!cap) return [];
  const next = timeline.events[i + 1];
  const from = at(e.at);
  const until = next ? at(next.at) : Math.round(timeline.videoSeconds * FPS);
  return [{...cap, from, duration: Math.max(40, until - from - 4)}];
});

const T = {
  title: 105, panel: 110, probe: 95,
  session: Math.round(timeline.videoSeconds * FPS),
  end: 130,
};
const S = {
  title: 0,
  panel: 95,
  probe: 195,
  session: 280,
  end: 280 + T.session - 20,
};
export const TOTAL_FRAMES = S.end + T.end;

export const WebMcpDemo: React.FC = () => (
  <AbsoluteFill style={{background: '#05040a'}}>
    <Fonts />
    <Sequence from={S.title} durationInFrames={T.title}><Title duration={T.title} /></Sequence>
    <Sequence from={S.panel} durationInFrames={T.panel}>
      <Still src="webmcp.png" duration={T.panel} eyebrow="chiptunes.app/webmcp"
        head="Fifteen tools, registered on document.modelContext."
        sub="The composer, the sound chip and the cartridge builder are already in the tab." />
    </Sequence>
    <Sequence from={S.probe} durationInFrames={T.probe}>
      <Still src="webmcp-probe.png" duration={T.probe} eyebrow="No guessing"
        head="The page says what it detected."
        sub="Both surfaces are checked, and registration is proven, not assumed." />
    </Sequence>

    <Sequence from={S.session} durationInFrames={T.session}>
      <AbsoluteFill>
        <OffthreadVideo src={staticFile('agent-session.mp4')} muted
          style={{width: '100%', height: '100%', objectFit: 'cover'}} />
        {/* The app narrates each call itself in this footage; these say what it
            MEANS. Positions come from the recorded timeline, so a re-capture
            cannot desynchronise them. */}
        {CUES.map((c) => (
          <Sequence key={c.kicker} from={c.from} durationInFrames={c.duration}>
            <Caption duration={c.duration} kicker={c.kicker} line={c.line} />
          </Sequence>
        ))}
      </AbsoluteFill>
    </Sequence>

    <Sequence from={S.end} durationInFrames={T.end}><End duration={T.end} /></Sequence>
  </AbsoluteFill>
);

/* --------------------------------------------------- Devpost thumbnail 3:2 */
// Devpost asks for 3:2; this is 1200x800. The Game Boy screen carries the
// product and the robot line carries the entry, because a judge scanning a
// gallery needs to know in one glance which challenge this is answering.
export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{background: '#07060e', fontFamily: UI, color: INK, overflow: 'hidden'}}>
    <Fonts />
    {/* The product, sharp, on the right — a gallery thumbnail that is all
        typography reads as a slide. The crop keeps the Game Boy and the agent
        bar, which together say what this is faster than the copy does. */}
    {/* The WHOLE frame, not a crop. Cover cut the agent bar out of the top
        right corner, which is the one element that says what this entry is. */}
    <div style={{position: 'absolute', right: -34, top: 186, width: 730, height: 411,
      borderRadius: 16, overflow: 'hidden', border: '1px solid #3b3450',
      boxShadow: '0 30px 80px #000b', transform: 'rotate(-1.2deg)'}}>
      <Img src={staticFile('agent-landing.png')} style={{width: '100%', height: '100%', objectFit: 'cover'}} />
    </div>
    <div style={{position: 'absolute', inset: 0,
      background: 'linear-gradient(90deg,#07060e 0%,#07060ef2 40%,#07060e66 62%,transparent 82%)'}} />
    <div style={{position: 'absolute', left: -180, top: -160, width: 900, height: 900, borderRadius: 900,
      background: `radial-gradient(circle,${MAGENTA}4d,transparent 66%)`, filter: 'blur(12px)'}} />
    <div style={{position: 'absolute', left: 64, top: 150, width: 600}}>
      <div style={{fontFamily: PIXEL, fontSize: 25, color: LIME, letterSpacing: 1}}>CHIPTUNES.APP</div>
      <div style={{fontSize: 62, fontWeight: 900, letterSpacing: -2.6, lineHeight: 1.03, marginTop: 26}}>
        A Game Boy studio<br />your agent can drive.
      </div>
      <div style={{fontSize: 23, fontWeight: 650, color: '#d3cee1', marginTop: 24, lineHeight: 1.45}}>
        15 WebMCP tools on <span style={{color: LIME}}>document.modelContext</span>.
        A real sound chip and a composer, running in the tab.
      </div>
      <div style={{display: 'flex', gap: 10, marginTop: 30, flexWrap: 'wrap', width: 560}}>
        {['no server', 'no key', 'nothing metered'].map((t) => (
          <div key={t} style={{border: '1px solid #4d7a12', background: '#131c0cdd', borderRadius: 999,
            padding: '9px 18px', fontSize: 19, fontWeight: 750, color: '#e7ffb0'}}>{t}</div>
        ))}
      </div>
    </div>
  </AbsoluteFill>
);

/* ------------------------------------------------------------ square logo */
export const Logo: React.FC = () => (
  <AbsoluteFill style={{background: '#07060e', fontFamily: UI, alignItems: 'center', justifyContent: 'center'}}>
    <Fonts />
    <div style={{position: 'absolute', width: 460, height: 460, borderRadius: 460,
      background: `radial-gradient(circle,${MAGENTA}77,transparent 66%)`, filter: 'blur(10px)'}} />
    {/* The DMG screen, drawn rather than photographed, so it stays crisp small. */}
    <div style={{position: 'relative', width: 300, height: 300, borderRadius: 34, background: '#cfc9b4',
      border: '6px solid #2a2536', boxShadow: '0 18px 50px #000a', display: 'flex',
      flexDirection: 'column', alignItems: 'center', paddingTop: 26}}>
      <div style={{width: 236, height: 178, borderRadius: 10, background: LIME,
        border: '10px solid #2a2536', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{fontSize: 76, lineHeight: 1}}>🤖</div>
      </div>
      <div style={{fontFamily: PIXEL, fontSize: 15, color: '#2a2536', marginTop: 22, letterSpacing: 1}}>CHIPTUNES</div>
      <div style={{display: 'flex', gap: 12, marginTop: 14}}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{width: 16, height: 16, borderRadius: 16, background: i % 2 ? MAGENTA : '#5b5470'}} />
        ))}
      </div>
    </div>
  </AbsoluteFill>
);

/* ------------------------------------------------------- Devpost gallery */
// Up to 15 images at 3:2. Each is a REAL frame from the recorded session (the
// same footage as the video, sampled at the moment its tool fired) with one
// sentence saying what it proves. A gallery of raw screenshots makes a judge
// work out the story; a gallery of captioned evidence tells it.
export const GALLERY: {src: string; kicker: string; line: string; pos?: string; top?: boolean}[] = [
  {src: 'agent-landing.png', kicker: 'chiptunes.app/webmcp',
   line: 'An agent attached to the page. The station keeps playing underneath.'},
  {src: 'webmcp.png', kicker: '15 tools, listed live',
   line: 'The panel reads the tools off the running surface, so the list cannot go stale.'},
  {src: 'webmcp-probe.png', kicker: 'No guessing',
   line: 'It reports which surfaces existed and how many tools registered.'},
  {src: 'shots/chiptunes_ask.png', top: true, kicker: 'chiptunes_ask',
   line: '“A dungeon theme like Castlevania, 40 seconds, no drums” — and it says what it understood.'},
  {src: 'shots/chiptunes_analyse.png', top: true, kicker: 'chiptunes_analyse',
   line: 'An agent cannot listen, so it measures: mode, phrase arc, consonance, density.'},
  {src: 'shots/chiptunes_variations.png', top: true, kicker: 'chiptunes_variations',
   line: 'Twelve complete, different songs in about 70 ms. Breadth is free here.'},
  {src: 'shots/chiptunes_variant.png', top: true, kicker: 'chiptunes_variant',
   line: 'It recomposes the exact song on air — the same document, not an approximation.'},
  {src: 'shots/chiptunes_export.png', top: true, kicker: 'chiptunes_export',
   line: 'A 32 KB .gb cartridge, built in the page, that boots on real hardware.'},
  {src: 'create.png', kicker: 'The tracker',
   line: 'Every note the agent wrote is editable by hand. One song, two ways in.'},
];

export const GalleryShot: React.FC<{i: number}> = ({i}) => {
  const s = GALLERY[i] || GALLERY[0];
  return (
    <AbsoluteFill style={{background: '#07060e', fontFamily: UI, color: INK, overflow: 'hidden'}}>
      <Fonts />
      <Img src={staticFile(s.src)} style={{width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: s.pos || (s.top ? '50% 78%' : '50% 22%')}} />
      {/* Session frames caption at the TOP: the app's own toast sits along the
          bottom edge, and that toast is the evidence — covering it to label it
          would be self-defeating. */}
      <AbsoluteFill style={{background: s.top
        ? 'linear-gradient(180deg,#07060e 0%,#07060ee6 26%,transparent 56%)'
        : 'linear-gradient(0deg,#07060e 0%,#07060ee6 22%,transparent 52%)'}} />
      <div style={{position: 'absolute', left: 56, right: 56, ...(s.top ? {top: 48} : {bottom: 52})}}>
        <div style={{fontFamily: PIXEL, fontSize: 17, color: LIME, letterSpacing: 1}}>{s.kicker}</div>
        <div style={{fontSize: 33, fontWeight: 800, letterSpacing: -1, marginTop: 16, lineHeight: 1.24}}>{s.line}</div>
      </div>
    </AbsoluteFill>
  );
};
