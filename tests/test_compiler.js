const assert = require('assert');
const { compile, supportedBlockTypes } = require('../frontend/compiler');
let next = 0;
const number = value => ({ type: 'math_number', id: 'n' + ++next, fields: { NUM: value } });
const text = value => ({ type: 'text', id: 't' + ++next, fields: { TEXT: value } });
const boolean = value => ({ type: 'logic_boolean', id: 'b' + ++next, fields: { BOOL: value ? 'TRUE' : 'FALSE' } });
function block(type, fields = {}, inputs = {}, nextBlock) {
  const state = { type, id: type + '_' + ++next, fields, inputs: {} };
  for (const [key, value] of Object.entries(inputs)) state.inputs[key] = { block: value };
  if (nextBlock) state.next = { block: nextBlock };
  return state;
}
function snapshot(...blocks) { return { blocks: { languageVersion: 0, blocks }, variables: [{ name: 'counter', id: 'counter' }] }; }
function valid(state) {
  const result = compile(state);
  assert.deepStrictEqual(result.diagnostics, [], JSON.stringify(result.diagnostics));
  return result;
}
const led = () => block('arduino_builtin_led');
const blink = snapshot(
  block('arduino_setup', {}, { DO: block('arduino_pin_mode', { MODE: 'OUTPUT' }, { PIN: led() }) }),
  block('arduino_loop', {}, { DO: block('arduino_digital_write', { LEVEL: 'HIGH' }, { PIN: led() },
    block('arduino_delay', {}, { MS: number(500) },
      block('arduino_digital_write', { LEVEL: 'LOW' }, { PIN: led() }, block('arduino_delay', {}, { MS: number(500) })))) }),
);
const beforeBlink = JSON.stringify(blink);
const generated = valid(blink).code;
assert.match(generated, /void setup\(\) \{\n  pinMode/);
assert.match(generated, /void loop\(\) \{\n  digitalWrite/);
assert.match(generated, /delay/);
assert.strictEqual((generated.match(/digitalWrite/g) || []).length, 2);
assert.strictEqual(JSON.stringify(blink), beforeBlink, 'compiler must not mutate input');

// Unknown robot, Python, camera, library, and function blocks remain errors.
for (const type of ['setup_robot', 'raw', 'import_module', 'camera_setup', 'lists_create_with', 'procedures_defnoreturn']) {
  const item = block(type);
  const result = compile(snapshot(item));
  assert.ok(result.diagnostics.some(issue => issue.blockId === item.id && /Unsupported/.test(issue.message)));
}
const disabled = block('camera_setup', {}, { VALUE: block('raw') }, block('arduino_delay', {}, { MS: number(1) }));
disabled.enabled = false;
valid(snapshot(disabled));
disabled.enabled = true; disabled.disabledReasons = ['MANUALLY_DISABLED'];
valid(snapshot(disabled));

// Real blocks replace dormant shadows; unsupported dormant shadows must not fail.
const write = block('arduino_delay');
write.inputs.MS = { block: number(10), shadow: block('raw') };
valid(snapshot(write));

const compare = block('logic_compare', { OP: 'GT' }, { A: number(5), B: number(2) });
const arithmetic = block('math_arithmetic', { OP: 'ADD' }, { A: number(3), B: number(4) });
const set = block('variables_set', { VAR: { id: 'counter' } }, { VALUE: arithmetic });
set.next = { block: block('controls_if', {}, { IF0: compare,
  DO0: block('text_print', {}, { TEXT: block('variables_get', { VAR: { id: 'counter' } }) }),
  ELSE: block('text_print', {}, { TEXT: text('No') }) }) };
const conditional = valid(snapshot(set)).code;
assert.match(conditional, /double v_counter = 0/);
assert.match(conditional, /Serial.begin\(9600\)/);
assert.match(conditional, /else \{/);

const conflict = snapshot(block('variables_set', { VAR: { id: 'counter' } }, { VALUE: number(3) },
  block('variables_set', { VAR: { id: 'counter' } }, { VALUE: text('wrong') })));
assert.ok(compile(conflict).diagnostics.some(item => /type/.test(item.message)));
const typeMismatch = block('arduino_delay', {}, { MS: text('not a duration') });
assert.ok(compile(snapshot(typeMismatch)).diagnostics.some(item => item.blockId === typeMismatch.inputs.MS.block.id));
assert.ok(compile(snapshot(block('controls_flow_statements', { FLOW: 'BREAK' }))).diagnostics.length);
assert.ok(compile(snapshot(block('arduino_loop', {}, { DO: block('controls_flow_statements', { FLOW: 'BREAK' }) }))).diagnostics.length);
valid(snapshot(block('controls_repeat_ext', {}, { TIMES: number(3), DO: block('controls_flow_statements', { FLOW: 'CONTINUE' }) })));
const forLoop = valid(snapshot(block('controls_for', { VAR: { id: 'counter' } }, {
  FROM: number(5), TO: number(1), BY: number(1), DO: block('text_print', {}, { TEXT: block('variables_get', { VAR: { id: 'counter' } }) }),
}))).code;
assert.match(forLoop, /_up/);
assert.match(forLoop, /_step > 0/);
assert.ok(compile(snapshot(block('controls_for', { VAR: { id: 'counter' } }, { FROM: number(0), TO: number(5), BY: number(0) }))).diagnostics.length);
assert.ok(compile(snapshot(block('arduino_delay'))).diagnostics.some(item => /Connect a value/.test(item.message)));
assert.ok(compile(snapshot(number(5))).diagnostics.some(item => /Connect this value/.test(item.message)));
assert.ok(compile(snapshot(block('arduino_setup'), block('arduino_setup'))).diagnostics.some(item => /only one/.test(item.message)));
assert.ok(compile(snapshot(block('controls_repeat_ext', {}, { TIMES: number(3), DO: block('arduino_loop') }))).diagnostics.some(item => /top level/.test(item.message)));
assert.ok(compile(snapshot()).diagnostics.length);

// Text escaping must not inject C++ even for quotes, NUL, and Unicode.
const malicious = '\"); digitalWrite(1, HIGH); //\n\0中文';
const stringCode = valid(snapshot(block('text_print', {}, { TEXT: text(malicious) }))).code;
assert.ok(!stringCode.includes('\0'));
assert.match(stringCode, /\\000/);
assert.match(stringCode, /\\344/);
const joined = block('text_join', {}, { ADD0: text('n='), ADD1: number(4) });
joined.extraState = { itemCount: 2 };
valid(snapshot(block('text_print', {}, { TEXT: joined })));
for (const op of ['ADD','MINUS','MULTIPLY','DIVIDE','POWER']) {
  valid(snapshot(block('text_print', {}, { TEXT: block('math_arithmetic', { OP: op }, { A: number(5), B: number(2) }) })));
}
for (const op of ['ROOT','ABS','NEG','LN','LOG10','EXP','POW10']) {
  valid(snapshot(block('text_print', {}, { TEXT: block('math_single', { OP: op }, { NUM: number(3) }) })));
}
assert.ok(supportedBlockTypes.includes('arduino_pin_mode'));
if (require.main === module && process.argv[2]) {
  require('fs').writeFileSync(process.argv[2], generated);
}
console.log('Arduino compiler passed: Blink, basic control flow, fixed variable types, loop context, disabled blocks, dormant shadows, unsupported blocks, and C++ string escaping.');
module.exports = { blink, generated, snapshot, block, number, text, boolean, valid };

const pin = name => block('arduino_pin', { PIN: name });
const gpioSteps = [
  block('arduino_pin_mode',{MODE:'INPUT_PULLUP'},{PIN:pin('2')}),
  block('arduino_digital_write_value',{}, {PIN:pin('13'),STATE:block('arduino_digital_read',{}, {PIN:pin('2')})}),
  block('arduino_analog_write',{}, {PIN:pin('9'),VALUE:number(128)}),
  block('arduino_tone',{}, {PIN:pin('8'),FREQUENCY:number(440),DURATION:number(1000)}),
  block('arduino_no_tone',{}, {PIN:pin('8')}),
];
gpioSteps.forEach((item,index)=>{if(gpioSteps[index+1]) item.next={block:gpioSteps[index+1]}});
const gpio = valid(snapshot(block('arduino_setup', {}, { DO:gpioSteps[0] }))).code;
assert.match(gpio,/INPUT_PULLUP/);assert.match(gpio,/\? HIGH : LOW/);assert.match(gpio,/tone\(/);assert.match(gpio,/noTone\(/);
valid(snapshot(block('variables_set',{VAR:{id:'counter'}},{VALUE:block('arduino_analog_read',{}, {PIN:pin('A0')})})));
valid(snapshot(block('arduino_digital_write_value',{}, {PIN:pin('13'),STATE:block('arduino_high_low',{LEVEL:'LOW'})})));
for (const invalid of ['256','-1','A99','13;evil()','GP15']) assert.ok(compile(snapshot(block('arduino_no_tone',{}, {PIN:pin(invalid)}))).diagnostics.some(item=>/pin number/.test(item.message)));
console.log('GPIO compiler passed: named pins, analog aliases, conditional digital output, state values, PWM, tone, and input validation.');


const libraryProgram = snapshot(
  block('arduino_include',{HEADER:'Servo.h'}),
  block('arduino_include',{HEADER:'Servo.h'}),
  block('arduino_cpp_declaration',{CODE:'Servo myServo;'}),
  block('arduino_setup',{}, {DO:block('arduino_cpp_statement',{CODE:'myServo.attach(9);'})}),
  block('arduino_loop',{}, {DO:block('arduino_cpp_statement',{CODE:'myServo.write(90);'}, {},
    block('text_print',{}, {TEXT:block('arduino_cpp_expression',{CODE:'myServo.read()',RETURN_TYPE:'number'})}))}),
);
const libraryCode=valid(libraryProgram).code;
assert.strictEqual((libraryCode.match(/#include <Servo.h>/g)||[]).length,1);
assert.ok(libraryCode.indexOf('#include <Servo.h>')<libraryCode.indexOf('Servo myServo;'));
assert.ok(libraryCode.indexOf('Servo myServo;')<libraryCode.indexOf('void setup()'));
assert.match(libraryCode,/myServo.attach\(9\);/);assert.match(libraryCode,/myServo.read\(\)/);
for(const header of ['../escape.h','bad>\n#include <evil','https://host/file.h','/absolute.h','sub/../evil.h']) {
 assert.ok(compile(snapshot(block('arduino_include',{HEADER:header}))).diagnostics.some(item=>/header name/.test(item.message)));
}
assert.ok(compile(snapshot(block('arduino_setup',{}, {DO:block('arduino_include',{HEADER:'Servo.h'})}))).diagnostics.some(item=>/top level/.test(item.message)));
assert.ok(compile(snapshot(block('arduino_setup',{}, {DO:block('arduino_cpp_declaration',{CODE:'int x;'})}))).diagnostics.some(item=>/top level/.test(item.message)));
assert.ok(compile(snapshot(block('arduino_cpp_statement',{CODE:''}))).diagnostics.some(item=>/Enter C\+\+/.test(item.message)));
valid(snapshot(block('arduino_digital_write_value',{}, {PIN:pin('13'),STATE:block('arduino_cpp_expression',{CODE:'true',RETURN_TYPE:'boolean'})})));
console.log('Library code generation passed: deduplicated includes, global declarations, native statements/typed expressions, placement, and invalid headers.');


const constructorSignature={header:'Servo.h',library:'Servo',owner:'Servo',qualifiedName:'Servo',name:'Servo',constructor:true,parameters:[],returnKind:'void',supported:true};
const callSignature={...constructorSignature,constructor:false,name:'write',qualifiedName:'Servo::write',returnType:'void',parameters:[{type:'int',name:'angle',kind:'number'}]};
function apiBlock(type,spec,fields={},inputs={}){const item=block(type,fields,inputs);item.extraState={signature:spec};return item;}
const constructorBlock=apiBlock('arduino_library_object',constructorSignature,{VAR:{id:'servo'}});
const methodBlock=apiBlock('arduino_library_call',callSignature,{VAR:{id:'servo'}},{ARG_0:number(90)});
const apiState=snapshot(constructorBlock,block('arduino_setup',{}, {DO:methodBlock}));
apiState.variables.push({id:'servo',name:'arm',type:'arduino-object:Servo'});
const apiCode=valid(apiState).code;
assert.match(apiCode,/#include <Servo.h>/);assert.match(apiCode,/Servo obj_arm;/);assert.match(apiCode,/obj_arm.write\(\(int\)\(90\)\);/);
const missingObject=snapshot(block('arduino_loop',{}, {DO:methodBlock}));missingObject.variables=apiState.variables;
assert.ok(compile(missingObject).diagnostics.some(item=>/Create a Servo object/.test(item.message)));
const unsupportedSignature={...callSignature,supported:false,reason:'Templates need Advanced C++.'};
assert.ok(compile(snapshot(apiBlock('arduino_library_call',unsupportedSignature))).diagnostics.some(item=>/Templates/.test(item.message)));
const rawCpp=block('arduino_cpp_expression',{CODE:'nullptr',RETURN_TYPE:'cpp'});
valid(snapshot(apiBlock('arduino_library_call',{header:'Test.h',library:'Test',qualifiedName:'takePointer',name:'takePointer',parameters:[{name:'pointer',type:'void *',kind:'cpp'}],returnKind:'void'}, {}, {ARG_0:rawCpp})));
console.log('Generated API calls passed: automatic headers, object declarations, typed arguments, missing instances, unsupported signatures, and C++ pointer slots.');
