/* Arduino Control shapes and flow checks, scoped to its independent editor. */
(function (root) {
  function register(Blockly) {
    if (Blockly.Blocks.arduino_switch?.studioxControl) return;
    Blockly.Blocks.arduino_switch = {
      studioxControl:true,
      init:function () {
        this.caseCount_ = 2;this.hasDefault_ = true;
        this.appendValueInput('VALUE').setCheck(['Number','Boolean']).appendField('switch integer');
        this.setPreviousStatement(true);this.setNextStatement(true);this.setColour('#00979D');
        this.setTooltip('Each case breaks automatically. Right-click to add/remove cases or the default branch. Case values must be integer constants.');
        this.updateShape_();
      },
      updateShape_:function () {
        for (const input of this.inputList.slice()) {
          const match=/^(?:CASE|DO)(\d+)$/.exec(input.name);
          if (match && Number(match[1]) >= this.caseCount_ || input.name === 'DEFAULT' && !this.hasDefault_) this.removeInput(input.name);
        }
        for (let index=0;index<this.caseCount_;index++) {
          if (!this.getInput('CASE'+index)) {
            this.appendValueInput('CASE'+index).setCheck(['Number','Boolean']).appendField('case');
            this.getInput('CASE'+index).connection.setShadowState({type:'math_number',fields:{NUM:index+1}});
            this.appendStatementInput('DO'+index).appendField('do');
          }
        }
        if (this.hasDefault_ && !this.getInput('DEFAULT')) this.appendStatementInput('DEFAULT').appendField('default');
        if (this.getInput('DEFAULT')) this.moveInputBefore('DEFAULT',null);
      },
      saveExtraState:function () {
        const defaults={};
        for (let index=0;index<this.caseCount_;index++) {
          const value=this.getInputTargetBlock('CASE'+index);
          if (value?.isShadow()) defaults['CASE'+index]=Blockly.serialization.blocks.save(value,{addNextBlocks:false,saveIds:false});
        }
        return {caseCount:this.caseCount_,hasDefault:this.hasDefault_,defaults};
      },
      loadExtraState:function (state) {
        this.caseCount_=Math.max(1,Math.min(16,Math.trunc(Number(state?.caseCount)||2)));
        this.hasDefault_=state?.hasDefault !== false;this.updateShape_();
        for (const [name,value] of Object.entries(state?.defaults || {})) {
          const input=this.getInput(name);
          if (input?.connection && (!input.connection.targetBlock() || input.connection.targetBlock().isShadow())) input.connection.setShadowState(value);
        }
      },
      mutationToDom:function () {
        const element=Blockly.utils.xml.createElement('mutation');
        element.setAttribute('cases',String(this.caseCount_));element.setAttribute('default',String(this.hasDefault_));return element;
      },
      domToMutation:function (element) {this.loadExtraState({caseCount:Number(element.getAttribute('cases')),hasDefault:element.getAttribute('default') !== 'false'});},
      customContextMenu:function (items) {
        const change=action=>()=>{
          const group=Blockly.Events.getGroup();Blockly.Events.setGroup(group || true);
          try {
            const before=JSON.stringify(this.saveExtraState());action();this.updateShape_();
            Blockly.Events.fire(new Blockly.Events.BlockChange(this,'mutation',null,before,JSON.stringify(this.saveExtraState())));
          } finally {Blockly.Events.setGroup(group);}
        };
        items.push({text:'Add case',enabled:this.caseCount_<16,callback:change(()=>++this.caseCount_)});
        items.push({text:'Remove last case',enabled:this.caseCount_>1,callback:change(()=>--this.caseCount_)});
        items.push({text:this.hasDefault_ ? 'Hide default branch' : 'Show default branch',enabled:true,callback:change(()=>this.hasDefault_=!this.hasDefault_)});
      },
    };
  }
  function configureWorkspace(workspace,Blockly) {
    if (workspace.studioxControlFlow_) return;workspace.studioxControlFlow_=true;
    const loops=new Set(['controls_repeat','controls_repeat_ext','controls_for','controls_forEach','controls_whileUntil','arduino_do_while']);
    const functions=new Set(['arduino_setup','arduino_loop','arduino_button_event','arduino_attach_interrupt','arduino_attach_pin_change_interrupt',
      'arduino_timer2_configure','arduino_timer_every','arduino_timer_callback','arduino_task']);
    function update() {
      for (const block of workspace.getBlocksByType('controls_flow_statements',false)) {
        if (block.studioxControlFlow_) continue;block.studioxControlFlow_=true;
        block.getSurroundLoop=function () {
          for (let parent=this.getSurroundParent();parent;parent=parent.getSurroundParent()) {
            if (loops.has(parent.type) || parent.type==='arduino_switch' && this.getFieldValue('FLOW')==='BREAK') return parent;
            if (functions.has(parent.type)) return null;
          }
          return null;
        };
      }
    }
    workspace.addChangeListener(event=>{if(!event.isUiEvent)update();});update();
  }
  const api={register,configureWorkspace};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  root.StudioXArduinoControlBlocks=api;
})(typeof window !== 'undefined' ? window : globalThis);
