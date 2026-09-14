import contract from './project.cjs';
// Original, small performances. All run through the same Strudel/shader engines.
const rings = `void mainImage(out vec4 color, in vec2 pixel) {
  vec2 uv = (pixel * 2. - iResolution.xy) / iResolution.y;
  float bass = texture(iChannel0, vec2(.025, .25)).r;
  float rings = sin(length(uv) * 18. - iTime * 3. - bass * 5.);
  vec3 ink = .5 + .5 * cos(iTime * .2 + uv.xyx + vec3(0,2,4));
  color = vec4(ink * smoothstep(-.2,.6,rings), 1.);
}`;
const starters = {
  groove:{music:`setcpm(30)
$: s("bd*4, [~ hh]*4, ~ sd ~ sd").gain(.5)
$: note("<c2 eb2 f2 g2>")
  .s("sawtooth").lpf(700).decay(.2).sustain(0).gain(.25)
$: note("c5 [eb5 g5] ~ bb4")
  .s("triangle").decay(.15).sustain(0).gain(.2)`,visuals:{Image:rings,channels:{Image:['audio']}}},
  pulse:{music:`setcpm(32)
$: s("bd*4, ~ sd ~ sd").gain(.5)
$: note("c2 ~ [eb2 g2] ~").s("square").lpf(600).gain(.15)`,visuals:{Image:`void mainImage(out vec4 c, in vec2 p) {
  vec2 uv = (2.*p-iResolution.xy)/iResolution.y;
  float rings = sin(length(uv)*20.-iTime*3.-ctKick*4.);
  c = vec4(vec3(.3,.7,1.)*smoothstep(0.,.2,rings),1.);
}`,channels:{Image:['audio']}}},
  trails:{music:`setcpm(28)
$: s("bd*4, [~ hh]*4").gain(.4)
$: note("<c4 eb4 g4 bb4>").s("triangle").decay(.3).sustain(0).gain(.2)`,visuals:{
    A:`void mainImage(out vec4 c, in vec2 p) {
  vec2 uv = p/iResolution.xy;
  vec2 point = .5 + .3*vec2(cos(iTime),sin(iTime*1.3));
  vec3 trail = texture(iChannel0,uv).rgb*.96;
  float spot = exp(-1800.*dot(uv-point,uv-point));
  c = vec4(trail+spot*vec3(.1,.3,.7)*(1.+ctKick),1.);
}`,
    Image:`void mainImage(out vec4 c, in vec2 p) {
  c = vec4(texture(iChannel0,p/iResolution.xy).rgb,1.);
}`,channels:{A:['A'],Image:['A']}}},
};
export function example(name = 'groove') {
  if (!Object.hasOwn(starters,name)) throw Error('Unknown example.');
  return contract.project({version:1,runtime:contract.RUNTIME,...starters[name]});
}
