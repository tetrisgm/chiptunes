// Minimal SMTP client for Cloudflare Workers — implicit TLS (port 465), AUTH LOGIN. Workers can't use
// nodemailer, so this speaks SMTP directly over a TCP socket to reuse the stack's MXroute account
// (the same AUTH_EMAIL_SERVER = smtps://user:pass@host:port URL every other product uses). Lockstep,
// no pipelining. Returns { sent: true } or { sent: false, reason }.
import { connect } from 'cloudflare:sockets';

export async function sendSmtp(serverUrl, fromDisplay, to, subject, text) {
  let u;
  try { u = new URL(serverUrl); } catch (e) { return { sent: false, reason: 'AUTH_EMAIL_SERVER is not a valid URL' }; }
  const host = u.hostname;
  const port = Number(u.port) || 465;
  const user = decodeURIComponent(u.username || '');
  const pass = decodeURIComponent(u.password || '');
  if (!host || !user || !pass) return { sent: false, reason: 'AUTH_EMAIL_SERVER missing host/user/pass' };
  const from = `${fromDisplay} <${user}>`;        // From matches the authenticated mailbox (SPF/DKIM alignment)
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const b64 = (s) => btoa(unescape(encodeURIComponent(s)));

  const socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  let buf = '';
  const readMore = async () => {
    const { value, done } = await reader.read();
    if (done) return false;
    buf += dec.decode(value, { stream: true });
    return true;
  };
  // Wait for a FINAL SMTP reply line ("NNN<space>…" — a dash after the code is a continuation line).
  const expect = async (okCsv) => {
    const ok = String(okCsv).split(',');
    while (true) {
      const m = buf.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n/);
      if (m) { buf = ''; if (!ok.includes(m[1])) throw new Error('SMTP said ' + m[1] + ': ' + m[0].trim()); return m[1]; }
      if (!(await readMore())) throw new Error('SMTP connection closed early: ' + buf.trim());
    }
  };
  const cmd = (line) => writer.write(enc.encode(line + '\r\n'));

  try {
    await expect('220');
    await cmd('EHLO chiptunes-monitor'); await expect('250');
    await cmd('AUTH LOGIN'); await expect('334');
    await cmd(b64(user)); await expect('334');
    await cmd(b64(pass)); await expect('235');
    await cmd('MAIL FROM:<' + user + '>'); await expect('250');
    await cmd('RCPT TO:<' + to + '>'); await expect('250,251');
    await cmd('DATA'); await expect('354');
    const body = ('' + text).replace(/\r?\n/g, '\r\n').replace(/\r\n\./g, '\r\n..');   // dot-stuffing
    const message = [
      'From: ' + from,
      'To: ' + to,
      'Subject: ' + subject,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      '.',
    ].join('\r\n');
    await cmd(message); await expect('250');
    try { await cmd('QUIT'); } catch (e) {}
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: String(e && e.message || e) };
  } finally {
    try { await writer.close(); } catch (e) {}
    try { socket.close(); } catch (e) {}
  }
}
