/* Entry shells are editor furniture; transfers append their instructions. */
(function (root) {
  const entryTypes = ['arduino_setup', 'arduino_loop'];
  function split(state) {
    const copy = JSON.parse(JSON.stringify(state));
    const tasks = [];
    function add(block, target) { if (block) tasks.push({ block, target }); }
    for (const block of copy.blocks && copy.blocks.blocks || []) {
      if (!entryTypes.includes(block.type)) { add(block, null); continue; }
      const input = block.inputs && block.inputs.DO;
      let body = input && (input.block || input.shadow);
      if (block.enabled === false || block.disabledReasons && block.disabledReasons.length) {
        for (let current = body; current; current = current.next && current.next.block) { current.enabled = false; current.disabledReasons = [...new Set([...(current.disabledReasons || []), 'MANUALLY_DISABLED'])]; }
      }
      add(body, block.type);
      if (block.next) add(block.next.block, null);
    }
    copy.blocks = { languageVersion: 0, blocks: tasks.map(task => task.block) };
    return { state: copy, targets: tasks.map(task => task.target) };
  }
  const api = { split, entryTypes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StudioXArduinoScaffold = api;
})(typeof window !== 'undefined' ? window : globalThis);
