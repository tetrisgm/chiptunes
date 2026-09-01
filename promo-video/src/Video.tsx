import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame} from 'remotion';

const ink = '#f5f3ee';
const lime = '#9bbc0f';
const magenta = '#a51d5d';
const ui = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif';

const fade = (frame: number, duration: number) => interpolate(
  frame,
  [0, 10, duration - 10, duration],
  [0, 1, 1, 0],
  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
);

const Shot: React.FC<{src: string; duration: number; children: React.ReactNode; align?: 'left'|'right'}> = ({src, duration, children, align='left'}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, duration], [1.015, 1.065], {extrapolateRight: 'clamp'});
  const rise = spring({frame: frame - 4, fps: 30, config: {damping: 18}});
  return <AbsoluteFill style={{background:'#05040a', opacity:fade(frame,duration), overflow:'hidden', fontFamily:ui}}>
    <Img src={staticFile(src)} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${scale})`,filter:'saturate(1.06) contrast(1.03)'}} />
    <div style={{position:'absolute',inset:0,background:align==='left'?'linear-gradient(90deg,rgba(5,4,10,.88),rgba(5,4,10,.22) 58%,transparent)':'linear-gradient(270deg,rgba(5,4,10,.9),rgba(5,4,10,.2) 60%,transparent)'}} />
    <div style={{position:'absolute',top:74,[align]:76,width:590,color:ink,opacity:rise,transform:`translateY(${(1-rise)*30}px)`,textShadow:'0 4px 24px #000'}}>{children}</div>
  </AbsoluteFill>;
};

const Eyebrow: React.FC<{children: React.ReactNode}> = ({children}) => <div style={{color:lime,fontSize:19,fontWeight:800,letterSpacing:2.4,textTransform:'uppercase',marginBottom:18}}>{children}</div>;
const Head: React.FC<{children: React.ReactNode}> = ({children}) => <div style={{fontSize:62,lineHeight:.98,fontWeight:850,letterSpacing:-2.8}}>{children}</div>;
const Sub: React.FC<{children: React.ReactNode}> = ({children}) => <div style={{fontSize:25,lineHeight:1.3,fontWeight:600,color:'#dbd9d4',marginTop:24,maxWidth:520}}>{children}</div>;

const Landing = () => <Shot src="landing.png" duration={90} align="left"><Eyebrow>CHIPTUNES.APP</Eyebrow><Head>Create or listen to<br/>Game Boy music.</Head><Sub>Pick a mood and a complete song starts writing itself.</Sub></Shot>;
const Playing = () => <Shot src="playing.png" duration={90} align="right"><Eyebrow>Automatic, not a loop</Eyebrow><Head>New songs.<br/>One after another.</Head><Sub>Four channels of pulse, wave, noise and sampled drums, composed live in your browser.</Sub></Shot>;
const Creating = () => <Shot src="create.png" duration={105} align="left"><Eyebrow>Make it yours</Eyebrow><Head>Open the tracker.<br/>Change every note.</Head><Sub>The editor rises over the game, so your song and its visual world stay connected.</Sub></Shot>;

const End = () => {
  const frame=useCurrentFrame();
  const pop=spring({frame,fps:30,config:{damping:16}});
  return <AbsoluteFill style={{background:'#080610',fontFamily:ui,color:ink,alignItems:'center',justifyContent:'center',overflow:'hidden'}}>
    <Img src={staticFile('playing.png')} style={{position:'absolute',width:'100%',height:'100%',objectFit:'cover',filter:'blur(14px) brightness(.2) saturate(1.2)',transform:'scale(1.08)'}} />
    <div style={{position:'absolute',width:620,height:620,borderRadius:620,background:`radial-gradient(circle,${magenta}66,transparent 66%)`,filter:'blur(12px)'}} />
    <div style={{position:'relative',textAlign:'center',transform:`scale(${.92+.08*pop})`,opacity:pop}}>
      <div style={{fontSize:76,fontWeight:900,letterSpacing:-4}}>chiptunes.app</div>
      <div style={{fontSize:27,fontWeight:700,color:lime,marginTop:18}}>REAL FOUR-CHANNEL SOUND</div>
      <div style={{fontSize:24,fontWeight:600,color:'#ddd9e5',marginTop:14}}>Edit it. Share it. Boot it as a cartridge.</div>
    </div>
  </AbsoluteFill>;
};

export const ChiptunesPromo: React.FC = () => <AbsoluteFill>
  <Sequence from={0} durationInFrames={90}><Landing/></Sequence>
  <Sequence from={80} durationInFrames={90}><Playing/></Sequence>
  <Sequence from={160} durationInFrames={105}><Creating/></Sequence>
  <Sequence from={255} durationInFrames={105}><End/></Sequence>
</AbsoluteFill>;
