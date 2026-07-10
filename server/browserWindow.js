// Minimize the automation browser window so these headed Playwright tasks don't
// steal focus or cover the screen while they run. Uses Chrome DevTools Protocol
// (Browser.setWindowBounds) which targets ONLY this automation window — never the
// user's own Chrome. Verified this does not affect task success (Cloudflare still
// clears; our fetches are CDP-driven, not throttled by background-tab timers).
// Best-effort: any failure is swallowed so it can never break a task.
export async function minimizeWindow(ctx, page) {
  try {
    const cdp = await ctx.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    return true;
  } catch {
    return false; // headless, unsupported, or already closed — ignore
  }
}
