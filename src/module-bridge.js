// Host-owned browser wrapper. Recreate typed errors in the caller's world;
// Electron contextBridge does not preserve custom properties on thrown Errors.
(() => {
  const transport = window.asterModuleTransport;
  async function call(method, input = {}) {
    const result = await transport.call(method, input);
    if (!result?.ok) throw Object.assign(new Error(result?.error || 'Module request failed'), { code: result?.code || 'module-request-rejected', status: result?.status });
    return result.value;
  }
  Object.defineProperty(window, 'asterModule', { value: Object.freeze({
    call,
    command: (command, input = {}) => call('command', { command, input }),
    ready: () => call('ready'),
    onCommand: transport.onCommand,
    onEvent: transport.onEvent,
  }), writable: false, configurable: false });
})();
