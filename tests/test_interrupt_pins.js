const assert=require('assert'),path=require('path');
const Blockly=require(path.resolve(__dirname,'../../blockly/node_modules/blockly'));
require(path.resolve(__dirname,'../../blockly/node_modules/blockly/blocks'));
const boardPins=require('../frontend/boardPins');
const {build}=require('../frontend/toolbox');
const {compile}=require('../frontend/compiler');
Blockly.defineBlocksWithJsonArray(require('../blocks/blocks.json').map(({python,...definition})=>definition));
boardPins.register(Blockly);
const uno='arduino:avr:uno',nano='arduino:avr:nano:cpu=atmega328old',mega='arduino:avr:mega:cpu=atmega2560';
const profile=board=>build({kind:'categoryToolbox',contents:[]},{libraries:[]},board).contents.find(item=>item.name==='I/O');
for(const board of [uno,nano])assert.deepStrictEqual(boardPins.interruptPins(board),['2','3']);
assert.deepStrictEqual(boardPins.interruptPins(mega),['2','3','18','19','20','21']);
assert.deepStrictEqual(boardPins.interruptPins('arduino:avr:leonardo'),['0','1','2','3','7']);
assert.deepStrictEqual(boardPins.interruptPins('arduino:avr:micro'),['0','1','2','3','7']);
assert.strictEqual(boardPins.interruptPins('other:avr:uno'),null);
for(const type of ['arduino_attach_interrupt','arduino_detach_interrupt']) {
 assert.strictEqual(profile(mega).contents.find(item=>item.type===type).inputs.PIN.shadow.type,'arduino_interrupt_pin');
 assert.deepStrictEqual(profile('vendor:arch:unknown').contents.find(item=>item.type===type).inputs.PIN.shadow,{type:'arduino_interrupt_pin',fields:{PIN:'?'}},'unknown boards require a pinout check rather than assuming pin 2');
}
assert.strictEqual(profile(mega).contents.find(item=>item.type==='arduino_attach_pin_change_interrupt').inputs.PIN.shadow.type,'arduino_pin','pin-change interrupts must not inherit the external-interrupt pin list');
function create(board) {const ws=new Blockly.Workspace();boardPins.setBoard(ws,board,Blockly);return ws;}
function append(ws,pin='18') {
 return Blockly.serialization.blocks.append({type:'arduino_attach_interrupt',fields:{MODE:'RISING'},inputs:{PIN:{shadow:{type:'arduino_interrupt_pin',fields:{PIN:pin}}}}},ws);
}
const ws=create(mega),attach=append(ws),shadow=attach.getInputTargetBlock('PIN');
assert.deepStrictEqual(shadow.getField('PIN').getOptions(false).map(item=>item[1]),['2','3','18','19','20','21']);
assert.strictEqual(shadow.getFieldValue('PIN'),'18');
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(ws),{board:mega}).diagnostics,[]);
assert.match(compile(Blockly.serialization.workspaces.save(ws),{board:mega}).code,/pinMode\(18, INPUT_PULLUP\);/);
boardPins.setBoard(ws,uno,Blockly);
assert.strictEqual(shadow.getFieldValue('PIN'),'18','switching boards must not silently rewire a saved pin');
assert.ok(shadow.getField('PIN').getOptions(false).some(([label,value])=>value==='18'&&label.includes('not supported')));
assert.ok(compile(Blockly.serialization.workspaces.save(ws),{board:uno}).diagnostics.some(item=>item.blockId===attach.id&&/not a hardware-interrupt pin/.test(item.message)));
shadow.setFieldValue('3','PIN');
assert.deepStrictEqual(shadow.getField('PIN').getOptions(false).map(item=>item[1]),['2','3']);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(ws),{board:uno}).diagnostics,[]);
shadow.setFieldValue('18','PIN'); // Same programmatic path used by Blockly Undo.
assert.strictEqual(shadow.getFieldValue('PIN'),'18');
const saved=Blockly.serialization.workspaces.save(ws);
const copied=create(uno);Blockly.serialization.workspaces.load(saved,copied);
assert.strictEqual(copied.getBlocksByType('arduino_interrupt_pin',false)[0].getFieldValue('PIN'),'18');
const xmlCopy=create(uno);Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(ws),xmlCopy);
assert.strictEqual(xmlCopy.getBlocksByType('arduino_interrupt_pin',false)[0].getFieldValue('PIN'),'18');
boardPins.setBoard(copied,mega,Blockly);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(copied),{board:mega}).diagnostics,[]);
const detached=Blockly.serialization.blocks.append({type:'arduino_detach_interrupt',inputs:{PIN:{shadow:{type:'arduino_interrupt_pin',fields:{PIN:'18'}}}}},copied);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(copied),{board:mega}).diagnostics,[]);
assert.ok(compile(Blockly.serialization.workspaces.save(copied),{board:uno}).diagnostics.some(item=>item.blockId===detached.id));
// Board validation also catches an invalid manually supplied literal pin.
const invalid={blocks:{blocks:[{id:'bad',type:'arduino_attach_interrupt',fields:{MODE:'RISING'},inputs:{PIN:{block:{type:'arduino_pin',fields:{PIN:'7'}}}}}]}};
assert.ok(compile(invalid,{board:uno}).diagnostics.some(item=>item.blockId==='bad'));
assert.deepStrictEqual(compile(invalid,{board:'arduino:avr:leonardo'}).diagnostics,[]);
// Uno -> unknown -> Mega restores the number and clears the placeholder diagnostic.
const unknown='vendor:arch:unknown';
const transition=create(uno),transitionAttach=append(transition,'2'),transitionPin=transitionAttach.getInputTargetBlock('PIN');
boardPins.setBoard(transition,unknown,Blockly);
assert.strictEqual(transitionPin.getFieldValue('PIN'),'?');
assert.strictEqual(transitionPin.getField('PIN').getText(),'Check board pinout');
assert.deepStrictEqual(transitionPin.getField('PIN').getOptions(false),[['Check board pinout','?']]);
const unknownResult=compile(Blockly.serialization.workspaces.save(transition),{board:unknown});
assert.strictEqual(unknownResult.diagnostics.length,1,'show one useful placeholder message, without a misleading pin 0 error');
assert.match(unknownResult.diagnostics[0].message,/Check the board pinout/);
transitionPin.setFieldValue('?','PIN');
boardPins.setBoard(transition,mega,Blockly);
assert.strictEqual(transitionPin.getFieldValue('PIN'),'2');
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(transition),{board:mega}).diagnostics,[]);
boardPins.setBoard(transition,unknown,Blockly);
boardPins.setBoard(transition,unknown,Blockly); // Catalog/activation refresh must retain memory.
const unknownState=Blockly.serialization.workspaces.save(transition);
const recovered=create(unknown);Blockly.serialization.workspaces.load(unknownState,recovered);
assert.strictEqual(recovered.getBlocksByType('arduino_interrupt_pin',false)[0].getFieldValue('PIN'),'?');
boardPins.setBoard(recovered,mega,Blockly);
assert.strictEqual(recovered.getBlocksByType('arduino_interrupt_pin',false)[0].getFieldValue('PIN'),'2');
const recoveredXml=create(mega);Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(transition),recoveredXml);
assert.strictEqual(recoveredXml.getBlocksByType('arduino_interrupt_pin',false)[0].getFieldValue('PIN'),'2','XML preserves the remembered pin when copying from an unknown board');
const initiallyUnknown=create(unknown),newAttach=append(initiallyUnknown,'?');
boardPins.setBoard(initiallyUnknown,mega,Blockly);
assert.strictEqual(newAttach.getInputTargetBlock('PIN').getFieldValue('PIN'),'2','an unresolved new selector receives the known board default');
transitionPin.setFieldValue('18','PIN');
boardPins.setBoard(transition,mega,Blockly);
assert.strictEqual(transitionPin.getFieldValue('PIN'),'18');
boardPins.setBoard(transition,unknown,Blockly);
boardPins.setBoard(transition,uno,Blockly);
assert.strictEqual(transitionPin.getFieldValue('PIN'),'18','a remembered but incompatible pin stays visible for correction');
assert.ok(compile(Blockly.serialization.workspaces.save(transition),{board:uno}).diagnostics.some(item=>/not a hardware-interrupt pin/.test(item.message)));
boardPins.setBoard(transition,mega,Blockly);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(transition),{board:mega}).diagnostics,[]);

const flyout=create(uno);flyout.targetWorkspace=ws;
const menuPin=flyout.newBlock('arduino_interrupt_pin');
boardPins.setBoard(ws,mega,Blockly);
assert.deepStrictEqual(menuPin.getField('PIN').getOptions(false).map(item=>item[1]),['2','3','18','19','20','21'],'flyout fields use their target workspace board');
for(const workspace of [ws,copied,xmlCopy,flyout,transition,recovered,recoveredXml,initiallyUnknown])workspace.dispose();
console.log('Interrupt pins passed: board-specific defaults, attach/detach validation, saved invalid pins, JSON/XML copies, Undo values, and flyout context.');
