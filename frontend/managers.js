/* Board and library installation dialogs; device operations use the shared job lock. */
(function (root) {
  function create({ get, request, runToolJob, cancelOperation }) {
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
    return { openBoards: async () => {
      if (!dialog.open) dialog.showModal();
      try { const sources = await request('/boards/sources'); get('board-sources').value = sources.urls.join('\n'); }
      catch (error) { status(error.message); return; }
      await search(); get('board-query').focus();
    } };
  }
  root.StudioXArduinoManagers = { create };
})(typeof window !== 'undefined' ? window : globalThis);
