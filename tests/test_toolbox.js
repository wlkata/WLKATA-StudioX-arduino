const assert = require('assert');
const { build } = require('../frontend/toolbox');
const original={kind:'categoryToolbox',contents:[{kind:'category',name:'Logic',contents:[]},{kind:'category',name:'Python',contents:[{kind:'block',type:'raw'}]},{kind:'category',name:'json',contents:[{kind:'block',type:'library_function_call'}]},{kind:'category',name:'Workflows',contents:[{kind:'block',type:'workflow_run'}]},{kind:'category',name:'Arduino',contents:[]}]};
const before=JSON.stringify(original);
const toolbox=build(original);
assert.strictEqual(JSON.stringify(original),before);
assert.deepStrictEqual(toolbox.contents.map(item=>item.name || item.kind),['Logic','sep','I/O','Timing','Serial','Libraries / C++']);
assert.ok(!toolbox.contents.some(item=>item.name==='Arduino'));
const io=toolbox.contents.find(item=>item.name==='I/O');
assert.ok(io.contents.find(item=>item.type==='arduino_digital_write_value').inputs.STATE.shadow);
assert.strictEqual(io.contents.find(item=>item.type==='arduino_analog_read').inputs.PIN.shadow.fields.PIN,'A0');
console.log('Arduino toolbox passed: independent category structure and editable I/O defaults.');

assert.ok(!toolbox.contents.some(item=>['Python','json','Workflows'].includes(item.name)));
assert.ok(original.contents.some(item=>item.name==='Python'));
console.log('Python toolbox filtering passed: hidden only in Arduino; source configuration remains unchanged.');

const ctor={owner:'Servo',qualifiedName:'Servo',name:'Servo',constructor:true,parameters:[],returnKind:'void',header:'Servo.h',library:'Servo',supported:true};
const method={...ctor,constructor:false,name:'write',qualifiedName:'Servo::write',parameters:[{name:'angle',type:'int',kind:'number'}]};
const rich=build(original,{libraries:[{name:'Servo',headers:[{name:'Servo.h',functions:[ctor,method],constants:[]}]}]});
const libraries=rich.contents.find(item=>item.name==='Libraries / C++');
const header=libraries.contents.find(item=>item.name==='Servo').contents.find(item=>item.name==='Servo.h');
assert.strictEqual(header.contents.length,2);
assert.strictEqual(header.contents[0].type,'arduino_class');
assert.strictEqual(header.contents[0].extraState.options.length,1);
assert.ok(!header.contents.some(item=>item.type==='arduino_library_object'));
assert.strictEqual(header.contents[0].extraState.signature.name,'Servo');
assert.ok(!toolbox.contents.some(item=>item.name==='Program'));
assert.ok(libraries.contents.find(item=>item.name==='Manage libraries').contents.some(item=>item.kind==='button'));
console.log('Library toolbox passed: three category levels, per-header signatures, manage action, advanced C++, and no Program/Python/Workflows.');

assert.strictEqual(header.contents[1].type,'arduino_instance_call');
assert.strictEqual(header.contents[1].extraState.signature.name,'write');
