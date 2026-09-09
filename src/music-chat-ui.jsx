/* Adapted from Vercel AI Elements 1.9.0 (Apache-2.0).
 * See music-chat-ui.NOTICE.md and music-chat-ui.LICENSE.txt.
 * Presentation only: never imports project, transport, storage or audio code.
 */
import React, {useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';

const text = value => typeof value === 'string' ? value : '';

function Chat({state, dispatch}) {
  const input = useRef(null), log = useRef(null), content = useRef(null);
  const following = useRef(true), composing = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const messages = state.messages || [], proposal = state.proposal;
  const pending = state.pending === true;
  const draft = text(state.input);
  const canSend = state.canSend === true && !pending && !!draft.trim() && draft.length <= 2000;
  const measure = () => {
    const el = log.current;
    if (!el || !el.clientHeight) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    following.current = bottom;
    setAtBottom(bottom);
  };
  const latest = () => {
    const el = log.current;
    if (!el || !el.clientHeight) return;
    el.scrollTop = el.scrollHeight;
    following.current = true;
    setAtBottom(true);
  };
  // Follow new content only when the reader was already at the bottom.
  // ResizeObserver also handles reopening a host-hidden panel, without remounting.
  useLayoutEffect(() => {
    const resize = () => { if (following.current) latest(); else measure(); };
    const Observer = log.current.ownerDocument.defaultView.ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(resize);
    observer.observe(log.current); observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { if (following.current) latest(); });

  const fill = value => {
    dispatch('onInput', value.slice(0, 2000));
    input.current.focus({preventScroll:true});
  };
  const send = event => {
    event.preventDefault();
    if (canSend && !composing.current) dispatch('onSend', draft.trim());
    // The controller clears input only after beginRequest succeeds.
  };
  return <section className="mcui" aria-label="Music chat">
    <header className="mcui-header"><h2>Chat</h2><div>
      <button type="button" onClick={() => dispatch('onSettings')}>Settings</button>
      <button type="button" onClick={() => dispatch('onHide')}>Hide chat</button>
    </div></header>
    <p className="mcui-status" role="status">{text(state.accessMessage)}</p>
    <div className="mcui-transcript">
      <div className="mcui-log" ref={log} onScroll={measure} role="log"
        aria-label="Conversation" aria-live="polite" aria-relevant="additions text" tabIndex={0}>
        <div className="mcui-content" ref={content}>
          {!messages.length && <div className="mcui-empty">
            <p>Ask about your music, explore an idea, or request an edit. You decide which changes to apply.</p>
            <div className="mcui-suggestions">{(state.suggestions || []).map((suggestion, i) =>
              <button type="button" key={i} onClick={() => fill(text(suggestion))}>{text(suggestion)}</button>)}</div>
          </div>}
          {messages.map((message, i) => <article className={'mcui-message '+(message.role === 'user' ? 'mcui-user' : 'mcui-assistant')} key={i}>
            <b>{message.role === 'user' ? 'You' : 'Assistant'}</b>
            <p>{text(message.content)}</p>
          </article>)}
          {proposal && <article className="mcui-proposal" aria-label="Current proposal">
            <b>{text(proposal.status)}</b><p>{text(proposal.summary)}</p>
            {typeof proposal.preview === 'string' && <pre>{proposal.preview}</pre>}
            {proposal.status === 'ready' && <div className="mcui-actions">
              <button type="button" disabled={!proposal.canApply || pending}
                onClick={() => dispatch('onApply', proposal.id)}>Apply</button>
              <button type="button" disabled={pending}
                onClick={() => dispatch('onReject', proposal.id)}>Reject</button>
            </div>}
          </article>}
          {pending && <p role="status">Waiting for a reply…</p>}
          {state.error && <p className="mcui-error" role="alert">{text(state.error)}</p>}
        </div>
      </div>
      {!atBottom && <button className="mcui-latest" type="button" onClick={latest}>Scroll to latest</button>}
    </div>
    <form className="mcui-composer" onSubmit={send} onDrop={event => {
      // No attachment intake or file navigation. Ordinary text drops remain native.
      if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    }} onDragOver={event => {
      if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    }}>
      <label>Message<textarea ref={input} rows={3} maxLength={2000} value={draft}
        placeholder="Ask about your music or request an edit"
        onChange={event => dispatch('onInput', event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          // Stop bubbling to the host Run shortcut; host capture must also exclude this island.
          if (event.key !== 'Enter') return;
          event.stopPropagation();
          if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          if (!event.shiftKey) send(event);
        }} onPaste={event => {
          // Read only text/plain; never create blobs, parse HTML or fetch attachments.
          event.preventDefault();
          const el = event.currentTarget, plain = event.clipboardData.getData('text/plain');
          if (!plain) return;
          const start = el.selectionStart, end = el.selectionEnd;
          const insert = plain.slice(0, Math.max(0, 2000 - (draft.length - (end-start))));
          dispatch('onInput', draft.slice(0,start)+insert+draft.slice(end));
          el.setSelectionRange(start+insert.length,start+insert.length);
        }} /></label>
      <small>Sending shares source, your request and recent chat with the selected provider. Edits require Apply.</small>
      <div className="mcui-actions">{pending
        ? <button key="stop" type="button" onClick={event => { event.preventDefault(); dispatch('onStop'); }}>Stop generation</button>
        : <button key="send" type="submit" disabled={!canSend}>Send</button>}</div>
    </form>
  </section>;
}

/**
 * State (complete snapshot on every update):
 * {input:string, messages:[{role:'user'|'assistant',content:string}],
 *  suggestions?:string[], pending:boolean, canSend:boolean,
 *  accessMessage?:string, error?:string,
 *  proposal?:{id:string,status:string,summary:string,preview?:string,canApply:boolean}}
 * Callbacks: onInput(text), onSend(trimmedText), onStop(), onApply(id),
 * onReject(id), onSettings(), onHide(). All callbacks are synchronous dispatches;
 * host owns async errors and must synchronously update input/request state.
 * Host MUST recheck current proposal identity/context/revision in onApply/onReject.
 * No callbacks are invoked by mounting/updating/unmounting.
 */
const mounted = new WeakSet();
export function mount(container, state, callbacks = {}) {
  if (!container || container.nodeType !== 1) throw Error('Chat requires an element');
  if (mounted.has(container) || container.childNodes.length) throw Error('Chat requires an empty, unmounted container');
  mounted.add(container);
  const root = createRoot(container);
  let alive = true, current = state;
  const dispatch = (name, value) => {
    if (!alive) return;
    // Recheck latest presentation state as well as the controller's authoritative check.
    if (name === 'onSend' && (current.pending || !current.canSend)) return;
    if (name === 'onStop' && !current.pending) return;
    if (name === 'onApply' || name === 'onReject') {
      const p = current.proposal;
      if (!p || p.id !== value || p.status !== 'ready' || current.pending || (name === 'onApply' && !p.canApply)) return;
    }
    if (typeof callbacks[name] === 'function') callbacks[name](value);
  };
  const update = next => {
    if (!alive) return;
    current = next;
    // Synchronous DOM updates make controlled input/selection usable by vanilla callers.
    flushSync(() => root.render(<Chat state={next} dispatch={dispatch}/>));
  };
  update(state);
  return {
    update,
    focus() { if (alive) container.querySelector('textarea')?.focus({preventScroll:true}); },
    destroy() {
      if (!alive) return;
      alive = false; root.unmount(); mounted.delete(container);
      // Cancellation is the host's responsibility, never an implicit model action.
    }
  };
}
