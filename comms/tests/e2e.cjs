const { chromium } = require('playwright');
/**
 * End-to-end check in real browsers (two people, live chat, notice + acknowledge, webhook alert,
 * a WebRTC video call with fake camera/mic, and mail).
 *
 *   npm run build && npm run seed -- --reset && npm start      # in one terminal
 *   npm run e2e                                                # in another
 *
 * Needs Playwright with Chromium available (require('playwright')). Screenshots go to E2E_OUT (default: a temp dir).
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const B = process.env.RELAY_URL ?? 'http://localhost:4000';
const out = process.env.E2E_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-'));
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('PASS', m); };
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errors = [];
  async function person(email) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 }, permissions: ['camera', 'microphone'] });
    const r = await ctx.request.post(B + '/api/auth/login', { data: { email, password: 'relay-demo-1' } });
    if (!r.ok()) throw new Error(await r.text());
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(email + ' ' + e.message));
    p.on('dialog', (d) => d.accept());
    return p;
  }
  const amina = await person('amina@example.com');
  const convs = await (await amina.request.get(B + '/api/conversations')).json();
  const itStatus = convs.conversations.find((c) => c.name === 'it-status');
  const hook = (await (await amina.request.post(B + '/api/conversations/' + itStatus.id + '/apps', { data: { name: 'E2E monitor' }, headers: { origin: B } })).json()).app.token;
  const daniel = await person('daniel@example.com');
  await amina.goto(B + '/#/chat'); await daniel.goto(B + '/#/chat');
  await amina.waitForSelector('.side-row'); await daniel.waitForSelector('.side-row');
  await amina.click('.side-row:has-text("general")'); await daniel.click('.side-row:has-text("general")');
  await amina.waitForSelector('.msg'); await daniel.waitForSelector('.msg');

  // presence
  try {
    await amina.waitForFunction(() => [...document.querySelectorAll('.member-list li')].some((li) => li.textContent.includes('Daniel') && li.textContent.includes('Available')), null, { timeout: 8000 });
  } catch (e) {
    console.log('member list:', await amina.locator('.side-panel').innerText().catch(() => 'no panel'));
    throw e;
  }
  ok(true, 'presence: Amina sees Daniel come online');

  // live message + mention
  await daniel.fill('.composer textarea', 'Service desk queue is clear @amina');
  await daniel.click('.send-btn');
  await amina.waitForSelector('.msg-body:has-text("Service desk queue is clear")', { timeout: 5000 });
  ok(await amina.locator('.mention-me').last().isVisible(), 'live message arrives with @mention highlighted');

  // notice + acknowledge
  await amina.click('button[aria-label="Post as a notice that needs acknowledging"]');
  await amina.fill('.composer textarea', 'Please restart Outlook once service returns.');
  await amina.click('.send-btn');
  const notice = daniel.locator('.notice-card:has-text("restart Outlook")');
  await notice.waitFor({ timeout: 5000 });
  await notice.locator('.notice-btn').click();
  await amina.waitForSelector('.notice-card:has-text("restart Outlook") >> text=Acknowledged by 1 of', { timeout: 5000 });
  ok(true, 'notice acknowledged by Daniel shows on Amina’s screen');
  await daniel.screenshot({ path: out + '/e2e-notice.png' });

  // webhook alert
  await amina.click('.side-row:has-text("it-status")');
  await amina.waitForSelector('.alert-card');
  const res = await fetch(`${B}/api/hooks/${hook}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Microsoft 365 restored', text: 'All checks passing.', severity: 'resolved' }) });
  ok(res.ok, 'webhook accepted');
  await amina.waitForSelector('.alert-card.sev-resolved:has-text("Microsoft 365 restored")', { timeout: 5000 });
  ok(true, 'app alert card appears live');

  // video call Amina -> Daniel
  await amina.goto(B + '/#/people');
  await amina.click('button[aria-label="Video call Daniel Otieno"]');
  await daniel.waitForSelector('.incoming', { timeout: 8000 });
  ok(true, 'Daniel gets incoming call');
  await daniel.click('button[aria-label="Answer with video"]');
  const connected = (p) => p.waitForFunction(() => {
    const vids = [...document.querySelectorAll('.call-window .tile video')];
    return vids.some((v) => !v.classList.contains('mirror') && v.srcObject && v.videoWidth > 0 && !v.paused);
  }, null, { timeout: 15000 });
  await connected(amina); await connected(daniel);
  ok(true, 'both sides receive remote video over WebRTC');
  await amina.waitForTimeout(800);
  await amina.screenshot({ path: out + '/e2e-call.png' });
  await daniel.click('button[aria-label="Mute microphone"]');
  await amina.waitForSelector('.tile-label:has-text("Daniel") svg', { timeout: 5000 });
  ok(true, 'mute indicator propagates');
  await amina.click('.call-controls button[aria-label="Hang up"]');
  await daniel.waitForSelector('.call-window', { state: 'detached', timeout: 5000 });
  ok(true, 'hang-up ends the call for both');
  await amina.goto(B + '/#/calls');
  await amina.waitForSelector('.history li:has-text("Daniel")');
  ok(true, 'call appears in history');

  // mail
  await amina.goto(B + '/#/mail/inbox');
  await amina.click('.compose-btn');
  await amina.fill('#mail-to', 'dan');
  await amina.keyboard.press('Enter');
  await amina.fill('#mail-subject', 'Shift handover');
  await amina.fill('.compose-body', 'Notes attached in Relay.');
  await amina.click('.compose-foot .btn.primary');
  await daniel.goto(B + '/#/mail/inbox');
  await daniel.waitForSelector('.mail-item:has-text("Shift handover")', { timeout: 5000 });
  ok(true, 'mail delivered to Daniel');

  // phone: ack button visible on notice from non-sender
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phoneCtx.request.post(B + '/api/auth/login', { data: { email: 'lucy@example.com', password: 'relay-demo-1' } });
  const ph = await phoneCtx.newPage();
  await ph.goto(B + '/#/chat');
  await ph.click('.m-conv:has(.m-conv-name:text-is("#general"))');
  await ph.waitForSelector('.notice-btn');
  await ph.locator('.notice-card').first().scrollIntoViewIfNeeded();
  await ph.screenshot({ path: out + '/e2e-phone-notice.png' });
  ok(true, 'phone notice shows Acknowledge');

  ok(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
  console.log('Screenshots in', out);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
