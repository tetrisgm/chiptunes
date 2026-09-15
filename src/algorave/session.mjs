import contract from './project.cjs';
export const STORAGE_KEY = 'ct-algorave-project-v1';
const copy = value => structuredClone(value);

export class ProjectSession {
  constructor(initial, runtime, storage) {
    this.runtime = runtime; this.storage = storage;
    this.draft = contract.project(initial); this.applied = copy(this.draft);
    this.history = []; this.busy = false; this.generation = 0; this.savedRaw = null; this.recoveryError = null;
    try {
      this.savedRaw = storage?.getItem(STORAGE_KEY) ?? null;
      if (this.savedRaw !== null) {
        if (this.savedRaw.length > 1100000) throw Error('Saved project is too large.');
        const record = JSON.parse(this.savedRaw);
        if (record?.version !== 1 || Object.keys(record).some(k => !['version','draft','applied'].includes(k))) throw Error('Unsupported saved project.');
        const draft = contract.project(record.draft), applied = contract.project(record.applied);
        this.draft = draft; this.applied = applied;
      }
    } catch (error) { this.recoveryError = 'Saved project was kept but could not be opened: ' + error.message; }
  }
  edit(value) {
    if (this.busy) throw Error('Wait for the current edit to finish.');
    this.draft = contract.project(value); this.generation++;
  }
  save({ replaceUnreadable = false } = {}) {
    if (!this.storage) return;
    if (this.recoveryError && !replaceUnreadable) throw Error(this.recoveryError);
    const current = this.storage.getItem(STORAGE_KEY);
    if (current !== this.savedRaw) throw Error('This project changed in another tab. Export your work before reloading.');
    const raw = JSON.stringify({ version:1, draft:this.draft, applied:this.applied });
    this.storage.setItem(STORAGE_KEY, raw); this.savedRaw = raw; this.recoveryError = null;
  }
  async requestContext(request, target = 'auto', conversation = []) {
    const snapshot = copy(this.draft);
    return contract.context({ kind:'algorave', id:crypto.randomUUID(), request, target, conversation,
      project:snapshot, baseRevision:await contract.revision(snapshot) });
  }
  async activate(value, { draftAfter = value, historyDraft = this.draft, record = true, restore = false, checkpoint } = {}) {
    if (this.busy) throw Error('Wait for the current edit to finish.');
    const next = contract.project(value), draft = contract.project(draftAfter);
    const previous = { draft:contract.project(historyDraft), applied:copy(this.applied) }, generation = this.generation;
    if(this.checkpoint!==undefined)previous.checkpoint=this.checkpoint;
    this.busy = true;
    let prepared;
    try {
      prepared = await this.runtime.prepare(next, previous.applied, {restore,checkpoint});
      if (generation !== this.generation) throw Error('The source changed. Review the edit again.');
      await prepared.apply();
      this.applied = next; this.draft = draft; this.generation++;
      if(prepared.checkpoint!==undefined)this.checkpoint=prepared.checkpoint;
      // Play/Run still activates the runtime, but an unchanged project is not
      // an edit. Otherwise starting playback hides the last edit behind a
      // redundant Undo step.
      if (record && (JSON.stringify(previous.applied) !== JSON.stringify(next) || JSON.stringify(previous.draft) !== JSON.stringify(draft))) {
        this.history.push(previous); if (this.history.length > 20) this.history.shift();
      }
      this.retainRuntime();
    } finally { prepared?.dispose(); this.busy = false; }
  }
  async accept(proposal, context) {
    const generation = this.generation, draft = copy(this.draft);
    if (await contract.revision(draft) !== context.baseRevision || generation !== this.generation) throw Error('The source changed. Ask for a fresh proposal.');
    const next = contract.candidateFrom(this.draft, proposal, context);
    if (proposal.edits.length) await this.activate(next);
  }
  async undo() {
    const previous = this.history.at(-1);
    if (!previous) return;
    await this.activate(previous.applied, { draftAfter:previous.draft, record:false, restore:true, checkpoint:previous.checkpoint });
    this.history.pop();
    this.retainRuntime();
  }
  retainRuntime(){this.runtime.retain?.([this.checkpoint,...this.history.map(item=>item.checkpoint)].filter(Number.isSafeInteger));}
}
