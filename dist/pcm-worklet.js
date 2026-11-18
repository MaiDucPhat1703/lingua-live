class LinguaPCM extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(sampleRate * 8);
    this.offset = 0;
    this.port.onmessage = event => {
      if (event.data === 'flush' && this.offset) this.flush();
    };
  }
  flush() {
    const result = this.buffer.slice(0, this.offset);
    this.port.postMessage({ samples: result, rate: sampleRate }, [result.buffer]);
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const length = Math.min(channel.length - offset, this.buffer.length - this.offset);
      this.buffer.set(channel.subarray(offset, offset + length), this.offset);
      this.offset += length;
      offset += length;
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('lingua-pcm', LinguaPCM);
