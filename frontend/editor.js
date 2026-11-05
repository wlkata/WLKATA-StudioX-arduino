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
    const workspace = Blockly.inject(host, {
      toolbox: options.toolbox,
      grid: { spacing: 20, length: 3, colour: '#a0a0a0', snap: true },
      move: { scrollbars: true, drag: true, wheel: true },
      trashcan: true,
      sounds: false,
      zoom: { controls: true, wheel: true, startScale: options.scale || 1, maxScale: 3, minScale: .3, scaleSpeed: 1.2 },
    });
    host.dataset.workspaceId = workspace.id;
    workspace.registerButtonCallback('CREATE_VARIABLE', button => Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace()));
    if (Blockly.Variables.flyoutCategory) workspace.registerToolboxCategoryCallback('VARIABLE', ws => Blockly.Variables.flyoutCategory(ws));
    if (Blockly.Procedures.flyoutCategory) workspace.registerToolboxCategoryCallback('PROCEDURE', ws => Blockly.Procedures.flyoutCategory(ws));

    function snapshot() { return { state: Blockly.serialization.workspaces.save(workspace) }; }
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
      const blocks = api.pasteBlockClipboard(workspace);
      reveal(blocks);
      return blocks;
    }
    function append(source) {
      const state = source && (source.state || source.workspace) || source;
      validateDefinitions(state);
      const blocks = api.appendWorkspaceSnapshot(workspace, state);
      reveal(blocks);
      return blocks;
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
      try { workspace.clear(); }
      finally { Blockly.Events.setGroup(previous); }
      recoveryLocked = false;
      originalRecovery = null;
      saveRecovery();
      options.onChange();
    }
    originalRecovery = api.getData('arduino', 'workspace');
    if (originalRecovery) {
      try {
        validateDefinitions(originalRecovery);
        Blockly.serialization.workspaces.load(originalRecovery, workspace);
        workspace.clearUndo();
      } catch (error) {
        recoveryLocked = true;
        options.onSaved('Could not restore saved blocks: ' + error.message + '. Stored recovery is preserved; save a backup or clear it to start over.');
      }
    }
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
      workspace, snapshot, append, importText, copy, paste, selected, clear, resize, saveRecovery, setDiagnostics, focus,
      activate: () => { workspace.markFocused(); resize(); },
      exportState: () => recoveryLocked ? originalRecovery : snapshot().state,
      recoveryLocked: () => recoveryLocked,
      undo,
    };
  }
  root.StudioXArduinoEditor = { create };
})(typeof window !== 'undefined' ? window : globalThis);
