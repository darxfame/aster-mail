const bridge = window.asterModule;
const plugin = await import('/package/' + new URL(location.href).searchParams.get('main'));
const api = Object.freeze({ call: bridge.call, onEvent: bridge.onEvent });
const instance = await plugin.activate(api);
bridge.onCommand(async (command, input, context) => {
  if (!Object.hasOwn(instance.commands || {}, command) || typeof instance.commands[command] !== 'function') throw new Error('Unknown command');
  return instance.commands[command](input, context);
});
await bridge.ready();
