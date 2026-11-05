// Run with StudioX's Electron: electron tests/test_frontend.cjs --studiox-root /path/to/blockly
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const repo = path.resolve(__dirname, '..');
const argument = process.argv.indexOf('--studiox-root');
const host = argument >= 0 ? path.resolve(process.argv[argument + 1]) : path.resolve(repo, '../blockly');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'studiox-arduino-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
const savedFile=path.join(temp,'Arduino.arduino.json');
ipcMain.handle('dialog:saveFile',()=>savedFile);
ipcMain.handle('dialog:openFile',()=>savedFile);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1500, height: 950,
    webPreferences: { nodeIntegration: true, contextIsolation: false } });
  const errors = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  const run = async source => {
    try { return await win.webContents.executeJavaScript(source); }
    catch (error) { throw new Error(error.message + '\nRenderer: ' + source); }
  };
  async function wait(source) {
    for (let index = 0; index < 180; index++) {
      if (await run(source)) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out: ' + source);
  }
  const url = file => pathToFileURL(file).href;
  async function bootstrap() {
    const manifest = require(path.join(repo, 'extension.json'));
    await run(`registerExtensionBlocks(${JSON.stringify(manifest)}, ${JSON.stringify(url(repo))}, ${JSON.stringify(manifest.contributes.blocks)})`);
    await run(`window.ws=Blockly.inject('blocklyDiv',{toolbox:{kind:'categoryToolbox',contents:[
      {kind:'category',name:'Logic',contents:[{kind:'block',type:'controls_if'}]},
      {kind:'category',name:'Variables',custom:'VARIABLE'},
      {kind:'category',name:'Functions',custom:'PROCEDURE'},
      {kind:'category',name:'Python',contents:[]},...extensionBlockCategories()]},sounds:false});
      Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(fs.readFileSync(path.join(repo,'examples/Blink.xml'),'utf8'))}),ws);
      window.showTab=which=>{
        document.getElementById('blockly-view').classList.toggle('active',which==='blockly');
        document.getElementById('arduino-view').classList.toggle('active',which==='arduino');
        if(which==='arduino') ExtensionAPI._fireLifecycle('arduino','activate');
        else { ws.markFocused(); ExtensionAPI._fireLifecycle('arduino','deactivate'); }
      };
      document.getElementById('main-tab').onclick=()=>showTab('blockly');
      document.getElementById('arduino-tab').onclick=()=>showTab('arduino');
      initBlockSelection();showTab('arduino');
      window.calls=[];window.jobs={};window.jobCounter=0;window.holdCompile=false;window.cliAvailable=true;
      ExtensionAPI.fetch=async(name,endpoint,options)=>{
        const body=options&&options.body?JSON.parse(options.body):null;calls.push({endpoint,body});
        if(endpoint==='/status')return {success:true,available:cliAvailable,cliPath:'/test/arduino-cli',version:{VersionString:'test'},error:'Install Arduino CLI'};
        if(endpoint==='/boards/sources')return {success:true,urls:[]};
        if(endpoint==='/boards/search')return {success:true,total:1,platforms:[{id:'arduino:mbed_rp2040',name:'Pico boards',version:'4.3.1',installedVersion:'',boards:['Raspberry Pi Pico']}]};
        if(endpoint==='/boards')return {success:true,boards:[{name:'Uno',fqbn:'arduino:avr:uno'},{name:'Mega',fqbn:'arduino:avr:mega:cpu=atmega2560'}]};
        if(endpoint==='/ports')return {success:true,ports:[{address:'COM9',label:'Test Arduino'}]};
        if(endpoint==='/compile'||endpoint==='/upload'||endpoint==='/core/install'||endpoint==='/boards/install'||endpoint==='/boards/refresh'){
          const id='job'+(++jobCounter);jobs[id]={id,success:true,ok:true,done:endpoint!=='/compile'||!holdCompile,log:['ok']};
          return {success:true,jobId:id};
        }
        if(endpoint.startsWith('/jobs/'))return jobs[endpoint.split('/')[2]];
        return {success:true};
      };
      window.focusBlock=block=>{block.workspace.markFocused();Blockly.getFocusManager().focusNode(block);block.select();};
      window.confirm=()=>true;
      window.beforeMain=JSON.stringify(Blockly.serialization.workspaces.save(ws));
      var script=document.createElement('script');script.src=${JSON.stringify(url(path.join(repo,'frontend/tab.js')))};document.body.appendChild(script);void 0;`);
    await wait("document.getElementById('arduino-blockly').dataset.workspaceId");
    await run("window.az=Blockly.Workspace.getById(document.getElementById('arduino-blockly').dataset.workspaceId);void 0");
    await wait("document.getElementById('arduino-tooling-status').textContent.includes('ready')");
  }
  try {
    const html = path.join(temp, 'index.html');
    fs.writeFileSync(html, `<!doctype html><html data-theme="light"><head><meta charset="UTF-8">
      <link rel="stylesheet" href="${url(path.join(host, 'css/styles.css'))}">
      <link rel="stylesheet" href="${url(path.join(repo, 'frontend/tab.css'))}">
      <style>body{overflow:hidden;display:flex;flex-direction:column}#fixture-tabs{display:flex;height:36px;flex-shrink:0}#blockly-view,#arduino-view{flex:1;min-height:0}#blocklyDiv{height:800px;width:1400px;position:relative}.app-view{display:none}.app-view.active{display:flex}</style>
      </head><body><div id="fixture-tabs"><button id="main-tab" class="sidebar-tab" data-tab="blockly">Blockly</button><button id="arduino-tab">Arduino</button></div>
      <div id="blockly-view" class="app-view active"><div id="blocklyDiv"></div></div>
      <div id="arduino-view" class="app-view">${fs.readFileSync(path.join(repo,'frontend/tab.html'),'utf8')}</div>
      <script src="${url(path.join(host,'node_modules/blockly/blockly_compressed.js'))}"></script>
      <script src="${url(path.join(host,'node_modules/blockly/blocks_compressed.js'))}"></script>
      <script src="${url(path.join(host,'node_modules/blockly/python_compressed.js'))}"></script>
      <script src="${url(path.join(host,'node_modules/blockly/msg/en.js'))}"></script>
      <script src="${url(path.join(host,'js/extensions/extensionAPI.js'))}"></script>
      <script>window.getWorkspace=()=>window.ws;</script>
      <script src="${url(path.join(host,'js/extensions/workspaceBridge.js'))}"></script>
      <script src="${url(path.join(host,'js/extensions/workspaceTransfer.js'))}"></script>
      <script src="${url(path.join(host,'js/extensions/extensionBlocks.js'))}"></script>
      <script src="${url(path.join(host,'js/workspace/blockSelection.js'))}"></script>
      </body></html>`);
    await win.loadFile(html);await bootstrap();
    assert.strictEqual(await run('az===ws'),false);
    assert.strictEqual(await run('az.getAllBlocks(false).length'),0,'Arduino starts empty instead of mirroring main');
    assert.strictEqual(await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))===beforeMain'),true);
    assert.strictEqual(await run("az.getToolbox().getToolboxItems().length"),5);
    await run("document.getElementById('arduino-import-main').click()");
    await wait("!document.getElementById('arduino-compile').disabled");
    assert.strictEqual(await run('az.getTopBlocks(false).length'),2);
    assert.strictEqual(await run('getWorkspace()===ws'),true,'global primary editor must stay unchanged');
    assert.strictEqual(await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))===beforeMain'),true);
    await run("window.delay=az.getBlocksByType('arduino_delay',false)[0].getInputTargetBlock('MS');document.getElementById('arduino-compile').click()");
    await wait("document.getElementById('arduino-build-status').textContent.includes('Compiled successfully')");
    await run("document.getElementById('arduino-port').value='COM9';document.getElementById('arduino-port').dispatchEvent(new Event('change'))");
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),false);
    await run("ws.getBlockById('blink_ms').setFieldValue(999,'NUM')");
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.strictEqual(await run("delay.getFieldValue('NUM')"),500);
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),false,'main edits do not invalidate an Arduino build');
    await run("document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.'");
    assert.deepStrictEqual(await run("calls.find(item=>item.endpoint==='/upload').body"),{compileId:'job1',port:'COM9'});
    await run("delay.setFieldValue(600,'NUM')");
    await wait("document.getElementById('arduino-upload').disabled");
    assert.strictEqual(await run("ws.getBlockById('blink_ms').getFieldValue('NUM')"),999);
    await run("holdCompile=true;document.getElementById('arduino-compile').click()");
    await wait('jobCounter===3');
    await run("delay.setFieldValue(700,'NUM');jobs.job3.done=true");
    await wait("document.getElementById('arduino-build-status').textContent.includes('older workspace')");
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),true);
    await run("holdCompile=false;document.getElementById('arduino-import-main').click()");
    await wait('az.getTopBlocks(false).length===4');
    await run("document.getElementById('arduino-undo').click()");
    await wait('az.getTopBlocks(false).length===2');
    assert.strictEqual(await run("ws.getTopBlocks(false).length"),2);
    await run("document.getElementById('arduino-redo').click()");
    await wait('az.getTopBlocks(false).length===4');
    await run("document.getElementById('arduino-undo').click()");
    await wait('az.getTopBlocks(false).length===2');
    await wait("!document.getElementById('arduino-compile').disabled");
    // Main custom selection clipboard -> Arduino, with no live linking.
    await run("showTab('blockly');focusBlock(ws.getBlockById('blink_delay_high'));window.copyDebug={selected:Blockly.getSelected()&&Blockly.getSelected().type,selectedWs:Blockly.getSelected()&&Blockly.getSelected().workspace.id,ws:ws.id,deletable:ws.getBlockById('blink_delay_high').isDeletable()};copyWorkspaceBlocks();showTab('arduino');document.getElementById('arduino-paste-blocks').click()");
    await wait('az.getTopBlocks(false).length===3');
    assert.strictEqual(await run("az.getTopBlocks(false).some(block=>block.type==='arduino_delay'&&block.getInputTargetBlock('MS').getFieldValue('NUM')===999)"),true);
    await run("document.getElementById('arduino-undo').click()");await wait('az.getTopBlocks(false).length===2');
    // Arduino copy -> main paste is an explicit transfer and remains independent.
    await run("focusBlock(az.getBlocksByType('arduino_delay',false)[0]);document.getElementById('arduino-copy-blocks').click();showTab('blockly');pasteWorkspaceBlocks()");
    await wait('ws.getTopBlocks(false).length===3');
    assert.strictEqual(await run('az.getTopBlocks(false).length'),2);
    await run("showTab('arduino');Blockly.defineBlocksWithJsonArray([{type:'raw_python_test',message0:'Python import',previousStatement:null,nextStatement:null,colour:200}]);window.unsupported=az.newBlock('raw_python_test');unsupported.initSvg();unsupported.render();unsupported.moveBy(500,40);void 0");
    await wait("document.getElementById('arduino-problems').children.length>0");
    assert.strictEqual(await run("document.getElementById('arduino-compile').disabled"),true);
    assert.strictEqual(await run("unsupported.isEnabled()&&unsupported.getSvgRoot().classList.contains('arduino-unsupported')"),true);
    assert.strictEqual(await run("ws.getAllBlocks(false).some(block=>block.getSvgRoot().classList.contains('arduino-unsupported'))"),false);
    const mainState=await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))');
    await run("document.querySelector('#arduino-problems button').click()");
    assert.strictEqual(await run("document.getElementById('arduino-view').classList.contains('active')"),true,'diagnostic navigation stays in Arduino');
    // The main document key handler must not delete its selection in Arduino.
    await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))");
    assert.strictEqual(await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))'),mainState);
    await run("unsupported.setDisabledReason(true,'MANUALLY_DISABLED')");
    await wait("!document.getElementById('arduino-compile').disabled");
    await run("unsupported.setDisabledReason(false,'MANUALLY_DISABLED')");await wait("document.getElementById('arduino-compile').disabled");
    await run("document.getElementById('arduino-toggle-highlights').click()");
    await wait("!unsupported.getSvgRoot().classList.contains('arduino-unsupported')");
    assert.strictEqual(await run("document.getElementById('arduino-compile').disabled"),true);
    await run('unsupported.dispose()');await wait("!document.getElementById('arduino-compile').disabled");
    await run("document.getElementById('arduino-manage-boards').click()");
    await wait("document.querySelector('#arduino-board-results button[data-platform]') !== null");
    assert.strictEqual(await run("document.getElementById('arduino-board-manager').open"),true);
    assert.match(await run("document.getElementById('arduino-board-results').textContent"),/Raspberry Pi Pico.*Install/s);
    await run("document.querySelector('#arduino-board-results button').click()");
    await wait("document.getElementById('arduino-board-manager-status').textContent.includes('Board support installed')");
    assert.deepStrictEqual(await run("calls.find(item=>item.endpoint==='/boards/install').body"),{platform:'arduino:mbed_rp2040',version:'4.3.1'});
    await run("document.getElementById('arduino-board-pico-source').click()");
    assert.match(await run("document.getElementById('arduino-board-sources').value"),/package_rp2040_index.json/);
    await run("document.getElementById('arduino-board-manager-close').click()");
    await run("document.getElementById('arduino-save-blocks').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Arduino blocks saved.'");
    assert.strictEqual(JSON.parse(fs.readFileSync(savedFile,'utf8')).format,'studiox-arduino');
    await run("document.getElementById('arduino-import-file').click()");await wait('az.getTopBlocks(false).length===4');
    await run("document.getElementById('arduino-undo').click()");await wait('az.getTopBlocks(false).length===2');
    await run("document.getElementById('arduino-board').value='arduino:avr:mega:cpu=atmega2560';document.getElementById('arduino-board').dispatchEvent(new Event('change'))");
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),true);
    await run("delay.setFieldValue(707,'NUM');showTab('blockly')");
    await new Promise(resolve=>setTimeout(resolve,300));
    await win.reload();await wait('typeof registerExtensionBlocks===\'function\'');await bootstrap();
    await wait('az.getAllBlocks(false).length>0');
    assert.strictEqual(await run("az.getBlocksByType('arduino_delay',false)[0].getInputTargetBlock('MS').getFieldValue('NUM')"),707,'Arduino recovery is independent of main');
    assert.strictEqual(await run("ws.getBlockById('blink_ms').getFieldValue('NUM')"),500);
    await run("document.documentElement.dataset.theme='dark';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await win.webContents.capturePage().then(image=>fs.writeFileSync('/private/tmp/studiox-arduino-independent.png',image.toPNG()));
    assert.deepStrictEqual(errors,[]);
    console.log('Independent Arduino workspace passed: empty start, detached import, no live sync, shared clipboard both ways, local undo/redo, local diagnostics, main shortcut isolation, file import/export, recovery, and stale-build checks.');
  } catch(error) { console.error(error);
    try { console.error(await run(`JSON.stringify({copyDebug:window.copyDebug,message:document.getElementById('arduino-build-status').textContent, main:ws.getTopBlocks(false).map(b=>b.type), arduino:az.getTopBlocks(false).map(b=>b.type), clipboard:ExtensionAPI.getBlockClipboard(), pasteDisabled:document.getElementById('arduino-paste-blocks').disabled,redoDisabled:document.getElementById('arduino-redo').disabled,undo:az.getUndoStack().map(e=>e.type),redo:az.getRedoStack().map(e=>e.type)})`)); } catch(_) {}
    process.exitCode=1; }
  finally { win.destroy();fs.rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0); }
});
