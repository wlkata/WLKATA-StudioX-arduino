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
let folderSelection=null,zipSelection=null;const pickerCalls=[];
ipcMain.handle('dialog:openFile',(_event,options={})=>{pickerCalls.push(['file',options]);return options.title==='Select Arduino library ZIP'?zipSelection:savedFile;});
ipcMain.handle('dialog:openFolder',(_event,options={})=>{pickerCalls.push(['folder',options]);return folderSelection;});
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
    await run(`window.findEnclosingProcedure=()=>null;window.getAllLocalScopeNames=()=>new Set();
      initSetupRobotBlock();initMoveRobotBlocks();initRobotCommandBlocks();
      window.ws=Blockly.inject('blocklyDiv',{toolbox:{kind:'categoryToolbox',contents:[
      {kind:'category',name:'Logic',contents:[{kind:'block',type:'controls_if'}]},
      {kind:'category',name:'Variables',custom:'VARIABLE'},
      {kind:'category',name:'Functions',custom:'PROCEDURE'},
      {kind:'category',name:'Robot',contents:['setup_robot','robot_homing','robot_zero','robot_speed','write_coordinate','write_angle','robot_wait_idle','robot_send_msg','robot_delay'].map(type=>({kind:'block',type}))},
      {kind:'category',name:'Accessories',contents:['robot_pump','robot_gripper','robot_three_finger','robot_conveyor'].map(type=>({kind:'block',type}))},
      {kind:'category',name:'Python',contents:[]},{kind:'category',name:'Workflows',contents:[]},...extensionBlockCategories()]},sounds:false});
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
      window.calls=[];window.jobs={};window.jobCounter=0;window.holdCompile=false;window.cliAvailable=true;window.libraryInstalled=false;window.failCompile=false;
      window.serialState={connected:false,port:'',baudrate:9600,error:''};window.serialChunks=[];window.serialCursor=0;window.serialFloor=0;window.holdSerialRead=false;
      window.emitSerial=text=>serialChunks.push({cursor:++serialCursor,text});
      window.serialSnapshot=cursor=>({...serialState,cursor:serialCursor,success:true,reset:cursor<serialFloor||cursor>serialCursor,text:serialChunks.filter(chunk=>chunk.cursor>(cursor<serialFloor?serialFloor:cursor)).map(chunk=>chunk.text).join('')});
      ExtensionAPI.fetch=async(name,endpoint,options)=>{
        const body=options&&options.body?JSON.parse(options.body):null;calls.push({endpoint,body});
        if(endpoint==='/serial/read'){
          const frame=serialSnapshot(body.cursor);
          if(holdSerialRead){holdSerialRead=false;return new Promise(resolve=>window.releaseSerialRead=()=>resolve(frame));}
          return frame;
        }
        if(endpoint==='/serial/connect'){
          if(body.port!==serialState.port){serialChunks=[];serialFloor=++serialCursor;}
          serialState={connected:true,port:body.port,baudrate:body.baudrate,error:''};return serialSnapshot(0);
        }
        if(endpoint==='/serial/disconnect'){serialState.connected=false;return serialSnapshot(0);}
        if(endpoint==='/serial/clear'){serialChunks=[];serialFloor=++serialCursor;return serialSnapshot(0);}
        if(endpoint==='/status')return {success:true,available:cliAvailable,cliPath:'/test/arduino-cli',version:{VersionString:'test'},error:'Install Arduino CLI'};
        if(endpoint==='/libraries')return {success:true,libraries:libraryInstalled?[{name:'Servo',version:'1.3.0',installedVersion:'1.3.0',headers:['Servo.h'],architectures:['avr'],versions:['1.3.0']}]:[]};
        if(endpoint==='/libraries/search')return {success:true,total:1,libraries:[{name:'Servo',version:'1.3.0',installedVersion:libraryInstalled?'1.3.0':'',description:'Servo control',headers:libraryInstalled?['Servo.h']:[],architectures:['avr'],versions:['1.2.2','1.3.0']}]};
        if(endpoint==='/libraries/catalog')return {success:true,libraries:libraryInstalled?[{name:'Servo',version:'1.3.0',headers:[{name:'Servo.h',functions:[{id:'servo',header:'Servo.h',library:'Servo',name:'Servo',owner:'Servo',qualifiedName:'Servo',constructor:true,parameters:[],supported:true,returnKind:'void'},{id:'write',header:'Servo.h',library:'Servo',name:'write',owner:'Servo',qualifiedName:'Servo::write',constructor:false,parameters:[{name:'angle',type:'int',kind:'number'}],supported:true,returnKind:'void'}],constants:[]}]}]:[],warnings:[]};
        if(endpoint==='/boards/sources')return {success:true,urls:[]};
        if(endpoint==='/boards/search')return {success:true,total:1,platforms:[{id:'arduino:mbed_rp2040',name:'Pico boards',version:'4.3.1',installedVersion:'',boards:['Raspberry Pi Pico']}]};
        if(endpoint==='/boards')return {success:true,boards:[{name:'Uno',fqbn:'arduino:avr:uno'},{name:'Mega',fqbn:'arduino:avr:mega:cpu=atmega2560'}]};
        if(endpoint==='/ports')return {success:true,ports:[{address:'COM9',label:'Test Arduino'}]};
        if(endpoint==='/compile'||endpoint==='/upload'||endpoint==='/core/install'||endpoint==='/boards/install'||endpoint==='/boards/refresh'||endpoint==='/libraries/install'||endpoint==='/libraries/refresh'||endpoint==='/libraries/install-local'){
          if(endpoint==='/upload'&&serialState.connected&&serialState.port===body.port)throw Error('Serial port still owned by monitor');
          if(endpoint==='/libraries/install'||endpoint==='/libraries/install-local')libraryInstalled=true;const id='job'+(++jobCounter);jobs[id]={id,success:true,ok:true,done:endpoint!=='/compile'||!holdCompile,log:['ok']};
          if(endpoint==='/compile'&&failCompile){jobs[id].ok=false;jobs[id].done=true;jobs[id].error='Compiler failed';}
          return {success:true,jobId:id};
        }
        if(endpoint.endsWith('/cancel')){const job=jobs[endpoint.split('/')[2]];job.done=true;job.ok=false;job.error='Operation cancelled.';return {success:true};}
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
      <script src="${url(path.join(host,'js/blocks/setupRobot.js'))}"></script>
      <script src="${url(path.join(host,'js/blocks/moveRobot.js'))}"></script>
      <script src="${url(path.join(host,'js/workspace/blockSelection.js'))}"></script>
      </body></html>`);
    await win.loadFile(html);await bootstrap();
    assert.strictEqual(await run('az===ws'),false);
    assert.strictEqual(await run("ws.getToolbox().getToolboxItems().some(item=>item.getName&&item.getName()==='Arduino')"),false,'Arduino stays out of Python toolbox');
    assert.strictEqual(await run('az.getAllBlocks(false).length'),2,'Arduino starts with Setup and Loop');
    assert.strictEqual(await run('az.getTopBlocks(false).every(b=>!b.isDeletable()&&!b.isDuplicatable())'),true);
    assert.strictEqual(await run("document.getElementById('arduino-add-entries')===null"),true);
    await wait("!document.getElementById('arduino-compile').disabled");
    assert.match(await run("document.getElementById('arduino-code').value"),/void setup\(\).*void loop\(/s);
    assert.strictEqual(await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))===beforeMain'),true);
    assert.deepStrictEqual(await run("az.getToolbox().getToolboxItems().filter(item=>!item.getParent()).map(item=>item.getName ? item.getName() : 'separator')"),['Logic','Variables','Functions','Robot','Accessories','separator','I/O','Timing','Serial','Libraries / C++']);
    assert.strictEqual(await run("document.querySelector('#arduino-blockly .blocklyTreeSeparator')!==null"),true);
    await run("az.getToolbox().setSelectedItem(az.getToolbox().getToolboxItems().find(item=>item.getName&&item.getName()==='I/O'))");
    await wait("az.getFlyout().getWorkspace().getTopBlocks(true).length===11");
    assert.deepStrictEqual(await run("az.getFlyout().getWorkspace().getTopBlocks(true).map(block=>block.type)"),['arduino_high_low','arduino_digital_write_value','arduino_digital_write','arduino_digital_read','arduino_analog_write','arduino_analog_read','arduino_pin_mode','arduino_pin','arduino_builtin_led','arduino_tone','arduino_no_tone']);
    assert.strictEqual(await run("az.getToolbox().getToolboxItems().some(item=>item.getName&&item.getName()==='Python')"),false);
    assert.strictEqual(await run("ws.getToolbox().getToolboxItems().some(item=>item.getName&&item.getName()==='Python')"),true);
    await run("document.getElementById('arduino-import-main').click()");
    await wait("!document.getElementById('arduino-compile').disabled");
    assert.strictEqual(await run('az.getTopBlocks(false).length'),2);
    assert.strictEqual(await run('getWorkspace()===ws'),true,'global primary editor must stay unchanged');
    assert.strictEqual(await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))===beforeMain'),true);
    const compileCount=()=>run("calls.filter(item=>item.endpoint==='/compile').length");
    const uploadCount=()=>run("calls.filter(item=>item.endpoint==='/upload').length");
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),true,'a serial port is required');
    await run("window.delay=az.getBlocksByType('arduino_delay',false)[0].getInputTargetBlock('MS');document.getElementById('arduino-port').value='COM9';document.getElementById('arduino-port').dispatchEvent(new Event('change'))");
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),false,'Upload works before any compile');
    await run("document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.'");
    assert.strictEqual(await compileCount(),1);
    assert.strictEqual(await uploadCount(),1);
    assert.deepStrictEqual(await run("calls.find(item=>item.endpoint==='/upload').body"),{compileId:'job1',port:'COM9'});
    assert.deepStrictEqual(await run("calls.filter(item=>['/compile','/upload'].includes(item.endpoint)).map(item=>item.endpoint)"),['/compile','/upload']);
    await run("ws.getBlockById('blink_ms').setFieldValue(999,'NUM')");
    assert.strictEqual(await run("delay.getFieldValue('NUM')"),500);
    await run("document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.'");
    assert.strictEqual(await compileCount(),1,'unchanged program and main-workspace edits reuse the build');
    assert.strictEqual(await uploadCount(),2);
    await run("az.getBlocksByType('arduino_loop',false)[0].moveBy(20,40)");
    await run("document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.'");
    assert.strictEqual(await compileCount(),1,'layout edits reuse the build');
    await run("document.getElementById('arduino-port').value='manual';document.getElementById('arduino-port').dispatchEvent(new Event('change'));document.getElementById('arduino-manual-port').value='/dev/ttyTest';document.getElementById('arduino-manual-port').dispatchEvent(new Event('input'));document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.'");
    assert.strictEqual(await compileCount(),1,'changing only the destination port reuses the build');
    assert.strictEqual(await run("calls.filter(item=>item.endpoint==='/upload').at(-1).body.port"),'/dev/ttyTest');
    await run("document.getElementById('arduino-port').value='COM9';document.getElementById('arduino-port').dispatchEvent(new Event('change'));delay.setFieldValue(600,'NUM');document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.'");
    assert.strictEqual(await compileCount(),2,'a code edit automatically compiles before upload');
    assert.match(await run("calls.filter(item=>item.endpoint==='/compile').at(-1).body.code"),/delay\(.*600/);
    assert.strictEqual(await run("ws.getBlockById('blink_ms').getFieldValue('NUM')"),999);
    const beforeStale=await uploadCount();
    await run("holdCompile=true;delay.setFieldValue(650,'NUM');document.getElementById('arduino-upload').click()");
    await wait("calls.filter(item=>item.endpoint==='/compile').length===3");
    await run("window.pendingCompile='job'+jobCounter;delay.setFieldValue(700,'NUM');jobs[pendingCompile].done=true");
    await wait("document.getElementById('arduino-build-status').textContent.includes('older workspace')");
    assert.strictEqual(await uploadCount(),beforeStale,'edits during automatic compilation must stop upload');
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),false);
    await run("holdCompile=false;failCompile=true;delay.setFieldValue(710,'NUM');document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Compiler failed'");
    assert.strictEqual(await uploadCount(),beforeStale,'compile failure must not upload');
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),false,'terminal failure releases the job lock');
    await run("failCompile=false;holdCompile=true;delay.setFieldValue(720,'NUM');document.getElementById('arduino-upload').click()");
    await wait("!document.getElementById('arduino-cancel').disabled");
    await run("document.getElementById('arduino-cancel').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Operation cancelled.'");
    assert.strictEqual(await uploadCount(),beforeStale,'cancelled compilation must not upload');
    await run("holdCompile=false;delay.setFieldValue(700,'NUM');document.getElementById('arduino-compile').click()");
    await wait("document.getElementById('arduino-build-status').textContent.includes('Compiled successfully')");
    const importedCount=await run('az.getAllBlocks(false).length');
    await run("holdCompile=false;document.getElementById('arduino-import-main').click()");
    await wait('az.getAllBlocks(false).length>'+importedCount);assert.strictEqual(await run('az.getTopBlocks(false).length'),2);
    await run("document.getElementById('arduino-undo').click()");
    await wait('az.getAllBlocks(false).length==='+importedCount);
    assert.strictEqual(await run("ws.getTopBlocks(false).length"),2);
    await run("document.getElementById('arduino-redo').click()");
    await wait('az.getAllBlocks(false).length>'+importedCount);assert.strictEqual(await run('az.getTopBlocks(false).length'),2);
    await run("document.getElementById('arduino-undo').click()");
    await wait('az.getAllBlocks(false).length==='+importedCount);
    await wait("!document.getElementById('arduino-compile').disabled");
    // Main custom selection clipboard -> Arduino, with no live linking.
    await run("showTab('blockly');focusBlock(ws.getBlockById('blink_delay_high'));window.copyDebug={selected:Blockly.getSelected()&&Blockly.getSelected().type,selectedWs:Blockly.getSelected()&&Blockly.getSelected().workspace.id,ws:ws.id,deletable:ws.getBlockById('blink_delay_high').isDeletable()};copyWorkspaceBlocks();showTab('arduino');document.getElementById('arduino-paste-blocks').click()");
    await wait('az.getAllBlocks(false).length>'+importedCount);assert.strictEqual(await run('az.getTopBlocks(false).length'),2);
    assert.strictEqual(await run("az.getBlocksByType('arduino_delay',false).some(block=>block.type==='arduino_delay'&&block.getInputTargetBlock('MS').getFieldValue('NUM')===999)"),true);
    await run("document.getElementById('arduino-undo').click()");await wait('az.getAllBlocks(false).length==='+importedCount);
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
    await run("document.getElementById('arduino-compile').click()");
    await wait("document.getElementById('arduino-build-status').textContent.includes('Compiled successfully')");
    await run("document.getElementById('arduino-manage-libraries').click()");
    await wait("document.getElementById('arduino-library-manager-status').textContent.includes('No user libraries')");
    await run("document.getElementById('arduino-library-refresh').click()");
    await wait("document.getElementById('arduino-library-manager-status').textContent.includes('Library index refreshed')");
    assert.match(await run("document.getElementById('arduino-upload').title"),/existing build/,'refreshing metadata preserves the build');
    await run("document.getElementById('arduino-library-query').value='Servo';document.getElementById('arduino-library-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
    await wait("document.querySelector('#arduino-library-results button[data-library]') !== null");
    await run("document.querySelector('#arduino-library-results button[data-library]').click()");
    await wait("document.getElementById('arduino-library-manager-status').textContent.includes('Library installed')");
    assert.deepStrictEqual(await run("calls.find(item=>item.endpoint==='/libraries/install').body"),{name:'Servo',version:'1.3.0'});
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),false);
    assert.match(await run("document.getElementById('arduino-upload').title"),/Compile this program/,'package changes require compilation on the next upload');
    await wait("az.getToolbox().getToolboxItems().some(item=>item.getName&&item.getName()==='Servo.h')");
    assert.deepStrictEqual(await run("(()=>{let item=az.getToolbox().getToolboxItems().find(item=>item.getName&&item.getName()==='Servo.h');const names=[];while(item){names.unshift(item.getName());item=item.getParent();}return names;})()"),['Libraries / C++','Servo','Servo.h']);
    await run("(()=>{const item=az.getToolbox().getToolboxItems().find(item=>item.getName&&item.getName()==='Servo.h');for(let parent=item.getParent();parent;parent=parent.getParent())parent.setExpanded(true);az.getToolbox().setSelectedItem(item);})();void 0");
    await wait("az.getFlyout().getWorkspace().getBlocksByType('arduino_class',false).length===1");
    assert.strictEqual(await run("az.getFlyout().getWorkspace().getBlocksByType('arduino_class',false)[0].getField('FUNC_NAME').getOptions(false).length"),1);
    const beforeLibraryBlocks=await run('az.getAllBlocks(false).length');
    await run(`Blockly.Events.setGroup(true);
      const template=Blockly.serialization.blocks.save(az.getFlyout().getWorkspace().getBlocksByType('arduino_class',false)[0]);
      const setter=Blockly.serialization.blocks.append({type:'variables_set',fields:{VAR:{id:'servoTest',name:'myServo',type:''}},inputs:{VALUE:{block:template}}},az,{recordUndo:true});
      const object=setter.getField('VAR').getVariable();
      const call=Blockly.serialization.blocks.append({type:'arduino_instance_call'},az,{recordUndo:true});
      call.setFieldValue(object.getId(),'VAR');call.getInputTargetBlock('ARG_0').setFieldValue(90,'NUM');
      const setup=az.getBlocksByType('arduino_setup',false)[0];let tail=setup.getInputTargetBlock('DO');
      while(tail&&tail.getNextBlock())tail=tail.getNextBlock();
      (tail?tail.nextConnection:setup.getInput('DO').connection).connect(setter.previousConnection);
      setter.nextConnection.connect(call.previousConnection);
      az.getVariableMap().renameVariable(object,'armServo');Blockly.Events.setGroup(false);void 0;`);
    await wait("document.getElementById('arduino-code').value.includes('v_armServo.write')");
    assert.match(await run("document.getElementById('arduino-code').value"),/Servo v_armServo;/);
    assert.strictEqual(await run("document.getElementById('arduino-compile').disabled"),false);
    assert.strictEqual(await run("document.getElementById('arduino-code').value.includes('StudioXObject')"),false);
    await run("document.getElementById('arduino-undo').click()");
    await wait('az.getAllBlocks(false).length==='+beforeLibraryBlocks);

    assert.strictEqual(await run("az.getToolbox().getToolboxItems().some(item=>item.getName&&['Program','Python','Workflows'].includes(item.getName()))"),false);
    // Cancelling a local picker must not start a job.
    const beforeLocal=await run("calls.filter(call=>call.endpoint==='/libraries/install-local').length");
    await run("document.getElementById('arduino-library-local-folder').click()");
    await wait("!document.getElementById('arduino-library-local-folder').disabled");
    assert.strictEqual(await run("calls.filter(call=>call.endpoint==='/libraries/install-local').length"),beforeLocal);
    folderSelection=path.join(temp,'Local library folder');
    await run("document.getElementById('arduino-library-local-folder').click()");
    await wait("calls.some(call=>call.endpoint==='/libraries/install-local'&&call.body.kind==='folder')");
    await wait("document.getElementById('arduino-library-manager-status').textContent.includes('Local library installed')");
    assert.deepStrictEqual(await run("calls.find(call=>call.endpoint==='/libraries/install-local'&&call.body.kind==='folder').body"),{kind:'folder',path:folderSelection});
    assert.strictEqual(pickerCalls.find(call=>call[0]==='folder')[1].title,'Select Arduino library folder');
    assert.strictEqual(await run("document.querySelectorAll('#arduino-library-results button[data-library]').length"),0,'installed local libraries do not offer catalog-only reinstall actions');
    zipSelection=path.join(temp,'Downloaded Library.zip');
    await run("document.getElementById('arduino-library-local-zip').click()");
    await wait("calls.some(call=>call.endpoint==='/libraries/install-local'&&call.body.kind==='zip')");
    await wait("document.getElementById('arduino-library-manager-status').textContent.includes('Local library installed') && !document.getElementById('arduino-library-local-zip').disabled");
    assert.deepStrictEqual(await run("calls.find(call=>call.endpoint==='/libraries/install-local'&&call.body.kind==='zip').body"),{kind:'zip',path:zipSelection});
    assert.strictEqual(pickerCalls.find(call=>call[1].title==='Select Arduino library ZIP')[1].filters[0].extensions[0],'zip');
    await run("document.querySelector('#arduino-library-results button[data-headers]').click()");
    await wait("az.getBlocksByType('arduino_include',false).length===1");
    await wait("document.getElementById('arduino-code').value.includes('#include <Servo.h>')");
    assert.strictEqual(await run("document.getElementById('arduino-library-manager').open"),false);
    assert.strictEqual(await run("ws.getBlocksByType('arduino_include',false).length"),0);
    await run("document.getElementById('arduino-manage-libraries').click()");
    await wait("document.querySelector('#arduino-library-results button[data-headers]') !== null");
    await run("document.querySelector('#arduino-library-results button[data-headers]').click()");
    assert.strictEqual(await run("az.getBlocksByType('arduino_include',false).length"),1,'include action avoids duplicates');
    await run("document.getElementById('arduino-undo').click()");await wait('az.getTopBlocks(false).length===2');
    await run("document.getElementById('arduino-save-blocks').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Arduino blocks saved.'");
    assert.strictEqual(JSON.parse(fs.readFileSync(savedFile,'utf8')).format,'studiox-arduino');
    const fileCount=await run('az.getAllBlocks(false).length');
    await run("document.getElementById('arduino-import-file').click()");await wait('az.getAllBlocks(false).length>'+fileCount);assert.strictEqual(await run('az.getTopBlocks(false).length'),2);
    await run("document.getElementById('arduino-undo').click()");await wait('az.getTopBlocks(false).length===2');
    await wait('az.getAllBlocks(false).length==='+fileCount);
    const clearCount=await run('az.getAllBlocks(false).length');
    await run("document.getElementById('arduino-clear-blocks').click()");
    await wait('az.getAllBlocks(false).length===2');
    await run("document.getElementById('arduino-undo').click()");await wait('az.getAllBlocks(false).length==='+clearCount);
    await run("window.delay=az.getBlocksByType('arduino_delay',false)[0].getInputTargetBlock('MS');void 0");
    await run("document.getElementById('arduino-board').value='arduino:avr:mega:cpu=atmega2560';document.getElementById('arduino-board').dispatchEvent(new Event('change'))");
    await wait("!document.getElementById('arduino-compile').disabled");
    assert.strictEqual(await run("document.getElementById('arduino-upload').disabled"),false);
    assert.match(await run("document.getElementById('arduino-upload').title"),/Compile this program/);
    const beforeBoardCompile=await compileCount();
    await run("document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.'");
    assert.strictEqual(await compileCount(),beforeBoardCompile+1,'a new board requires a new build');
    assert.strictEqual(await run("calls.filter(item=>item.endpoint==='/compile').at(-1).body.board"),'arduino:avr:mega:cpu=atmega2560');
    await run("delay.setFieldValue(707,'NUM');showTab('blockly')");
    await new Promise(resolve=>setTimeout(resolve,300));
    await win.reload();await wait('typeof registerExtensionBlocks===\'function\'');await bootstrap();
    await wait('az.getAllBlocks(false).length>0');
    assert.strictEqual(await run("az.getBlocksByType('arduino_delay',false)[0].getInputTargetBlock('MS').getFieldValue('NUM')"),707,'Arduino recovery is independent of main');
    assert.strictEqual(await run("ws.getBlockById('blink_ms').getFieldValue('NUM')"),500);
    // Whole-workspace transfer converts Python robot blocks before loading.
    await run(`document.getElementById('arduino-clear-blocks').click();ws.clear();
      const n=value=>({shadow:{type:'math_number',fields:{NUM:value}}});
      const axes=Object.fromEntries(['X','Y','Z','A','B','C'].map((axis,index)=>['AXIS_'+axis,n(index+1)]));
      const pump={type:'robot_pump',id:'pythonPump',fields:{VARIABLE:'robot',MODE:'1'},next:{block:{type:'robot_delay',inputs:{TIME:n(1.5)}}}};
      const pose={type:'write_coordinate',fields:{VARIABLE:'robot',MOTION:'2',POSITION:'1'},inputs:axes,next:{block:pump}};
      const home={type:'robot_homing',fields:{VARIABLE:'robot'},next:{block:pose}};
      const source={type:'setup_robot',fields:{VARIABLE:{id:'pyRobot',name:'robot',type:''},MODEL:'Mirobot_UART',PORT:'VirtualMirobot'},next:{block:home}};
      Blockly.serialization.blocks.append(source,ws);
      window.robotSourceBefore=JSON.stringify(Blockly.serialization.workspaces.save(ws));
      document.getElementById('arduino-import-main').click();void 0;`);
    await wait("az.getBlocksByType('arduino_class',false).length===1");
    assert.strictEqual(await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))===robotSourceBefore'),true);
    await wait("!document.getElementById('arduino-compile').disabled");
    await wait("document.getElementById('arduino-code').value.includes('v_robot.init()')");
    assert.match(await run("document.getElementById('arduino-code').value"),/v_robot.init\(\);/);
    assert.strictEqual(await run("document.getElementById('arduino-code').value.includes('sx_bus_')"),false);
    assert.match(await run("document.getElementById('arduino-code').value"),/Mirobot_UART v_robot/);
    await wait("document.getElementById('arduino-code').value.includes('v_robot.homing()')");
    assert.match(await run("document.getElementById('arduino-code').value"),/v_robot.homing\(\);\n\s*v_robot.waitIdle\(\)/);
    assert.match(await run("document.getElementById('arduino-code').value"),/v_robot.movePose\(\(uint8_t\)\(2\)/);
    assert.strictEqual(await run("az.getAllBlocks(false).some(block=>['setup_robot','robot_homing','write_coordinate','robot_pump','robot_delay'].includes(block.type))"),false);
    // JSON clipboard: paste a selected command into an already-declared robot.
    const beforeRobotPaste=await run('az.getAllBlocks(false).length');
    await run("ExtensionAPI.copyBlockToClipboard(ws.getBlockById('pythonPump'));document.getElementById('arduino-paste-blocks').click()");
    await wait('az.getAllBlocks(false).length>'+beforeRobotPaste);
    assert.strictEqual(await run("az.getBlocksByType('robot_pump',false).length"),0);
    await run("document.getElementById('arduino-undo').click()");await wait('az.getAllBlocks(false).length==='+beforeRobotPaste);
    // XML clipboard follows the same mapping and remains one undo action.
    await run("ExtensionAPI.publishBlockClipboard([Blockly.Xml.domToText(Blockly.Xml.blockToDom(ws.getBlockById('pythonPump'),true))]);document.getElementById('arduino-paste-blocks').click()");
    await wait('az.getAllBlocks(false).length>'+beforeRobotPaste);
    assert.strictEqual(await run("az.getBlocksByType('robot_pump',false).length"),0);
    await run("document.getElementById('arduino-undo').click()");await wait('az.getAllBlocks(false).length==='+beforeRobotPaste);
    // Joint JSON and XML clipboard transfers use Arduino moveJoints behavior.
    await run(`(function(){
      const axes=Object.fromEntries(['X','Y','Z','A','B','C'].map((axis,index)=>['AXIS_'+axis,{shadow:{type:'math_number',fields:{NUM:index+1}}}]));
      const block=Blockly.serialization.blocks.append({type:'write_angle',id:'pythonJoint',fields:{VARIABLE:'robot',POSITION:'1'},inputs:axes},ws);
      window.jointSourceBefore=JSON.stringify(Blockly.serialization.workspaces.save(ws));
      ExtensionAPI.copyBlockToClipboard(block);document.getElementById('arduino-paste-blocks').click();
    })();void 0;`);
    await wait("document.getElementById('arduino-code').value.includes('v_robot.moveJoints((bool)(true), (float)(1), (float)(2), (float)(3), (float)(4), (float)(5), (float)(6))')");
    assert.strictEqual(await run("az.getBlocksByType('write_angle',false).length"),0);
    assert.strictEqual(await run('JSON.stringify(Blockly.serialization.workspaces.save(ws))===jointSourceBefore'),true);
    await wait("!document.getElementById('arduino-compile').disabled");
    await run("document.getElementById('arduino-undo').click()");await wait('az.getAllBlocks(false).length==='+beforeRobotPaste);
    await run("ExtensionAPI.publishBlockClipboard([Blockly.Xml.domToText(Blockly.Xml.blockToDom(ws.getBlockById('pythonJoint'),true))]);document.getElementById('arduino-paste-blocks').click()");
    await wait("document.getElementById('arduino-code').value.includes('v_robot.moveJoints((bool)(true), (float)(1), (float)(2), (float)(3), (float)(4), (float)(5), (float)(6))')");
    await wait("!document.getElementById('arduino-compile').disabled");
    await run("document.getElementById('arduino-undo').click()");await wait('az.getAllBlocks(false).length==='+beforeRobotPaste);
    // Use the flyout's native block creation path, as toolbox dragging does.
    await run(`document.getElementById('arduino-clear-blocks').click();
      var robotCategory=az.getToolbox().getToolboxItems().find(item=>item.getName&&item.getName()==='Robot');az.getToolbox().setSelectedItem(robotCategory);void 0;`);
    await wait("az.getFlyout().getWorkspace().getBlocksByType('variables_set',false).length===1");
    assert.deepStrictEqual(await run("az.getFlyout().getWorkspace().getTopBlocks(true).map(block=>block.type==='arduino_instance_call' ? block.librarySpec_.name : block.type)"),['variables_set','waitIdle','sendMsg','homing','zero','movePose','moveJoints','setMotionSpeed','arduino_delay']);
    assert.strictEqual(await run("az.getFlyout().getWorkspace().getAllBlocks(false).some(block=>['setup_robot','robot_homing','robot_speed','write_coordinate','write_angle'].includes(block.type))"),false);
    await run(`var flyoutOriginal=az.getFlyout().getWorkspace().getBlocksByType('variables_set',false)[0];
      window.draggedSetup=az.getFlyout().createBlock(flyoutOriginal);void 0;`);
    await wait("az.getBlocksByType('arduino_class',false).length===1");
    await wait("!document.getElementById('arduino-compile').disabled");
    await wait("document.getElementById('arduino-code').value.includes('v_robot.init()')");
    assert.match(await run("document.getElementById('arduino-code').value"),/v_robot.init\(\);/);
    await run(`var flyoutOriginal=az.getFlyout().getWorkspace().getBlocksByType('arduino_instance_call',false).find(block=>block.librarySpec_.name==='homing');
      az.getFlyout().createBlock(flyoutOriginal);void 0;`);
    await wait("az.getBlocksByType('arduino_instance_call',false).length===3");
    await wait("!document.getElementById('arduino-compile').disabled");
    await wait("document.getElementById('arduino-code').value.includes('v_robot.homing()')");
    assert.match(await run("document.getElementById('arduino-code').value"),/v_robot.homing\(\);\n\s*v_robot.waitIdle\(\)/);
    await run(`var flyoutOriginal=az.getFlyout().getWorkspace().getBlocksByType('arduino_instance_call',false).find(block=>block.librarySpec_.name==='moveJoints');
      az.getFlyout().createBlock(flyoutOriginal);void 0;`);
    await wait("az.getBlocksByType('arduino_instance_call',false).length===4");
    await wait("document.getElementById('arduino-code').value.includes('v_robot.moveJoints')");
    await wait("!document.getElementById('arduino-compile').disabled");
    await run(`var accessoriesCategory=az.getToolbox().getToolboxItems().find(item=>item.getName&&item.getName()==='Accessories');az.getToolbox().setSelectedItem(accessoriesCategory);void 0;`);
    await wait("az.getFlyout().getWorkspace().getBlocksByType('arduino_instance_call',false).length===3");
    assert.deepStrictEqual(await run("az.getFlyout().getWorkspace().getTopBlocks(true).map(block=>block.librarySpec_.name)"),['setEndtGripper','setEndtPump','setEndtPump']);
    assert.strictEqual(await run("az.getFlyout().getWorkspace().getAllBlocks(false).some(block=>['robot_pump','robot_gripper','robot_three_finger','robot_conveyor'].includes(block.type))"),false);
    await run("az.getFlyout().createBlock(az.getFlyout().getWorkspace().getBlocksByType('arduino_instance_call',false).find(block=>block.librarySpec_.name==='setEndtPump'));void 0");
    await wait("az.getBlocksByType('arduino_instance_call',false).length===5");
    await wait("!document.getElementById('arduino-compile').disabled");
    await wait("document.getElementById('arduino-code').value.includes('v_robot.setEndtPump')");
    assert.match(await run("document.getElementById('arduino-code').value"),/v_robot.setEndtPump/);
    await run(`document.getElementById('arduino-clear-blocks').click();
      var variablesCategory=az.getToolbox().getToolboxItems().find(item=>item.getName&&item.getName()==='Variables');
      az.getToolbox().setSelectedItem(variablesCategory);void 0;`);
    await wait("az.getFlyout().getWorkspace().getBlocksByType('arduino_address_of',false).length===1");
    await run(`var pointerSpec={id:'pointer-read',header:'PointerFixture.h',library:'PointerFixture',owner:'PointerFixture',qualifiedName:'PointerFixture::read',name:'read',parameters:[{name:'out',type:'uint16_t *',kind:'cpp'}],returnType:'void',returnKind:'void',constructor:false,supported:true};
      var pointerCtor={...pointerSpec,id:'pointer-ctor',name:'PointerFixture',qualifiedName:'PointerFixture',constructor:true,parameters:[]};
      var pointerVariable=id=>({id,name:id,type:''});
      Blockly.serialization.blocks.append({type:'variables_set',fields:{VAR:pointerVariable('red')},inputs:{VALUE:{block:{type:'arduino_type',fields:{TYPE:'uint16_t'}}}}},az);
      Blockly.serialization.blocks.append({type:'variables_set',fields:{VAR:pointerVariable('pointerSensor')},inputs:{VALUE:{block:{type:'arduino_class',extraState:{signature:pointerCtor,methods:[pointerSpec]}}}}},az);
      var pointerCall=Blockly.serialization.blocks.append({type:'arduino_instance_call',fields:{VAR:pointerVariable('pointerSensor')},extraState:{signature:pointerSpec},inputs:{ARG_0:{block:{type:'arduino_address_of',fields:{VAR:pointerVariable('red')}}}}},az);
      az.getBlocksByType('arduino_setup',false)[0].getInput('DO').connection.connect(pointerCall.previousConnection);void 0;`);
    await wait("document.getElementById('arduino-code').value.includes('v_pointerSensor.read(&v_red)')");
    await wait("!document.getElementById('arduino-compile').disabled");
    await run("az.getVariableMap().renameVariable(az.getVariableMap().getVariableById('red'),'pink');void 0");
    await wait("document.getElementById('arduino-code').value.includes('v_pointerSensor.read(&v_pink)')");
    const escapedText=String.raw`red\tgreen\nliteral\\t`;
    await run(`window.escapedPrint=Blockly.serialization.blocks.append({type:'arduino_serial_print',fields:{NEWLINE:'FALSE'},inputs:{VALUE:{block:{type:'text',fields:{TEXT:${JSON.stringify(escapedText)}}}}}},az);az.getBlocksByType('arduino_loop',false)[0].getInput('DO').connection.connect(escapedPrint.previousConnection);void 0;`);
    const expectedPrint=String.raw`Serial.print(String("red\tgreen\nliteral\\t"));`;
    await wait('document.getElementById("arduino-code").value.includes('+JSON.stringify(expectedPrint)+')');
    assert.strictEqual(await run("escapedPrint.getInputTargetBlock('VALUE').getFieldValue('TEXT')"),escapedText,'text fields keep the typed escape spelling');
    await wait("!document.getElementById('arduino-compile').disabled");
    await run("document.getElementById('arduino-serial-tab').click();document.getElementById('arduino-port').value='COM9';document.getElementById('arduino-port').dispatchEvent(new Event('change'))");
    assert.strictEqual(await run("document.getElementById('arduino-serial-panel').hidden"),false);
    assert.strictEqual(await run("document.getElementById('arduino-serial-baud').tagName"),'SELECT');
    assert.strictEqual(await run("['9600','115200','57600','custom'].every(value=>Array.from(document.getElementById('arduino-serial-baud').options).some(option=>option.value===value))"),true,'baud dropdown includes common rates and Custom');
    assert.strictEqual(await run("document.getElementById('arduino-serial-baud').value"),'9600');
    assert.strictEqual(await run("calls.filter(c=>c.endpoint==='/serial/connect').length"),0,'monitor does not open a port at startup');
    await run("document.getElementById('arduino-serial-toggle').click()");
    await wait("document.getElementById('arduino-serial-toggle').textContent==='Disconnect' && !document.getElementById('arduino-serial-toggle').disabled");
    await run("emitSerial('Hello sensor\\n<img src=x>');void 0");
    await wait("document.getElementById('arduino-serial-output').textContent.includes('Hello sensor')");
    assert.strictEqual(await run("document.getElementById('arduino-serial-output').querySelector('img')===null"),true,'serial data is displayed as text');
    await run("var serialText=document.getElementById('arduino-serial-output').firstChild;var selectionRange=document.createRange();selectionRange.setStart(serialText,0);selectionRange.setEnd(serialText,5);getSelection().removeAllRanges();getSelection().addRange(selectionRange);emitSerial(' more data');void 0");
    await wait("document.getElementById('arduino-serial-output').textContent.endsWith(' more data')");
    assert.strictEqual(await run('getSelection().toString()'),'Hello','incoming text preserves selection for copying');
    await run("document.getElementById('arduino-serial-baud').value='115200';document.getElementById('arduino-serial-baud').dispatchEvent(new Event('change'))");
    await wait("serialState.baudrate===115200 && !document.getElementById('arduino-serial-baud').disabled");
    assert.strictEqual(await run("ExtensionAPI.getSetting('arduino.serialBaud')"),115200);
    const customReads=await run("calls.filter(c=>c.endpoint==='/serial/read').length");
    await run("document.getElementById('arduino-serial-baud').value='custom';document.getElementById('arduino-serial-baud').dispatchEvent(new Event('change'))");
    await wait("calls.filter(c=>c.endpoint==='/serial/read').length>"+customReads);
    assert.strictEqual(await run("document.getElementById('arduino-serial-baud').value"),'custom','background polling preserves Custom mode');
    assert.strictEqual(await run("document.getElementById('arduino-serial-custom-label').hidden"),false);
    await run("document.getElementById('arduino-serial-custom-baud').value='153600';document.getElementById('arduino-serial-custom-baud').dispatchEvent(new Event('input'));document.getElementById('arduino-serial-custom-baud').dispatchEvent(new Event('change'))");
    await wait("serialState.baudrate===153600 && ExtensionAPI.getSetting('arduino.serialBaud')===153600 && !document.getElementById('arduino-serial-custom-baud').disabled");
    assert.strictEqual(await run("document.getElementById('arduino-serial-baud').value"),'custom');
    await run("document.getElementById('arduino-serial-baud').value='115200';document.getElementById('arduino-serial-baud').dispatchEvent(new Event('change'))");
    await wait("serialState.baudrate===115200 && !document.getElementById('arduino-serial-baud').disabled");
    assert.strictEqual(await run("document.getElementById('arduino-serial-custom-label').hidden"),true);
    const baudCalls=await run("calls.filter(c=>c.endpoint==='/serial/connect').length");
    await run("document.getElementById('arduino-serial-baud').value='custom';document.getElementById('arduino-serial-baud').dispatchEvent(new Event('change'));document.getElementById('arduino-serial-custom-baud').value='0';document.getElementById('arduino-serial-custom-baud').dispatchEvent(new Event('change'))");
    await wait("document.getElementById('arduino-serial-status').dataset.error==='true'");
    assert.strictEqual(await run("calls.filter(c=>c.endpoint==='/serial/connect').length"),baudCalls,'invalid baud never opens a connection');
    await run("document.getElementById('arduino-serial-baud').value='115200';document.getElementById('arduino-serial-baud').dispatchEvent(new Event('change'));window.holdSerialRead=true;emitSerial('STALE');void 0");
    await wait("typeof window.releaseSerialRead==='function'");
    await run("document.getElementById('arduino-serial-clear').click()");
    await wait("document.getElementById('arduino-serial-output').textContent===''");
    await run('window.releaseSerialRead()');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.strictEqual(await run("document.getElementById('arduino-serial-output').textContent"),'','late polling responses cannot restore cleared text');
    await run("emitSerial('Board ready\\n');void 0");
    await wait("document.getElementById('arduino-serial-output').textContent.includes('Board ready')");
    const serialUploadStart=await run('calls.length');
    await run("document.getElementById('arduino-upload').click()");
    await wait("document.getElementById('arduino-build-status').textContent==='Upload complete.' && serialState.connected");
    const uploadSequence=await run('calls.slice('+serialUploadStart+').map(c=>c.endpoint)');
    assert.ok(uploadSequence.indexOf('/serial/disconnect')<uploadSequence.indexOf('/upload'));
    assert.ok(uploadSequence.indexOf('/serial/connect')>uploadSequence.indexOf('/upload'));
    assert.strictEqual(await run("document.getElementById('arduino-serial-output').textContent.includes('Board ready')"),true,'operation logs do not replace serial output');
    await run("document.getElementById('arduino-port').value='manual';document.getElementById('arduino-manual-port').value='COM10';document.getElementById('arduino-port').dispatchEvent(new Event('change'))");
    await wait("!serialState.connected && document.getElementById('arduino-serial-toggle').textContent==='Connect'");
    await run("document.getElementById('arduino-serial-toggle').click()");
    await wait("serialState.connected && serialState.port==='COM10' && !document.getElementById('arduino-serial-clear').disabled");
    await run("emitSerial('R: 11  G: 22  B: 33  Clear: 44\\n');document.getElementById('arduino-serial-tab').click();void 0");
    await wait("document.getElementById('arduino-serial-output').textContent.includes('R: 11')");
    await run("document.documentElement.dataset.theme='dark';new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await win.webContents.capturePage().then(image=>fs.writeFileSync('/private/tmp/studiox-arduino-serial-monitor.png',image.toPNG()));
    await win.webContents.capturePage().then(image=>fs.writeFileSync('/private/tmp/studiox-arduino-independent.png',image.toPNG()));
    assert.deepStrictEqual(errors,[]);
    console.log('Arduino integration passed: permanent Setup/Loop, nested library function blocks, native Robot/Accessories toolbox creation, plain setup, Python robot mapping on import and JSON/XML clipboard, independent editor, board/library managers, local folder/ZIP pickers and cancellation, automatic compile/upload, build reuse, layout/port reuse, stale-code protection, failed/cancelled compilation, package invalidation, clipboard, undo, and recovery.');
  } catch(error) { console.error(error);console.error('Renderer errors:',errors);
    try { console.error(await run(`JSON.stringify({errors:null,flyoutOptions:az.getFlyout().getWorkspace().getBlocksByType('arduino_instance_call',false).map(b=>({signature:b.librarySpec_?.name,field:b.getFieldValue('FUNC_NAME'),disposed:b.isDisposed()})),flyout:az.getFlyout().getWorkspace().getAllBlocks(false).map(b=>b.type),categories:az.getToolbox().getToolboxItems().map(i=>({name:i.getName(),visible:i.isVisible&&i.isVisible()})),copyDebug:window.copyDebug,message:document.getElementById('arduino-build-status').textContent, main:ws.getTopBlocks(false).map(b=>b.type), arduino:az.getTopBlocks(false).map(b=>b.type), clipboard:ExtensionAPI.getBlockClipboard(), pasteDisabled:document.getElementById('arduino-paste-blocks').disabled,redoDisabled:document.getElementById('arduino-redo').disabled,undo:az.getUndoStack().map(e=>e.type),redo:az.getRedoStack().map(e=>e.type)})`)); } catch(_) {}
    process.exitCode=1; }
  finally { win.destroy();fs.rmSync(temp,{recursive:true,force:true});app.exit(process.exitCode||0); }
});
