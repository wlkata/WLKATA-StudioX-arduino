/* Regression: library returns use C++ declarations, including saved bad kinds. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const {execFileSync} = require('child_process');
const types = require('../frontend/cppTypes'), {compile} = require('../frontend/compiler');
const root = path.resolve(__dirname, '..'), arg = process.argv.indexOf('--studiox-root');
const host = arg < 0 ? path.resolve(root, '../blockly') : process.argv[arg + 1];
const Blockly = require(path.join(host, 'node_modules/blockly'));
require(path.join(host, 'node_modules/blockly/blocks'));
Blockly.defineBlocksWithJsonArray(JSON.parse(fs.readFileSync(path.join(root, 'blocks/blocks.json'))));
const context = {Blockly, StudioXArduinoCppTypes: types};
vm.runInNewContext(fs.readFileSync(path.join(root, 'frontend/libraryBlocks.js'), 'utf8'), context);
const api = context.StudioXArduinoLibraryBlocks;
const ctor = {id:'sensor', header:'ColorSensor.h', library:'ColorSensor', owner:'ColorSensor',
  qualifiedName:'ColorSensor', name:'ColorSensor', constructor:true, returnType:'void', returnKind:'void', parameters:[], supported:true};
const method = (name, returnType, returnKind = 'cpp') => ({...ctor, id:name, name, qualifiedName:'ColorSensor::' + name, constructor:false, returnType, returnKind});
const block = (type, fields = {}, inputs = {}, extraState) => ({type, fields, inputs:Object.fromEntries(Object.entries(inputs).map(([name, block]) => [name, {block}])), ...(extraState ? {extraState} : {})});
const declare = methods => block('variables_set', {VAR:{id:'sensor',name:'sensor',type:''}}, {
  VALUE:block('arduino_class', {}, {}, {signature:ctor,options:[ctor],methods})
});
const call = spec => block('arduino_instance_call', {VAR:{id:'sensor'}}, {}, {signature:spec,options:[spec]});
const compare = (spec, op = 'NEQ') => block('logic_compare', {OP:op}, {A:call(spec), B:block('math_number', {NUM:0})});
const snapshot = (spec, condition = compare(spec)) => ({variables:[{id:'sensor',name:'sensor'}],blocks:{blocks:[
  declare([spec]), block('arduino_setup', {}, {DO:block('controls_whileUntil', {MODE:'WHILE'}, {BOOL:condition})}), block('arduino_loop')
]}});

for (const cppType of ['int8_t','uint8_t','int16_t','int32_t','int64_t','unsigned long','float','double','bool','boolean']) {
  for (const op of ['EQ','NEQ','LT','LTE','GT','GTE']) {
    const spec = method('begin', cppType, 'text'); // Deliberately incorrect old metadata.
    const state = snapshot(spec, compare(spec, op)), before = JSON.stringify(state);
    assert.deepStrictEqual(compile(state).diagnostics, [], cppType + ' compared with zero');
    assert.strictEqual(JSON.stringify(state), before, 'compilation leaves snapshots untouched');
  }
}
for (const cppType of ['String','int8_t *','ColorSensor']) {
  assert.ok(compile(snapshot(method('begin', cppType, 'number'))).diagnostics.some(d => /Cannot compare/.test(d.message)), 'reject ' + cppType + ' despite misleading numeric kind');
}
assert.strictEqual(types.category('boolean'), 'boolean');
assert.strictEqual(types.category('const int8_t'), 'number');
assert.strictEqual(types.category('std::uint16_t'), 'number');
assert.strictEqual(types.category('int8_t *', 'number'), 'cpp');
assert.strictEqual(types.category(undefined, 'number'), 'number', 'legacy signatures with no C++ type remain usable');
const ready = method('ready', 'boolean');
assert.deepStrictEqual(compile(snapshot(ready, block('logic_negate', {}, {BOOL:call(ready)}))).diagnostics, []);
const enable = {...method('enable', 'void', 'number'), parameters:[{name:'enabled',type:'boolean',kind:'cpp'}]};
const invocation = call(enable); invocation.extraState.statement = true;
invocation.inputs.ARG_0 = {block:block('logic_boolean', {BOOL:'TRUE'})};
const enabled = snapshot(enable); enabled.blocks.blocks[1].inputs.DO.block = invocation;
assert.deepStrictEqual(compile(enabled).diagnostics, []);
assert.match(compile(enabled).code, /enable\(\(boolean\)\(true\)\)/);

(async () => {
  const workspace = new Blockly.Workspace(); api.observeWorkspace(workspace);
  const saved = method('begin', 'boolean', 'cpp');
  Blockly.serialization.workspaces.load(snapshot(saved), workspace);
  await new Promise(resolve => setTimeout(resolve, 30));
  const loaded = workspace.getBlocksByType('arduino_instance_call')[0];
  const comparison = workspace.getBlocksByType('logic_compare')[0];
  assert.strictEqual(loaded.saveExtraState().signature.returnKind, 'boolean');
  assert.strictEqual(loaded.outputConnection.getCheck()[0], 'Boolean');
  assert.strictEqual(comparison.getInputTargetBlock('A'), loaded, 'Boolean/number comparisons stay connected');
  assert.strictEqual(comparison.getInputTargetBlock('B').type, 'math_number');
  assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(workspace)).diagnostics, []);

  const changed = {...method('begin', 'int8_t', 'cpp'), id:'fresh-header'};
  api.setCatalog(workspace, {libraries:[{headers:[{functions:[changed, {...changed,id:'other-library',library:'OtherLibrary',returnType:'String'}]}]}]});
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.strictEqual(loaded.saveExtraState().signature.id, 'fresh-header', 'current headers replace saved metadata');
  assert.strictEqual(loaded.saveExtraState().signature.returnKind, 'number');
  assert.strictEqual(loaded.getField('FUNC_NAME').getOptions(false).length, 1, 'do not mix classes from different libraries');
  assert.strictEqual(comparison.getInputTargetBlock('A'), loaded);

  const copy = new Blockly.Workspace(); api.observeWorkspace(copy);
  Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(workspace), copy);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepStrictEqual(compile(Blockly.serialization.workspaces.save(copy)).diagnostics, []);
  const python = new Blockly.Workspace();
  const pyCompare = python.newBlock('logic_compare'), boolean = python.newBlock('logic_boolean'), number = python.newBlock('math_number');
  pyCompare.getInput('A').connection.connect(boolean.outputConnection);
  pyCompare.getInput('B').connection.connect(number.outputConnection);
  assert.strictEqual(python.connectionChecker.doTypeChecks(boolean.outputConnection, number.outputConnection), false, 'Python workspace keeps its strict checker');

  const temperature = workspace.newBlock('math_arithmetic');
  const boolValue = workspace.newBlock('logic_boolean');
  assert.strictEqual(workspace.connectionChecker.doTypeChecks(temperature.getInput('A').connection, boolValue.outputConnection), false, 'normal numeric input sockets stay strict');
  for (const ws of [workspace, copy, python]) ws.dispose();

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'studiox-cpp-return-types-'));
  try {
    fs.writeFileSync(path.join(folder, 'Arduino.h'), '#pragma once\n#include <stdint.h>\nusing boolean = bool;\n');
    fs.writeFileSync(path.join(folder, 'ColorSensor.h'), '#pragma once\nstruct ColorSensor { int8_t begin(){return 0;} boolean ready(){return true;} };\n');
    for (const spec of [method('begin','int8_t'), method('ready','boolean')]) {
      const generated = compile(snapshot(spec));
      fs.writeFileSync(path.join(folder, 'program.cpp'), generated.code);
      execFileSync('c++', ['-std=c++11','-fsyntax-only','-I',folder,path.join(folder,'program.cpp')], {stdio:'pipe'});
    }
  } finally { fs.rmSync(folder, {recursive:true,force:true}); }
  console.log('C++ types passed: declared return/parameter types, saved metadata repair, scalar comparisons, live catalog refresh, workspace isolation, XML restoration, and native C++ compilation.');
})().catch(error => {console.error(error);process.exitCode = 1;});
