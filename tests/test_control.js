/* Old Control operations, scheduling semantics, dynamic switch shapes, and scopes. */
const assert=require('assert'),fs=require('fs'),path=require('path');
const Blockly=require(path.resolve(__dirname,'../../blockly/node_modules/blockly'));
require(path.resolve(__dirname,'../../blockly/node_modules/blockly/blocks'));
Blockly.defineBlocksWithJsonArray(require('../blocks/blocks.json').filter(definition=>!Blockly.Blocks[definition.type]).map(({python,...definition})=>definition));
const control=require('../frontend/controlBlocks');control.register(Blockly);
const {compile,supportedBlockTypes}=require('../frontend/compiler'),{build}=require('../frontend/toolbox');
let id=0;
const b=(type,fields={},inputs={})=>({type,id:'ctrl_'+(++id),fields,inputs:Object.fromEntries(Object.entries(inputs).map(([name,block])=>[name,{block}]))});
const num=NUM=>b('math_number',{NUM}),bool=BOOL=>b('logic_boolean',{BOOL:BOOL?'TRUE':'FALSE'});
const chain=(...items)=>{items.forEach((item,index)=>{if(items[index+1])item.next={block:items[index+1]}});return items[0];};
const state=(...blocks)=>({variables:[{id:'count',name:'count'}],blocks:{languageVersion:0,blocks}});
const change=()=>b('math_change',{VAR:{id:'count'}},{DELTA:num(1)});
const print=TEXT=>b('text_print',{}, {TEXT});
const good=snapshot=>{const result=compile(snapshot);assert.deepStrictEqual(result.diagnostics,[],JSON.stringify(result.diagnostics));return result.code;};
const selection=()=>b('arduino_switch',{}, {VALUE:b('variables_get',{VAR:{id:'count'}}),CASE0:num(0),DO0:change(),CASE1:num(1),DO1:b('controls_flow_statements',{FLOW:'BREAK'}),DEFAULT:change()});
const source=state(
 b('arduino_setup',{}, {DO:chain(
  b('variables_set',{VAR:{id:'count'}},{VALUE:b('arduino_type',{TYPE:'int'})}),
  b('arduino_delay',{}, {MS:num(1)}),b('arduino_delay',{UNIT:'US'},{MS:num(10)}),
  b('arduino_no_interrupts'),b('arduino_interrupts'),
  b('arduino_timer2_configure',{}, {INTERVAL:num(500),DO:change()}),b('arduino_timer2_start'),b('arduino_timer2_stop'),
  b('arduino_timer_schedule',{ID:'1'},{INTERVAL:num(1000),COUNT:num(1)}),
  b('controls_if',{}, {IF0:bool(false),DO0:b('arduino_end_program')})
 )}),
 b('arduino_loop',{}, {DO:chain(
  b('arduino_do_while',{MODE:'WHILE'},{BOOL:bool(false),DO:change()}),
  b('arduino_do_while',{MODE:'UNTIL'},{BOOL:bool(true),DO:b('controls_flow_statements',{FLOW:'CONTINUE'})}),
  selection(),print(b('arduino_millis')),print(b('arduino_millis',{UNIT:'US'})),b('arduino_task_yield')
 )}),
 b('arduino_timer_every',{ID:'1'},{INTERVAL:num(1000),DO:change()}),
 b('arduino_timer_callback',{ID:'1'},{DO:change()}),
 b('arduino_task',{ID:'1'},{SETUP:change(),LOOP:chain(b('arduino_task_sleep',{}, {MS:num(10)}),b('arduino_task_yield'))}),
 b('arduino_task',{ID:'2'},{LOOP:b('arduino_task_sleep',{}, {MS:num(20)})}),
);
const original=JSON.stringify(source),code=good(source);
assert.strictEqual(JSON.stringify(source),original);
assert.match(code,/do \{\n[\s\S]*\} while \(false\);/);
assert.match(code,/\} while \(!\(true\)\);/);
assert.match(code,/case 0: \{/);assert.match(code,/default: \{/);
assert.match(code,/delay\(1\);/);assert.match(code,/delayMicroseconds\(10\);/);assert.match(code,/micros\(\)/);
assert.match(code,/while \(true\) \{\}/);
assert.match(code,/MsTimer2::set\(500, sx_hardware_timer\);/);assert.match(code,/MsTimer2::start\(\);/);assert.match(code,/MsTimer2::stop\(\);/);
assert.strictEqual((code.match(/SimpleTimer sx_timer;/g)||[]).length,1);
assert.strictEqual((code.match(/sx_timer.run\(\);/g)||[]).length,1);
assert.match(code,/sx_timer.setInterval\(1000, sx_every_1\);/);assert.match(code,/sx_timer.setTimer\(1000, sx_action_1, 1\);/);
assert.match(code,/volatile int v_count = 0;/);
assert.strictEqual((code.match(/mySCoop.start\(\);/g)||[]).length,1);
assert.match(code,/defineTask\(sx_task_1\)/);assert.match(code,/defineTask\(sx_task_2\)/);
assert.match(code,/void sx_task_1::loop\(\) \{\n  sleep\(10\);\n  yield\(\);/);
assert.match(code,/void loop\(\) \{\n  mySCoop.yield\(\);\n  sx_timer.run\(\);/);
const bad=s=>compile(s).diagnostics;
assert.ok(bad(state(b('arduino_timer2_start'))).some(item=>/Configure/.test(item.message)));
assert.ok(bad(state(b('arduino_timer2_configure',{}, {INTERVAL:num(1)}),b('arduino_timer2_configure',{}, {INTERVAL:num(2)}))).some(item=>/only one/.test(item.message)));
assert.ok(bad(state(b('arduino_timer_schedule',{ID:'2'},{INTERVAL:num(1),COUNT:num(1)}))).some(item=>/Define scheduled action 2/.test(item.message)));
assert.ok(bad(state(b('arduino_timer_every',{ID:'1'},{INTERVAL:num(1)}),b('arduino_timer_every',{ID:'1'},{INTERVAL:num(1)}))).some(item=>/already defined/.test(item.message)));
assert.ok(bad(state(b('arduino_task',{ID:'1'}),b('arduino_task',{ID:'1'}))).some(item=>/already defined/.test(item.message)));
assert.ok(bad(state(b('arduino_task_sleep',{}, {MS:num(1)}))).some(item=>/inside a cooperative task/.test(item.message)));
const nestedCallback=b('arduino_task',{ID:'1'},{LOOP:b('arduino_timer2_configure',{}, {INTERVAL:num(1),DO:b('arduino_task_sleep',{}, {MS:num(1)})})});
assert.ok(bad(state(nestedCallback)).some(item=>/inside a cooperative task/.test(item.message)),'timer callbacks do not inherit task member scope');
const duplicate=selection();duplicate.inputs.CASE1={block:num(0)};
assert.ok(bad(state(duplicate)).some(item=>/unique/.test(item.message)));
const fraction=selection();fraction.inputs.CASE0={block:num(1.5)};
assert.ok(bad(state(fraction)).some(item=>/integer constants/.test(item.message)));
const runtimeCase=selection();runtimeCase.inputs.CASE0={block:b('variables_get',{VAR:{id:'count'}})};
assert.ok(bad(state(runtimeCase)).some(item=>/integer constant/.test(item.message)));
const continueSwitch=selection();continueSwitch.inputs.DO0={block:b('controls_flow_statements',{FLOW:'CONTINUE'})};
assert.ok(bad(state(continueSwitch)).some(item=>/continue must be inside a loop/.test(item.message)));
good(state(b('controls_whileUntil',{MODE:'WHILE'},{BOOL:bool(false),DO:continueSwitch})));
for (const owner of [b('arduino_soft_pwm_stop',{}, {PIN:num(4)}),b('arduino_no_tone',{}, {PIN:num(8)})]) {
 assert.ok(bad(state(b('arduino_timer2_configure',{}, {INTERVAL:num(1)}),owner)).some(item=>/Timer2/.test(item.message)));
}
const sharedSource={kind:'categoryToolbox',contents:[
 {kind:'category',name:'Logic',contents:[{kind:'block',type:'controls_if'},{kind:'block',type:'logic_boolean'}]},
 {kind:'category',name:'Loops',contents:['controls_whileUntil','controls_for','controls_flow_statements','controls_repeat_ext'].map(type=>({kind:'block',type}))},
]};
const sharedBefore=JSON.stringify(sharedSource),toolbox=build(sharedSource);
assert.strictEqual(JSON.stringify(sharedSource),sharedBefore,'organizing Arduino categories must not mutate the Python toolbox');
const category=toolbox.contents.find(item=>item.name==='Control');
assert.deepStrictEqual(category.contents.map(item=>item.type),['arduino_end_program','arduino_do_while','arduino_delay','arduino_switch','arduino_millis','arduino_timer2_configure','arduino_timer2_start','arduino_timer2_stop','arduino_timer_every','arduino_timer_callback','arduino_timer_schedule','arduino_interrupts','arduino_no_interrupts','arduino_task','arduino_task_yield','arduino_task_sleep']);
assert.ok(toolbox.contents.find(item=>item.name==='Logic').contents.some(item=>item.type==='controls_if'));
for(const type of ['controls_whileUntil','controls_for','controls_flow_statements','controls_repeat_ext']) {
 assert.ok(toolbox.contents.find(item=>item.name==='Loops').contents.some(item=>item.type===type),type+' remains in Loops');
 assert.ok(!category.contents.some(item=>item.type===type),type+' is not duplicated in Control');
}
assert.ok(!category.contents.some(item=>item.type==='controls_if'),'If is not duplicated in Control');
const workspace=new Blockly.Workspace();control.configureWorkspace(workspace,Blockly);
for(const entry of category.contents)Blockly.serialization.blocks.append(entry,workspace);
const saved=Blockly.serialization.workspaces.save(workspace),copy=new Blockly.Workspace();control.configureWorkspace(copy,Blockly);Blockly.serialization.workspaces.load(saved,copy);
assert.deepStrictEqual(Blockly.serialization.workspaces.save(copy),saved);
const xmlCopy=new Blockly.Workspace();control.configureWorkspace(xmlCopy,Blockly);Blockly.Xml.domToWorkspace(Blockly.Xml.workspaceToDom(workspace),xmlCopy);
assert.strictEqual(xmlCopy.getBlocksByType('arduino_switch',false).length,1);
const visited=new Set(require('./test_io').visited);
function visit(block){if(!block)return;visited.add(block.type);Object.values(block.inputs||{}).forEach(input=>visit(input.block||input.shadow));visit(block.next?.block);}
source.blocks.blocks.forEach(visit);
module.exports={visited}; // Extended by the Math/Logic target coverage fixture.
if(require.main===module && process.argv[2])fs.writeFileSync(process.argv[2],code);
if(require.main===module)(async()=>{
 const switchBlock=workspace.getBlocksByType('arduino_switch',false)[0];
 const menu=[];switchBlock.customContextMenu(menu);menu.find(item=>item.text==='Add case').callback();
 assert.strictEqual(switchBlock.caseCount_,3);switchBlock.getInputTargetBlock('CASE2').setFieldValue(7,'NUM');
 await new Promise(resolve=>setTimeout(resolve,30));workspace.clearUndo();
 const removal=[];switchBlock.customContextMenu(removal);removal.find(item=>item.text==='Remove last case').callback();
 await new Promise(resolve=>setTimeout(resolve,30));workspace.undo(false);
 assert.strictEqual(switchBlock.caseCount_,3);assert.strictEqual(switchBlock.getInputTargetBlock('CASE2').getFieldValue('NUM'),7,'Undo preserves an edited case constant');
 const flow=workspace.newBlock('controls_flow_statements');flow.setFieldValue('BREAK','FLOW');switchBlock.getInput('DO0').connection.connect(flow.previousConnection);
 await new Promise(resolve=>setTimeout(resolve,30));assert.strictEqual(flow.getSurroundLoop(),switchBlock);
 const whileBlock=workspace.getBlocksByType('arduino_do_while',false)[0];flow.unplug();whileBlock.getInput('DO').connection.connect(flow.previousConnection);
 assert.strictEqual(flow.getSurroundLoop(),whileBlock);
 for(const ws of [workspace,copy,xmlCopy])ws.dispose();
 console.log('Control passed: old section order, switch/loops/scopes, microsecond units, timers, scheduled actions, cooperative tasks, serialization, and Undo.');
})().catch(error=>{console.error(error);process.exitCode=1;});
