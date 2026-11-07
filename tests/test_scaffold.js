const assert=require('assert');
const {split}=require('../frontend/scaffold');
const state={variables:[{id:'x',name:'x'}],blocks:{blocks:[
 {type:'arduino_setup',inputs:{DO:{block:{type:'arduino_delay',id:'first',next:{block:{type:'arduino_delay',id:'second'}}}}}},
 {type:'arduino_loop',disabledReasons:['MANUALLY_DISABLED'],inputs:{DO:{block:{type:'arduino_delay',id:'loop'}}}},
 {type:'arduino_include',fields:{HEADER:'Servo.h'}}]}};
const before=JSON.stringify(state),result=split(state);
assert.strictEqual(JSON.stringify(state),before);
assert.deepStrictEqual(result.targets,['arduino_setup','arduino_loop',null]);
assert.strictEqual(result.state.blocks.blocks[0].next.block.id,'second');
assert.ok(result.state.blocks.blocks[1].disabledReasons.includes('MANUALLY_DISABLED'));
assert.deepStrictEqual(result.state.variables,state.variables);
console.log('Permanent scaffold transfer passed: entry bodies, standalone globals, disabled content, variables, and source isolation.');
