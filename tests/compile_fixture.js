/* Generate a sketch that exercises every supported block kind for real CLI checks. */
const assert = require('assert');
const fs = require('fs');
const { compile, supportedBlockTypes } = require('../frontend/compiler');
const { block, number, text, boolean, snapshot } = require('./test_compiler');
const get = id => block('variables_get', { VAR: { id } });
const print = value => block('text_print', {}, { TEXT: value });
const spec={header:'Arduino.h',library:'Fixture',owner:'String',qualifiedName:'String',name:'String',constructor:true,parameters:[],returnKind:'void',supported:true};
const withSpec=(type,signature,fields={},inputs={})=>{const item=block(type,fields,inputs);item.extraState={signature};if(type==='arduino_instance_call')item.extraState.statement=true;return item;};
const fixtureObject=withSpec('arduino_library_object',spec,{VAR:{id:'fixture'}});
const fixtureRef=withSpec('arduino_library_object_ref',{...spec,constructor:false},{VAR:{id:'fixture'}});
const items = [
  block('variables_set',{VAR:{id:'managedString'}},{VALUE:withSpec('arduino_library_value',spec)}),
  block('variables_set',{VAR:{id:'stringAlias'}},{VALUE:withSpec('arduino_class',spec)}),
  block('variables_set',{VAR:{id:'explicitPin'}},{VALUE:block('arduino_type',{TYPE:'int'})}),
  withSpec('arduino_instance_call',{...spec,constructor:false,qualifiedName:'String::length',name:'length',returnKind:'number',returnType:'unsigned int'},{VAR:{id:'stringAlias'}}),
  withSpec('arduino_library_call',{header:'Arduino.h',library:'Fixture',qualifiedName:'useFixture',name:'useFixture',parameters:[{type:'const String &',name:'object',kind:'cpp'}],returnKind:'void',supported:true},{},{ARG_0:get('stringAlias')}),

  withSpec('arduino_library_call',{header:'Arduino.h',library:'Fixture',qualifiedName:'useFixture',name:'useFixture',parameters:[{type:'const String &',name:'object',kind:'cpp'}],returnKind:'void',supported:true},{},{ARG_0:fixtureRef}),
  print(withSpec('arduino_library_value',{...spec,constructor:false,qualifiedName:'String::length',name:'length',returnType:'int',returnKind:'number'},{VAR:{id:'fixture'}})),
  print(withSpec('arduino_library_constant',{header:'Arduino.h',library:'Fixture',qualifiedName:'HIGH',name:'HIGH',kind:'number'})),
  block('arduino_serial_begin', { BAUD: 9600 }),
  block('arduino_cpp_statement', { CODE: 'libraryCounter += 1;' }),
  print(block('arduino_cpp_expression', { CODE: 'libraryCounter', RETURN_TYPE: 'number' })),
  block('variables_set', { VAR: { id: 'counter' } }, { VALUE: number(0) }),
  block('math_change', { VAR: { id: 'counter' } }, { DELTA: number(1) }),
  block('variables_set', { VAR: { id: 'label' } }, { VALUE: text('UTF-8 中文 " \\ \0') }),
  block('text_append', { VAR: { id: 'label' } }, { TEXT: number(7) }),
  print(block('text_length', {}, { VALUE: get('label') })),
  print(block('text_isEmpty', {}, { VALUE: get('label') })),
  print(block('logic_operation', { OP: 'AND' }, { A: boolean(true), B: block('logic_negate', {}, { BOOL: boolean(false) }) })),
  print(block('logic_ternary', {}, { IF: boolean(true), THEN: number(1), ELSE: number(2) })),
  print(block('math_modulo', {}, { DIVIDEND: number(-5), DIVISOR: number(3) })),
  print(block('math_constant', { CONSTANT: 'PI' })),
  block('arduino_pin_mode', { MODE: 'INPUT_PULLUP' }, { PIN: number(7) }),
  print(block('arduino_digital_read', {}, { PIN: number(7) })),
  print(block('arduino_analog_read', {}, { PIN: number(0) })),
  print(block('arduino_millis')),
  block('arduino_analog_write', {}, { PIN: number(9), VALUE: number(127) }),
  block('arduino_digital_write_value', {}, { PIN: block('arduino_pin',{PIN:'13'}), STATE: block('arduino_high_low',{LEVEL:'HIGH'}) }),
  block('arduino_tone', {}, { PIN: number(8), FREQUENCY: number(440), DURATION: number(10) }),
  block('arduino_no_tone', {}, { PIN: number(8) }),
  block('arduino_serial_print', { NEWLINE: 'FALSE' }, { VALUE: get('label') }),
  block('controls_repeat', { TIMES: 2 }, { DO: block('controls_flow_statements', { FLOW: 'CONTINUE' }) }),
  block('controls_repeat_ext', {}, { TIMES: number(2), DO: print(number(2)) }),
  block('controls_whileUntil', { MODE: 'WHILE' }, { BOOL: boolean(false), DO: print(number(0)) }),
  block('controls_whileUntil', { MODE: 'UNTIL' }, { BOOL: boolean(true), DO: print(number(0)) }),
  block('controls_for', { VAR: { id: 'counter' } }, { FROM: number(0), TO: number(3), BY: number(1), DO: print(get('counter')) }),
  block('controls_if', {}, { IF0: block('logic_compare', { OP: 'EQ' }, { A: number(1), B: number(1) }), DO0: print(text('yes')), ELSE: print(text('no')) }),
];
for (const op of ['ADD', 'MINUS', 'MULTIPLY', 'DIVIDE', 'POWER']) items.push(print(block('math_arithmetic', { OP: op }, { A: number(3), B: number(2) })));
for (const op of ['ROOT', 'ABS', 'NEG', 'LN', 'LOG10', 'EXP', 'POW10']) items.push(print(block('math_single', { OP: op }, { NUM: number(3) })));
for (const op of ['ROUND', 'ROUNDUP', 'ROUNDDOWN']) items.push(print(block('math_round', { OP: op }, { NUM: number(3.5) })));
const join = block('text_join', {}, { ADD0: text('value='), ADD1: number(5) });join.extraState={itemCount:2};items.push(print(join));
for (let i = 0; i < items.length - 1; i++) items[i].next = { block: items[i + 1] };
const state = snapshot(fixtureObject,block('arduino_cpp_declaration',{CODE:'void useFixture(const String &) {}'}),block('arduino_include', {HEADER:'Wire.h'}), block('arduino_cpp_declaration', {CODE:'int libraryCounter = 0;'}), block('arduino_setup', {}, { DO: items[0] }), block('arduino_loop', {}, { DO:
  block('arduino_digital_write', { LEVEL: 'HIGH' }, { PIN: block('arduino_builtin_led') }, block('arduino_delay', {}, { MS: number(1) })) }));
state.variables.push({id:'explicitPin',name:'explicitPin'},{id:'managedString',name:'managedString'},{id:'stringAlias',name:'stringAlias'},{ id: 'label', name: 'class' },{id:'fixture',name:'fixture',type:'arduino-object:String'});
const generated = compile(state);
assert.deepStrictEqual(generated.diagnostics, []);
const visited = new Set();
function visit(block) {
  if (!block) return;
  visited.add(block.type);
  Object.values(block.inputs || {}).forEach(input => visit(input.block || input.shadow));
  if (block.next) visit(block.next.block || block.next.shadow);
}
state.blocks.blocks.forEach(visit);
assert.deepStrictEqual(supportedBlockTypes.filter(type => !visited.has(type)), [], 'fixture must exercise every supported block');
if (process.argv[2]) fs.writeFileSync(process.argv[2], generated.code);
console.log('Full Arduino block subset fixture generated without diagnostics.');
