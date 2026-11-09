/* Run generated Math/Logic C++ on the host and compile the same source for AVR. */
const assert=require('assert'),fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const Blockly=require(path.resolve(__dirname,'../../blockly/node_modules/blockly'));
require(path.resolve(__dirname,'../../blockly/node_modules/blockly/blocks'));
const {compile,supportedBlockTypes}=require('../frontend/compiler'),{build}=require('../frontend/toolbox'),types=require('../frontend/cppTypes');
Blockly.defineBlocksWithJsonArray(require('../blocks/blocks.json').filter(definition=>!Blockly.Blocks[definition.type]).map(({python,...definition})=>definition));
let id=0;
const b=(type,fields={},inputs={})=>({type,id:'math_'+(++id),fields,inputs:Object.fromEntries(Object.entries(inputs).map(([name,block])=>[name,{block}]))});
const num=NUM=>b('math_number',{NUM}),bool=BOOL=>b('logic_boolean',{BOOL:BOOL?'TRUE':'FALSE'}),get=(name='count')=>b('variables_get',{VAR:{id:name}});
const inc=()=>b('arduino_increment_value',{VAR:{id:'count'},OP:'INC'});
const chain=(...items)=>{items.forEach((item,index)=>{if(items[index+1])item.next={block:items[index+1]}});return items[0];};
const state=(...blocks)=>({variables:[{id:'count',name:'count'},{id:'rng',name:'rng'},{id:'mixed',name:'mixed'}],blocks:{languageVersion:0,blocks}});
const steps=[],expected=[];
function out(value,result) {steps.push(b('text_print',{}, {TEXT:value}));expected.push(result);}
steps.push(b('variables_set',{VAR:{id:'count'}},{VALUE:b('arduino_type',{TYPE:'int'})}),b('variables_set',{VAR:{id:'rng'}},{VALUE:b('arduino_type',{TYPE:'long'})}),b('variables_set',{VAR:{id:'count'}},{VALUE:num(10)}));
for(const [OP,amount,value] of [['ADD',3,13],['SUB',1,12],['MUL',2,24],['DIV',4,6]]) {steps.push(b('arduino_variable_operation',{VAR:{id:'count'},OP},{VALUE:num(amount)}));out(get(),value);}
out(inc(),7);out(b('arduino_increment_value',{VAR:{id:'count'},OP:'DEC'}),6);
steps.push(b('math_change',{VAR:{id:'count'}},{DELTA:num(1)}));out(get(),7);
steps.push(b('math_change',{VAR:{id:'count'}},{DELTA:num(-1)}));out(get(),6);
out(b('logic_compare',{OP:'EQ'},{A:b('arduino_sizeof',{}, {VALUE:b('arduino_type',{TYPE:'int'})}),B:b('arduino_sizeof',{}, {VALUE:get()})}),1);
out(b('arduino_sizeof',{}, {VALUE:inc()}),{positive:true});out(get(),6);
out(b('arduino_min_max',{OP:'MIN'},{A:inc(),B:num(100)}),7);out(get(),7);
out(b('arduino_min_max',{OP:'MAX'},{A:inc(),B:num(4)}),8);out(get(),8);
out(b('arduino_square',{}, {NUM:inc()}),81);out(get(),9);
for(const [OP,A,B,result] of [['AND',12,10,8],['OR',12,10,14],['XOR',12,10,6],['SHL',1,20,1048576],['SHL',1,31,-2147483648],['SHR',-8,1,-4]])out(b('arduino_bitwise',{OP},{A:num(A),B:num(B)}),result);
out(b('arduino_bit_not',{}, {NUM:num(0)}),-1);
out(num(-2147483648),-2147483648);out(num(4294967295),4294967295);
out(b('arduino_remainder',{}, {A:num(-5),B:num(2)}),-1);
out(b('arduino_remainder',{}, {A:num(-2147483648),B:num(-1)}),0);
out(b('math_modulo',{}, {DIVIDEND:num(-5),DIVISOR:num(2)}),1);
for(const [OP,input,result] of [['SIN',30,.5],['COS',60,.5],['TAN',45,1],['ASIN',.5,30],['ACOS',.5,60],['ATAN',1,45]])out(b('math_trig',{OP},{NUM:num(input)}),result);
for(const [OP,input,result] of [['ABS',-5,5],['ROOT',9,3],['LN',1,0],['LOG10',100,2],['EXP',0,1],['POW10',2,100]])out(b('math_single',{OP},{NUM:num(input)}),result);
for(const [OP,value,result] of [['ROUND',3.5,4],['ROUNDUP',3.1,4],['ROUNDDOWN',3.9,3]])out(b('math_round',{OP},{NUM:num(value)}),result);
for(const [value,result] of [[-1,0],[11,10],[5,5]])out(b('math_constrain',{}, {VALUE:num(value),LOW:num(0),HIGH:num(10)}),result);
const mapped=MODE=>b('arduino_map',{MODE},{VALUE:num(5),FROM_LOW:num(0),FROM_HIGH:num(10),TO_LOW:num(0),TO_HIGH:num(9)});
out(mapped('INT'),4);out(mapped('FLOAT'),4.5);
out(b('math_constrain',{}, {VALUE:inc(),LOW:num(0),HIGH:num(100)}),10);out(get(),10);
out(b('logic_operation',{OP:'AND'},{A:num(2),B:bool(true)}),1);
out(b('logic_operation',{OP:'OR'},{A:num(0),B:bool(false)}),0);
out(b('logic_negate',{}, {BOOL:num(0)}),1);
const mixed=b('logic_ternary',{}, {IF:num(0),THEN:bool(true),ELSE:num(3)});
steps.push(b('variables_set',{VAR:{id:'mixed'}},{VALUE:mixed}));out(get('mixed'),3);
out(b('logic_compare',{OP:'NEQ'},{A:b('arduino_address_of',{VAR:{id:'count'}}),B:b('logic_null')}),1);
const accept=b('arduino_library_call',{}, {ARG_0:b('logic_null')});accept.extraState={signature:{name:'acceptPointer',qualifiedName:'acceptPointer',header:'Arduino.h',library:'Test',returnType:'void',parameters:[{name:'value',type:'int *',kind:'cpp'}],supported:true}};
steps.push(accept);expected.push(1);
steps.push(b('arduino_random_seed',{}, {NUM:num(42)}));
for(let index=0;index<50;index++)out(b('arduino_random_int',{}, {FROM:num(1),TO:num(3)}),{range:[1,2],integer:true});
const rngOutput=b('controls_repeat_ext',{}, {TIMES:num(1000),DO:chain(b('variables_set',{VAR:{id:'rng'}},{VALUE:b('math_random_int',{}, {FROM:num(1),TO:num(3)})}),b('text_print',{}, {TEXT:get('rng')}))});
const randomStart=expected.length;steps.push(rngOutput);for(let i=0;i<1000;i++)expected.push({range:[1,3],integer:true});
out(b('math_random_int',{}, {FROM:num(3),TO:num(1)}),{range:[1,3],integer:true});
out(b('math_random_int',{}, {FROM:num(2147483647),TO:num(2147483647)}),2147483647);
out(b('math_random_int',{}, {FROM:num(-2147483648),TO:num(-2147483648)}),-2147483648);
for(let i=0;i<20;i++)out(b('math_random_int',{}, {FROM:num(-2147483648),TO:num(2147483647)}),{range:[-2147483648,2147483647],integer:true});
for(let i=0;i<20;i++)out(b('math_random_float'),{range:[0,1],exclusiveUpper:true});
out(b('arduino_bitwise',{OP:'AND'},{A:get(),B:num(7)}),2); // count is 10; exercise typed runtime conversion.
out(b('arduino_remainder',{}, {A:num(-5.9),B:num(2)}),-1);
out(b('arduino_bitwise',{OP:'AND'},{A:num(-5.9),B:num(7)}),3);
out(b('arduino_bitwise',{OP:'AND'},{A:num(2147483648),B:num(7)}),0);
out(b('arduino_bitwise',{OP:'AND'},{A:b('math_single',{OP:'ROOT'},{NUM:num(-1)}),B:num(7)}),0);
steps.push(b('variables_set',{VAR:{id:'rng'}},{VALUE:num(0)}));
out(b('arduino_remainder',{}, {A:num(5),B:get('rng')}),0);
for(const MODE of ['INT','FLOAT'])out(b('arduino_map',{MODE},{VALUE:num(1),FROM_LOW:get('rng'),FROM_HIGH:get('rng'),TO_LOW:num(0),TO_HIGH:num(1)}),0);
steps.push(b('variables_set',{VAR:{id:'rng'}},{VALUE:num(32)}));
for(const OP of ['SHL','SHR'])out(b('arduino_bitwise',{OP},{A:num(1),B:get('rng')}),0);
out(b('arduino_bitwise',{OP:'AND'},{A:inc(),B:num(7)}),3);out(get(),11);
out(b('logic_compare',{OP:'EQ'},{A:b('logic_null'),B:b('logic_null')}),1);
steps.push(b('variables_set',{VAR:{id:'rng'}},{VALUE:num(2147483646)}));
out(b('arduino_bitwise',{OP:'AND'},{A:get('rng'),B:num(3)}),2);
out(b('arduino_bitwise',{OP:'AND'},{A:b('arduino_bitwise',{OP:'XOR'},{A:get('rng'),B:num(0)}),B:num(3)}),2);
const source=state(b('arduino_cpp_declaration',{CODE:'void acceptPointer(int *value) { Serial.println(value == nullptr ? 1 : 0); }'}),b('arduino_setup',{}, {DO:chain(...steps)}),b('arduino_loop'));
const before=JSON.stringify(source),result=compile(source);
assert.deepStrictEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));assert.strictEqual(JSON.stringify(source),before);
assert.match(result.code,/double v_mixed = 0;/,'Boolean/number ternaries promote to number');
const bad=value=>compile(state(b('text_print',{}, {TEXT:value}))).diagnostics;
assert.ok(bad(b('arduino_remainder',{}, {A:num(1),B:num(0)})).some(issue=>/nonzero/.test(issue.message)));
assert.ok(bad(b('arduino_bitwise',{OP:'SHL'},{A:num(1),B:num(32)})).some(issue=>/0 to 31/.test(issue.message)));
assert.ok(bad(b('arduino_map',{MODE:'INT'},{VALUE:num(1),FROM_LOW:num(.1),FROM_HIGH:num(.2),TO_LOW:num(0),TO_HIGH:num(1)})).some(issue=>/endpoints must differ/.test(issue.message)));
assert.ok(bad(b('math_constrain',{}, {VALUE:num(1),LOW:num(10),HIGH:num(0)})).some(issue=>/lower constrain/.test(issue.message)));
assert.ok(bad(b('arduino_bitwise',{OP:'BAD);evil()'},{A:num(1),B:num(2)})).some(issue=>/valid op/.test(issue.message)));
assert.ok(bad(b('logic_ternary',{}, {IF:bool(true),THEN:num(1),ELSE:b('text',{TEXT:'no'})})).some(issue=>/compatible types/.test(issue.message)));
const workspace=new Blockly.Workspace();types.configureWorkspace(workspace);
const truth=Blockly.serialization.blocks.append(b('logic_operation',{OP:'AND'},{A:num(2),B:bool(true)}),workspace);
const ternary=Blockly.serialization.blocks.append(b('logic_ternary',{}, {IF:num(1),THEN:bool(true),ELSE:num(2)}),workspace);
assert.strictEqual(truth.getInputTargetBlock('A').type,'math_number');
assert.strictEqual(ternary.getInputTargetBlock('IF').type,'math_number');
assert.strictEqual(ternary.getInputTargetBlock('ELSE').type,'math_number');
const python=new Blockly.Workspace(),negate=python.newBlock('logic_negate'),literal=python.newBlock('math_number');
assert.strictEqual(python.connectionChecker.doTypeChecks(negate.getInput('BOOL').connection,literal.outputConnection),false,'Python condition sockets remain strict');
const toolbox=build({kind:'categoryToolbox',contents:[]}),math=toolbox.contents.find(item=>item.name==='Math'),logic=toolbox.contents.find(item=>item.name==='Logic');
for(const entry of [...math.contents,...logic.contents].filter(item=>item.kind==='block'))Blockly.serialization.blocks.append(entry,workspace);
const saved=Blockly.serialization.workspaces.save(workspace),copy=new Blockly.Workspace();types.configureWorkspace(copy);Blockly.serialization.workspaces.load(saved,copy);
assert.deepStrictEqual(Blockly.serialization.workspaces.save(copy),saved);
const xmlCopy=new Blockly.Workspace();types.configureWorkspace(xmlCopy);Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(workspace),xmlCopy);
assert.strictEqual(xmlCopy.getBlocksByType('arduino_map',false).length,1);
const visited=new Set(require('./test_control').visited);
function visit(block){if(!block)return;visited.add(block.type);Object.values(block.inputs||{}).forEach(input=>visit(input.block||input.shadow));visit(block.next?.block);}
source.blocks.blocks.forEach(visit);assert.deepStrictEqual(supportedBlockTypes.filter(type=>!visited.has(type)),[],'combined fixtures cover every supported block');
if(process.argv[2])fs.writeFileSync(process.argv[2],result.code);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'studiox-math-execution-'));
try {
 fs.writeFileSync(path.join(temporary,'Arduino.h'),`#pragma once
#include <stdint.h>
#include <cmath>
#include <string>
#include <iostream>
#include <iomanip>
using String = std::string;
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105
struct SerialOutput { void begin(unsigned long) {} template<class T> void println(T value) { std::cout << std::setprecision(17) << value << "\\n"; } };
static SerialOutput Serial;
static uint32_t rngState=1;
inline void randomSeed(unsigned long seed) { if(seed)rngState=(uint32_t)seed; }
inline long random(long upper) { rngState=rngState*1664525U+1013904223U; return upper>0 ? (long)((rngState>>1)%(uint32_t)upper) : 0; }
inline long random(long low,long high) { return low>=high ? low : low+random(high-low); }
inline long map(long value,long low,long high,long outLow,long outHigh) { return (value-low)*(outHigh-outLow)/(high-low)+outLow; }
#ifdef STUDIOX_TEST_AVR_FLOAT_DOUBLE
#define double float
#endif
`);
 fs.writeFileSync(path.join(temporary,'program.cpp'),result.code+'\nint main() { setup(); }\n');
 for(const precision of ['native','avr-float']) {
 const buildResult=cp.spawnSync('c++',['-std=c++11',...(precision==='avr-float' ? ['-DSTUDIOX_TEST_AVR_FLOAT_DOUBLE'] : []),'-I',temporary,path.join(temporary,'program.cpp'),'-o',path.join(temporary,'program')],{encoding:'utf8',timeout:30000});
 assert.strictEqual(buildResult.status,0,buildResult.stderr || buildResult.error?.message);
 const run=cp.spawnSync(path.join(temporary,'program'),[],{encoding:'utf8',timeout:10000});assert.strictEqual(run.status,0,run.stderr);
 const values=run.stdout.trim().split('\n').map(Number);assert.strictEqual(values.length,expected.length);
 expected.forEach((value,index)=>{
  const actual=values[index];assert.ok(Number.isFinite(actual),'finite result at '+index);
  if(typeof value==='number')assert.ok(Math.abs(actual-value)<=1e-7*Math.max(1,Math.abs(value)),index+': expected '+value+', got '+actual);
  else if(value.positive)assert.ok(actual>0);
  else {assert.ok(actual>=value.range[0] && (value.exclusiveUpper ? actual<value.range[1] : actual<=value.range[1]),'range at '+index+': '+actual);if(value.integer)assert.ok(Number.isInteger(actual));}
 });
 assert.deepStrictEqual([...new Set(values.slice(randomStart,randomStart+1000))].sort(),[1,2,3],'inclusive random reaches both endpoints');
 }
} finally {fs.rmSync(temporary,{recursive:true,force:true});for(const ws of [workspace,python,copy,xmlCopy])ws.dispose();}
console.log('Math/Logic passed: generated C++ numeric results, random bounds, single evaluation, bit operations, mapping, sizeof, null pointers, C++ conditions, toolbox, and JSON/XML recovery.');
