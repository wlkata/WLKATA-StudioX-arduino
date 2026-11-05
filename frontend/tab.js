(function () {
  const assetBase = document.currentScript.src;
  let editor = null;
  let analysis = null;
  let compiled = null;
  let available = false;
  let busy = false;
  let operation = null;
  let generation = 0;
  let timer;
  let highlights = true;
  const api = window.ExtensionAPI;
  const get = id => document.getElementById('arduino-' + id);
  const message = text => { get('build-status').textContent = text; };
  function request(path, body) {
    return api.fetch('arduino', path, body === undefined ? undefined : {
      method: 'POST', body: JSON.stringify(body),
    }).then(data => {
      if (!data || !data.success) throw new Error(data && data.error || 'Arduino extension is unavailable.');
      return data;
    });
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const port = () => get('port').value === 'manual' ? get('manual-port').value.trim() : get('port').value;
  function buttons() {
    const valid = analysis && !analysis.diagnostics.length;
    get('compile').disabled = busy || !available || !valid;
    get('upload').disabled = busy || !available || !valid || !port() || !compiled ||
      compiled.code !== analysis.code || compiled.board !== get('board').value;
    get('install-core').disabled = busy || !available;
    get('cancel').hidden = !busy;
    get('cancel').disabled = !operation;
    ['board', 'port', 'manual-port', 'save-cli', 'refresh-devices', 'manage-boards'].forEach(id => { get(id).disabled = busy; });
    get('undo').disabled = !editor || !editor.workspace.getUndoStack().length;
    get('redo').disabled = !editor || !editor.workspace.getRedoStack().length;
    get('copy-blocks').disabled = !editor || !editor.selected();
    get('paste-blocks').disabled = !editor || !api.getBlockClipboard();
  }
  async function analyze() {
    const token = ++generation;
    try {
      if (!editor) return;
      const snapshot = editor.snapshot();
      if (token !== generation) return;
      analysis = window.StudioXArduinoCompiler.compile(snapshot);
      get('code').value = analysis.code;
      if (compiled && compiled.code !== analysis.code) {
        compiled = null;
        if (!busy) message('Workspace changed. Compile again before uploading.');
      }
      editor.setDiagnostics(highlights ? analysis.diagnostics : []);
      get('validation-status').textContent = analysis.diagnostics.length
        ? analysis.diagnostics.length + ' workspace problem' + (analysis.diagnostics.length === 1 ? '' : 's')
        : 'Workspace supports Arduino';
      const problems = get('problems');
      problems.replaceChildren();
      analysis.diagnostics.forEach(item => {
        const li = document.createElement('li');
        const node = document.createElement(item.blockId ? 'button' : 'span');
        node.textContent = item.message;
        if (item.blockId) {
          node.type = 'button';
          node.title = 'Show this block in the Arduino workspace';
          node.addEventListener('click', () => editor.focus(item.blockId));
        }
        li.appendChild(node);
        problems.appendChild(li);
      });
      if (!analysis.diagnostics.length && !compiled && !busy) message('Ready to compile.');
    } catch (error) {
      analysis = null;
      compiled = null;
      message(error.message);
    }
    buttons();
  }
  function validateSoon() {
    clearTimeout(timer);
    // Invalidate upload immediately, before the debounced generation runs.
    compiled = null;
    buttons();
    timer = setTimeout(analyze, 180);
  }
  async function refresh() {
    get('refresh-devices').disabled = true;
    try {
      const status = await request('/status');
      available = status.available;
      get('tooling-status').textContent = available
        ? 'Arduino CLI ready' + (status.version && status.version.VersionString ? ' · ' + status.version.VersionString : '')
        : status.error;
      get('cli-settings').open = !available;
      if (!available) { message('Run Arduino setup in Settings → Extensions to install CLI.'); return; }
      get('cli-path').placeholder = status.cliPath || 'Automatic detection';
      const savedBoard = get('board').value || api.getSetting('arduino.board', 'arduino:avr:uno');
      const savedPort = get('port').value;
      const results = await Promise.allSettled([request('/boards'), request('/ports')]);
      if (results[0].status === 'fulfilled') {
        get('board').replaceChildren();
        results[0].value.boards.forEach(board => {
          const option = document.createElement('option'); option.value = board.fqbn; option.textContent = board.name;
          get('board').appendChild(option);
        });
        if ([...get('board').options].some(option => option.value === savedBoard)) get('board').value = savedBoard;
      }
      if (results[1].status === 'fulfilled') {
        get('port').replaceChildren();
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Choose a serial port'; get('port').appendChild(empty);
        results[1].value.ports.forEach(item => {
          const option = document.createElement('option'); option.value = item.address; option.textContent = item.label;
          get('port').appendChild(option);
        });
        const manual = document.createElement('option'); manual.value = 'manual'; manual.textContent = 'Enter port manually…'; get('port').appendChild(manual);
        if ([...get('port').options].some(option => option.value === savedPort)) get('port').value = savedPort;
      }
      const failure = results.find(result => result.status === 'rejected');
      if (failure) message('Device discovery: ' + failure.reason.message + ' Install board support if this is a new setup.');
    } catch (error) { available = false; get('tooling-status').textContent = error.message; }
    finally { buttons(); }
  }
  async function watchJob(identifier, onProgress) {
    operation = identifier;
    buttons();
    let failures = 0;
    while (true) {
      try {
        const job = await request('/jobs/' + identifier);
        failures = 0;
        get('log').textContent = job.log.join('\n');
        if (onProgress) onProgress(job);
        get('log').scrollTop = get('log').scrollHeight;
        if (job.done) {
          if (!job.ok) throw new Error(job.error || 'Operation failed.');
          return job;
        }
      } catch (error) {
        if (++failures >= 3) throw error;
      }
      await pause(300);
    }
  }
  async function perform(kind) {
    if (busy) return;
    busy = true;
    showOutput('log');
    buttons();
    try {
      await analyze();
      const board = get('board').value;
      const code = analysis && analysis.code;
      if (kind !== 'core' && (!analysis || analysis.diagnostics.length)) {
        throw new Error('Resolve workspace problems before compiling or uploading.');
      }
      if (kind === 'upload' && (!compiled || compiled.code !== code || compiled.board !== board || !port())) {
        throw new Error('Compile the current workspace and select a port before uploading.');
      }
      message(kind === 'compile' ? 'Compiling…' : kind === 'upload' ? 'Uploading…' : 'Installing board support…');
      let started;
      if (kind === 'compile') {
        compiled = null;
        started = await request('/compile', { code, board });
      } else if (kind === 'upload') {
        started = await request('/upload', { compileId: compiled.id, port: port() });
      } else {
        compiled = null;
        started = await request('/core/install', { board });
      }
      const job = await watchJob(started.jobId);
      await analyze();
      if (kind === 'compile') {
        if (analysis && !analysis.diagnostics.length && analysis.code === code && get('board').value === board) {
          compiled = { id: job.id, code, board };
          message('Compiled successfully. Select a port and upload.');
        } else message('Compiled an older workspace. Compile again to include your latest changes.');
      } else message(kind === 'upload' ? 'Upload complete.' : 'Board support installed.');
    } catch (error) { message(error.message); }
    finally {
      busy = false;
      operation = null;
      buttons();
      if (kind === 'core') refresh();
    }
  }
  async function runToolJob(path, body, onProgress) {
    if (busy) throw new Error('Another Arduino operation is running.');
    busy = true; compiled = null; showOutput('log'); buttons();
    try {
      const started = await request(path, body);
      return await watchJob(started.jobId, onProgress);
    } finally { busy = false; operation = null; buttons(); await refresh(); }
  }
  async function cancelOperation() {
    if (operation) await request('/jobs/' + operation + '/cancel', {});
  }
  function showOutput(tab) {
    get('code-panel').hidden = tab !== 'code';
    get('log-panel').hidden = tab !== 'log';
    get('code-tab').setAttribute('aria-selected', String(tab === 'code'));
    get('log-tab').setAttribute('aria-selected', String(tab === 'log'));
  }
  function menuAction(id, callback) {
    get(id).addEventListener('click', async () => {
      get('more').open = false;
      try { await callback(); }
      catch (error) { message(error.message); }
    });
  }
  async function start() {
    if (!api || !api.getWorkspaceSnapshot || !api.getWorkspaceToolbox || !api.appendWorkspaceSnapshot || !api.pasteBlockClipboard) {
      message('This extension needs a StudioX version with independent-workspace transfer APIs.'); return;
    }
    for (const asset of ['compiler', 'toolbox', 'editor', 'managers']) {
      const name = { compiler: 'StudioXArduinoCompiler', toolbox: 'StudioXArduinoToolbox', editor: 'StudioXArduinoEditor', managers: 'StudioXArduinoManagers' }[asset];
      if (window[name]) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = new URL(asset + '.js', assetBase).href;
        script.onload = resolve; script.onerror = () => reject(new Error('Could not load Arduino ' + asset + '.'));
        document.body.appendChild(script);
      });
    }
    const toolbox = window.StudioXArduinoToolbox.build(await api.getWorkspaceToolbox());
    editor = window.StudioXArduinoEditor.create(get('blockly'), {
      api, toolbox,
      scale: window.AppPreferences && AppPreferences.getBlockScale ? AppPreferences.getBlockScale() : 1,
      isActive: () => api.isActive('arduino'),
      onChange: validateSoon,
      onSelection: buttons,
      onSaved: text => { get('saved-status').textContent = text; },
    });
    get('cli-guide').addEventListener('click', () => require('electron').shell.openExternal('https://docs.arduino.cc/arduino-cli/installation/'));
    get('undo').addEventListener('click', () => editor.undo(false));
    get('redo').addEventListener('click', () => editor.undo(true));
    get('copy-blocks').addEventListener('click', () => editor.copy());
    get('paste-blocks').addEventListener('click', () => {
      try { const blocks = editor.paste(); message(blocks.length ? 'Pasted blocks into Arduino.' : 'Copy blocks first.'); }
      catch (error) { message(error.message); }
    });
    get('add-entries').addEventListener('click', () => {
      try {
        const blocks = editor.addEntryBlocks();
        message(blocks.length ? 'Added missing Setup / Loop blocks.' : 'Setup and Loop are already in the Arduino workspace.');
      } catch (error) { message(error.message); }
    });
    get('import-main').addEventListener('click', async () => {
      try {
        const source = await api.getWorkspaceSnapshot();
        const blocks = editor.append(source);
        message(blocks.length ? 'Imported a copy from Blockly. The editors remain independent.' : 'The Blockly workspace is empty.');
      } catch (error) { message(error.message); }
    });
    menuAction('save-blocks', async () => {
      const file = await require('electron').ipcRenderer.invoke('dialog:saveFile', {
        title: 'Save Arduino blocks', defaultPath: 'Arduino.arduino.json',
        filters: [{ name: 'Arduino blocks', extensions: ['json'] }],
      });
      if (!file) return;
      require('fs').writeFileSync(file, JSON.stringify({ format: 'studiox-arduino', version: 1, state: editor.exportState() }, null, 2), 'utf8');
      message('Arduino blocks saved.');
    });
    menuAction('import-file', async () => {
      const file = await require('electron').ipcRenderer.invoke('dialog:openFile', {
        title: 'Import Arduino blocks', filters: [{ name: 'Blockly blocks', extensions: ['json', 'xml', 'blockly'] }],
      });
      if (!file) return;
      const blocks = editor.importText(require('fs').readFileSync(file, 'utf8'));
      message('Imported ' + blocks.length + ' block stack(s) into Arduino.');
    });
    menuAction('clear-blocks', () => {
      if (!editor.workspace.getAllBlocks(false).length && !editor.recoveryLocked()) return;
      if (confirm(editor.recoveryLocked() ? 'Clear the preserved Arduino recovery and start over?' : 'Clear the Arduino workspace? You can undo this action.')) editor.clear();
    });
    menuAction('settings-toggle', () => { get('cli-settings').open = !get('cli-settings').open; });
    menuAction('refresh-devices', refresh);
    get('code-tab').addEventListener('click', () => showOutput('code'));
    get('log-tab').addEventListener('click', () => showOutput('log'));
    get('compile').addEventListener('click', () => perform('compile'));
    get('upload').addEventListener('click', () => perform('upload'));
    menuAction('install-core', () => perform('core'));
    const managers = window.StudioXArduinoManagers.create({ get, request, runToolJob, cancelOperation });
    menuAction('manage-boards', () => managers.openBoards());
    get('cancel').addEventListener('click', async () => {
      if (!operation) return;
      try { await request('/jobs/' + operation + '/cancel', {}); message('Cancelling operation…'); }
      catch (error) { message(error.message); }
    });
    get('save-cli').addEventListener('click', async () => {
      try { await request('/settings', { cliPath: get('cli-path').value }); compiled = null; await refresh(); }
      catch (error) { message(error.message); }
    });
    get('board').value = api.getSetting('arduino.board', 'arduino:avr:uno');
    get('board').addEventListener('change', () => {
      compiled = null; api.setSetting('arduino.board', get('board').value);
      message('Board changed. Compile again before uploading.'); buttons();
    });
    get('port').addEventListener('change', () => {
      get('manual-port-label').hidden = get('port').value !== 'manual'; buttons();
    });
    get('manual-port').addEventListener('input', buttons);
    get('copy-code').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(get('code').value); message('Arduino code copied.'); }
      catch (error) { message(error.message); }
    });
    get('toggle-highlights').addEventListener('click', () => {
      highlights = !highlights; get('toggle-highlights').textContent = highlights ? 'Hide highlights' : 'Show highlights'; analyze();
    });
    window.addEventListener('studiox-block-clipboard', buttons);
    api.onActivate('arduino', () => { requestAnimationFrame(() => { if (api.isActive('arduino')) editor.activate(); }); analyze(); refresh(); });
    api.onDeactivate('arduino', () => editor.saveRecovery());
    await analyze();
    await refresh();
  }
  start().catch(error => message(error.message));
})();
