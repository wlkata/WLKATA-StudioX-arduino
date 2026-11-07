/* The Arduino editor owns its workspace, diagnostics, undo history and recovery. */
(function (root) {
  function create(host, options) {
    const api = options.api;
    let loading = true;
    let recoveryLocked = false;
    let originalRecovery = null;
    let lastSelected = null;
    let savedTimer;
    let warningIds = new Set();
    const entries = {};
    const entryTypes = StudioXArduinoScaffold.entryTypes;
    const workspace = Blockly.inject(host, {
      toolbox: options.toolbox,
      maxInstances: { arduino_setup: 1, arduino_loop: 1 },
      grid: { spacing: 20, length: 3, colour: '#a0a0a0', snap: true },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: true,
      sounds: false,
      zoom: { controls: true, wheel: true, startScale: options.scale || 1, maxScale: 3, minScale: .3, scaleSpeed: 1.2 },
    });
    host.dataset.workspaceId = workspace.id;
    for (const [category,callback] of [['Robot','ARDUINO_ROBOT'],['Accessories','ARDUINO_ACCESSORIES']]) {
      workspace.registerToolboxCategoryCallback(callback, () => {
        const source=options.sourceToolbox?.contents?.find(item=>item.name===category)?.contents || [];
        return StudioXArduinoRobotMapping.flyout(source,snapshot());
      });
    }
    workspace.registerButtonCallback('ARDUINO_MANAGE_LIBRARIES', () => options.onManageLibraries());
    workspace.registerButtonCallback('CREATE_VARIABLE', button => Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace()));
    if (Blockly.Variables.flyoutCategory) workspace.registerToolboxCategoryCallback('VARIABLE', ws => {
      const blocks = Blockly.Variables.flyoutCategory(ws);
      for (const type of ['arduino_type','arduino_instance_call']) {
        const block = Blockly.utils.xml.createElement('block'); block.setAttribute('type',type); blocks.push(block);
      }
      return blocks;
    });
    if (Blockly.Procedures.flyoutCategory) workspace.registerToolboxCategoryCallback('PROCEDURE', ws => Blockly.Procedures.flyoutCategory(ws));

    function snapshot() {
      const state = Blockly.serialization.workspaces.save(workspace);
      (state.blocks && state.blocks.blocks || []).forEach(block => {
        if (entryTypes.includes(block.type)) delete block.deletable;
      });
      return { state };
    }
    function attach(block, type) {
      if (!block || !block.previousConnection) return;
      let tail = entries[type].getInputTargetBlock('DO');
      if (!tail) entries[type].getInput('DO').connection.connect(block.previousConnection);
      else {
        while (tail.getNextBlock()) tail = tail.getNextBlock();
        if (tail.nextConnection) tail.nextConnection.connect(block.previousConnection);
      }
    }
    function ensureEntries() {
      Blockly.Events.disable();
      try {
        entryTypes.forEach((type, index) => {
          const existing = workspace.getBlocksByType(type, false);
          const entry = existing[0] || workspace.newBlock(type);
          if (!existing.length) { entry.initSvg(); entry.render(); entry.moveBy(40, 40 + index * 240); }
          entry.setDeletable(false);
          entry.isDuplicatable = () => false;
          entries[type] = entry;
          for (const duplicate of existing.slice(1)) {
            const body = duplicate.getInputTargetBlock('DO');
            if (body) { body.unplug(false); attach(body, type); }
            duplicate.dispose(false);
          }
        });
      } finally { Blockly.Events.enable(); }
    }
    function validateDefinitions(state) {
      function check(block) {
        if (!block || !Blockly.Blocks[block.type]) throw new Error('Block definition is not installed: ' + (block && block.type || 'unknown'));
        Object.values(block.inputs || {}).forEach(input => { if (input.block) check(input.block); if (input.shadow) check(input.shadow); });
        if (block.next && block.next.block) check(block.next.block);
      }
      (state.blocks && state.blocks.blocks || []).forEach(check);
    }
    function saveRecovery() {
      clearTimeout(savedTimer);
      if (loading || recoveryLocked) return;
      try { api.setData('arduino', 'workspace', snapshot().state); options.onSaved('Saved locally'); }
      catch (error) { options.onSaved('Could not save locally. Save blocks to a file.'); }
    }
    function applyTheme() {
      const dark = document.documentElement.dataset.theme === 'dark';
      workspace.setTheme(Blockly.Theme.defineTheme('studiox_arduino_' + (dark ? 'dark' : 'light'), {
        base: Blockly.Themes.Classic,
        componentStyles: {
          workspaceBackgroundColour: dark ? '#1e1e1e' : '#ffffff',
          toolboxBackgroundColour: dark ? '#252526' : '#f3f3f3',
          toolboxForegroundColour: dark ? '#d4d4d4' : '#333333',
          flyoutBackgroundColour: dark ? '#2d2d30' : '#eeeeee',
          flyoutForegroundColour: dark ? '#d4d4d4' : '#333333',
          flyoutOpacity: 1,
          scrollbarColour: dark ? '#666666' : '#b0b0b0',
        },
      }));
    }
    function resize() {
      if (host.clientWidth > 0 && host.clientHeight > 0) Blockly.svgResize(workspace);
    }
    function selected() {
      const current = Blockly.getSelected ? Blockly.getSelected() : Blockly.common.getSelected();
      if (current && current.workspace === workspace && !current.isInFlyout) return current;
      return lastSelected && !lastSelected.isDisposed() ? lastSelected : null;
    }
    function undo(redo) {
      // Blockly records edits after a render frame. Let pending imports/pastes
      // enter the undo history before applying a toolbar or keyboard action.
      requestAnimationFrame(() => setTimeout(() => {
        workspace.undo(!!redo);
        options.onSelection();
      }, 0));
    }
    function copy() {
      const block = selected();
      if (!block || !api.copyBlockToClipboard(block)) return false;
      options.onSelection();
      return true;
    }
    async function reveal(blocks) {
      if (!blocks.length) return;
      await Blockly.renderManagement.finishQueuedRenders();
      resize();
      if (!options.isActive || options.isActive()) workspace.markFocused();
      if (!options.isActive || options.isActive()) Blockly.getFocusManager().focusNode(blocks[0]);
      blocks[0].select();
      workspace.centerOnBlock(blocks[0].id);
    }
    function paste() {
      const packet=api.getBlockClipboard();
      if (!packet) return [];
      if (packet.format==='json') return append({variables:packet.variables || [],blocks:{languageVersion:0,blocks:packet.blocks}});
      const temporary = new Blockly.Workspace();
      try {
        api.pasteBlockClipboard(temporary);
        return append(Blockly.serialization.workspaces.save(temporary));
      } finally { temporary.dispose(); }
    }
    function append(source) {
      const incoming = source && (source.state || source.workspace) || source;
      const state = StudioXArduinoRobotMapping.transform(incoming,snapshot()).state;
      validateDefinitions(state);
      const prepared = StudioXArduinoScaffold.split(state);
      const previous = Blockly.Events.getGroup();
      Blockly.Events.setGroup(previous || true);
      let blocks;
      try {
        blocks = api.appendWorkspaceSnapshot(workspace, prepared.state);
        blocks.forEach((block, index) => {
          const target = prepared.targets[index] || (block.previousConnection && !block.outputConnection ? 'arduino_setup' : null);
          if (target) attach(block, target);
        });
      } finally { Blockly.Events.setGroup(previous); }
      reveal(blocks);
      return blocks;
    }
    function addIncludes(headers) {
      const existing = new Set(workspace.getBlocksByType('arduino_include', false).map(block => block.getFieldValue('HEADER').trim()));
      const missing = [...new Set(headers)].filter(header => !existing.has(header));
      return append({ blocks: { languageVersion: 0, blocks: missing.map((header, index) => ({ type: 'arduino_include', fields: { HEADER: header }, x: 40, y: 40 + index * 80 })) } });
    }
    function importText(text) {
      if (!String(text).trim().startsWith('<')) return append(JSON.parse(text));
      const xml = Blockly.utils.xml.textToDom(text);
      const missing = [...xml.querySelectorAll('block, shadow')].find(node => !Blockly.Blocks[node.getAttribute('type')]);
      if (missing) throw new Error('Block definition is not installed: ' + missing.getAttribute('type'));
      const temporary = new Blockly.Workspace();
      try {
        Blockly.Xml.domToWorkspace(xml, temporary);
        return append(Blockly.serialization.workspaces.save(temporary));
      } finally { temporary.dispose(); }
    }
    function setDiagnostics(items) {
      warningIds.forEach(id => {
        const block = workspace.getBlockById(id);
        if (!block) return;
        block.setWarningText(null, 'arduino');
        if (block.getSvgRoot()) block.getSvgRoot().classList.remove('arduino-unsupported');
      });
      warningIds = new Set();
      const messages = new Map();
      items.forEach(item => {
        if (!item.blockId) return;
        const list = messages.get(item.blockId) || [];
        list.push(item.message);
        messages.set(item.blockId, list);
      });
      messages.forEach((list, id) => {
        const block = workspace.getBlockById(id);
        if (!block) return;
        block.setWarningText('Arduino: ' + list.join('\n'), 'arduino');
        if (block.getSvgRoot()) block.getSvgRoot().classList.add('arduino-unsupported');
        warningIds.add(id);
      });
    }
    function focus(id) {
      const block = workspace.getBlockById(id);
      if (!block) return;
      resize();workspace.markFocused();Blockly.getFocusManager().focusNode(block);block.select();workspace.centerOnBlock(id);
    }
    function clear() {
      const previous = Blockly.Events.getGroup();
      Blockly.Events.setGroup(previous || true);
      try {
        for (const block of workspace.getTopBlocks(false)) {
          if (!entryTypes.includes(block.type)) block.dispose(false);
          else {
            const body = block.getInputTargetBlock('DO');
            if (body) body.dispose(false);
          }
        }
      }
      finally { Blockly.Events.setGroup(previous); }
      recoveryLocked = false;
      originalRecovery = null;
      saveRecovery();
      options.onChange();
    }
    originalRecovery = api.getData('arduino', 'workspace');
    if (originalRecovery) {
      try {
        const restored=StudioXArduinoRobotMapping.transform(originalRecovery).state;
        validateDefinitions(restored);
        Blockly.serialization.workspaces.load(restored, workspace);
        workspace.clearUndo();
      } catch (error) {
        recoveryLocked = true;
        options.onSaved('Could not restore saved blocks: ' + error.message + '. Stored recovery is preserved; save a backup or clear it to start over.');
      }
    }
    ensureEntries();
    StudioXArduinoLibraryBlocks.observeWorkspace(workspace);
    workspace.clearUndo();
    loading = false;
    workspace.addChangeListener(event => {
      if (event.type === Blockly.Events.SELECTED && event.newElementId) lastSelected = workspace.getBlockById(event.newElementId);
      if (event.isUiEvent) { options.onSelection(); return; }
      if (loading) return;
      options.onChange();
      clearTimeout(savedTimer);
      savedTimer = setTimeout(saveRecovery, 250);
    });
    host.addEventListener('keydown', event => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (!['c','v','z','y'].includes(key)) return;
      event.preventDefault();event.stopImmediatePropagation();
      if (key === 'c') copy();
      else if (key === 'v') paste();
      else undo(key === 'y' || event.shiftKey);
    }, true);
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.addEventListener('beforeunload', saveRecovery);
    applyTheme();resize();
    return {
      workspace, snapshot, append, addIncludes, importText, copy, paste, selected, clear, resize, saveRecovery, setDiagnostics, focus,
      activate: () => { workspace.markFocused(); resize(); },
      exportState: () => recoveryLocked ? originalRecovery : snapshot().state,
      recoveryLocked: () => recoveryLocked,
      updateToolbox: toolbox => { workspace.updateToolbox(toolbox); resize(); },
      undo,
    };
  }
  root.StudioXArduinoEditor = { create };
})(typeof window !== 'undefined' ? window : globalThis);
