/* In/Out migration: real Blockly definitions, event semantics, and C++ fixtures. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compile, supportedBlockTypes } = require('../frontend/compiler');
const { build } = require('../frontend/toolbox');
const host = path.resolve(__dirname, '../../blockly');
const Blockly = require(path.join(host, 'node_modules/blockly'));
const definitions = require('../blocks/blocks.json');
Blockly.defineBlocksWithJsonArray(definitions.filter(definition=>!Blockly.Blocks[definition.type]).map(({python, ...definition}) => definition));
const workspace = new Blockly.Workspace();
const io = build({kind:'categoryToolbox',contents:[]}).contents.find(item => item.name === 'I/O').contents;
const oldOrder = ['arduino_high_low','arduino_digital_write_value','arduino_digital_read','arduino_analog_write','arduino_analog_read',
  'arduino_soft_pwm_write','arduino_soft_pwm_stop','arduino_button_event','arduino_attach_interrupt','arduino_detach_interrupt',
  'arduino_attach_pin_change_interrupt','arduino_detach_pin_change_interrupt','arduino_pulse_in','arduino_pulse_in_timeout','arduino_pin_mode','arduino_shift_out'];
assert.deepStrictEqual(io.slice(0,16).map(item=>item.type), oldOrder);
for (const entry of io) {
  const node = Blockly.serialization.blocks.append(entry, workspace);
  assert.strictEqual(node.type, entry.type);
}
const saved = Blockly.serialization.workspaces.save(workspace);
const restored = new Blockly.Workspace();
Blockly.serialization.workspaces.load(saved,restored);
assert.deepStrictEqual(Blockly.serialization.workspaces.save(restored),saved);
const buttonNode = restored.getBlocksByType('arduino_button_event',false)[0];
assert.strictEqual(buttonNode.previousConnection,null);
assert.strictEqual(buttonNode.nextConnection,null);
assert.strictEqual(buttonNode.getField('EVENT').getOptions(false).length,5);
workspace.dispose();restored.dispose();

let sequence = 0;
function block(type, fields={}, inputs={}) {
  return {type,id:'io_'+(++sequence),fields,inputs:Object.fromEntries(Object.entries(inputs).map(([key,value])=>[key,{block:value}]))};
}
const num = NUM => block('math_number',{NUM});
const pin = PIN => block('arduino_pin',{PIN:String(PIN)});
const change = () => block('math_change',{VAR:{id:'count'}},{DELTA:num(1)});
function chain(...items) { items.forEach((item,index)=>{if(items[index+1])item.next={block:items[index+1]}});return items[0]; }
const snapshot = (...items) => ({variables:[{id:'count',name:'count'}],blocks:{languageVersion:0,blocks:items}});
function valid(state) { const result=compile(state);assert.deepStrictEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));return result.code; }
function event(EVENT='attachClick',ACTIVE_LEVEL='LOW',PIN=4) { return block('arduino_button_event',{EVENT,ACTIVE_LEVEL},{PIN:pin(PIN),DO:change()}); }
const addressCall = block('arduino_library_call',{}, {ARG_0:block('arduino_address_of',{VAR:{id:'count'}})});
addressCall.extraState={signature:{header:'Arduino.h',library:'Fixture',qualifiedName:'recordCount',name:'recordCount',parameters:[{type:'volatile int *',name:'count',kind:'cpp'}],returnType:'void',supported:true}};
const setup = chain(
  block('variables_set',{VAR:{id:'count'}},{VALUE:block('arduino_type',{TYPE:'int'})}),
  addressCall,
  block('arduino_attach_interrupt',{MODE:'FALLING'},{PIN:block('arduino_interrupt_pin',{PIN:'2'}),DO:change()}),
  block('arduino_detach_interrupt',{}, {PIN:pin(2)}),
  block('arduino_attach_pin_change_interrupt',{MODE:'CHANGE'},{PIN:pin(10),DO:change()}),
  block('arduino_detach_pin_change_interrupt',{}, {PIN:pin(10)}),
  block('arduino_shift_out',{ORDER:'MSBFIRST'},{VALUE:num(165),DATA_PIN:pin(11),CLOCK_PIN:pin(12)}),
);
const loop = chain(
  block('arduino_soft_pwm_write',{}, {PIN:pin(5),VALUE:num(128)}),
  block('arduino_soft_pwm_stop',{}, {PIN:pin(5)}),
  block('text_print',{}, {TEXT:block('arduino_pulse_in',{LEVEL:'HIGH'},{PIN:pin(7)})}),
  block('text_print',{}, {TEXT:block('arduino_pulse_in_timeout',{LEVEL:'LOW'},{PIN:pin(7),TIMEOUT:num(1000000)})}),
);
const state=snapshot(block('arduino_cpp_declaration',{CODE:'void recordCount(volatile int *) {}'}),block('arduino_setup',{}, {DO:setup}),block('arduino_loop',{}, {DO:loop}),
  ...['attachClick','attachDoubleClick','attachLongPressStart','attachDuringLongPress','attachLongPressStop'].map(mode=>event(mode)),event('attachClick','HIGH',6));
const before=JSON.stringify(state);
const code=valid(state);
assert.strictEqual(JSON.stringify(state),before);
assert.strictEqual((code.match(/#include <SoftPWM.h>/g)||[]).length,1);
assert.strictEqual((code.match(/SoftPWMBegin\(\);/g)||[]).length,1);
assert.match(code,/void setup\(\) \{[\s\S]*SoftPWMBegin\(\);/);
assert.match(code,/void loop\(\) \{\n  sx_button_1.tick\(\);\n  sx_button_2.tick\(\);/);
assert.strictEqual((code.match(/OneButton sx_button_\d/g)||[]).length,2,'all five events share one object on pin 4');
assert.match(code,/OneButton sx_button_1\(4, true, true\)/);
assert.match(code,/OneButton sx_button_2\(6, false, false\)/);
assert.match(code,/volatile int v_count = 0/);
assert.match(code,/attachInterrupt\(digitalPinToInterrupt\(2\), sx_handler_\d+, FALLING\)/);
assert.match(code,/PCintPort::attachInterrupt\(10, sx_handler_\d+, CHANGE\)/);
assert.match(code,/PCintPort::detachInterrupt\(10\)/);
assert.match(code,/detachInterrupt\(digitalPinToInterrupt\(2\)\)/);
assert.match(code,/shiftOut\(11, 12, MSBFIRST, 165\)/);
assert.match(code,/void setup\(\) \{\n  pinMode\(2, INPUT\);/,'the last attach/detach request supplies the startup mode, as in BlockFactory');
assert.match(code,/pinMode\(12, OUTPUT\)/);
assert.match(code,/pulseIn\(7, HIGH\)/);
assert.match(code,/pulseIn\(7, LOW, /);
assert.strictEqual((code.match(/pinMode\(7, INPUT\)/g)||[]).length,1,'pulse blocks share one startup mode');
assert.ok(!code.includes('sx_pin')&&!code.includes('sx_data_pin')&&!code.includes('studioxPulseIn'),'fixed pins need no temporaries or pulse helper');
assert.match(code,/SoftPWMSet\(5, constrain\(128, 0, 255\)\)/);
assert.match(code,/SoftPWMEnd\(5\)/);
const setupBody=code.split('void setup() {')[1].split('void loop()')[0];
assert.ok(setupBody.indexOf('pinMode(7, INPUT)')<setupBody.indexOf('Serial.begin'));
assert.ok(setupBody.indexOf('pinMode(7, INPUT)')<setupBody.indexOf('SoftPWMBegin'));
assert.ok(!code.split('void loop() {')[1].includes('pinMode('),'literal pulse reads no longer reconfigure pins in Loop');
assert.ok(code.indexOf('void sx_handler_1();')<code.indexOf('void sx_handler_1() {'));
for (const mode of ['attachClick','attachDoubleClick','attachLongPressStart','attachDuringLongPress','attachLongPressStop']) assert.match(code,new RegExp('sx_button_1\\.'+mode+'\\(sx_handler_'));

// Pin configuration is startup work; attach/detach/shift/pulse stay in their branches.
const interruptPair=block('controls_if',{}, {IF0:block('logic_boolean',{BOOL:'TRUE'}),DO0:chain(
  block('arduino_attach_interrupt',{MODE:'RISING'},{PIN:num(2)}),
  block('arduino_attach_pin_change_interrupt',{MODE:'RISING'},{PIN:pin(10)}),
  block('arduino_shift_out',{ORDER:'LSBFIRST'},{DATA_PIN:pin(11),CLOCK_PIN:pin(12),VALUE:num(42)}),
)});
const placed=valid(snapshot(block('arduino_setup'),block('arduino_loop',{}, {DO:interruptPair})));
assert.match(placed,/void setup\(\) \{\n  pinMode\(2, INPUT_PULLUP\);\n  pinMode\(10, INPUT\);\n  pinMode\(11, OUTPUT\);\n  pinMode\(12, OUTPUT\);\n\}/);
assert.match(placed,/void loop\(\) \{\n  if \(true\) \{\n    attachInterrupt\(digitalPinToInterrupt\(2\), sx_handler_1, RISING\);\n    PCintPort::attachInterrupt\(10, sx_handler_2, RISING\);\n    shiftOut\(11, 12, LSBFIRST, 42\);/);
const explicit=valid(snapshot(block('arduino_setup',{}, {DO:chain(
  block('arduino_pin_mode',{MODE:'OUTPUT'},{PIN:pin(2)}),
  block('arduino_attach_interrupt',{MODE:'RISING'},{PIN:pin(2)})
)})));
assert.match(explicit,/pinMode\(2, INPUT_PULLUP\);\n  pinMode\(2, OUTPUT\);\n  attachInterrupt/,'an explicit pin-mode block remains at its own position');
const defaultMode=block('arduino_pin_mode',{MODE:'OUTPUT'});
defaultMode.inputs.PIN={shadow:num(7)};
assert.match(valid(snapshot(defaultMode)),/pinMode\(7, OUTPUT\);/,'default numeric shadows need no conversion');
assert.match(valid(snapshot(block('arduino_pin_mode',{MODE:'INPUT'},{PIN:pin('A0')}))),/pinMode\(A0, INPUT\);/);
assert.match(valid(snapshot(block('arduino_pin_mode',{MODE:'OUTPUT'},{PIN:block('variables_get',{VAR:{id:'count'}})}))),/pinMode\(\(uint8_t\)\(v_count\), OUTPUT\);/,'runtime pin conversion is retained');
const analogPin=valid(snapshot(block('arduino_loop',{}, {DO:block('text_print',{}, {TEXT:block('arduino_pulse_in',{}, {PIN:pin('A0')})})})));
assert.match(analogPin,/pinMode\(A0, INPUT\)/);assert.match(analogPin,/pulseIn\(A0, HIGH\)/);
const dynamicPin=()=>block('arduino_cpp_expression',{CODE:'nextPin()',RETURN_TYPE:'number'});
const dynamicSource=valid(snapshot(
  block('arduino_cpp_declaration',{CODE:'int nextPin() { return 2; }'}),
  block('arduino_setup'),
  block('arduino_loop',{}, {DO:chain(
    block('variables_set',{VAR:{id:'count'}},{VALUE:num(2)}),
    block('arduino_attach_interrupt',{MODE:'RISING'},{PIN:block('variables_get',{VAR:{id:'count'}})}),
    block('arduino_detach_interrupt',{}, {PIN:dynamicPin()}),
    block('arduino_attach_pin_change_interrupt',{}, {PIN:dynamicPin()}),
    block('arduino_detach_pin_change_interrupt',{}, {PIN:dynamicPin()}),
    block('arduino_shift_out',{}, {DATA_PIN:dynamicPin(),CLOCK_PIN:pin(12),VALUE:num(7)}),
    block('text_print',{}, {TEXT:block('arduino_pulse_in',{}, {PIN:dynamicPin()})})
  )})
));
const dynamicLoop=dynamicSource.split('void loop() {')[1];
assert.ok(dynamicLoop.indexOf('v_count = 2;')<dynamicLoop.indexOf('pinMode(sx_pin_0, INPUT_PULLUP)'));
assert.strictEqual((dynamicLoop.match(/nextPin\(\)/g)||[]).length,5,'runtime pin expressions are evaluated once per block');
assert.match(dynamicSource,/void setup\(\) \{\n  pinMode\(12, OUTPUT\);\n  Serial.begin\(9600\);\n\}/,'runtime pin values must not be configured before their assignments');
assert.match(dynamicSource,/static unsigned long studioxPulseIn/,'only calculated pulse pins keep the runtime helper');

const duplicate=compile(snapshot(event(),event()));
assert.ok(duplicate.diagnostics.some(item=>/already has a handler/.test(item.message)));
assert.ok(compile(snapshot(event(),event('attachDoubleClick','HIGH'))).diagnostics.some(item=>/same pressed level/.test(item.message)));
const dynamic=event();dynamic.inputs.PIN={block:block('arduino_millis')};
assert.ok(compile(snapshot(dynamic)).diagnostics.some(item=>/fixed pin/.test(item.message)));
const nonInteger=event();nonInteger.inputs.PIN={block:num(1.5)};
assert.ok(compile(snapshot(nonInteger)).diagnostics.some(item=>/whole number/.test(item.message)));
assert.ok(compile(snapshot(block('arduino_setup',{}, {DO:event()}))).diagnostics.some(item=>/top level/.test(item.message)));
const interrupt=block('arduino_attach_interrupt',{MODE:'RISING'},{PIN:pin(2),DO:block('controls_flow_statements',{FLOW:'BREAK'})});
assert.ok(compile(snapshot(block('controls_repeat_ext',{}, {TIMES:num(2),DO:interrupt}))).diagnostics.some(item=>/inside a loop/.test(item.message)),'callbacks cannot break a loop outside their function');
interrupt.inputs.DO={block:block('controls_repeat_ext',{}, {TIMES:num(2),DO:block('controls_flow_statements',{FLOW:'BREAK'})})};
valid(snapshot(interrupt));
const disabled=event();disabled.enabled=false;
assert.ok(!valid(snapshot(disabled)).includes('OneButton'));
const disabledPWM=block('arduino_soft_pwm_write');disabledPWM.enabled=false;
assert.ok(!valid(snapshot(disabledPWM)).includes('SoftPWM'));
assert.ok(!valid(snapshot(block('arduino_setup'))).includes('SoftPWM'));
const bothTimers=snapshot(block('arduino_soft_pwm_stop',{}, {PIN:pin(5)}),block('arduino_tone',{}, {PIN:pin(8),FREQUENCY:num(440),DURATION:num(100)}));
assert.ok(compile(bothTimers).diagnostics.some(item=>/Timer2/.test(item.message)));
bothTimers.blocks.blocks[1]=block('arduino_no_tone',{}, {PIN:pin(8)});
assert.ok(compile(bothTimers).diagnostics.some(item=>/Timer2/.test(item.message)),'stop-tone also links the AVR Timer2 handler');
const badMode=block('arduino_attach_interrupt',{MODE:'RISING); invalid()'},{PIN:pin(2)});
assert.ok(compile(snapshot(badMode)).diagnostics.some(item=>/valid mode/.test(item.message)));
assert.ok(!compile(snapshot(badMode)).code.includes('invalid()'));
const missing=block('arduino_pulse_in_timeout',{}, {PIN:pin(7)});
assert.ok(compile(snapshot(block('text_print',{}, {TEXT:missing}))).diagnostics.some(item=>/TIMEOUT/.test(item.message)));

const baseline=require('./compile_fixture');
const visited=new Set(baseline.visited);
function visit(item) { if(!item)return;visited.add(item.type);Object.values(item.inputs||{}).forEach(input=>visit(input.block||input.shadow));visit(item.next?.block); }
state.blocks.blocks.forEach(visit);
module.exports={visited}; // The Control fixture extends the combined coverage set.
if(require.main===module && process.argv[2])fs.writeFileSync(process.argv[2],code);
if(require.main===module && process.argv[3])fs.writeFileSync(process.argv[3],dynamicSource);
console.log('In/Out passed: all 16 equivalents, Blockly round trips, five shared button events, automatic polling, callbacks, interrupt variables, PWM, pulse timing, shiftOut, and diagnostics.');
