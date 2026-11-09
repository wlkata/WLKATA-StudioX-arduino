/* External-interrupt pins from the Arduino AVR core's board variants. */
(function (root) {
  const defaultBoard = 'arduino:avr:uno';
  const profiles = {
    uno:[2,3], nano:[2,3], mega:[2,3,18,19,20,21], megaADK:[2,3,18,19,20,21],
    leonardo:[0,1,2,3,7], micro:[0,1,2,3,7],
  };
  function interruptPins(board) {
    const [vendor,architecture,name] = String(board || '').split(':');
    return vendor === 'arduino' && architecture === 'avr' && profiles[name] ? profiles[name].map(String) : null;
  }
  function boardFor(block) {
    let workspace = block?.workspace;
    workspace = workspace?.targetWorkspace || workspace;
    return workspace?.studioxArduinoBoard ?? defaultBoard;
  }
  function options(field, block = field.getSourceBlock()) {
    const pins = interruptPins(boardFor(block));
    const current = field.restoringPin_ || field.getValue();
    const result = pins ? pins.map(pin => [pin,pin]) : [['Check board pinout','?']];
    if (pins && current === '?') result.unshift(['Choose an interrupt pin','?']);
    if (pins && current && /^\d{1,3}$/.test(current) && !pins.includes(current)) {
      result.unshift([current + ' (not supported on this board)',current]);
    }
    return result;
  }
  function register(Blockly) {
    if (Blockly.Blocks.arduino_interrupt_pin?.studioxBoardPins) return;
    class InterruptPinField extends Blockly.FieldDropdown {
      constructor(block) {
        super(function () { return options(this,block); });
        this.pinBlock_ = block;
      }
      doClassValidation_(value) {
        value = String(value);
        // Keep the previous number while an unknown board shows its placeholder.
        // Preserve invalid numeric pins on known boards for correction or Undo.
        if (/^\d{1,3}$/.test(value)) {
          this.previousPin_ = value;
          return interruptPins(boardFor(this.getSourceBlock() || this.pinBlock_)) ? value : '?';
        }
        return value === '?' ? value : null;
      }
      doValueUpdate_(value) {
        this.restoringPin_ = value;
        this.getOptions(false);
        try { super.doValueUpdate_(value); } finally { this.restoringPin_ = null; }
      }
      loadState(state) {
        super.loadState(state);
        this.refreshBoard();
      }
      fromXml(element) { this.loadState(element.textContent); }
      refreshBoard() {
        const pins = interruptPins(boardFor(this.getSourceBlock() || this.pinBlock_));
        const current = this.getValue();
        const selected = pins ? (current === '?' ? this.previousPin_ || pins[0] : current) : '?';
        const previous = this.previousPin_;
        this.setOptions(function () { return options(this); });
        // setOptions selects the first item. Restore the remembered value before
        // selecting, so a refresh cannot replace it with the board's default.
        this.previousPin_ = previous;
        this.setValue(selected);
      }
    }
    Blockly.Blocks.arduino_interrupt_pin = {
      studioxBoardPins:true,
      init:function () {
        this.appendDummyInput().appendField('interrupt pin').appendField(new InterruptPinField(this),'PIN');
        this.setOutput(true,'Number');this.setColour('#00979D');
        this.setTooltip('Choose a hardware-interrupt pin for the selected board. If the pin list is unavailable, check the board pinout and replace this dropdown with a pin value. Pin-change interrupts use different pins.');
      },
      saveExtraState:function () {
        const previous = this.getField('PIN').previousPin_;
        return previous ? {previousPin:previous} : null;
      },
      loadExtraState:function (state) {
        const previous = String(state?.previousPin ?? '');
        this.getField('PIN').previousPin_ = /^\d{1,3}$/.test(previous) ? previous : null;
      },
      mutationToDom:function () {
        const element = Blockly.utils.xml.createElement('mutation');
        const previous = this.saveExtraState()?.previousPin;
        if (previous) element.setAttribute('previous-pin',previous);
        return element;
      },
      domToMutation:function (element) { this.loadExtraState({previousPin:element.getAttribute('previous-pin')}); },
    };
  }
  function setBoard(workspace, board, Blockly) {
    workspace.studioxArduinoBoard = board || defaultBoard;
    const workspaces = [workspace,workspace.getFlyout?.()?.getWorkspace()].filter(Boolean);
    const previous = Blockly.Events.isEnabled();
    if (previous) Blockly.Events.disable();
    try {
      for (const target of workspaces) for (const block of target.getBlocksByType('arduino_interrupt_pin',false)) {
        block.getField('PIN')?.refreshBoard?.();
      }
    } finally { if (previous) Blockly.Events.enable(); }
  }
  const api = {defaultBoard,interruptPins,register,setBoard};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.StudioXArduinoBoardPins = api;
})(typeof window !== 'undefined' ? window : globalThis);
