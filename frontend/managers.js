/* Board and library installation dialogs; device operations use the shared job lock. */
(function (root) {
  function create({ get, request, runToolJob, cancelOperation, addIncludes }) {
    const dialog = get('board-manager');
    const status = text => { get('board-manager-status').textContent = text; };
    let searching = 0, working = false;
    const element = (tag, text, className) => {
      const node = document.createElement(tag); node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    function lock(value) {
      working = value;
      dialog.querySelectorAll('button, input, textarea').forEach(node => {
        if (node.id !== 'arduino-board-manager-close' && node.id !== 'arduino-board-manager-cancel') node.disabled = value;
      });
      get('board-manager-cancel').hidden = !value;
    }
    async function search() {
      const token = ++searching;
      status('Searching board packages…');
      try {
        const response = await request('/boards/search', { query: get('board-query').value });
        if (token !== searching) return;
        get('board-results').replaceChildren();
        response.platforms.forEach(platform => {
          const card = element('div', '', 'arduino-manager-card');
          card.appendChild(element('h4', platform.name));
          card.appendChild(element('p', platform.id + ' · ' + platform.version + (platform.installedVersion ? ' · Installed: ' + platform.installedVersion : ' · Not installed') + (platform.deprecated ? ' · Deprecated' : '')));
          card.appendChild(element('p', platform.boards.slice(0, 12).join(', ') + (platform.boards.length > 12 ? '…' : '')));
          const install = element('button', platform.installedVersion === platform.version ? 'Reinstall' : platform.installedVersion ? 'Update' : 'Install', 'arduino-button');
          install.type = 'button'; install.dataset.platform = platform.id;
          install.disabled = working;
          install.addEventListener('click', () => perform('/boards/install', { platform: platform.id, version: platform.version }, 'Board support installed. Select your board in the toolbar.'));
          card.appendChild(install); get('board-results').appendChild(card);
        });
        status(response.platforms.length ? (response.total > response.platforms.length ? 'Showing the first 200 packages. Refine your search.' : response.platforms.length + ' board package(s).') : 'No packages found. Refresh the index or add a manufacturer package URL.');
      } catch (error) { if (token === searching) status(error.message + ' Try Refresh index.'); }
    }
    async function perform(path, body, success) {
      if (working) return;
      lock(true); status('Working…'); get('board-manager-log').hidden = false;
      try {
        await runToolJob(path, body, job => { get('board-manager-log').textContent = job.log.join('\n'); });
        await search(); status(success);
      } catch (error) { status(error.message); }
      finally { lock(false); }
    }
    get('board-manager-close').addEventListener('click', () => dialog.close());
    get('board-search-form').addEventListener('submit', event => { event.preventDefault(); if (!working) search(); });
    get('board-refresh').addEventListener('click', () => perform('/boards/refresh', {}, 'Board index refreshed.'));
    get('board-manager-cancel').addEventListener('click', () => cancelOperation().catch(error => status(error.message)));
    get('board-save-sources').addEventListener('click', async () => {
      try {
        await request('/boards/sources', { urls: get('board-sources').value.split('\n').map(line => line.trim()).filter(Boolean) });
        await perform('/boards/refresh', {}, 'Board sources saved and index refreshed.');
      } catch (error) { status(error.message); }
    });
    get('board-pico-source').addEventListener('click', () => {
      const url = 'https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json';
      const urls = get('board-sources').value.split('\n').filter(Boolean);
      if (!urls.includes(url)) urls.push(url);
      get('board-sources').value = urls.join('\n'); status('Click Save and refresh to enable the Arduino-Pico catalog.');
    });
    const libraryUI = createLibraryManager({ get, request, runToolJob, cancelOperation, addIncludes, element });
    return { openLibraries: libraryUI.open, openBoards: async () => {
      if (!dialog.open) dialog.showModal();
      try { const sources = await request('/boards/sources'); get('board-sources').value = sources.urls.join('\n'); }
      catch (error) { status(error.message); return; }
      await search(); get('board-query').focus();
    } };
  }
  function createLibraryManager({ get, request, runToolJob, cancelOperation, addIncludes, element }) {
    const dialog = get('library-manager');
    const status = text => { get('library-manager-status').textContent = text; };
    let working = false, token = 0, installedOnly = true;
    function lock(value) {
      working = value;
      dialog.querySelectorAll('button, input, select').forEach(node => {
        if (node.id !== 'arduino-library-manager-close' && node.id !== 'arduino-library-manager-cancel') node.disabled = value;
      });
      get('library-manager-cancel').hidden = !value;
    }
    function include(headers) {
      try { addIncludes(headers); dialog.close(); }
      catch (error) { status(error.message); }
    }
    async function list(local = installedOnly) {
      installedOnly = local;
      const current = ++token;
      status(local ? 'Loading installed libraries…' : 'Searching libraries…');
      try {
        const response = local ? await request('/libraries') : await request('/libraries/search', { query: get('library-query').value });
        if (current !== token) return;
        get('library-results').replaceChildren();
        response.libraries.forEach(library => {
          const card = element('div', '', 'arduino-manager-card');
          card.appendChild(element('h4', library.name));
          card.appendChild(element('p', library.description || ''));
          card.appendChild(element('p', library.installedVersion ? 'Installed: ' + library.installedVersion : 'Not installed'));
          card.appendChild(element('p', 'Architectures: ' + library.architectures.join(', ')));
          const controls = element('div', '', 'arduino-manager-search');
          const versions = document.createElement('select'); versions.setAttribute('aria-label', library.name + ' version');
          [...new Set([library.version, ...(library.versions || []).slice().reverse()])].filter(Boolean).forEach(version => {
            const option = element('option', version); option.value = version; versions.appendChild(option);
          });
          controls.appendChild(versions);
          const install = element('button', library.installedVersion ? 'Install selected version' : 'Install', 'arduino-button');
          install.type = 'button'; install.dataset.library = library.name;
          install.addEventListener('click', () => perform('/libraries/install', { name: library.name, version: versions.value }, 'Library installed. Add its include header to use it in this workspace.'));
          controls.appendChild(install);
          if (library.headers && library.headers.length) {
            const add = element('button', 'Add include', 'arduino-button'); add.type = 'button';
            add.dataset.headers = library.headers.join(', '); add.title = library.headers.join(', ');
            add.addEventListener('click', () => include(library.headers)); controls.appendChild(add);
          }
          card.appendChild(controls); get('library-results').appendChild(card);
        });
        status(local ? (response.libraries.length ? 'Installed libraries. Search to discover more.' : 'No user libraries installed. Search to discover libraries, or enter a built-in header above.') :
          response.libraries.length ? (response.total > response.libraries.length ? 'Showing the first 100 libraries. Refine your search.' : response.libraries.length + ' library result(s).') : 'No libraries found. Try another name or refresh the index.');
      } catch (error) { if (current === token) status(error.message); }
    }
    async function perform(path, body, success) {
      if (working) return;
      lock(true); status('Working…'); get('library-manager-log').hidden = false;
      try {
        await runToolJob(path, body, job => { get('library-manager-log').textContent = job.log.join('\n'); });
        await list(); status(success);
      } catch (error) { status(error.message); }
      finally { lock(false); }
    }
    get('library-manager-close').addEventListener('click', () => dialog.close());
    get('library-search-form').addEventListener('submit', event => { event.preventDefault(); if (!working) list(false); });
    get('library-installed').addEventListener('click', () => { if (!working) list(true); });
    get('library-refresh').addEventListener('click', () => perform('/libraries/refresh', {}, 'Library index refreshed.'));
    get('library-manager-cancel').addEventListener('click', () => cancelOperation().catch(error => status(error.message)));
    get('library-include-form').addEventListener('submit', event => {
      event.preventDefault();
      const header = get('library-header').value.trim();
      if (!working && header) include([header]);
    });
    return { open: async () => { if (!dialog.open) dialog.showModal(); await list(true); get('library-query').focus(); } };
  }
  root.StudioXArduinoManagers = { create };
})(typeof window !== 'undefined' ? window : globalThis);
