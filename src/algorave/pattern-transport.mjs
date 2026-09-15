// The upstream lookahead clock follows the one AudioContext. Worker queries use
// exact contiguous cycle windows; only event data returns to this audio thread.
export class PatternTransport {
  constructor({getTime,output,onError,clockFactory}) {
    this.getTime=getTime;this.output=output;this.onError=onError;this.cps=.5;
    this.playing=false;this.epoch=0;this.nextCycle=0;this.queue=[];this.segments=[];this.clients=new Set();this.processing=false;this.pendingTempo=null;this.tempoTicks=0;this.anchorCycle=0;
    this.clock=clockFactory(getTime,(phase,duration)=>{
      if(!this.playing)return;
      // A delayed upstream clock emits all missed slices synchronously. Merge
      // contiguous expired slices before the async drain, retaining their cycle
      // count. They must advance time, not overflow the queue or replay late.
      const previous=this.queue.at(-1);
      if(phase+.1<this.getTime() && previous?.client===this.active && previous.epoch===this.epoch && previous.duration===duration &&
        Math.abs(previous.phase+previous.count*duration-phase)<1e-7){
        previous.count++;return;
      }
      // Never reset the upstream clock from inside its catch-up loop: stop()
      // resets phase to zero and would make that loop start over indefinitely.
      if(this.queue.length>32){
        const epoch=this.epoch;
        queueMicrotask(()=>{if(this.playing&&this.epoch===epoch)this.fail(Error('Audio scheduling fell behind. Run again.'));});
        return;
      }
      this.queue.push({phase,duration,count:1,epoch:this.epoch,client:this.active});
      queueMicrotask(()=>this.drain());
    });
  }
  set(client, play) {
    this.clients.add(client);this.active=client;this.pendingTempo=client.cps;
    if(!play){this.stop();this.cps=client.cps;return;}
    if(!this.playing){
      this.nextCycle=0;this.tempoTicks=0;this.segments=[];this.playing=true;this.epoch++;this.clock.start();
    }
    this.collect();
  }
  position(time) {
    if(!this.playing)return {cycle:0,cps:this.cps};
    const segment=[...this.segments].reverse().find(s=>s.time<=time)||this.segments[0];
    return segment?{cycle:Math.max(0,segment.begin+(time-segment.time)*segment.cps),cps:segment.cps}:{cycle:0,cps:this.cps};
  }
  async drain() {
    if(this.processing)return;this.processing=true;
    try{
      while(this.queue.length&&this.playing){
        const task=this.queue.shift();
        if(task.epoch!==this.epoch)continue;
        const client=task.client;
        if(client===this.active&&this.pendingTempo!==null){
          if(this.cps!==this.pendingTempo)this.tempoTicks=0;
          this.cps=this.pendingTempo;this.pendingTempo=null;
        }
        if(this.tempoTicks===0){this.anchorCycle=this.nextCycle;this.anchorTime=task.phase;}
        this.tempoTicks+=task.count;
        const cps=this.cps,begin=this.nextCycle,end=this.anchorCycle+this.tempoTicks*task.duration*cps;
        this.nextCycle=end;
        this.segments.push({time:task.phase+.1,begin,cps});
        this.segments=this.segments.filter(s=>s.time>=this.getTime()-2).slice(-128);
        // Missed windows still advance musical time, as in upstream Cyclist.
        if(task.phase+(task.count-1)*task.duration+.1<this.getTime())continue;
        try {
          const events=await client.query(begin,end,cps);
          if(task.epoch!==this.epoch||!this.playing)continue;
          for(const event of events){
            const time=this.anchorTime+(event.begin-this.anchorCycle)/cps+.1;
            if(time>=this.getTime())Promise.resolve(this.output(event,time,event.duration/cps,cps,client)).catch(error=>{
              if(task.epoch===this.epoch&&client===this.active)this.fail(error);
            });
            const next=event.value.cps;
            if(next!==undefined){
              if(!Number.isFinite(next)||next<=0||next>20)throw Error('Invalid patterned tempo.');
              if(next!==this.cps){this.cps=next;this.tempoTicks=0;}
            }
          }
        }catch(error){
          if(task.epoch===this.epoch&&client===this.active)this.fail(error);
        }
      }
    }catch(error){this.fail(error);}
    finally{this.processing=false;this.collect();}
  }
  collect() {
    // Retired candidates may still serve already queued lookahead slices.
    if(this.processing)return;
    for(const client of this.clients)if(client!==this.active&&!this.queue.some(t=>t.client===client)){client.dispose();this.clients.delete(client);}
  }
  stop() {this.clock.stop();this.playing=false;this.epoch++;this.queue=[];this.segments=[];this.nextCycle=0;this.tempoTicks=0;this.collect();}
  fail(error) {this.stop();this.active?.dispose();this.onError(error);}
  dispose() {this.stop();for(const client of this.clients)client.dispose();this.clients.clear();}
}
