document.querySelector('#increment').addEventListener('click', async () => {
  try { const value = await window.asterModule.command('increment'); document.querySelector('#result').textContent = String(value.count); }
  catch { document.querySelector('#result').textContent = 'Module error'; }
});
window.asterModule.onEvent(event => { if (event.topic === 'example.sandbox-demo.count') document.querySelector('#result').textContent = String(event.data); });
