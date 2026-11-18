'use strict';
function encodeLinguaWav(samples, sourceRate) {
  const rate=16000;
  const size=Math.floor(samples.length*rate/sourceRate);
  const bytes=new ArrayBuffer(44+size*2), view=new DataView(bytes);
  const write=(offset,text)=>{for(let i=0;i<text.length;i++)view.setUint8(offset+i,text.charCodeAt(i))};
  write(0,'RIFF');view.setUint32(4,36+size*2,true);write(8,'WAVE');write(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);
  view.setUint16(34,16,true);write(36,'data');view.setUint32(40,size*2,true);
  for(let i=0;i<size;i++){
    const position=i*sourceRate/rate, left=Math.floor(position), fraction=position-left;
    const value=samples[left]*(1-fraction)+(samples[Math.min(left+1,samples.length-1)]||0)*fraction;
    const clipped=Math.max(-1,Math.min(1,value));
    view.setInt16(44+i*2,clipped*(clipped<0?32768:32767),true);
  }
  return bytes;
}
class LinguaLocalCapture {
  constructor(onChunk){this.onChunk=onChunk;this.context=null;this.worklet=null;this.accepting=true}
  async start(stream){
    this.context=new AudioContext();
    await this.context.audioWorklet.addModule('pcm-worklet.js');
    this.worklet=new AudioWorkletNode(this.context,'lingua-pcm');
    this.source=this.context.createMediaStreamSource(stream);
    this.silent=this.context.createGain();this.silent.gain.value=0;
    this.worklet.port.onmessage=event=>{
      if(this.accepting)this.onChunk(encodeLinguaWav(event.data.samples,event.data.rate),event.data.samples.length/event.data.rate);
    };
    this.source.connect(this.worklet).connect(this.silent).connect(this.context.destination);
    await this.context.resume();
  }
  async stop(){
    if(!this.worklet){await this.context?.close();return}
    this.source.disconnect();
    await new Promise(resolve=>{
      const previous=this.worklet.port.onmessage;
      this.worklet.port.onmessage=event=>{previous(event);resolve()};
      this.worklet.port.postMessage('flush');
      setTimeout(resolve,150);
    });
    this.accepting=false;
    this.worklet.disconnect();this.silent.disconnect();
    await this.context.close();
  }
}
