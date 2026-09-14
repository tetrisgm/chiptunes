import contract from './project.cjs';
// Fixed same-origin endpoints retain the existing authenticated gateway boundary.
export class AgentClient {
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.fetch = fetcher; this.active = null; }
  cancel() { this.active?.abort(); }
  async json(path, options = {}) {
    const controller = options.controller || new AbortController();
    const timer = setTimeout(() => controller.abort(), 35000);
    let reader, cancelListener;
    const aborted = new Promise((_, reject) => {
      cancelListener = () => reject(Error('Agent request cancelled or timed out.'));
      controller.signal.addEventListener('abort', cancelListener, { once:true });
      if (controller.signal.aborted) cancelListener();
    });
    const transport = async () => {
      const response = await this.fetch(path, { credentials:'same-origin', redirect:'error', ...options, signal:controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw Error('Agent request cancelled.'); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw Error(response.status === 401 ? 'Unlock agent access first.' : response.status === 429 ? 'Agent usage limit reached.' : response.status === 409 ? 'This request is already active or was already used.' : 'Agent is unavailable. Your code is unchanged.');
      }
      if (!response.headers.get('content-type')?.includes('application/json')) { void response.body?.cancel().catch(() => {}); throw Error('Unexpected agent response.'); }
      reader = response.body?.getReader();
      if (!reader) throw Error('Empty agent response.');
      const decoder = new TextDecoder('utf-8', { fatal:true }); let text='',length=0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.byteLength; if (length > 65536) throw Error('Agent response is too large.');
        text += decoder.decode(value, { stream:true });
      }
      return JSON.parse(text + decoder.decode());
    };
    try { return await Promise.race([transport(), aborted]); } catch (error) { if (controller.signal.aborted) throw Error('Agent request cancelled or timed out.'); throw error; }
    finally { clearTimeout(timer); controller.signal.removeEventListener('abort', cancelListener); if (reader) { void reader.cancel().catch(() => {}); } }
  }
  access() { return this.json('/api/music/chat/access'); }
  unlock(password) { return this.json('/api/music/chat/access', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({password}) }); }
  logout() { return this.json('/api/music/chat/access', { method:'DELETE' }); }
  async request(context, provider = 'openai') {
    if (this.active) throw Error('An agent request is already running.');
    if (!['openai','anthropic'].includes(provider)) throw Error('Unsupported provider.');
    const controller = new AbortController(); this.active = controller;
    try {
      const snapshot = await contract.context(structuredClone(context));
      if (controller.signal.aborted) throw Error('Agent request cancelled.');
      const proposal = await this.json('/api/music/chat', { controller, method:'POST',
        headers:{'content-type':'application/json','x-music-provider':provider}, body:JSON.stringify(snapshot) });
      contract.candidateFrom(snapshot.project, proposal, snapshot);
      return proposal;
    } finally { if (this.active === controller) this.active = null; }
  }
}
