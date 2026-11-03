export async function activate(api) {
  let count = (await api.call('storage.get')).count || 0;
  return { commands: {
    open: () => api.call('ui.openView', { view: 'panel' }),
    draft: (_input, context) => api.call(context?.editorId ? 'meeting.patchDraft' : 'meeting.openDraft', { location: 'SDK demo: fictional room' }),
    increment: async () => { count++; await api.call('storage.set', { count }); await api.call('events.publish', { topic: 'count', data: count }); return { count }; },
    inspect: async input => {
      let directNetworkBlocked = true, fileBlocked = true, calendarBlocked = false;
      if (input.url) try { await fetch(input.url); directNetworkBlocked = false; } catch { /* CSP must block it. */ }
      if (input.file) try { await fetch(input.file); fileBlocked = false; } catch { /* No filesystem surface. */ }
      try { await api.call('calendar.list', { start: '2026-11-03T00:00:00Z', end: '2026-11-04T00:00:00Z' }); } catch { calendarBlocked = true; }
      if (input.iceServer) {
        const peer = new RTCPeerConnection({ iceServers: [{ urls: input.iceServer }] });
        try {
          const gathered = new Promise(resolve => { const timer = setTimeout(resolve, 700); peer.onicegatheringstatechange = () => { if (peer.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } }; });
          peer.createDataChannel('isolation-check');
          await peer.setLocalDescription(await peer.createOffer()); await gathered;
        } finally { peer.close(); }
      }
      return { cookie: document.cookie, coreBridge: typeof window.aster !== 'undefined', node: typeof require !== 'undefined' || typeof process !== 'undefined', directNetworkBlocked, fileBlocked, calendarBlocked };
    },
  } };
}
