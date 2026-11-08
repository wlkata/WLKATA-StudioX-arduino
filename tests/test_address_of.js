/* Address blocks must pass real variables to mutable C++ pointer parameters. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const {execFileSync} = require('child_process');
const {compile} = require('../frontend/compiler'), types = require('../frontend/cppTypes');
const root = path.resolve(__dirname, '..'), arg = process.argv.indexOf('--studiox-root');
const host = arg < 0 ? path.resolve(root, '../blockly') : process.argv[arg + 1];
const Blockly = require(path.join(host, 'node_modules/blockly'));
require(path.join(host, 'node_modules/blockly/blocks'));
Blockly.defineBlocksWithJsonArray(JSON.parse(fs.readFileSync(path.join(root, 'blocks/blocks.json'))));
const context = {Blockly, StudioXArduinoCppTypes:types};
vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/libraryBlocks.js'), 'utf8'), context);
let id = 0;
const block = (type, fields = {}, inputs = {}, signature) => ({type,id:'address-test-' + id++,fields,
  inputs:Object.fromEntries(Object.entries(inputs).map(([key, block]) => [key, {block}])),
  ...(signature ? {extraState:{signature,options:[signature]}} : {})});
const colors = ['red','green','blue','clear'];
const ctor = {id:'ctor',library:'PointerFixture',header:'PointerFixture.h',owner:'Sensor',qualifiedName:'Sensor',name:'Sensor',
  constructor:true,returnType:'void',returnKind:'void',supported:true,parameters:[]};
const read = {...ctor,id:'getRGBC',constructor:false,name:'getRGBC',qualifiedName:'Sensor::getRGBC',
  parameters:colors.map(name => ({name,type:'uint16_t *',kind:'cpp'}))};
const address = name => block('arduino_address_of', {VAR:{id:name,name,type:''}});
const declare = (name, type = 'uint16_t') => block('variables_set', {VAR:{id:name,name,type:''}}, {VALUE:block('arduino_type', {TYPE:type})});
const invocation = block('arduino_instance_call', {VAR:{id:'sensor'}}, Object.fromEntries(colors.map((name,index) => ['ARG_' + index,address(name)])), read);
const state = {variables:[...colors,'sensor'].map(name => ({id:name,name,type:''})),blocks:{blocks:[
  ...colors.map(name => declare(name)),
  block('variables_set',{VAR:{id:'sensor',name:'sensor',type:''}},{VALUE:block('arduino_class', {}, {}, ctor)}),
  block('arduino_setup', {}, {DO:invocation}), block('arduino_loop')
]}};
const before = JSON.stringify(state), output = compile(state);
assert.deepStrictEqual(output.diagnostics, []);
assert.strictEqual(JSON.stringify(state), before);
assert.match(output.code, /getRGBC\(&v_red, &v_green, &v_blue, &v_clear\);/);
for (const name of colors) assert.ok(output.code.includes('uint16_t v_' + name + ' = 0;'));

const free = {...read,id:'free',owner:'',qualifiedName:'take',name:'take',parameters:[{name:'value',type:'double *',kind:'cpp'}]};
const implicit = {variables:[{id:'only',name:'only'}],blocks:{blocks:[block('arduino_library_call',{}, {ARG_0:address('only')},free)]}};
assert.deepStrictEqual(compile(implicit).diagnostics, []);
assert.match(compile(implicit).code, /double v_only = 0;/);
assert.match(compile(implicit).code, /take\(&v_only\);/);
for (const name of ['class','setup','loop','Serial','Wire']) {
  const reserved = JSON.parse(JSON.stringify(implicit)); reserved.variables[0].name = name;
  assert.ok(compile(reserved).code.includes('take(&v_' + name + ');'), 'generated names protect ' + name);
}
const legacy = {...free,parameters:[{name:'sensor',type:'Sensor *',kind:'cpp'}]};
const legacyState = {variables:[{id:'sensor',name:'sensor',type:'arduino-object:Sensor'}],blocks:{blocks:[
  block('arduino_library_object',{VAR:{id:'sensor'}},{},ctor), block('arduino_library_call',{}, {ARG_0:address('sensor')},legacy)
]}};
assert.deepStrictEqual(compile(legacyState).diagnostics, []);
assert.match(compile(legacyState).code, /take\(&obj_sensor\)/);
assert.ok(!compile(legacyState).code.includes('double v_sensor'));
const invalid = {variables:state.variables,blocks:{blocks:[block('arduino_delay',{}, {MS:address('red')})]}};
assert.ok(compile(invalid).diagnostics.some(d => /needs number/.test(d.message)));

const workspace = new Blockly.Workspace(); context.StudioXArduinoLibraryBlocks.observeWorkspace(workspace);
Blockly.serialization.workspaces.load(state, workspace);
const call = workspace.getBlocksByType('arduino_instance_call')[0];
assert.strictEqual(call.getInputTargetBlock('ARG_0').type, 'arduino_address_of');
assert.strictEqual(call.getInputTargetBlock('ARG_0').outputConnection.getCheck()[0], 'ArduinoPointer');
workspace.getVariableMap().renameVariable(workspace.getVariableMap().getVariableById('red'), 'pink');
const renamed = compile(Blockly.serialization.workspaces.save(workspace));
assert.deepStrictEqual(renamed.diagnostics, []);
assert.match(renamed.code, /getRGBC\(&v_pink, &v_green, &v_blue, &v_clear\)/);
const copy = new Blockly.Workspace();
Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(workspace), copy);
assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(copy)).diagnostics, []);
assert.match(compile(Blockly.serialization.workspaces.save(copy)).code, /&v_pink/);
const pasted = new Blockly.Workspace();
Blockly.Xml.domToBlock(Blockly.Xml.blockToDom(call.getInputTargetBlock('ARG_0')), pasted);
assert.strictEqual(pasted.getTopBlocks()[0].getField('VAR').getVariable().getName(), 'pink');
for (const ws of [workspace,copy,pasted]) ws.dispose();

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studiox-address-of-'));
try {
  fs.writeFileSync(path.join(folder, 'Arduino.h'), '#pragma once\n#include <stdint.h>\n');
  fs.writeFileSync(path.join(folder, 'PointerFixture.h'), '#pragma once\nstruct Sensor { void getRGBC(uint16_t *r,uint16_t *g,uint16_t *b,uint16_t *c){*r=11;*g=22;*b=33;*c=44;} };\n');
  const source = path.join(folder, 'program.cpp'), binary = path.join(folder, 'program');
  fs.writeFileSync(source, '#include <cassert>\n' + output.code + '\nint main(){setup();assert(v_red==11 && v_green==22 && v_blue==33 && v_clear==44);}\n');
  execFileSync('c++', ['-std=c++11','-I',folder,source,'-o',binary], {stdio:'pipe'});
  execFileSync(binary, [], {stdio:'pipe'});
  const wrong = JSON.parse(JSON.stringify(state));
  wrong.blocks.blocks[0].inputs.VALUE.block.fields.TYPE = 'double';
  fs.writeFileSync(source, compile(wrong).code);
  assert.throws(() => execFileSync('c++', ['-std=c++11','-fsyntax-only','-I',folder,source], {stdio:'pipe'}), 'a wrong pointee type must fail instead of being cast');
} finally { fs.rmSync(folder, {recursive:true,force:true}); }
console.log('Address-of passed: typed color outputs, mutation through pointers, variable renames, XML/clipboard persistence, implicit and legacy variables, name protection, numeric socket rejection, and C++ pointee checks.');
